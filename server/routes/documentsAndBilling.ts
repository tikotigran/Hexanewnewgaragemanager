import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { getDataDir, getDb } from '../db/database';
import { type AuthedRequest, logAudit, requireAuth } from '../middleware/auth';
import {
  calculateVatBreakdown,
  checkVatRegimeEligibility,
  type VatRegime,
} from '../services/taxService';
import {
  generateFacturXXml,
  StubPlateformeAgreeeAdapter,
  validateFacturXXml,
} from '../services/facturxService';
import {
  generateCerfaPreparationPdf,
  generateInvoicePdf,
  generateStructuredPdf,
} from '../services/pdfService';
import {
  formatFullAddress,
  resolvePdfBrandingFromSettings,
  type CompanySettingsData,
} from '../services/brandingPdfHelpers';

function loadUserAppSettings(db: ReturnType<typeof getDb>, userId: number): Record<string, unknown> {
  const rows = db
    .prepare('SELECT key, value_json FROM app_settings WHERE user_id = ?')
    .all(userId) as Array<{ key: string; value_json: string }>;
  const settings: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      settings[r.key] = JSON.parse(r.value_json);
    } catch {
      settings[r.key] = r.value_json;
    }
  }
  return settings;
}

const router = Router();
router.use(requireAuth);

function getDocsDir(): string {
  const dir = path.resolve(getDataDir(), 'documents');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ==================== FACTURATION & FACTUR-X ====================
const invoiceLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().int().min(1).default(1),
  unit_price_ttc_cents: z.number().int().min(0),
});

const invoiceCreateSchema = z.object({
  business_profile_id: z.number().int().positive(),
  sale_id: z.number().int().positive().nullable().optional(),
  vehicle_id: z.number().int().positive().nullable().optional(),
  contact_id: z.number().int().positive().nullable().optional(),
  invoice_number: z.string().max(60).optional(),
  issue_date: z.string().min(8),
  due_date: z.string().min(8),
  vat_regime: z.enum(['franchise_en_base', 'tva_sur_marge', 'tva_sur_prix_total', 'autre_regime']),
  vat_rate_bps: z.number().int().min(0).max(5000).optional().default(2000),
  vat_legal_mention: z.string().max(400).optional(),
  payment_terms: z.string().max(200).optional().default('Paiement à réception'),
  facturx_profile: z.enum(['MINIMUM', 'BASIC', 'EN16931']).optional().default('BASIC'),
  notes: z.string().max(2000).optional().default(''),
  issue_immediately: z.boolean().optional().default(false),
  lines: z.array(invoiceLineSchema).min(1),
});

router.get('/invoices', (req: AuthedRequest, res) => {
  const db = getDb();
  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim();

  const where = ['i.user_id = ?'];
  const params: unknown[] = [req.user!.id];
  if (status && status !== 'all') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(i.invoice_number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const invoices = db
    .prepare(
      `SELECT i.*, bp.nom_commercial AS business_profile_name,
        c.first_name, c.last_name, c.company_name,
        v.marque, v.modele, v.immatriculation, v.vin
       FROM invoices i
       LEFT JOIN business_profiles bp ON bp.id = i.business_profile_id
       LEFT JOIN contacts c ON c.id = i.contact_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.issue_date DESC, i.id DESC`
    )
    .all(...params);

  res.json({ invoices });
});

router.get('/invoices/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const invoice = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?')
    .get(id, req.user!.id);
  if (!invoice) {
    res.status(404).json({ error: 'Facture introuvable.' });
    return;
  }
  const lines = db
    .prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC')
    .all(id);
  const payments = db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, id DESC')
    .all(id);
  res.json({ invoice, lines, payments });
});

