import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database';
import { type AuthedRequest, logAudit, requireAuth } from '../middleware/auth';
import { executePurchaseTransaction, executeSaleTransaction } from '../services/automationService';
import { checkVatRegimeEligibility, type VatRegime } from '../services/taxService';

const router = Router();
router.use(requireAuth);

// ==================== CONTACTS / CRM ====================
const contactSchema = z.object({
  type: z.enum(['particulier', 'professionnel', 'fournisseur', 'client', 'prospect']),
  is_buyer: z.boolean().optional().default(false),
  is_supplier: z.boolean().optional().default(false),
  first_name: z.string().max(80).optional().default(''),
  last_name: z.string().max(80).optional().default(''),
  company_name: z.string().max(160).optional().default(''),
  siren: z.string().max(20).optional().default(''),
  siret: z.string().max(24).optional().default(''),
  email: z.string().max(180).optional().default(''),
  phone: z.string().max(40).optional().default(''),
  address: z.string().max(240).optional().default(''),
  city: z.string().max(100).optional().default(''),
  postal_code: z.string().max(20).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
});

router.get('/contacts', (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const search = String(req.query.search || '').trim();
  const type = String(req.query.type || '').trim();

  const where: string[] = ['c.user_id = ?', 'c.deleted_at IS NULL'];
  const params: unknown[] = [userId];

  if (search) {
    where.push(
      '(c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.siret LIKE ?)'
    );
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }
  if (type && type !== 'all') {
    where.push('c.type = ?');
    params.push(type);
  }

  const contacts = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM purchases p WHERE p.contact_id = c.id AND p.deleted_at IS NULL) AS purchases_count,
        (SELECT COUNT(*) FROM sales s WHERE s.contact_id = c.id AND s.deleted_at IS NULL) AS sales_count
       FROM contacts c
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC, c.id DESC`
    )
    .all(...params);

  res.json({ contacts });
});

router.get('/contacts/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const userId = req.user!.id;

  const contact = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId);
  if (!contact) {
    res.status(404).json({ error: 'Contact introuvable.' });
    return;
  }

  const purchases = db
    .prepare(
      `SELECT p.*, v.marque, v.modele, v.immatriculation
       FROM purchases p JOIN vehicles v ON v.id = p.vehicle_id
       WHERE p.contact_id = ? AND p.user_id = ? AND p.deleted_at IS NULL`
    )
    .all(id, userId);

  const sales = db
    .prepare(
      `SELECT s.*, v.marque, v.modele, v.immatriculation
       FROM sales s JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.contact_id = ? AND s.user_id = ? AND s.deleted_at IS NULL`
    )
    .all(id, userId);

  res.json({ contact, purchases, sales });
});

router.post('/contacts', (req: AuthedRequest, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données contact invalides', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (!d.first_name && !d.last_name && !d.company_name) {
    res.status(400).json({ error: 'Veuillez renseigner un nom ou une entreprise.' });
    return;
  }

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO contacts (
        user_id, type, is_buyer, is_supplier, first_name, last_name, company_name,
        siren, siret, email, phone, address, city, postal_code, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user!.id,
      d.type,
      d.is_buyer ? 1 : 0,
      d.is_supplier ? 1 : 0,
      d.first_name,
      d.last_name,
      d.company_name,
      d.siren,
      d.siret,
      d.email,
      d.phone,
      d.address,
      d.city,
      d.postal_code,
      d.notes
    );

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  logAudit(req.user!.id, 'CONTACT_CREATE', 'contact', Number(info.lastInsertRowid), d, req.ip || '');
  res.status(201).json({ contact });
});

router.patch('/contacts/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = contactSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données invalides' });
    return;
  }
  const db = getDb();
  const current = db
    .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, req.user!.id) as Record<string, unknown> | undefined;
  if (!current) {
    res.status(404).json({ error: 'Contact introuvable.' });
    return;
  }
  const m = { ...current, ...parsed.data };
  db.prepare(
    `UPDATE contacts SET
      type = ?, is_buyer = ?, is_supplier = ?, first_name = ?, last_name = ?, company_name = ?,
      siren = ?, siret = ?, email = ?, phone = ?, address = ?, city = ?, postal_code = ?, notes = ?,
      updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(
    m.type,
    m.is_buyer ? 1 : 0,
    m.is_supplier ? 1 : 0,
    m.first_name,
    m.last_name,
    m.company_name,
    m.siren,
    m.siret,
    m.email,
    m.phone,
    m.address,
    m.city,
    m.postal_code,
    m.notes,
    id,
    req.user!.id
  );
  const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  res.json({ contact: updated });
});

router.delete('/contacts/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  db.prepare("UPDATE contacts SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, req.user!.id);
  res.json({ ok: true });
});

