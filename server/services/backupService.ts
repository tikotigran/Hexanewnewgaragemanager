import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getBackupsDir } from '../db/database';

export function exportUserDataJson(db: Database.Database, userId: number): Record<string, unknown> {
  const user = db
    .prepare(
      'SELECT id, first_name, last_name, email, phone, address, country, language, theme, currency, created_at FROM users WHERE id = ?'
    )
    .get(userId);

  const businessProfiles = db
    .prepare(
      `SELECT bp.* FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL`
    )
    .all(userId);

  const vehicles = db.prepare('SELECT * FROM vehicles WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  const contacts = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  const purchases = db.prepare('SELECT * FROM purchases WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  const sales = db.prepare('SELECT * FROM sales WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  const expenses = db.prepare('SELECT * FROM expenses WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  const transactions = db.prepare('SELECT * FROM financial_transactions WHERE user_id = ?').all(userId);
  const invoices = db.prepare('SELECT * FROM invoices WHERE user_id = ?').all(userId);
  const policeRegister = db.prepare('SELECT * FROM police_register_entries WHERE user_id = ?').all(userId);
  const taxRules = db.prepare('SELECT * FROM tax_rules WHERE user_id = ? OR user_id IS NULL').all(userId);
  const listings = db.prepare('SELECT * FROM marketplace_listings WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  const events = db.prepare('SELECT * FROM calendar_events WHERE user_id = ?').all(userId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ?').all(userId);

  return {
    exportedAt: new Date().toISOString(),
    platform: 'HexaVO',
    version: '1.0',
    user,
    businessProfiles,
    vehicles,
    contacts,
    purchases,
    sales,
    expenses,
    transactions,
    invoices,
    policeRegister,
    taxRules,
    listings,
    events,
    tasks,
  };
}

export async function createSqliteBackup(db: Database.Database): Promise<{ fileName: string; filePath: string; sizeBytes: number }> {
  const backupsDir = getBackupsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `hexavo-backup-${stamp}.sqlite`;
  const filePath = path.resolve(backupsDir, fileName);
  await db.backup(filePath);
  const stat = fs.statSync(filePath);
  return { fileName, filePath, sizeBytes: stat.size };
}

export function listSqliteBackups(): Array<{ fileName: string; sizeBytes: number; createdAt: string }> {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => {
      const stat = fs.statSync(path.resolve(backupsDir, f));
      return {
        fileName: f,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