router.post('/invoices', (req: AuthedRequest, res) => {
  const parsed = invoiceCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données facture invalides', details: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const db = getDb();
  const userId = req.user!.id;

  const bp = db
    .prepare(
      `SELECT bp.* FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE bp.id = ? AND ubp.user_id = ?`
    )
    .get(d.business_profile_id, userId) as Record<string, unknown> | undefined;

  if (!bp) {
    res.status(403).json({ error: 'Profil professionnel invalide ou non autorisé.' });
    return;
  }

  let purchasePriceTtc = 0;
  let eligibilityWarning: string | undefined;
  if (d.vehicle_id) {
    const vehicle = db
      .prepare('SELECT prix_achat_cents, legal_context FROM vehicles WHERE id = ? AND user_id = ?')
      .get(d.vehicle_id, userId) as { prix_achat_cents: number; legal_context: 'personal' | 'professional' } | undefined;
    if (vehicle) {
      purchasePriceTtc = vehicle.prix_achat_cents;
      const purchase = db
        .prepare('SELECT vat_regime, seller_type FROM purchases WHERE vehicle_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1')
        .get(d.vehicle_id, userId) as { vat_regime: string; seller_type: string } | undefined;
      const elig = checkVatRegimeEligibility({
        legalContext: vehicle.legal_context,
        requestedRegime: d.vat_regime,
        purchaseVatRegime: purchase?.vat_regime || 'hors_tva',
        sellerTypeAtPurchase: purchase?.seller_type || 'particulier',
      });
      if (!elig.eligible) {
        eligibilityWarning = elig.warningMessage;
      }
    }
  }

  const totalTtcCents = d.lines.reduce((s, l) => s + l.quantity * l.unit_price_ttc_cents, 0);
  const vatCalc = calculateVatBreakdown({
    amountTtcCents: totalTtcCents,
    purchasePriceTtcCents: purchasePriceTtc,
    vatRegime: d.vat_regime,
    vatRateBps: d.vat_rate_bps,
    customMention: d.vat_legal_mention,
  });

  const buyer = d.contact_id
    ? (db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(d.contact_id, userId) as Record<
        string,
        unknown
      > | null)
    : null;

  const year = d.issue_date.slice(0, 4) || new Date().getFullYear().toString();
  const countRow = db
    .prepare('SELECT COUNT(*) as c FROM invoices WHERE user_id = ?')
    .get(userId) as { c: number };
  const invNumber = d.invoice_number?.trim() || `FAC-${year}-${String(countRow.c + 1).padStart(4, '0')}`;

  const buyerName = buyer
    ? (buyer.company_name as string) || `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim()
    : 'Client comptoir';

  const xml = generateFacturXXml({
    invoiceNumber: invNumber,
    issueDate: d.issue_date,
    dueDate: d.due_date,
    currency: 'EUR',
    profile: d.facturx_profile,
    seller: {
      name: `${bp.nom_commercial} (${bp.raison_sociale})`,
      siret: String(bp.siret || ''),
      vatNumber: String(bp.tva_intracom || ''),
      address: String(bp.adresse_pro || 'France'),
      countryCode: 'FR',
    },
    buyer: {
      name: buyerName,
      siret: buyer ? String(buyer.siret || '') : undefined,
      address: buyer ? `${buyer.address || ''} ${buyer.postal_code || ''} ${buyer.city || ''}`.trim() : 'France',
      countryCode: 'FR',
    },
    lines: d.lines.map((l) => {
      const lineTtc = l.quantity * l.unit_price_ttc_cents;
      const lineBreakdown = calculateVatBreakdown({
        amountTtcCents: lineTtc,
        purchasePriceTtcCents: purchasePriceTtc,
        vatRegime: d.vat_regime,
        vatRateBps: d.vat_rate_bps,
      });
      return {
        description: l.description,
        quantity: l.quantity,
        unitPriceHtCents: Math.round(lineBreakdown.subtotalHtCents / l.quantity),
        vatRateBps: d.vat_regime === 'tva_sur_prix_total' ? d.vat_rate_bps : 0,
        vatCents: lineBreakdown.vatCents,
        totalTtcCents: lineTtc,
      };
    }),
    subtotalHtCents: vatCalc.subtotalHtCents,
    vatCents: vatCalc.vatCents,
    totalTtcCents: vatCalc.totalTtcCents,
    vatLegalMention: vatCalc.legalMention,
    paymentTerms: d.payment_terms,
  });

  const xmlValidation = validateFacturXXml(xml);

  const invoice = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO invoices (
          user_id, business_profile_id, sale_id, vehicle_id, contact_id, invoice_number,
          status, issue_date, due_date, vat_regime, vat_legal_mention, currency,
          subtotal_ht_cents, vat_cents, total_ttc_cents, paid_cents, payment_terms,
          facturx_profile, xml_content, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        userId,
        d.business_profile_id,
        d.sale_id ?? null,
        d.vehicle_id ?? null,
        d.contact_id ?? null,
        invNumber,
        d.issue_immediately ? 'emise' : 'brouillon',
        d.issue_date,
        d.due_date,
        d.vat_regime,
        vatCalc.legalMention,
        vatCalc.subtotalHtCents,
        vatCalc.vatCents,
        vatCalc.totalTtcCents,
        d.payment_terms,
        d.facturx_profile,
        xml,
        d.notes
      );

    const invoiceId = Number(info.lastInsertRowid);
    d.lines.forEach((l, idx) => {
      const lineTtc = l.quantity * l.unit_price_ttc_cents;
      const lb = calculateVatBreakdown({
        amountTtcCents: lineTtc,
        purchasePriceTtcCents: purchasePriceTtc,
        vatRegime: d.vat_regime,
        vatRateBps: d.vat_rate_bps,
      });
      db.prepare(
        `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_ht_cents, vat_rate_bps, vat_cents, total_ttc_cents, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invoiceId,
        l.description,
        l.quantity,
        Math.round(lb.subtotalHtCents / l.quantity),
        d.vat_regime === 'tva_sur_prix_total' ? d.vat_rate_bps : 0,
        lb.vatCents,
        lineTtc,
        idx
      );
    });

    return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  })();

  logAudit(userId, 'INVOICE_CREATE', 'invoice', (invoice as { id: number }).id, { invNumber, vat_regime: d.vat_regime }, req.ip || '');
  res.status(201).json({ invoice, xmlValidation, eligibilityWarning });
});

