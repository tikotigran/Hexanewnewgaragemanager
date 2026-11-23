import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '../db/database';
import {
  type AuthedRequest,
  clearSessionCookie,
  generateSessionToken,
  hashPassword,
  hashToken,
  logAudit,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email().max(180),
  password: z.string().min(8).max(128),
  phone: z.string().max(40).optional().default(''),
  address: z.string().max(250).optional().default(''),
  country: z.string().max(80).optional().default('France'),
  language: z.enum(['fr', 'ru', 'en']).optional().default('fr'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function createSessionForUser(
  userId: number,
  ip: string,
  ua: string
): { token: string; expiresAt: string } {
  const db = getDb();
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  db.prepare(
    'INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, tokenHash, expiresAt, ip, ua);

  return { token, expiresAt };
}

router.post('/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données invalides', details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  const email = parsed.data.email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone, address, country, language, theme, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'light', 'EUR')`
    )
    .run(
      parsed.data.first_name.trim(),
      parsed.data.last_name.trim(),
      email,
      hashPassword(parsed.data.password),
      parsed.data.phone,
      parsed.data.address,
      parsed.data.country,
      parsed.data.language
    );

  const userId = Number(result.lastInsertRowid);
  const { token } = createSessionForUser(
    userId,
    req.ip || '',
    String(req.headers['user-agent'] || '')
  );

  setSessionCookie(res, req, token);
  logAudit(userId, 'USER_REGISTER', 'user', userId, { email }, req.ip || '');

  const user = db
    .prepare(
      'SELECT id, first_name, last_name, email, phone, address, country, language, theme, currency, role FROM users WHERE id = ?'
    )
    .get(userId);

  res.status(201).json({ user, token, businessProfiles: [] });
});

router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email et mot de passe requis.' });
    return;
  }

  const db = getDb();
  const email = parsed.data.email.trim().toLowerCase();
  const userRow = db
    .prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL')
    .get(email) as (Record<string, unknown> & { id: number; password_hash: string }) | undefined;

  if (!userRow || !verifyPassword(parsed.data.password, userRow.password_hash)) {
    res.status(401).json({ error: 'Identifiants incorrects.' });
    return;
  }

  const { token } = createSessionForUser(
    userRow.id,
    req.ip || '',
    String(req.headers['user-agent'] || '')
  );
  setSessionCookie(res, req, token);
  logAudit(userRow.id, 'USER_LOGIN', 'user', userRow.id, {}, req.ip || '');

  const { password_hash: _ph, ...safeUser } = userRow;
  const businessProfiles = db
    .prepare(
      `SELECT bp.*, ubp.role, ubp.is_default
       FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
       ORDER BY ubp.is_default DESC, bp.id ASC`
    )
    .all(userRow.id);

  res.json({ user: safeUser, token, businessProfiles });
});

router.post('/demo-login', (req, res) => {
  const db = getDb();
  const userRow = db
    .prepare("SELECT * FROM users WHERE email = 'demo@hexavo.fr' AND deleted_at IS NULL")
    .get() as (Record<string, unknown> & { id: number }) | undefined;

  if (!userRow) {
    res.status(404).json({ error: 'Compte démo indisponible.' });
    return;
  }

  const { token } = createSessionForUser(
    userRow.id,
    req.ip || '',
    String(req.headers['user-agent'] || '')
  );
  setSessionCookie(res, req, token);

  const { password_hash: _ph, ...safeUser } = userRow;
  const businessProfiles = db
    .prepare(
      `SELECT bp.*, ubp.role, ubp.is_default
       FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
       ORDER BY ubp.is_default DESC, bp.id ASC`
    )
    .all(userRow.id);

  res.json({ user: safeUser, token, businessProfiles });
});

router.post('/logout', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  if (req.sessionToken) {
    db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashToken(req.sessionToken));
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

router.post('/forgot-password', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Email requis.' });
    return;
  }
  const db = getDb();
  const user = db
    .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
    .get(email) as { id: number } | undefined;

  // Always return neutral confirmation; generate reset token in DB when user exists
  let resetTokenPreview: string | undefined;
  if (user) {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 3600 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, hashToken(rawToken), expiresAt);
    if (process.env.NODE_ENV !== 'production') {
      resetTokenPreview = rawToken;
    }
  }

  res.json({
    ok: true,
    message: 'Si cet email est enregistré, une procédure de réinitialisation a été préparée.',
    ...(resetTokenPreview ? { devResetToken: resetTokenPreview } : {}),
  });
});

router.post('/reset-password', (req, res) => {
  const schema = z.object({
    token: z.string().min(10),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Jeton ou mot de passe invalide (8 caractères min).' });
    return;
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`
    )
    .get(hashToken(parsed.data.token)) as { id: number; user_id: number } | undefined;

  if (!row) {
    res.status(400).json({ error: 'Jeton de réinitialisation invalide ou expiré.' });
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      hashPassword(parsed.data.newPassword),
      row.user_id
    );
    db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(row.user_id);
  })();

  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const businessProfiles = db
    .prepare(
      `SELECT bp.*, ubp.role, ubp.is_default
       FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
       ORDER BY ubp.is_default DESC, bp.id ASC`
    )
    .all(req.user!.id);

  res.json({ user: req.user, businessProfiles });
});

