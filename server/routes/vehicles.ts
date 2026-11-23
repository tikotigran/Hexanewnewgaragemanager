import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDb, getUploadsDir } from '../db/database';
import { type AuthedRequest, logAudit, requireAuth } from '../middleware/auth';
import { calculateVehicleProfitability } from '../services/financeService';

const router = Router();

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, getUploadsDir()),
    filename: (_req, file, cb) => {
      const ext =
        file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
      cb(null, `veh-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(new Error('Format image non autorisé (JPG, PNG, WebP uniquement).'));
      return;
    }
    cb(null, true);
  },
});

const vehicleBaseFields = {
  legal_context: z.enum(['personal', 'professional']),
  business_profile_id: z.number().int().positive().nullable().optional(),
  status: z.enum(['brouillon', 'en_preparation', 'en_reparation', 'en_vente', 'reserve', 'vendu', 'archive']),
  marque: z.string().min(1).max(80),
  modele: z.string().min(1).max(80),
  version: z.string().max(120),
  immatriculation: z.string().max(32),
  vin: z.string().max(32),
  annee: z.number().int().min(1900).max(2035).nullable().optional(),
  kilometrage: z.number().int().min(0).max(2000000).nullable().optional(),
  energie: z.string().max(40),
  boite_vitesses: z.string().max(40),
  couleur: z.string().max(40),
  portes: z.number().int().min(1).max(9).nullable().optional(),
  puissance_fiscale: z.number().int().min(1).max(200).nullable().optional(),
  co2: z.number().int().min(0).max(999).nullable().optional(),
  date_achat: z.string().min(8).max(20),
  prix_achat_cents: z.number().int().min(0),
  prix_vente_prevu_cents: z.number().int().min(0).nullable().optional(),
  fournisseur_nom: z.string().max(120),
  fournisseur_tel: z.string().max(40),
  notes: z.string().max(3000),
  ct_ok: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  paperwork_done: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
};

const vehicleCreateSchema = z.object({
  ...vehicleBaseFields,
  status: vehicleBaseFields.status.optional().default('en_preparation'),
  version: vehicleBaseFields.version.optional().default(''),
  immatriculation: vehicleBaseFields.immatriculation.optional().default(''),
  vin: vehicleBaseFields.vin.optional().default(''),
  energie: vehicleBaseFields.energie.optional().default(''),
  boite_vitesses: vehicleBaseFields.boite_vitesses.optional().default(''),
  couleur: vehicleBaseFields.couleur.optional().default(''),
  fournisseur_nom: vehicleBaseFields.fournisseur_nom.optional().default(''),
  fournisseur_tel: vehicleBaseFields.fournisseur_tel.optional().default(''),
  notes: vehicleBaseFields.notes.optional().default(''),
});

const vehicleUpdateSchema = z.object(vehicleBaseFields).partial();

function toDbFlag(value: boolean | number | undefined, fallback = 0): number {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return fallback;
}

router.use(requireAuth);

router.get('/', (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const context = String(req.query.legal_context || '').trim();
  const marque = String(req.query.marque || '').trim();
  const hasListing = String(req.query.has_listing || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;

  const where: string[] = ['v.user_id = ?', 'v.deleted_at IS NULL'];
  const params: unknown[] = [userId];

  if (search) {
    where.push('(v.marque LIKE ? OR v.modele LIKE ? OR v.immatriculation LIKE ? OR v.vin LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (status && status !== 'all') {
    where.push('v.status = ?');
    params.push(status);
  } else if (status !== 'all') {
    // By default keep archived visible only when explicitly filtered or searched
  }
  if (context && (context === 'personal' || context === 'professional')) {
    where.push('v.legal_context = ?');
    params.push(context);
  }
  if (marque) {
    where.push('v.marque = ?');
    params.push(marque);
  }
  if (hasListing === 'yes') {
    where.push("EXISTS (SELECT 1 FROM marketplace_listings ml WHERE ml.vehicle_id = v.id AND ml.deleted_at IS NULL AND ml.status = 'publie')");
  } else if (hasListing === 'no') {
    where.push("NOT EXISTS (SELECT 1 FROM marketplace_listings ml WHERE ml.vehicle_id = v.id AND ml.deleted_at IS NULL AND ml.status = 'publie')");
  }

  const whereSql = where.join(' AND ');
  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM vehicles v WHERE ${whereSql}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT v.*,
        bp.nom_commercial AS business_profile_name,
        (SELECT url FROM vehicle_photos vp WHERE vp.vehicle_id = v.id ORDER BY vp.is_primary DESC, vp.sort_order ASC, vp.id ASC LIMIT 1) AS primary_photo_url,
        (SELECT COALESCE(SUM(amount_ttc_cents), 0) FROM expenses e WHERE e.vehicle_id = v.id AND e.deleted_at IS NULL) AS direct_expenses_cents,
        (SELECT ml.status FROM marketplace_listings ml WHERE ml.vehicle_id = v.id AND ml.deleted_at IS NULL ORDER BY ml.id DESC LIMIT 1) AS listing_status,
        (SELECT ml.slug FROM marketplace_listings ml WHERE ml.vehicle_id = v.id AND ml.deleted_at IS NULL ORDER BY ml.id DESC LIMIT 1) AS listing_slug
       FROM vehicles v
       LEFT JOIN business_profiles bp ON bp.id = v.business_profile_id
       WHERE ${whereSql}
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ vehicles: rows, total, page, limit });
});

router.post('/', (req: AuthedRequest, res) => {
  const parsed = vehicleCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données véhicule invalides', details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  const d = parsed.data;
  const userId = req.user!.id;

  let businessProfileId: number | null = null;
  if (d.legal_context === 'professional') {
    if (!d.business_profile_id) {
      res.status(400).json({
        error: 'Veuillez sélectionner un profil professionnel pour un véhicule en activité professionnelle.',
      });
      return;
    }
    const ownsBp = db
      .prepare('SELECT 1 FROM user_business_profiles WHERE user_id = ? AND business_profile_id = ?')
      .get(userId, d.business_profile_id);
    if (!ownsBp) {
      res.status(403).json({ error: 'Profil professionnel non autorisé.' });
      return;
    }
    businessProfileId = d.business_profile_id;
  }

  const vehicle = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO vehicles (
          user_id, business_profile_id, legal_context, status, marque, modele, version,
          immatriculation, vin, annee, kilometrage, energie, boite_vitesses, couleur,
          portes, puissance_fiscale, co2, date_achat, prix_achat_cents, prix_vente_prevu_cents,
          fournisseur_nom, fournisseur_tel, notes, ct_ok, paperwork_done
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        businessProfileId,
        d.legal_context,
        d.status,
        d.marque.trim(),
        d.modele.trim(),
        d.version,
        d.immatriculation.toUpperCase().trim(),
        d.vin.toUpperCase().trim(),
        d.annee ?? null,
        d.kilometrage ?? null,
        d.energie,
        d.boite_vitesses,
        d.couleur,
        d.portes ?? null,
        d.puissance_fiscale ?? null,
        d.co2 ?? null,
        d.date_achat,
        d.prix_achat_cents,
        d.prix_vente_prevu_cents ?? null,
        d.fournisseur_nom,
        d.fournisseur_tel,
        d.notes,
        toDbFlag(d.ct_ok, 0),
        toDbFlag(d.paperwork_done, 0)
      );

    const vehicleId = Number(info.lastInsertRowid);
    db.prepare(
      'INSERT INTO vehicle_status_history (vehicle_id, user_id, old_status, new_status, reason) VALUES (?, ?, NULL, ?, ?)'
    ).run(vehicleId, userId, d.status, 'Création de la fiche véhicule');

    return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  })();

  logAudit(userId, 'VEHICLE_CREATE', 'vehicle', (vehicle as { id: number }).id, { marque: d.marque, modele: d.modele, legal_context: d.legal_context }, req.ip || '');
  res.status(201).json({ vehicle });
});

router.get('/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const userId = req.user!.id;

  const vehicle = db
    .prepare(
      `SELECT v.*, bp.nom_commercial AS business_profile_name, bp.siret AS business_siret
       FROM vehicles v
       LEFT JOIN business_profiles bp ON bp.id = v.business_profile_id
       WHERE v.id = ? AND v.user_id = ? AND v.deleted_at IS NULL`
    )
    .get(id, userId) as Record<string, unknown> | undefined;

  if (!vehicle) {
    res.status(404).json({ error: 'Véhicule introuvable.' });
    return;
  }

  const photos = db
    .prepare('SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC')
    .all(id);
  const statusHistory = db
    .prepare('SELECT * FROM vehicle_status_history WHERE vehicle_id = ? ORDER BY changed_at DESC, id DESC')
    .all(id);
  const purchases = db
    .prepare(
      `SELECT p.*, c.first_name, c.last_name, c.company_name
       FROM purchases p LEFT JOIN contacts c ON c.id = p.contact_id
       WHERE p.vehicle_id = ? AND p.deleted_at IS NULL ORDER BY p.purchase_date DESC`
    )
    .all(id);
  const sales = db
    .prepare(
      `SELECT s.*, c.first_name, c.last_name, c.company_name
       FROM sales s LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE s.vehicle_id = ? AND s.deleted_at IS NULL ORDER BY s.sale_date DESC`
    )
    .all(id);
  const expenses = db
    .prepare(
      `SELECT e.*, ec.code AS category_code, ec.label_fr, ec.label_ru, ec.label_en
       FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.vehicle_id = ? AND e.deleted_at IS NULL ORDER BY e.operation_date DESC`
    )
    .all(id);
  const documents = db
    .prepare('SELECT * FROM documents WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    .all(id);
  const listing = db
    .prepare('SELECT * FROM marketplace_listings WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(id);
  const policeEntry = db
    .prepare('SELECT * FROM police_register_entries WHERE vehicle_id = ? AND user_id = ?')
    .get(id, userId);

  const directExpensesCents = (expenses as Array<{ amount_ttc_cents: number }>).reduce(
    (sum, e) => sum + e.amount_ttc_cents,
    0
  );

  const profitability = calculateVehicleProfitability({
    purchasePriceCents: Number(vehicle.prix_achat_cents || 0),
    directExpensesCents,
    salePriceCents: vehicle.prix_vente_final_cents ? Number(vehicle.prix_vente_final_cents) : null,
    plannedSalePriceCents: vehicle.prix_vente_prevu_cents ? Number(vehicle.prix_vente_prevu_cents) : null,
  });

  res.json({
    vehicle,
    photos,
    statusHistory,
    purchases,
    sales,
    expenses,
    documents,
    listing: listing || null,
    policeEntry: policeEntry || null,
    profitability,
  });
});

router.patch('/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = vehicleUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données invalides', details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Véhicule introuvable.' });
    return;
  }

  const d = parsed.data;
  const merged = { ...existing, ...d };
  if (merged.legal_context === 'personal') {
    merged.business_profile_id = null;
  }

  db.transaction(() => {
    const nextCtOk = toDbFlag(d.ct_ok, Number(existing.ct_ok || 0));
    const nextPaperworkDone = toDbFlag(d.paperwork_done, Number(existing.paperwork_done || 0));
    db.prepare(
      `UPDATE vehicles SET
        business_profile_id = ?, legal_context = ?, status = ?, marque = ?, modele = ?, version = ?,
        immatriculation = ?, vin = ?, annee = ?, kilometrage = ?, energie = ?, boite_vitesses = ?,
        couleur = ?, portes = ?, puissance_fiscale = ?, co2 = ?, date_achat = ?, prix_achat_cents = ?,
        prix_vente_prevu_cents = ?, fournisseur_nom = ?, fournisseur_tel = ?, notes = ?,
        ct_ok = ?, paperwork_done = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(
      merged.business_profile_id ?? null,
      merged.legal_context,
      merged.status,
      String(merged.marque).trim(),
      String(merged.modele).trim(),
      merged.version || '',
      String(merged.immatriculation || '').toUpperCase().trim(),
      String(merged.vin || '').toUpperCase().trim(),
      merged.annee ?? null,
      merged.kilometrage ?? null,
      merged.energie || '',
      merged.boite_vitesses || '',
      merged.couleur || '',
      merged.portes ?? null,
      merged.puissance_fiscale ?? null,
      merged.co2 ?? null,
      merged.date_achat,
      merged.prix_achat_cents,
      merged.prix_vente_prevu_cents ?? null,
      merged.fournisseur_nom || '',
      merged.fournisseur_tel || '',
      merged.notes || '',
      nextCtOk,
      nextPaperworkDone,
      id,
      userId
    );

    if (d.status && d.status !== existing.status) {
      db.prepare(
        'INSERT INTO vehicle_status_history (vehicle_id, user_id, old_status, new_status, reason) VALUES (?, ?, ?, ?, ?)'
      ).run(id, userId, existing.status, d.status, String(req.body.status_reason || 'Mise à jour manuelle'));
    }
  })();

  const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  logAudit(userId, 'VEHICLE_UPDATE', 'vehicle', id, d, req.ip || '');
  res.json({ vehicle: updated });
});