router.post('/invoices/:id/issue', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, req.user!.id) as
    | Record<string, unknown>
    | undefined;
  if (!inv) {
    res.status(404).json({ error: 'Facture introuvable.' });
    return;
  }
  db.prepare("UPDATE invoices SET status = 'emise', updated_at = datetime('now') WHERE id = ?").run(id);
  res.json({ invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) });
});

router.post('/invoices/:id/payments', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    amount_cents: z.number().int().positive(),
    payment_date: z.string().min(8),
    payment_method: z.string().max(40).default('virement'),
    reference: z.string().max(120).optional().default(''),
    notes: z.string().max(500).optional().default(''),
    idempotency_key: z.string().max(120).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Montant ou date de paiement invalide.' });
    return;
  }

  const d = parsed.data;
  const db = getDb();
  const userId = req.user!.id;

  const result = db.transaction(() => {
    if (d.idempotency_key) {
      const existing = db
        .prepare('SELECT id FROM payments WHERE idempotency_key = ? AND user_id = ?')
        .get(d.idempotency_key, userId);
      if (existing) {
        return { duplicate: true, invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) };
      }
    }

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, userId) as
      | (Record<string, unknown> & { total_ttc_cents: number; paid_cents: number; invoice_number: string })
      | undefined;

    if (!inv) throw new Error('INVOICE_NOT_FOUND');

    const remaining = inv.total_ttc_cents - inv.paid_cents;
    if (remaining <= 0) throw new Error('ALREADY_PAID');

    const applied = Math.min(d.amount_cents, remaining);
    const newPaid = inv.paid_cents + applied;
    const newStatus = newPaid >= inv.total_ttc_cents ? 'payee' : 'partiellement_payee';

    db.prepare(
      `INSERT INTO payments (user_id, invoice_id, amount_cents, payment_date, payment_method, reference, notes, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, id, applied, d.payment_date, d.payment_method, d.reference, d.notes, d.idempotency_key || null);

    db.prepare("UPDATE invoices SET paid_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(
      newPaid,
      newStatus,
      id
    );

    if (!inv.sale_id) {
      // Standalone invoice inflow transaction
      db.prepare(
        `INSERT INTO financial_transactions (
          user_id, business_profile_id, vehicle_id, contact_id, invoice_id,
          legal_context, direction, category, amount_cents, operation_date, payment_date, payment_method, payment_status, description
        ) VALUES (?, ?, ?, ?, ?, 'professional', 'inflow', 'facture_client', ?, ?, ?, ?, 'paye', ?)`
      ).run(
        userId,
        inv.business_profile_id,
        inv.vehicle_id,
        inv.contact_id,
        id,
        applied,
        d.payment_date,
        d.payment_date,
        d.payment_method,
        `Paiement facture ${inv.invoice_number}`
      );
    }

    return { duplicate: false, invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) };
  })();

  res.json(result);
});

router.get('/invoices/:id/pdf', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const userId = req.user!.id;

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, userId) as
    | Record<string, unknown>
    | undefined;
  if (!inv) {
    res.status(404).json({ error: 'Facture introuvable.' });
    return;
  }

  const bp = db.prepare('SELECT * FROM business_profiles WHERE id = ?').get(inv.business_profile_id) as Record<
    string,
    unknown
  >;
  const buyer = inv.contact_id
    ? (db.prepare('SELECT * FROM contacts WHERE id = ?').get(inv.contact_id) as Record<string, unknown> | undefined)
    : undefined;
  const vehicle = inv.vehicle_id
    ? (db.prepare('SELECT * FROM vehicles WHERE id = ?').get(inv.vehicle_id) as Record<string, unknown> | undefined)
    : undefined;
  const lines = db
    .prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC')
    .all(id) as Array<{
    description: string;
    quantity: number;
    unit_price_ht_cents: number;
    vat_rate_bps: number;
    total_ttc_cents: number;
  }>;

  const appSettings = loadUserAppSettings(db, userId);
  const companyCfg = (appSettings.company_settings || {}) as Partial<CompanySettingsData>;
  const mergedAddress =
    String(bp?.adresse_pro || '').trim() ||
    formatFullAddress({
      address: companyCfg.address,
      postalCode: companyCfg.postalCode,
      city: companyCfg.city,
      country: companyCfg.country,
    });
  const ibanStr = String(bp?.iban || companyCfg.iban || '').trim();
  const baseTerms = String(inv.payment_terms || '');
  const paymentTermsWithIban =
    ibanStr && !baseTerms.includes(ibanStr) ? `${baseTerms}${baseTerms ? ' · ' : ''}IBAN : ${ibanStr}` : baseTerms;

  const pdfBytes = await generateInvoicePdf({
    invoiceNumber: String(inv.invoice_number),
    issueDate: String(inv.issue_date),
    dueDate: String(inv.due_date),
    seller: {
      title: 'VENDEUR / ÉMETTEUR',
      name: String(bp?.nom_commercial || companyCfg.companyName || 'Professionnel'),
      subtitle: String(bp?.raison_sociale || ''),
      address: mergedAddress,
      siret: String(bp?.siret || companyCfg.siret || ''),
      vatNumber: String(bp?.tva_intracom || companyCfg.vatNumber || ''),
      phone: String(bp?.telephone || companyCfg.phone || ''),
      email: String(bp?.email || companyCfg.email || ''),
    },
    buyer: {
      title: 'CLIENT / ACQUÉREUR',
      name: buyer
        ? String(buyer.company_name || `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim())
        : 'Client',
      address: buyer ? `${buyer.address || ''} ${buyer.postal_code || ''} ${buyer.city || ''}`.trim() : '',
      siret: buyer ? String(buyer.siret || '') : '',
      phone: buyer ? String(buyer.phone || '') : '',
      email: buyer ? String(buyer.email || '') : '',
    },
    vehicleSummary: vehicle
      ? `${vehicle.marque} ${vehicle.modele} · Immat ${vehicle.immatriculation || '-'} · VIN ${vehicle.vin || '-'}`
      : undefined,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceHtCents: l.unit_price_ht_cents,
      vatRateBps: l.vat_rate_bps,
      totalTtcCents: l.total_ttc_cents,
    })),
    subtotalHtCents: Number(inv.subtotal_ht_cents),
    vatCents: Number(inv.vat_cents),
    totalTtcCents: Number(inv.total_ttc_cents),
    paidCents: Number(inv.paid_cents),
    showVatBreakdown: inv.vat_regime === 'tva_sur_prix_total',
    vatLegalMention: String(inv.vat_legal_mention),
    paymentTerms: paymentTermsWithIban,
    facturxXml: String(inv.xml_content || ''),
    branding: resolvePdfBrandingFromSettings(appSettings, {
      fallbackCompanyName: String(bp?.nom_commercial || companyCfg.companyName || 'HexaVO'),
    }),
  });

  // Persist document record if not already saved
  const fileName = `facture-${String(inv.invoice_number).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  const storagePath = path.resolve(getDocsDir(), `${userId}-${fileName}`);
  fs.writeFileSync(storagePath, Buffer.from(pdfBytes));

  const existingDoc = db
    .prepare("SELECT id FROM documents WHERE invoice_id = ? AND user_id = ? AND doc_type = 'facture_vente'")
    .get(id, userId);
  if (!existingDoc) {
    db.prepare(
      `INSERT INTO documents (user_id, business_profile_id, vehicle_id, sale_id, invoice_id, doc_type, title, doc_number, language, file_name, mime_type, storage_path)
       VALUES (?, ?, ?, ?, ?, 'facture_vente', ?, ?, 'fr', ?, 'application/pdf', ?)`
    ).run(
      userId,
      inv.business_profile_id,
      inv.vehicle_id,
      inv.sale_id,
      id,
      `Facture ${inv.invoice_number}`,
      inv.invoice_number,
      fileName,
      storagePath
    );
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(Buffer.from(pdfBytes));
});

router.get('/invoices/:id/xml', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const inv = db
    .prepare('SELECT invoice_number, xml_content FROM invoices WHERE id = ? AND user_id = ?')
    .get(id, req.user!.id) as { invoice_number: string; xml_content: string } | undefined;

  if (!inv || !inv.xml_content) {
    res.status(404).json({ error: 'XML Factur-X introuvable.' });
    return;
  }

  const fileName = `facturx-${inv.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(inv.xml_content);
});