router.patch('/profile', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    first_name: z.string().min(1).max(80).optional(),
    last_name: z.string().min(1).max(80).optional(),
    phone: z.string().max(40).optional(),
    address: z.string().max(250).optional(),
    country: z.string().max(80).optional(),
    language: z.enum(['fr', 'ru', 'en']).optional(),
    theme: z.enum(['light', 'dark']).optional(),
    currency: z.string().max(10).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Paramètres de profil invalides.' });
    return;
  }

  const db = getDb();
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, unknown>;
  const data = { ...current, ...parsed.data };

  db.prepare(
    `UPDATE users
     SET first_name = ?, last_name = ?, phone = ?, address = ?, country = ?, language = ?, theme = ?, currency = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    data.first_name,
    data.last_name,
    data.phone,
    data.address,
    data.country,
    data.language,
    data.theme,
    data.currency,
    req.user!.id
  );

  const updated = db
    .prepare(
      'SELECT id, first_name, last_name, email, phone, address, country, language, theme, currency, role FROM users WHERE id = ?'
    )
    .get(req.user!.id);
  logAudit(req.user!.id, 'PROFILE_UPDATE', 'user', req.user!.id, parsed.data, req.ip || '');
  res.json({ user: updated });
});

router.post('/change-password', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Mot de passe invalide (minimum 8 caractères).' });
    return;
  }
  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
    password_hash: string;
  };
  if (!verifyPassword(parsed.data.currentPassword, row.password_hash)) {
    res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    hashPassword(parsed.data.newPassword),
    req.user!.id
  );
  logAudit(req.user!.id, 'PASSWORD_CHANGE', 'user', req.user!.id, {}, req.ip || '');
  res.json({ ok: true });
});

// Business Profiles CRUD (can be added at any time without breaking historical operations)
const businessProfileSchema = z.object({
  nom_commercial: z.string().min(1).max(160),
  raison_sociale: z.string().min(1).max(160),
  siren: z.string().max(20).optional().default(''),
  siret: z.string().max(24).optional().default(''),
  adresse_pro: z.string().max(250).optional().default(''),
  telephone: z.string().max(40).optional().default(''),
  email: z.string().max(180).optional().default(''),
  code_ape: z.string().max(20).optional().default(''),
  forme_juridique: z.string().max(120).optional().default('Entrepreneur individuel (Micro-entreprise)'),
  regime_fiscal: z.enum(['micro_bic', 'micro_bnc', 'reel_simplifie', 'reel_normal', 'is']).optional().default('micro_bic'),
  regime_tva: z.enum(['franchise_en_base', 'tva_sur_marge', 'tva_sur_prix_total', 'autre_regime']).optional().default('franchise_en_base'),
  tva_intracom: z.string().max(40).optional().default(''),
  iban: z.string().max(64).optional().default(''),
  bic: z.string().max(32).optional().default(''),
  logo_url: z.string().max(500).optional().default(''),
  is_default: z.boolean().optional().default(false),
});

router.get('/business-profiles', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT bp.*, ubp.role, ubp.is_default
       FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
       ORDER BY ubp.is_default DESC, bp.id ASC`
    )
    .all(req.user!.id);
  res.json({ businessProfiles: rows });
});