router.delete('/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const userId = req.user!.id;

  const existing = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId);
  if (!existing) {
    res.status(404).json({ error: 'Véhicule introuvable.' });
    return;
  }

  // Document & Legal Register Protection: prevent hard/soft deletion if linked to sales, invoices, or Livre de Police
  const hasDocs = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM sales WHERE vehicle_id = ? AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM invoices WHERE vehicle_id = ?) +
        (SELECT COUNT(*) FROM police_register_entries WHERE vehicle_id = ?) +
        (SELECT COUNT(*) FROM documents WHERE vehicle_id = ? AND deleted_at IS NULL) AS total_links`
    )
    .get(id, id, id, id) as { total_links: number };

  if (hasDocs.total_links > 0) {
    res.status(409).json({
      error:
        'Suppression bloquée : ce véhicule est lié à des documents légaux, factures, ventes ou au Livre de Police. Utilisez l\'archivage pour le masquer du stock actif sans perdre l\'historique.',
    });
    return;
  }

  db.prepare("UPDATE vehicles SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, userId);
  logAudit(userId, 'VEHICLE_DELETE', 'vehicle', id, {}, req.ip || '');
  res.json({ ok: true });
});

// Vehicle Photos Upload & Management
router.post('/:id/photos', upload.array('photos', 12), (req: AuthedRequest, res) => {
  const vehicleId = Number(req.params.id);
  const db = getDb();
  const userId = req.user!.id;

  const vehicle = db
    .prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(vehicleId, userId);
  if (!vehicle) {
    res.status(404).json({ error: 'Véhicule introuvable.' });
    return;
  }

  const files = (req.files as Express.Multer.File[]) || [];
  if (files.length === 0) {
    res.status(400).json({ error: 'Aucune photo reçue.' });
    return;
  }

  const existingCount = (
    db.prepare('SELECT COUNT(*) as c FROM vehicle_photos WHERE vehicle_id = ?').get(vehicleId) as { c: number }
  ).c;

  const inserted = db.transaction(() => {
    const out: unknown[] = [];
    files.forEach((f, idx) => {
      const url = `/uploads/${f.filename}`;
      const isPrimary = existingCount === 0 && idx === 0 ? 1 : 0;
      const r = db
        .prepare(
          'INSERT INTO vehicle_photos (vehicle_id, user_id, url, original_name, mime_type, size_bytes, sort_order, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(vehicleId, userId, url, f.originalname, f.mimetype, f.size, existingCount + idx, isPrimary);
      out.push(db.prepare('SELECT * FROM vehicle_photos WHERE id = ?').get(r.lastInsertRowid));
    });
    return out;
  })();

  res.status(201).json({ photos: inserted });
});

router.patch('/:id/photos/reorder', (req: AuthedRequest, res) => {
  const vehicleId = Number(req.params.id);
  const schema = z.object({
    photoIds: z.array(z.number().int().positive()),
    primaryPhotoId: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ordre des photos invalide.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const owns = db
    .prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?')
    .get(vehicleId, userId);
  if (!owns) {
    res.status(404).json({ error: 'Véhicule introuvable.' });
    return;
  }

  db.transaction(() => {
    parsed.data.photoIds.forEach((pid, idx) => {
      db.prepare('UPDATE vehicle_photos SET sort_order = ? WHERE id = ? AND vehicle_id = ? AND user_id = ?').run(
        idx,
        pid,
        vehicleId,
        userId
      );
    });
    if (parsed.data.primaryPhotoId) {
      db.prepare('UPDATE vehicle_photos SET is_primary = 0 WHERE vehicle_id = ? AND user_id = ?').run(vehicleId, userId);
      db.prepare('UPDATE vehicle_photos SET is_primary = 1 WHERE id = ? AND vehicle_id = ? AND user_id = ?').run(
        parsed.data.primaryPhotoId,
        vehicleId,
        userId
      );
    }
  })();

  const photos = db
    .prepare('SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC')
    .all(vehicleId);
  res.json({ photos });
});

router.delete('/:id/photos/:photoId', (req: AuthedRequest, res) => {
  const vehicleId = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  const db = getDb();
  const userId = req.user!.id;

  const photo = db
    .prepare('SELECT * FROM vehicle_photos WHERE id = ? AND vehicle_id = ? AND user_id = ?')
    .get(photoId, vehicleId, userId) as { url: string } | undefined;

  if (!photo) {
    res.status(404).json({ error: 'Photo introuvable.' });
    return;
  }

  db.prepare('DELETE FROM vehicle_photos WHERE id = ? AND user_id = ?').run(photoId, userId);

  if (photo.url.startsWith('/uploads/')) {
    const filePath = path.resolve(getUploadsDir(), path.basename(photo.url));
    if (filePath.startsWith(getUploadsDir() + path.sep) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  res.json({ ok: true });
});

export default router;