router.post('/invoices/:id/pa-transmit', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const inv = db
    .prepare('SELECT invoice_number, xml_content FROM invoices WHERE id = ? AND user_id = ?')
    .get(id, req.user!.id) as { invoice_number: string; xml_content: string } | undefined;
  if (!inv) {
    res.status(404).json({ error: 'Facture introuvable.' });
    return;
  }
  const adapter = new StubPlateformeAgreeeAdapter();
  const validation = validateFacturXXml(inv.xml_content || '');
  const result = await adapter.submitInvoice(inv.invoice_number, inv.xml_content, new Uint8Array());
  res.json({
    ...result,
    status: result.accepted ? 'transmise_pa' : validation.valid ? 'prete_pa_xml_valide' : 'xml_invalide',
    validation,
  });
});

// ==================== DOCUMENTS & CERFA 15776*02 ====================
router.get('/documents', (req: AuthedRequest, res) => {
  const db = getDb();
  const docType = String(req.query.doc_type || '').trim();
  const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;

  const where = ['d.user_id = ?', 'd.deleted_at IS NULL'];
  const params: unknown[] = [req.user!.id];
  if (docType && docType !== 'all') {
    where.push('d.doc_type = ?');
    params.push(docType);
  }
  if (vehicleId) {
    where.push('d.vehicle_id = ?');
    params.push(vehicleId);
  }

  const documents = db
    .prepare(
      `SELECT d.*, v.marque, v.modele, v.immatriculation
       FROM documents d
       LEFT JOIN vehicles v ON v.id = d.vehicle_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.created_at DESC, d.id DESC`
    )
    .all(...params);

  res.json({ documents });
});