// ==================== PURCHASES (ACHATS) ====================
const purchaseSchema = z.object({
  vehicle_id: z.number().int().positive(),
  contact_id: z.number().int().positive().nullable().optional(),
  business_profile_id: z.number().int().positive().nullable().optional(),
  legal_context: z.enum(['personal', 'professional']),
  seller_type: z.enum(['particulier', 'professionnel', 'societe', 'autre']),
  purchase_date: z.string().min(8),
  amount_ht_cents: z.number().int().min(0),
  vat_cents: z.number().int().min(0).optional().default(0),
  amount_ttc_cents: z.number().int().min(0),
  vat_regime: z.string().max(60).optional().default('hors_tva'),
  payment_method: z.string().max(40).optional().default('virement'),
  payment_status: z.enum(['a_payer', 'partiellement_paye', 'paye', 'en_retard']).optional().default('paye'),
  document_number: z.string().max(60).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
});

router.get('/purchases', (req: AuthedRequest, res) => {
  const db = getDb();
  const search = String(req.query.search || '').trim();
  const context = String(req.query.legal_context || '').trim();

  const where = ['p.user_id = ?', 'p.deleted_at IS NULL'];
  const params: unknown[] = [req.user!.id];
  if (search) {
    where.push('(v.marque LIKE ? OR v.modele LIKE ? OR v.immatriculation LIKE ? OR p.document_number LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (context === 'personal' || context === 'professional') {
    where.push('p.legal_context = ?');
    params.push(context);
  }

  const purchases = db
    .prepare(
      `SELECT p.*, v.marque, v.modele, v.immatriculation, v.vin,
        c.first_name, c.last_name, c.company_name,
        bp.nom_commercial AS business_profile_name
       FROM purchases p
       JOIN vehicles v ON v.id = p.vehicle_id
       LEFT JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN business_profiles bp ON bp.id = p.business_profile_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.purchase_date DESC, p.id DESC`
    )
    .all(...params);

  res.json({ purchases });
});

router.post('/purchases', (req: AuthedRequest, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données d\'achat invalides', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const db = getDb();

  try {
    const out = executePurchaseTransaction(db, {
      userId: req.user!.id,
      businessProfileId: d.legal_context === 'professional' ? d.business_profile_id ?? null : null,
      vehicleId: d.vehicle_id,
      contactId: d.contact_id ?? null,
      legalContext: d.legal_context,
      sellerType: d.seller_type,
      purchaseDate: d.purchase_date,
      amountHtCents: d.amount_ht_cents,
      vatCents: d.vat_cents,
      amountTtcCents: d.amount_ttc_cents,
      vatRegime: d.vat_regime,
      paymentMethod: d.payment_method,
      paymentStatus: d.payment_status,
      documentNumber: d.document_number,
      notes: d.notes,
    });

    logAudit(req.user!.id, 'PURCHASE_CREATE', 'purchase', out.purchaseId, d, req.ip || '');
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(out.purchaseId);
    res.status(201).json({ purchase, policeEntryId: out.policeEntryId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur';
    if (msg === 'VEHICLE_NOT_FOUND') {
      res.status(404).json({ error: 'Véhicule introuvable.' });
      return;
    }
    if (msg === 'BUSINESS_PROFILE_REQUIRED_FOR_PRO') {
      res.status(400).json({ error: 'Un profil professionnel est requis pour un achat professionnel.' });
      return;
    }
    res.status(500).json({ error: 'Erreur lors de la création de l\'achat.' });
  }
});

// ==================== SALES (VENTES) ====================
const saleSchema = z.object({
  vehicle_id: z.number().int().positive(),
  contact_id: z.number().int().positive().nullable().optional(),
  business_profile_id: z.number().int().positive().nullable().optional(),
  legal_context: z.enum(['personal', 'professional']),
  seller_type: z.enum(['particulier', 'professionnel']),
  buyer_type: z.enum(['particulier', 'professionnel', 'societe']),
  sale_date: z.string().min(8),
  amount_ht_cents: z.number().int().min(0),
  vat_cents: z.number().int().min(0).optional().default(0),
  amount_ttc_cents: z.number().int().min(0),
  vat_regime: z.string().max(60).optional().default('hors_tva'),
  payment_method: z.string().max(40).optional().default('virement'),
  payment_status: z.enum(['a_payer', 'partiellement_paye', 'paye', 'en_retard']).optional().default('paye'),
  invoice_number: z.string().max(60).optional().default(''),
  extra_services_cents: z.number().int().min(0).optional().default(0),
  extra_services_desc: z.string().max(300).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
  sales_channel: z.enum(['leboncoin', 'direct', 'recommandation', 'autre']).optional().default('direct'),
  idempotency_key: z.string().max(120).optional(),
});

router.get('/sales', (req: AuthedRequest, res) => {
  const db = getDb();
  const search = String(req.query.search || '').trim();
  const context = String(req.query.legal_context || '').trim();

  const where = ['s.user_id = ?', 's.deleted_at IS NULL'];
  const params: unknown[] = [req.user!.id];
  if (search) {
    where.push('(v.marque LIKE ? OR v.modele LIKE ? OR v.immatriculation LIKE ? OR s.invoice_number LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (context === 'personal' || context === 'professional') {
    where.push('s.legal_context = ?');
    params.push(context);
  }

  const sales = db
    .prepare(
      `SELECT s.*, v.marque, v.modele, v.immatriculation, v.vin, v.prix_achat_cents,
        c.first_name, c.last_name, c.company_name,
        bp.nom_commercial AS business_profile_name
       FROM sales s
       JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN contacts c ON c.id = s.contact_id
       LEFT JOIN business_profiles bp ON bp.id = s.business_profile_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.sale_date DESC, s.id DESC`
    )
    .all(...params);

  res.json({ sales });
});

router.post('/sales', (req: AuthedRequest, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données de vente invalides', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const db = getDb();

  // Check VAT eligibility against purchase record
  const purchase = db
    .prepare('SELECT vat_regime, seller_type FROM purchases WHERE vehicle_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(d.vehicle_id, req.user!.id) as { vat_regime: string; seller_type: string } | undefined;

  const eligibility = checkVatRegimeEligibility({
    legalContext: d.legal_context,
    requestedRegime: d.vat_regime as VatRegime,
    purchaseVatRegime: purchase?.vat_regime || 'hors_tva',
    sellerTypeAtPurchase: purchase?.seller_type || 'particulier',
  });

  if (!eligibility.eligible && d.legal_context === 'personal') {
    res.status(400).json({ error: eligibility.warningMessage });
    return;
  }

  try {
    const result = executeSaleTransaction(db, {
      userId: req.user!.id,
      businessProfileId: d.legal_context === 'professional' ? d.business_profile_id ?? null : null,
      vehicleId: d.vehicle_id,
      contactId: d.contact_id ?? null,
      legalContext: d.legal_context,
      sellerType: d.legal_context === 'personal' ? 'particulier' : 'professionnel',
      buyerType: d.buyer_type,
      saleDate: d.sale_date,
      amountHtCents: d.amount_ht_cents,
      vatCents: d.vat_cents,
      amountTtcCents: d.amount_ttc_cents,
      vatRegime: d.vat_regime,
      paymentMethod: d.payment_method,
      paymentStatus: d.payment_status,
      invoiceNumber: d.invoice_number,
      extraServicesCents: d.extra_services_cents,
      extraServicesDesc: d.extra_services_desc,
      notes: d.notes,
      salesChannel: d.sales_channel,
      idempotencyKey: d.idempotency_key,
    });

    logAudit(req.user!.id, 'SALE_CONFIRM', 'sale', result.saleId, d, req.ip || '');
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(result.saleId);
    res.status(result.duplicate ? 200 : 201).json({
      sale,
      duplicate: result.duplicate,
      vatWarning: !eligibility.eligible ? eligibility.warningMessage : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur';
    if (msg === 'VEHICLE_NOT_FOUND') {
      res.status(404).json({ error: 'Véhicule introuvable.' });
      return;
    }
    if (msg === 'VEHICLE_ALREADY_SOLD') {
      res.status(409).json({ error: 'Ce véhicule est déjà marqué comme vendu.' });
      return;
    }
    res.status(500).json({ error: 'Erreur lors de la confirmation de la vente.' });
  }
});

// ==================== EXPENSES (DÉPENSES) ====================
router.get('/expense-categories', (_req: AuthedRequest, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM expense_categories ORDER BY scope ASC, id ASC').all();
  res.json({ categories });
});

const expenseSchema = z.object({
  scope: z.enum(['vehicle', 'business']),
  vehicle_id: z.number().int().positive().nullable().optional(),
  business_profile_id: z.number().int().positive().nullable().optional(),
  category_id: z.number().int().positive(),
  supplier_contact_id: z.number().int().positive().nullable().optional(),
  supplier_name: z.string().max(120).optional().default(''),
  operation_date: z.string().min(8),
  payment_date: z.string().nullable().optional(),
  amount_ht_cents: z.number().int().min(0),
  vat_rate_bps: z.number().int().min(0).max(5000).optional().default(2000),
  vat_cents: z.number().int().min(0).optional().default(0),
  amount_ttc_cents: z.number().int().min(0),
  vat_deductible: z.boolean().optional().default(false),
  payment_method: z.string().max(40).optional().default('carte'),
  payment_status: z.enum(['a_payer', 'partiellement_paye', 'paye', 'en_retard']).optional().default('paye'),
  is_recurring: z.boolean().optional().default(false),
  recurrence_interval: z.string().nullable().optional(),
  notes: z.string().max(2000).optional().default(''),
});

router.get('/expenses', (req: AuthedRequest, res) => {
  const db = getDb();
  const scope = String(req.query.scope || '').trim();
  const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;
  const search = String(req.query.search || '').trim();

  const where = ['e.user_id = ?', 'e.deleted_at IS NULL'];
  const params: unknown[] = [req.user!.id];

  if (scope === 'vehicle' || scope === 'business') {
    where.push('e.scope = ?');
    params.push(scope);
  }
  if (vehicleId) {
    where.push('e.vehicle_id = ?');
    params.push(vehicleId);
  }
  if (search) {
    where.push('(e.supplier_name LIKE ? OR e.notes LIKE ? OR ec.label_fr LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const expenses = db
    .prepare(
      `SELECT e.*, ec.code AS category_code, ec.label_fr, ec.label_ru, ec.label_en,
        v.marque, v.modele, v.immatriculation
       FROM expenses e
       JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.operation_date DESC, e.id DESC`
    )
    .all(...params);

  res.json({ expenses });
});

router.post('/expenses', (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données de dépense invalides', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const userId = req.user!.id;

  if (d.scope === 'vehicle' && !d.vehicle_id) {
    res.status(400).json({ error: 'Une dépense véhicule doit être associée à un véhicule.' });
    return;
  }
  if (d.scope === 'business' && d.vehicle_id) {
    res.status(400).json({ error: 'Une dépense générale ne doit pas être rattachée à un véhicule.' });
    return;
  }

  const cat = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(d.category_id) as
    | { code: string; label_fr: string }
    | undefined;
  if (!cat) {
    res.status(400).json({ error: 'Catégorie de dépense introuvable.' });
    return;
  }

  let legalContext: 'personal' | 'professional' = d.scope === 'business' ? 'professional' : 'personal';
  if (d.vehicle_id) {
    const v = db.prepare('SELECT legal_context, business_profile_id FROM vehicles WHERE id = ? AND user_id = ?').get(d.vehicle_id, userId) as
      | { legal_context: 'personal' | 'professional'; business_profile_id: number | null }
      | undefined;
    if (!v) {
      res.status(404).json({ error: 'Véhicule introuvable.' });
      return;
    }
    legalContext = v.legal_context;
  }

  const created = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO expenses (
          user_id, business_profile_id, vehicle_id, category_id, scope,
          supplier_contact_id, supplier_name, operation_date, payment_date,
          amount_ht_cents, vat_rate_bps, vat_cents, amount_ttc_cents, vat_deductible,
          payment_method, payment_status, is_recurring, recurrence_interval, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        d.business_profile_id ?? null,
        d.scope === 'vehicle' ? d.vehicle_id : null,
        d.category_id,
        d.scope,
        d.supplier_contact_id ?? null,
        d.supplier_name,
        d.operation_date,
        d.payment_date ?? (d.payment_status === 'paye' ? d.operation_date : null),
        d.amount_ht_cents,
        d.vat_rate_bps,
        d.vat_cents,
        d.amount_ttc_cents,
        d.vat_deductible ? 1 : 0,
        d.payment_method,
        d.payment_status,
        d.is_recurring ? 1 : 0,
        d.recurrence_interval ?? null,
        d.notes
      );

    const expenseId = Number(info.lastInsertRowid);

    db.prepare(
      `INSERT INTO financial_transactions (
        user_id, business_profile_id, vehicle_id, contact_id, expense_id,
        legal_context, direction, category, amount_cents, currency,
        operation_date, payment_date, payment_method, payment_status, description
      ) VALUES (?, ?, ?, ?, ?, ?, 'outflow', ?, ?, 'EUR', ?, ?, ?, ?, ?)`
    ).run(
      userId,
      d.business_profile_id ?? null,
      d.scope === 'vehicle' ? d.vehicle_id : null,
      d.supplier_contact_id ?? null,
      expenseId,
      legalContext,
      cat.code,
      d.amount_ttc_cents,
      d.operation_date,
      d.payment_date ?? (d.payment_status === 'paye' ? d.operation_date : null),
      d.payment_method,
      d.payment_status,
      `${cat.label_fr}${d.supplier_name ? ` — ${d.supplier_name}` : ''}`
    );

    return db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId);
  })();

  logAudit(userId, 'EXPENSE_CREATE', 'expense', (created as { id: number }).id, d, req.ip || '');
  res.status(201).json({ expense: created });
});

router.delete('/expenses/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE expenses SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, req.user!.id);
    db.prepare('DELETE FROM financial_transactions WHERE expense_id = ? AND user_id = ?').run(id, req.user!.id);
  })();
  res.json({ ok: true });
});

export default router;