router.post('/business-profiles', requireAuth, (req: AuthedRequest, res) => {
  const parsed = businessProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données du profil professionnel invalides', details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  const d = parsed.data;

  const created = db.transaction(() => {
    const bpRes = db
      .prepare(
        `INSERT INTO business_profiles (
          nom_commercial, raison_sociale, siren, siret, adresse_pro, telephone, email,
          code_ape, forme_juridique, regime_fiscal, regime_tva, tva_intracom, iban, bic, logo_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.nom_commercial,
        d.raison_sociale,
        d.siren,
        d.siret,
        d.adresse_pro,
        d.telephone,
        d.email,
        d.code_ape,
        d.forme_juridique,
        d.regime_fiscal,
        d.regime_tva,
        d.tva_intracom,
        d.iban,
        d.bic,
        d.logo_url
      );

    const bpId = Number(bpRes.lastInsertRowid);
    if (d.is_default) {
      db.prepare('UPDATE user_business_profiles SET is_default = 0 WHERE user_id = ?').run(req.user!.id);
    }
    const existingCount = (
      db.prepare('SELECT COUNT(*) as c FROM user_business_profiles WHERE user_id = ?').get(req.user!.id) as {
        c: number;
      }
    ).c;

    db.prepare(
      'INSERT INTO user_business_profiles (user_id, business_profile_id, role, is_default) VALUES (?, ?, ?, ?)'
    ).run(req.user!.id, bpId, 'owner', d.is_default || existingCount === 0 ? 1 : 0);

    return db
      .prepare(
        `SELECT bp.*, ubp.role, ubp.is_default
         FROM business_profiles bp
         JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
         WHERE bp.id = ? AND ubp.user_id = ?`
      )
      .get(bpId, req.user!.id);
  })();

  logAudit(req.user!.id, 'BUSINESS_PROFILE_CREATE', 'business_profile', (created as { id: number }).id, d, req.ip || '');
  res.status(201).json({ businessProfile: created });
});

router.patch('/business-profiles/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = businessProfileSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données invalides' });
    return;
  }

  const db = getDb();
  const ownership = db
    .prepare('SELECT * FROM user_business_profiles WHERE user_id = ? AND business_profile_id = ?')
    .get(req.user!.id, id);
  if (!ownership) {
    res.status(404).json({ error: 'Profil professionnel introuvable.' });
    return;
  }

  const current = db.prepare('SELECT * FROM business_profiles WHERE id = ?').get(id) as Record<string, unknown>;
  const merged = { ...current, ...parsed.data };

  db.transaction(() => {
    db.prepare(
      `UPDATE business_profiles SET
        nom_commercial = ?, raison_sociale = ?, siren = ?, siret = ?, adresse_pro = ?,
        telephone = ?, email = ?, code_ape = ?, forme_juridique = ?, regime_fiscal = ?,
        regime_tva = ?, tva_intracom = ?, iban = ?, bic = ?, logo_url = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      merged.nom_commercial,
      merged.raison_sociale,
      merged.siren,
      merged.siret,
      merged.adresse_pro,
      merged.telephone,
      merged.email,
      merged.code_ape,
      merged.forme_juridique,
      merged.regime_fiscal,
      merged.regime_tva,
      merged.tva_intracom,
      merged.iban,
      merged.bic,
      merged.logo_url,
      id
    );

    if (parsed.data.is_default) {
      db.prepare('UPDATE user_business_profiles SET is_default = 0 WHERE user_id = ?').run(req.user!.id);
      db.prepare('UPDATE user_business_profiles SET is_default = 1 WHERE user_id = ? AND business_profile_id = ?').run(
        req.user!.id,
        id
      );
    }
  })();

  const updated = db
    .prepare(
      `SELECT bp.*, ubp.role, ubp.is_default
       FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE bp.id = ? AND ubp.user_id = ?`
    )
    .get(id, req.user!.id);

  logAudit(req.user!.id, 'BUSINESS_PROFILE_UPDATE', 'business_profile', id, parsed.data, req.ip || '');
  res.json({ businessProfile: updated });
});

export default router;