router.post('/documents/generate', async (req: AuthedRequest, res, next) => {
  try {
  const schema = z.object({
    doc_type: z.enum([
      'cerfa_15776',
      'facture_achat',
      'bon_commande',
      'recu_paiement',
      'rapport_vehicule',
      'document_interne',
    ]),
    vehicle_id: z.number().int().positive().nullable().optional(),
    contact_id: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).max(180),
    date: z.string().min(8),
    amount_cents: z.number().int().min(0).optional().default(0),
    cerfa_fields: z
      .object({
        sellerName: z.string().optional(),
        sellerIsPro: z.boolean().optional(),
        sellerSiret: z.string().optional(),
        sellerAddress: z.string().optional(),
        buyerName: z.string().optional(),
        buyerIsPro: z.boolean().optional(),
        buyerSiret: z.string().optional(),
        buyerAddress: z.string().optional(),
        immatriculation: z.string().optional(),
        vin: z.string().optional(),
        marque: z.string().optional(),
        modele: z.string().optional(),
        dateMiseEnCirculation: z.string().optional(),
        kilometrage: z.string().optional(),
        genreNational: z.string().optional(),
        heureCession: z.string().optional(),
      })
      .optional(),
    notes: z.string().max(2000).optional().default(''),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Paramètres de document invalides', details: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const db = getDb();
  const userId = req.user!.id;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  const vehicle = d.vehicle_id
    ? (db.prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ?').get(d.vehicle_id, userId) as Record<
        string,
        unknown
      > | null)
    : null;
  const bp = vehicle?.business_profile_id
    ? (db.prepare('SELECT * FROM business_profiles WHERE id = ?').get(vehicle.business_profile_id) as Record<
        string,
        unknown
      > | null)
    : null;
  const contact = d.contact_id
    ? (db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(d.contact_id, userId) as Record<
        string,
        unknown
      > | null)
    : null;

  const appSettings = loadUserAppSettings(db, userId);
  const companyCfg = (appSettings.company_settings || {}) as Partial<CompanySettingsData>;
  const defaultBp = bp
    ? bp
    : (db
        .prepare(
          `SELECT bp.* FROM business_profiles bp
           JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
           WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
           ORDER BY ubp.is_default DESC, bp.id ASC LIMIT 1`
        )
        .get(userId) as Record<string, unknown> | undefined);

  const hasCompanyConfigured = Boolean(defaultBp || companyCfg.companyName);
  // Respect legal context strictly: never auto-insert business profile on personal vehicle!
  const isPersonalVehicle = vehicle?.legal_context === 'personal';
  const isProVehicle = vehicle
    ? vehicle.legal_context === 'professional' && hasCompanyConfigured
    : hasCompanyConfigured;

  const companyDisplayName = String(
    companyCfg.companyName ||
      (defaultBp ? `${defaultBp.nom_commercial}${defaultBp.raison_sociale ? ` (${defaultBp.raison_sociale})` : ''}` : '')
  ).trim();
  const companyFullAddress =
    formatFullAddress({
      address: companyCfg.address,
      postalCode: companyCfg.postalCode,
      city: companyCfg.city,
      country: companyCfg.country,
    }) || String(defaultBp?.adresse_pro || '');
  const companySiret = String(companyCfg.siret || defaultBp?.siret || '');

  const defaultSellerName = isProVehicle
    ? companyDisplayName || `${user.first_name} ${user.last_name}`
    : `${user.first_name} ${user.last_name}`;
  const defaultSellerAddress = isProVehicle ? companyFullAddress : String(user.address || '');
  const defaultBuyerName = contact
    ? String(contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
    : '';
  const defaultBuyerAddress = contact
    ? `${contact.address || ''} ${contact.postal_code || ''} ${contact.city || ''}`.trim()
    : '';

  let pdfBytes: Uint8Array;
  const docNumber = `${d.doc_type.toUpperCase()}-${Date.now().toString().slice(-6)}`;

  if (d.doc_type === 'cerfa_15776') {
    const cf = d.cerfa_fields || {};
    const cerfaSellerPro = cf.sellerIsPro ?? isProVehicle;
    const cerfaBranding = resolvePdfBrandingFromSettings(appSettings, {
      isPersonalOnly: !cerfaSellerPro,
      fallbackCompanyName: companyCfg.companyName || String(defaultBp?.nom_commercial || 'HexaVO'),
    });
    pdfBytes = await generateCerfaPreparationPdf({
      sellerName: cf.sellerName ?? defaultSellerName,
      sellerIsPro: cerfaSellerPro,
      sellerSiret: cf.sellerSiret ?? (cerfaSellerPro ? companySiret : undefined),
      sellerAddress: cf.sellerAddress ?? defaultSellerAddress,
      buyerName: cf.buyerName ?? defaultBuyerName,
      buyerIsPro: cf.buyerIsPro ?? (contact?.type === 'professionnel'),
      buyerSiret: cf.buyerSiret ?? (contact ? String(contact.siret || '') : undefined),
      buyerAddress: cf.buyerAddress ?? defaultBuyerAddress,
      immatriculation: cf.immatriculation ?? String(vehicle?.immatriculation || ''),
      vin: cf.vin ?? String(vehicle?.vin || ''),
      marque: cf.marque ?? String(vehicle?.marque || ''),
      modele: cf.modele ?? String(vehicle?.modele || ''),
      dateMiseEnCirculation: cf.dateMiseEnCirculation ?? (vehicle?.annee ? `01/01/${vehicle.annee}` : ''),
      kilometrage: cf.kilometrage ?? String(vehicle?.kilometrage || ''),
      genreNational: cf.genreNational ?? 'VP',
      dateCession: d.date,
      heureCession: cf.heureCession ?? '14:00',
      prixCessionCents: d.amount_cents || Number(vehicle?.prix_vente_final_cents || vehicle?.prix_vente_prevu_cents || 0),
      branding: cerfaBranding,
    });
  } else {
    const docBranding = resolvePdfBrandingFromSettings(appSettings, {
      isPersonalOnly: isPersonalVehicle,
      fallbackCompanyName: companyCfg.companyName || String(defaultBp?.nom_commercial || 'HexaVO'),
    });
    const sections: Array<{ heading: string; rows: Array<[string, string]> }> = [
      {
        heading: isProVehicle ? 'Émetteur (Professionnel)' : 'Émetteur (Particulier)',
        rows: [
          ['Nom / Raison sociale', defaultSellerName],
          ['Adresse', defaultSellerAddress || '-'],
          ...(isProVehicle && companySiret ? [['SIRET', companySiret] as [string, string]] : []),
          ...(isProVehicle && (companyCfg.phone || defaultBp?.telephone)
            ? [['Téléphone', String(companyCfg.phone || defaultBp?.telephone)] as [string, string]]
            : []),
          ...(isProVehicle && (companyCfg.email || defaultBp?.email)
            ? [['E-mail', String(companyCfg.email || defaultBp?.email)] as [string, string]]
            : []),
        ],
      },
    ];
    if (contact) {
      sections.push({
        heading: 'Contrepartie / Contact',
        rows: [
          ['Nom / Société', defaultBuyerName],
          ['Adresse', defaultBuyerAddress || '-'],
          ['Téléphone / Email', `${contact.phone || ''} ${contact.email || ''}`.trim() || '-'],
        ],
      });
    }
    if (vehicle) {
      sections.push({
        heading: 'Informations Véhicule',
        rows: [
          ['Marque & Modèle', `${vehicle.marque} ${vehicle.modele} ${vehicle.version || ''}`.trim()],
          ['Immatriculation', String(vehicle.immatriculation || '-')],
          ['VIN', String(vehicle.vin || '-')],
          ['Année / Kilométrage', `${vehicle.annee || '-'} · ${vehicle.kilometrage || '-'} km`],
          ['Contexte juridique', vehicle.legal_context === 'professional' ? 'Activité professionnelle' : 'Vente personnelle'],
        ],
      });
    }
    if (d.amount_cents > 0 || d.notes) {
      sections.push({
        heading: "Détails de l'opération",
        rows: [
          ...(d.amount_cents > 0
            ? [['Montant TTC', `${(d.amount_cents / 100).toFixed(2).replace('.', ',')} EUR`] as [string, string]]
            : []),
          ['Notes', d.notes || '-'],
        ],
      });
    }
    pdfBytes = await generateStructuredPdf({
      title: d.title,
      docNumber,
      date: d.date,
      sections,
      includeSignatureBoxes: d.doc_type === 'bon_commande' || d.doc_type === 'recu_paiement',
      branding: docBranding,
    });
  }

  const fileName = `${d.doc_type}-${docNumber}.pdf`;
  const storagePath = path.resolve(getDocsDir(), `${userId}-${fileName}`);
  fs.writeFileSync(storagePath, Buffer.from(pdfBytes));

  const docInfo = db
    .prepare(
      `INSERT INTO documents (
        user_id, business_profile_id, vehicle_id, doc_type, title, doc_number,
        language, file_name, mime_type, storage_path, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, 'fr', ?, 'application/pdf', ?, ?)`
    )
    .run(
      userId,
      isProVehicle ? (vehicle?.business_profile_id ?? (defaultBp?.id ? Number(defaultBp.id) : null)) : null,
      d.vehicle_id ?? null,
      d.doc_type,
      d.title,
      docNumber,
      fileName,
      storagePath,
      JSON.stringify(d)
    );

  const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(docInfo.lastInsertRowid);
  logAudit(userId, 'DOCUMENT_GENERATE', 'document', Number(docInfo.lastInsertRowid), { doc_type: d.doc_type }, req.ip || '');
  res.status(201).json({ document });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id/download', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const doc = db
    .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, req.user!.id) as { storage_path: string; file_name: string; mime_type: string } | undefined;

  if (!doc) {
    res.status(404).json({ error: 'Document introuvable.' });
    return;
  }

  const docsDir = getDocsDir();
  const resolved = path.resolve(doc.storage_path);
  if (!resolved.startsWith(docsDir + path.sep) || !fs.existsSync(resolved)) {
    res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });
    return;
  }

  res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
  res.sendFile(resolved);
});

