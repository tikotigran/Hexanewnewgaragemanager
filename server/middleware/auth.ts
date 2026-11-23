import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/database';

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  country: string;
  language: string;
  theme: string;
  currency: string;
  role: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

export const SESSION_COOKIE_NAME = 'hexavo_sid';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derived);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      result[k] = decodeURIComponent(v);
    }
  }
  return result;
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  return null;
}

export function setSessionCookie(res: Response, req: Request, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    return next();
  }
  const db = getDb();
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.address, u.country, u.language, u.theme, u.currency, u.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.deleted_at IS NULL`
    )
    .get(tokenHash) as AuthUser | undefined;

  if (row) {
    req.user = row;
    req.sessionToken = token;
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  // Basic CSRF defense for cookie-authenticated state-changing requests
  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    const hasCustomHeader = req.headers['x-requested-with'] === 'HexaVO';
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] || req.headers.host) as string | undefined;

    if (!hasBearer && !hasCustomHeader && origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          res.status(403).json({ error: 'Requête cross-origin refusée (CSRF).' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Origine invalide.' });
        return;
      }
    }
  }

  optionalAuth(req, res, () => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    next();
  });
}

export function logAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown> = {},
  ipAddress = ''
): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, action, entityType, String(entityId), JSON.stringify(details), ipAddress);
  } catch {
    // Do not break business flow if audit insert fails
  }
}
