import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrations';
import { executePurchaseTransaction, executeSaleTransaction } from './automationService';
import { hashPassword } from '../middleware/auth';

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexavo-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return { db, dir };
}

test('Mixed personal + pro workflow, late business profile addition, Livre de Police separation, and sale idempotency', () => {
  const { db, dir } = createTestDb();
  try {
    // 1. User registers with NO business profile initially
    const userId = Number(
      db
        .prepare(
          `INSERT INTO users (first_name, last_name, email, password_hash)
           VALUES ('Alice', 'Martin', 'alice@example.fr', ?)`
        )
        .run(hashPassword('Secret123!')).lastInsertRowid
    );

    // 2. Add a personal vehicle BEFORE having any business profile
    const personalVehId = Number(
      db
        .prepare(
          `INSERT INTO vehicles (user_id, business_profile_id, legal_context, status, marque, modele, date_achat, prix_achat_cents)
           VALUES (?, NULL, 'personal', 'en_vente', 'Renault', 'Clio', '2024-05-01', 1100000)`
        )
        .run(userId).lastInsertRowid
    );

    // Purchase for personal vehicle MUST NOT create a Livre de Police entry
    const pPers = executePurchaseTransaction(db, {
      userId,
      businessProfileId: null,
      vehicleId: personalVehId,
      contactId: null,
      legalContext: 'personal',
      sellerType: 'particulier',
      purchaseDate: '2024-05-01',
      amountHtCents: 1100000,
      vatCents: 0,
      amountTtcCents: 1100000,
      vatRegime: 'hors_tva',
      paymentMethod: 'virement',
      paymentStatus: 'paye',
      documentNumber: '',
      notes: '',
    });
    assert.equal(pPers.policeEntryId, null);

    // 3. Later, user opens a micro-entreprise and adds a Business Profile
    const bpId = Number(
      db
        .prepare(
          `INSERT INTO business_profiles (nom_commercial, raison_sociale, siret)
           VALUES ('Martin VO', 'MARTIN ALICE EI', '90123456700011')`
        )
        .run().lastInsertRowid
    );
    db.prepare('INSERT INTO user_business_profiles (user_id, business_profile_id, is_default) VALUES (?, ?, 1)').run(
      userId,
      bpId
    );

    // Verify historical personal vehicle keeps its personal legal_context!
    const oldPers = db.prepare('SELECT legal_context, business_profile_id FROM vehicles WHERE id = ?').get(personalVehId) as {
      legal_context: string;
      business_profile_id: number | null;
    };
    assert.equal(oldPers.legal_context, 'personal');
    assert.equal(oldPers.business_profile_id, null);

    // 4. Add a professional vehicle and record purchase -> creates Livre de Police entry
    const proVehId = Number(
      db
        .prepare(
          `INSERT INTO vehicles (user_id, business_profile_id, legal_context, status, marque, modele, immatriculation, vin, date_achat, prix_achat_cents)
           VALUES (?, ?, 'professional', 'en_vente', 'Audi', 'A3', 'GG-555-AA', 'WAUZZZ8V1LA000001', '2026-10-01', 1650000)`
        )
        .run(userId, bpId).lastInsertRowid
    );

    const pPro = executePurchaseTransaction(db, {
      userId,
      businessProfileId: bpId,
      vehicleId: proVehId,
      contactId: null,
      legalContext: 'professional',
      sellerType: 'societe',
      purchaseDate: '2026-10-01',
      amountHtCents: 1650000,
      vatCents: 0,
      amountTtcCents: 1650000,
      vatRegime: 'tva_sur_marge_eligible',
      paymentMethod: 'virement',
      paymentStatus: 'paye',
      documentNumber: 'ACH-PRO-1',
      notes: '',
    });
    assert.ok(pPro.policeEntryId !== null);

    // Create active marketplace listing for proVehId
    db.prepare(
      `INSERT INTO marketplace_listings (user_id, business_profile_id, vehicle_id, slug, title, price_cents, location_city, seller_type, status)
       VALUES (?, ?, ?, 'audi-a3-test', 'Audi A3 Sportback', 1990000, 'Paris', 'professionnel', 'publie')`
    ).run(userId, bpId, proVehId);

    // 5. Confirm sale with idempotency key (simulate double-click)
    const sale1 = executeSaleTransaction(db, {
      userId,
      businessProfileId: bpId,
      vehicleId: proVehId,
      contactId: null,
      legalContext: 'professional',
      sellerType: 'professionnel',
      buyerType: 'particulier',
      saleDate: '2026-11-10',
      amountHtCents: 1990000,
      vatCents: 0,
      amountTtcCents: 1990000,
      vatRegime: 'franchise_en_base',
      paymentMethod: 'virement',
      paymentStatus: 'paye',
      invoiceNumber: 'FAC-2026-0001',
      extraServicesCents: 0,
      extraServicesDesc: '',
      notes: '',
      idempotencyKey: 'double-click-key-1',
    });
    assert.equal(sale1.duplicate, false);

    const sale2 = executeSaleTransaction(db, {
      userId,
      businessProfileId: bpId,
      vehicleId: proVehId,
      contactId: null,
      legalContext: 'professional',
      sellerType: 'professionnel',
      buyerType: 'particulier',
      saleDate: '2026-11-10',
      amountHtCents: 1990000,
      vatCents: 0,
      amountTtcCents: 1990000,
      vatRegime: 'franchise_en_base',
      paymentMethod: 'virement',
      paymentStatus: 'paye',
      invoiceNumber: 'FAC-2026-0001',
      extraServicesCents: 0,
      extraServicesDesc: '',
      notes: '',
      idempotencyKey: 'double-click-key-1',
    });
    assert.equal(sale2.duplicate, true);
    assert.equal(sale2.saleId, sale1.saleId);

    // Verify vehicle -> vendu, Livre de Police -> disposed, Listing -> vendu
    const vehAfter = db.prepare('SELECT status FROM vehicles WHERE id = ?').get(proVehId) as { status: string };
    assert.equal(vehAfter.status, 'vendu');

    const lpAfter = db.prepare('SELECT status, sale_price_cents FROM police_register_entries WHERE id = ?').get(
      pPro.policeEntryId
    ) as { status: string; sale_price_cents: number };
    assert.equal(lpAfter.status, 'disposed');
    assert.equal(lpAfter.sale_price_cents, 1990000);

    const listingAfter = db.prepare('SELECT status FROM marketplace_listings WHERE vehicle_id = ?').get(proVehId) as {
      status: string;
    };
    assert.equal(listingAfter.status, 'vendu');

    // Total Livre de Police entries = 1 (personal vehicle excluded)
    const lpCount = (
      db.prepare('SELECT COUNT(*) as c FROM police_register_entries WHERE user_id = ?').get(userId) as { c: number }
    ).c;
    assert.equal(lpCount, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