// ==================== LIVRE DE POLICE (IMMUTABLE) ====================
router.get('/livre-de-police', (req: AuthedRequest, res) => {
  const db = getDb();
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();

  const where = ['e.user_id = ?'];
  const params: unknown[] = [req.user!.id];
  if (search) {
    where.push('(e.entry_number LIKE ? OR e.marque_modele LIKE ? OR e.immatriculation LIKE ? OR e.vin LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (status && status !== 'all') {
    where.push('e.status = ?');
    params.push(status);
  }

  const entries = db
    .prepare(
      `SELECT e.*, bp.nom_commercial AS business_profile_name
       FROM police_register_entries e
       LEFT JOIN business_profiles bp ON bp.id = e.business_profile_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.entry_sequence DESC`
    )
    .all(...params);

  const corrections = db
    .prepare(
      `SELECT * FROM police_register_corrections
       WHERE user_id = ?
       ORDER BY corrected_at DESC, id DESC`
    )
    .all(req.user!.id);

  res.json({ entries, corrections });
});

router.post('/livre-de-police/:entryId/corrections', (req: AuthedRequest, res) => {
  const entryId = Number(req.params.entryId);
  const schema = z.object({
    reason: z.string().min(5).max(500),
    field_changes: z.record(z.string(), z.string()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Motif (min 5 caractères) et champs de correction requis.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const entry = db
    .prepare('SELECT * FROM police_register_entries WHERE id = ? AND user_id = ?')
    .get(entryId, userId);
  if (!entry) {
    res.status(404).json({ error: 'Entrée du Livre de Police introuvable.' });
    return;
  }

  const seqRow = db
    .prepare('SELECT COALESCE(MAX(correction_sequence), 0) AS max_seq FROM police_register_corrections WHERE entry_id = ?')
    .get(entryId) as { max_seq: number };

  const authorName = `${req.user!.first_name} ${req.user!.last_name}`;
  const info = db
    .prepare(
      `INSERT INTO police_register_corrections (entry_id, user_id, correction_sequence, reason, field_changes_json, author_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      entryId,
      userId,
      seqRow.max_seq + 1,
      parsed.data.reason,
      JSON.stringify(parsed.data.field_changes),
      authorName
    );

  // Append-only: entry row keeps its original snapshot; status reflects a correction annotation exists
  db.prepare("UPDATE police_register_entries SET status = 'corrected' WHERE id = ? AND status = 'active'").run(entryId);
  logAudit(userId, 'POLICE_REGISTER_CORRECTION', 'police_register_entry', entryId, parsed.data, req.ip || '');

  const correction = db.prepare('SELECT * FROM police_register_corrections WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ correction });
});

router.get('/livre-de-police/export/csv', (req: AuthedRequest, res) => {
  const db = getDb();
  const entries = db
    .prepare('SELECT * FROM police_register_entries WHERE user_id = ? ORDER BY entry_sequence ASC')
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const header = [
    'Numéro',
    'Date enregistrement',
    'Marque / Modèle',
    'Immatriculation',
    'VIN',
    'Date entrée',
    'Prix achat (EUR)',
    'Fournisseur',
    'Date sortie',
    'Prix vente (EUR)',
    'Acquéreur',
    'Statut',
    'Empreinte SHA-256',
  ].join(';');

  const lines = entries.map((e) => {
    const sup = JSON.parse(String(e.supplier_snapshot_json || '{}'));
    const buy = e.buyer_snapshot_json ? JSON.parse(String(e.buyer_snapshot_json)) : {};
    return [
      e.entry_number,
      e.recorded_at,
      `"${String(e.marque_modele).replace(/"/g, '""')}"`,
      e.immatriculation,
      e.vin,
      e.purchase_date,
      (Number(e.purchase_price_cents) / 100).toFixed(2),
      `"${String(sup.name || '').replace(/"/g, '""')}"`,
      e.sale_date || '',
      e.sale_price_cents ? (Number(e.sale_price_cents) / 100).toFixed(2) : '',
      `"${String(buy.name || '').replace(/"/g, '""')}"`,
      e.status,
      e.entry_hash,
    ].join(';');
  });

  const csv = '\uFEFF' + [header, ...lines].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="livre-de-police-hexavo.csv"');
  res.send(csv);
});

router.get('/livre-de-police/export/pdf', async (req: AuthedRequest, res) => {
  const db = getDb();
  const entries = db
    .prepare('SELECT * FROM police_register_entries WHERE user_id = ? ORDER BY entry_sequence ASC')
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const sections = entries.map((e) => {
    const sup = JSON.parse(String(e.supplier_snapshot_json || '{}'));
    const buy = e.buyer_snapshot_json ? JSON.parse(String(e.buyer_snapshot_json)) : null;
    return {
      heading: `${e.entry_number} — ${e.marque_modele} (${e.immatriculation || 'Sans immat'})`,
      rows: [
        ['VIN / Série', String(e.vin || '-')],
        ['Entrée / Achat', `${e.purchase_date} · ${(Number(e.purchase_price_cents) / 100).toFixed(2)} EUR`],
        ['Fournisseur', String(sup.name || '-')],
        ['Sortie / Vente', e.sale_date ? `${e.sale_date} · ${(Number(e.sale_price_cents || 0) / 100).toFixed(2)} EUR` : 'En stock'],
        ['Acquéreur', buy ? String(buy.name || '-') : '-'],
        ['Intégrité (SHA-256)', String(e.entry_hash).slice(0, 32) + '...'],
      ] as Array<[string, string]>,
    };
  });

  const pdfBytes = await generateStructuredPdf({
    title: 'LIVRE DE POLICE ÉLECTRONIQUE (REGISTRE VO)',
    docNumber: `REG-${new Date().toISOString().slice(0, 10)}`,
    date: new Date().toISOString().slice(0, 10),
    subtitle: 'Journal chronologique inaltérable des opérations professionnelles de véhicules d\'occasion',
    sections: sections.length > 0 ? sections : [{ heading: 'Registre vide', rows: [['Statut', 'Aucune écriture professionnelle enregistrée']] }],
    disclaimer:
      'Export d\'archivage HexaVO. Vérifiez la conformité réglementaire de votre tenue de registre électronique auprès de votre conseil.',
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="livre-de-police-hexavo.pdf"');
  res.send(Buffer.from(pdfBytes));
});

export default router;
