import type Database from 'better-sqlite3';
import { hashPassword } from '../middleware/auth';
import { computePoliceEntryHash } from '../services/automationService';
import { generateFacturXXml } from '../services/facturxService';

export function seedDatabase(db: Database.Database): void {
  // 1. Seed system expense categories if empty
  const catCount = (db.prepare('SELECT COUNT(*) as c FROM expense_categories').get() as { c: number }).c;
  if (catCount === 0) {
    const categories = [
      // Vehicle categories
      ['vehicle', 'reparation', 'Réparation mécanique', 'Механический ремонт', 'Mechanical repair'],
      ['vehicle', 'pieces', 'Pièces détachées', 'Запчасти', 'Spare parts'],
      ['vehicle', 'detailing', 'Detailing / Préparation esthétique', 'Детейлинг', 'Detailing'],
      ['vehicle', 'lavage', 'Lavage', 'Мойка', 'Car wash'],
      ['vehicle', 'diagnostic', 'Diagnostic électronique', 'Диагностика', 'Diagnostics'],
      ['vehicle', 'transport', 'Transport / Convoyage', 'Транспортировка', 'Transport'],
      ['vehicle', 'controle_technique', 'Contrôle technique', 'Техосмотр (CT)', 'Technical inspection'],
      ['vehicle', 'preparation', 'Préparation à la vente', 'Подготовка к продаже', 'Sale preparation'],
      ['vehicle', 'autre_vehicule', 'Autres frais véhicule', 'Прочие расходы на авто', 'Other vehicle expenses'],
      // Business overhead categories
      ['business', 'loyer', 'Loyer / Local', 'Аренда', 'Rent'],
      ['business', 'electricite', 'Électricité / Énergie', 'Электричество', 'Electricity'],
      ['business', 'internet', 'Internet / Téléphonie', 'Интернет и связь', 'Internet & telecom'],
      ['business', 'assurance', 'Assurance professionnelle', 'Страхование', 'Business insurance'],
      ['business', 'publicite', 'Publicité / Annonces', 'Реклама', 'Advertising'],
      ['business', 'outillage', 'Outillage', 'Инструменты', 'Tools'],
      ['business', 'logiciel', 'Logiciels & SaaS', 'Программное обеспечение', 'Software'],
      ['business', 'frais_bancaires', 'Frais bancaires', 'Банковские комиссии', 'Bank fees'],
      ['business', 'comptabilite', 'Comptabilité / Conseil', 'Бухгалтерия', 'Accounting'],
      ['business', 'deplacement', 'Déplacements', 'Транспорт и поездки', 'Travel'],
      ['business', 'autre_pro', 'Autres charges générales', 'Прочие операционные расходы', 'Other operating expenses'],
    ];
    const stmt = db.prepare(
      'INSERT INTO expense_categories (user_id, scope, code, label_fr, label_ru, label_en, is_system) VALUES (NULL, ?, ?, ?, ?, ?, 1)'
    );
    for (const row of categories) {
      stmt.run(...row);
    }
  }

  // 2. Seed global 2026 French Tax Rules if empty
  const ruleCount = (db.prepare('SELECT COUNT(*) as c FROM tax_rules WHERE user_id IS NULL').get() as { c: number }).c;
  if (ruleCount === 0) {
    db.prepare(
      `INSERT INTO tax_rules (user_id, rule_code, label, activity_type, regime_fiscal, regime_tva, social_rate_bps, income_tax_rate_bps, vat_rate_bps, effective_from, legal_notice, is_default)
       VALUES
       (NULL, 'MICRO_BIC_VENTES_2026', 'Micro-entrepreneur Achat/Revente (Base 2026 — 12,3%)', 'achat_revente_vo', 'micro_bic', 'franchise_en_base', 1230, 100, 2000, '2026-01-01', 'TVA non applicable, art. 293 B du CGI', 1),
       (NULL, 'MICRO_BIC_TVA_MARGE_2026', 'Micro-entrepreneur avec TVA sur marge (2026)', 'achat_revente_vo', 'micro_bic', 'tva_sur_marge', 1230, 100, 2000, '2026-01-01', 'Régime particulier — Biens d''occasion — Art. 297 A du CGI', 0),
       (NULL, 'SOCIETE_REEL_IS_2026', 'Société / Régime réel (IS + TVA 20%)', 'negoce_auto_pro', 'is', 'tva_sur_marge', 0, 1500, 2000, '2026-01-01', 'TVA sur marge art. 297 A ou prix total selon origine véhicule', 0)`
    ).run();
  }

  // 3. Seed demo account if no users exist yet
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  db.transaction(() => {
    const userRes = db
      .prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash, phone, address, country, language, theme, currency, role)
         VALUES (?, ?, ?, ?, ?, ?, 'France', 'fr', 'light', 'EUR', 'user')`
      )
      .run(
        'Jean-Luc',
        'Moreau',
        'demo@hexavo.fr',
        hashPassword('HexaVO2026!'),
        '+33 6 12 45 78 90',
        '18 Rue de la République, 75011 Paris'
      );
    const userId = Number(userRes.lastInsertRowid);

    // One Professional Business Profile (Micro-entrepreneur)
    const bpRes = db
      .prepare(
        `INSERT INTO business_profiles (
          nom_commercial, raison_sociale, siren, siret, adresse_pro, telephone, email,
          code_ape, forme_juridique, regime_fiscal, regime_tva, tva_intracom, iban, bic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'Moreau Auto Sélection',
        'MOREAU JEAN-LUC EI',
        '894521304',
        '89452130400018',
        '42 Avenue Jean Jaurès, 93500 Pantin',
        '+33 1 48 92 10 34',
        'contact@moreau-auto.fr',
        '4511Z',
        'Entrepreneur individuel (Micro-entreprise)',
        'micro_bic',
        'franchise_en_base',
        'FR42894521304',
        'FR7630004000031234567890143',
        'BNPAFRPP'
      );
    const bpId = Number(bpRes.lastInsertRowid);

    db.prepare(
      'INSERT INTO user_business_profiles (user_id, business_profile_id, role, is_default) VALUES (?, ?, ?, 1)'
    ).run(userId, bpId, 'owner');

    // Contacts
    const c1 = Number(
      db
        .prepare(
          `INSERT INTO contacts (user_id, type, is_buyer, is_supplier, first_name, last_name, email, phone, address, city, postal_code, notes)
           VALUES (?, 'particulier', 1, 0, 'Camille', 'Laurent', 'camille.laurent@orange.fr', '+33 6 44 21 88 10', '12 Rue Victor Hugo', 'Lyon', '69002', 'Acheteuse sérieuse, paiement par virement instantané')`
        )
        .run(userId).lastInsertRowid
    );
    const c2 = Number(
      db
        .prepare(
          `INSERT INTO contacts (user_id, type, is_buyer, is_supplier, first_name, last_name, company_name, siren, siret, email, phone, address, city, postal_code, notes)
           VALUES (?, 'fournisseur', 0, 1, 'Marc', 'Delacroix', 'BCA Enchères Île-de-France', '412589630', '41258963000025', 'appro@bca-auto.fr', '+33 1 60 12 33 00', 'ZI Les Mardelles', 'Aulnay-sous-Bois', '93600', 'Fournisseur principal ventes pro')`
        )
        .run(userId).lastInsertRowid
    );
    const c3 = Number(
      db
        .prepare(
          `INSERT INTO contacts (user_id, type, is_buyer, is_supplier, first_name, last_name, email, phone, address, city, postal_code, notes)
           VALUES (?, 'prospect', 1, 1, 'Thomas', 'Bernard', 't.bernard@gmail.com', '+33 6 77 19 04 52', '5 Place Bellecour', 'Vincennes', '94300', 'Intéressé par la Golf VIII R-Line')`
        )
        .run(userId).lastInsertRowid
    );

    // Vehicles: Mix of Professional & Personal in the SAME account!
    // 1. Pro - En vente (Peugeot 3008)
    const v1 = Number(
      db
        .prepare(
          `INSERT INTO vehicles (
            user_id, business_profile_id, legal_context, status, marque, modele, version,
            immatriculation, vin, annee, kilometrage, energie, boite_vitesses, couleur,
            portes, puissance_fiscale, co2, date_achat, prix_achat_cents, prix_vente_prevu_cents,
            fournisseur_nom, fournisseur_tel, notes
          ) VALUES (?, ?, 'professional', 'en_vente', 'Peugeot', '3008', '1.5 BlueHDi 130ch Allure Pack', 'GC-482-KL', 'VF3MCYHZJNS104821', 2022, 48500, 'Diesel', 'Automatique EAT8', 'Gris Platinium', 5, 7, 129, '2026-09-12', 1940000, 2390000, 'BCA Enchères Île-de-France', '+33 1 60 12 33 00', 'Historique entretien Peugeot complet, contrôle technique vierge.')`
        )
        .run(userId, bpId).lastInsertRowid
    );

    // 2. Pro - Vendu (BMW Série 3)
    const v2 = Number(
      db
        .prepare(
          `INSERT INTO vehicles (
            user_id, business_profile_id, legal_context, status, marque, modele, version,
            immatriculation, vin, annee, kilometrage, energie, boite_vitesses, couleur,
            portes, puissance_fiscale, co2, date_achat, prix_achat_cents, prix_vente_prevu_cents,
            prix_vente_final_cents, fournisseur_nom, fournisseur_tel, notes
          ) VALUES (?, ?, 'professional', 'vendu', 'BMW', 'Série 3', '320d M Sport G20', 'FP-918-TR', 'WBA5V51060FH49102', 2021, 61200, 'Diesel', 'Automatique Steptronic', 'Alpinweiss', 4, 10, 124, '2026-08-05', 2580000, 3150000, 3090000, 'BCA Enchères Île-de-France', '+33 1 60 12 33 00', 'Vendue avec garantie 6 mois et Factur-X émise.')`
        )
        .run(userId, bpId).lastInsertRowid
    );

    // 3. Pro - En préparation (Volkswagen Golf VIII)
    const v3 = Number(
      db
        .prepare(
          `INSERT INTO vehicles (
            user_id, business_profile_id, legal_context, status, marque, modele, version,
            immatriculation, vin, annee, kilometrage, energie, boite_vitesses, couleur,
            portes, puissance_fiscale, co2, date_achat, prix_achat_cents, prix_vente_prevu_cents,
            fournisseur_nom, fournisseur_tel, notes
          ) VALUES (?, ?, 'professional', 'en_preparation', 'Volkswagen', 'Golf VIII', '1.5 eTSI 150ch R-Line DSG7', 'GH-114-WX', 'WVWZZZCDZNW018394', 2022, 34900, 'Hybride essence', 'Automatique DSG7', 'Gris Lunaire', 5, 8, 122, '2026-10-18', 2120000, 2540000, 'Particulier reprise', '+33 6 33 20 11 45', 'Attente jantes + detailing complet avant mise en ligne.')`
        )
        .run(userId, bpId).lastInsertRowid
    );

    // 4. Personal - En vente (Peugeot 308 GT - Vente personnelle particulier!)
    const v4 = Number(
      db
        .prepare(
          `INSERT INTO vehicles (
            user_id, business_profile_id, legal_context, status, marque, modele, version,
            immatriculation, vin, annee, kilometrage, energie, boite_vitesses, couleur,
            portes, puissance_fiscale, co2, date_achat, prix_achat_cents, prix_vente_prevu_cents,
            fournisseur_nom, fournisseur_tel, notes
          ) VALUES (?, NULL, 'personal', 'en_vente', 'Peugeot', '308', 'GT Pack 1.2 PureTech 130 EAT8', 'GE-729-MN', 'VR3FPHNSJMY502193', 2021, 39200, 'Essence', 'Automatique EAT8', 'Bleu Avatar', 5, 7, 131, '2024-03-10', 2250000, 2090000, 'Concession Peugeot Paris 11', '+33 1 43 55 80 00', 'Véhicule personnel familial — vente privée hors activité professionnelle.')`
        )
        .run(userId).lastInsertRowid
    );

    // Photos mapped to our generated assets
    db.prepare(
      'INSERT INTO vehicle_photos (vehicle_id, user_id, url, original_name, sort_order, is_primary) VALUES (?, ?, ?, ?, 0, 1)'
    ).run(v1, userId, '/src/assets/images/vehicle_peugeot_3008_1795209536956.jpg', 'peugeot-3008.jpg');
    db.prepare(
      'INSERT INTO vehicle_photos (vehicle_id, user_id, url, original_name, sort_order, is_primary) VALUES (?, ?, ?, ?, 0, 1)'
    ).run(v2, userId, '/src/assets/images/vehicle_bmw_serie3_1795209536945.jpg', 'bmw-serie3.jpg');
    db.prepare(
      'INSERT INTO vehicle_photos (vehicle_id, user_id, url, original_name, sort_order, is_primary) VALUES (?, ?, ?, ?, 0, 1)'
    ).run(v3, userId, '/src/assets/images/vehicle_vw_golf_1795209537860.jpg', 'vw-golf.jpg');
    db.prepare(
      'INSERT INTO vehicle_photos (vehicle_id, user_id, url, original_name, sort_order, is_primary) VALUES (?, ?, ?, ?, 0, 1)'
    ).run(v4, userId, '/src/assets/images/vehicle_renault_clio_1795209537284.jpg', 'peugeot-308.jpg');

    // Status histories
    for (const [vid, st] of [
      [v1, 'en_vente'],
      [v2, 'vendu'],
      [v3, 'en_preparation'],
      [v4, 'en_vente'],
    ] as const) {
      db.prepare(
        'INSERT INTO vehicle_status_history (vehicle_id, user_id, old_status, new_status, reason) VALUES (?, ?, NULL, ?, ?)'
      ).run(vid, userId, st, 'Création dossier véhicule');
    }

    // Purchases & Financial outflows
    const p1 = Number(
      db
        .prepare(
          `INSERT INTO purchases (user_id, business_profile_id, vehicle_id, contact_id, legal_context, seller_type, purchase_date, amount_ht_cents, vat_cents, amount_ttc_cents, vat_regime, payment_method, payment_status, document_number, notes)
           VALUES (?, ?, ?, ?, 'professional', 'societe', '2026-09-12', 1940000, 0, 1940000, 'tva_sur_marge_eligible', 'virement', 'paye', 'ACH-2026-002', 'Achat vente aux enchères pro')`
        )
        .run(userId, bpId, v1, c2).lastInsertRowid
    );
    const p2 = Number(
      db
        .prepare(
          `INSERT INTO purchases (user_id, business_profile_id, vehicle_id, contact_id, legal_context, seller_type, purchase_date, amount_ht_cents, vat_cents, amount_ttc_cents, vat_regime, payment_method, payment_status, document_number, notes)
           VALUES (?, ?, ?, ?, 'professional', 'societe', '2026-08-05', 2580000, 0, 2580000, 'tva_sur_marge_eligible', 'virement', 'paye', 'ACH-2026-001', 'Achat lot pro')`
        )
        .run(userId, bpId, v2, c2).lastInsertRowid
    );
    const p3 = Number(
      db
        .prepare(
          `INSERT INTO purchases (user_id, business_profile_id, vehicle_id, contact_id, legal_context, seller_type, purchase_date, amount_ht_cents, vat_cents, amount_ttc_cents, vat_regime, payment_method, payment_status, document_number, notes)
           VALUES (?, ?, ?, NULL, 'professional', 'particulier', '2026-10-18', 2120000, 0, 2120000, 'hors_tva', 'virement', 'paye', 'ACH-2026-003', 'Reprise particulier')`
        )
        .run(userId, bpId, v3).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO financial_transactions (user_id, business_profile_id, vehicle_id, contact_id, purchase_id, legal_context, direction, category, amount_cents, operation_date, payment_date, payment_method, payment_status, description)
       VALUES
       (?, ?, ?, ?, ?, 'professional', 'outflow', 'achat_vehicule', 1940000, '2026-09-12', '2026-09-12', 'virement', 'paye', 'Achat Peugeot 3008'),
       (?, ?, ?, ?, ?, 'professional', 'outflow', 'achat_vehicule', 2580000, '2026-08-05', '2026-08-05', 'virement', 'paye', 'Achat BMW Série 3'),
       (?, ?, ?, NULL, ?, 'professional', 'outflow', 'achat_vehicule', 2120000, '2026-10-18', '2026-10-18', 'virement', 'paye', 'Achat Volkswagen Golf VIII')`
    ).run(userId, bpId, v1, c2, p1, userId, bpId, v2, c2, p2, userId, bpId, v3, p3);

    // Sale for v2 (BMW Série 3)
    const s1 = Number(
      db
        .prepare(
          `INSERT INTO sales (user_id, business_profile_id, vehicle_id, contact_id, legal_context, seller_type, buyer_type, sale_date, amount_ht_cents, vat_cents, amount_ttc_cents, vat_regime, payment_method, payment_status, invoice_number, extra_services_cents, extra_services_desc, notes)
           VALUES (?, ?, ?, ?, 'professional', 'professionnel', 'particulier', '2026-09-24', 3090000, 0, 3090000, 'franchise_en_base', 'virement', 'paye', 'FAC-2026-0001', 0, '', 'Livraison effectuée à Pantin')`
        )
        .run(userId, bpId, v2, c1).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO financial_transactions (user_id, business_profile_id, vehicle_id, contact_id, sale_id, legal_context, direction, category, amount_cents, operation_date, payment_date, payment_method, payment_status, description)
       VALUES (?, ?, ?, ?, ?, 'professional', 'inflow', 'vente_vehicule', 3090000, '2026-09-24', '2026-09-24', 'virement', 'paye', 'Vente BMW Série 3 (FAC-2026-0001)')`
    ).run(userId, bpId, v2, c1, s1);

    // Expenses (Vehicle-specific + General Business overhead)
    const catDetailing = (db.prepare("SELECT id FROM expense_categories WHERE code = 'detailing'").get() as { id: number }).id;
    const catRep = (db.prepare("SELECT id FROM expense_categories WHERE code = 'reparation'").get() as { id: number }).id;
    const catCt = (db.prepare("SELECT id FROM expense_categories WHERE code = 'controle_technique'").get() as { id: number }).id;
    const catLoyer = (db.prepare("SELECT id FROM expense_categories WHERE code = 'loyer'").get() as { id: number }).id;
    const catAssur = (db.prepare("SELECT id FROM expense_categories WHERE code = 'assurance'").get() as { id: number }).id;

    const e1 = Number(
      db
        .prepare(
          `INSERT INTO expenses (user_id, business_profile_id, vehicle_id, category_id, scope, supplier_name, operation_date, payment_date, amount_ht_cents, vat_rate_bps, vat_cents, amount_ttc_cents, payment_method, payment_status, notes)
           VALUES (?, ?, ?, ?, 'vehicle', 'CleanCar Pro 93', '2026-09-15', '2026-09-15', 24000, 2000, 4800, 28800, 'carte', 'paye', 'Polissage complet + nettoyage intérieur')`
        )
        .run(userId, bpId, v1, catDetailing).lastInsertRowid
    );
    const e2 = Number(
      db
        .prepare(
          `INSERT INTO expenses (user_id, business_profile_id, vehicle_id, category_id, scope, supplier_name, operation_date, payment_date, amount_ht_cents, vat_rate_bps, vat_cents, amount_ttc_cents, payment_method, payment_status, notes)
           VALUES (?, ?, ?, ?, 'vehicle', 'Garage Central Pantin', '2026-08-12', '2026-08-12', 45000, 2000, 9000, 54000, 'virement', 'paye', 'Révision complète + plaquettes avant')`
        )
        .run(userId, bpId, v2, catRep).lastInsertRowid
    );
    const e3 = Number(
      db
        .prepare(
          `INSERT INTO expenses (user_id, business_profile_id, vehicle_id, category_id, scope, supplier_name, operation_date, payment_date, amount_ht_cents, vat_rate_bps, vat_cents, amount_ttc_cents, payment_method, payment_status, notes)
           VALUES (?, ?, ?, ?, 'vehicle', 'Dekra Pantin', '2026-10-20', '2026-10-20', 6500, 2000, 1300, 7800, 'carte', 'paye', 'Contrôle technique favorable')`
        )
        .run(userId, bpId, v3, catCt).lastInsertRowid
    );
    const e4 = Number(
      db
        .prepare(
          `INSERT INTO expenses (user_id, business_profile_id, vehicle_id, category_id, scope, supplier_name, operation_date, payment_date, amount_ht_cents, vat_rate_bps, vat_cents, amount_ttc_cents, payment_method, payment_status, is_recurring, recurrence_interval, notes)
           VALUES (?, ?, NULL, ?, 'business', 'SCI Parc Pantin', '2026-10-01', '2026-10-01', 85000, 0, 0, 85000, 'prelevement', 'paye', 1, 'monthly', 'Loyer mensuel box stockage 4 places')`
        )
        .run(userId, bpId, catLoyer).lastInsertRowid
    );
    const e5 = Number(
      db
        .prepare(
          `INSERT INTO expenses (user_id, business_profile_id, vehicle_id, category_id, scope, supplier_name, operation_date, payment_date, amount_ht_cents, vat_rate_bps, vat_cents, amount_ttc_cents, payment_method, payment_status, is_recurring, recurrence_interval, notes)
           VALUES (?, ?, NULL, ?, 'business', 'AXA Pro Auto', '2026-10-05', '2026-10-05', 18500, 0, 0, 18500, 'prelevement', 'paye', 1, 'monthly', 'RC Pro & W Garage')`
        )
        .run(userId, bpId, catAssur).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO financial_transactions (user_id, business_profile_id, vehicle_id, expense_id, legal_context, direction, category, amount_cents, operation_date, payment_date, payment_method, payment_status, description)
       VALUES
       (?, ?, ?, ?, 'professional', 'outflow', 'detailing', 28800, '2026-09-15', '2026-09-15', 'carte', 'paye', 'Detailing Peugeot 3008'),
       (?, ?, ?, ?, 'professional', 'outflow', 'reparation', 54000, '2026-08-12', '2026-08-12', 'virement', 'paye', 'Révision BMW Série 3'),
       (?, ?, ?, ?, 'professional', 'outflow', 'controle_technique', 7800, '2026-10-20', '2026-10-20', 'carte', 'paye', 'Contrôle technique Golf VIII'),
       (?, ?, NULL, ?, 'professional', 'outflow', 'loyer', 85000, '2026-10-01', '2026-10-01', 'prelevement', 'paye', 'Loyer mensuel parc'),
       (?, ?, NULL, ?, 'professional', 'outflow', 'assurance', 18500, '2026-10-05', '2026-10-05', 'prelevement', 'paye', 'Assurance RC Pro')`
    ).run(userId, bpId, v1, e1, userId, bpId, v2, e2, userId, bpId, v3, e3, userId, bpId, e4, userId, bpId, e5);

    // Invoice + Factur-X XML for BMW sale
    const xml = generateFacturXXml({
      invoiceNumber: 'FAC-2026-0001',
      issueDate: '2026-09-24',
      dueDate: '2026-09-24',
      currency: 'EUR',
      profile: 'BASIC',
      seller: {
        name: 'Moreau Auto Sélection (MOREAU JEAN-LUC EI)',
        siret: '89452130400018',
        address: '42 Avenue Jean Jaurès, 93500 Pantin',
        countryCode: 'FR',
      },
      buyer: {
        name: 'Camille Laurent',
        address: '12 Rue Victor Hugo, 69002 Lyon',
        countryCode: 'FR',
      },
      lines: [
        {
          description: 'BMW Série 3 320d M Sport G20 — VIN WBA5V51060FH49102 — Immat FP-918-TR',
          quantity: 1,
          unitPriceHtCents: 3090000,
          vatRateBps: 0,
          vatCents: 0,
          totalTtcCents: 3090000,
        },
      ],
      subtotalHtCents: 3090000,
      vatCents: 0,
      totalTtcCents: 3090000,
      vatLegalMention: 'TVA non applicable, art. 293 B du CGI',
      paymentTerms: 'Paiement comptant par virement',
    });

    const invId = Number(
      db
        .prepare(
          `INSERT INTO invoices (
            user_id, business_profile_id, sale_id, vehicle_id, contact_id, invoice_number,
            status, issue_date, due_date, vat_regime, vat_legal_mention, currency,
            subtotal_ht_cents, vat_cents, total_ttc_cents, paid_cents, payment_terms,
            facturx_profile, xml_content, pa_transmission_status
          ) VALUES (?, ?, ?, ?, ?, 'FAC-2026-0001', 'payee', '2026-09-24', '2026-09-24', 'franchise_en_base', 'TVA non applicable, art. 293 B du CGI', 'EUR', 3090000, 0, 3090000, 3090000, 'Paiement comptant par virement', 'BASIC', ?, 'not_configured')`
        )
        .run(userId, bpId, s1, v2, c1, xml).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price_ht_cents, vat_rate_bps, vat_cents, total_ttc_cents, sort_order)
       VALUES (?, ?, 1, 3090000, 0, 0, 3090000, 0)`
    ).run(invId, 'BMW Série 3 320d M Sport G20 — VIN WBA5V51060FH49102 — Immat FP-918-TR');

    // Livre de Police entries ONLY for the 3 professional vehicles (NOT v4 which is personal!)
    const lpRows = [
      {
        vid: v2,
        pid: p2,
        sid: s1,
        seq: 1,
        num: 'LP-2026-0001',
        immat: 'FP-918-TR',
        vin: 'WBA5V51060FH49102',
        mm: 'BMW Série 3',
        pdate: '2026-08-05',
        pprice: 2580000,
        sdate: '2026-09-24',
        sprice: 3090000,
        status: 'disposed',
        supplier: { name: 'BCA Enchères Île-de-France', siret: '41258963000025' },
        buyer: { name: 'Camille Laurent', address: '12 Rue Victor Hugo, 69002 Lyon' },
      },
      {
        vid: v1,
        pid: p1,
        sid: null,
        seq: 2,
        num: 'LP-2026-0002',
        immat: 'GC-482-KL',
        vin: 'VF3MCYHZJNS104821',
        mm: 'Peugeot 3008',
        pdate: '2026-09-12',
        pprice: 1940000,
        sdate: null,
        sprice: null,
        status: 'active',
        supplier: { name: 'BCA Enchères Île-de-France', siret: '41258963000025' },
        buyer: null,
      },
      {
        vid: v3,
        pid: p3,
        sid: null,
        seq: 3,
        num: 'LP-2026-0003',
        immat: 'GH-114-WX',
        vin: 'WVWZZZCDZNW018394',
        mm: 'Volkswagen Golf VIII',
        pdate: '2026-10-18',
        pprice: 2120000,
        sdate: null,
        sprice: null,
        status: 'active',
        supplier: { name: 'Particulier reprise', phone: '+33 6 33 20 11 45' },
        buyer: null,
      },
    ];

    for (const r of lpRows) {
      const hash = computePoliceEntryHash(r);
      db.prepare(
        `INSERT INTO police_register_entries (
          user_id, business_profile_id, vehicle_id, purchase_id, sale_id,
          entry_number, entry_sequence, supplier_snapshot_json, buyer_snapshot_json,
          vehicle_snapshot_json, immatriculation, vin, marque_modele,
          purchase_date, purchase_price_cents, sale_date, sale_price_cents,
          supporting_doc_ref, status, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        bpId,
        r.vid,
        r.pid,
        r.sid,
        r.num,
        r.seq,
        JSON.stringify(r.supplier),
        r.buyer ? JSON.stringify(r.buyer) : null,
        JSON.stringify({ marque_modele: r.mm, immatriculation: r.immat, vin: r.vin }),
        r.immat,
        r.vin,
        r.mm,
        r.pdate,
        r.pprice,
        r.sdate,
        r.sprice,
        r.sid ? 'FAC-2026-0001' : `ACH-${r.pid}`,
        r.status,
        hash
      );
    }

    // Marketplace Listings (1 Pro + 1 Personal)
    db.prepare(
      `INSERT INTO marketplace_listings (
        user_id, business_profile_id, vehicle_id, slug, title, description, price_cents,
        location_city, location_region, seller_type, vehicle_condition, status,
        contact_phone, contact_email, views_count, published_at
      ) VALUES
      (?, ?, ?, 'peugeot-3008-allure-pack-2022-pantin', 'Peugeot 3008 1.5 BlueHDi 130ch Allure Pack EAT8', 'Superbe Peugeot 3008 en parfait état, entretien suivi exclusivement dans le réseau Peugeot, caméra 360°, hayon mains libres, Apple CarPlay. Garantie 6 mois incluse par Moreau Auto Sélection.', 2390000, 'Pantin', 'Île-de-France', 'professionnel', 'tres_bon_etat', 'publie', '+33 1 48 92 10 34', 'contact@moreau-auto.fr', 142, '2026-10-02T10:00:00Z'),
      (?, NULL, ?, 'peugeot-308-gt-pack-2021-paris', 'Peugeot 308 GT Pack 1.2 PureTech 130 EAT8 — Particulier', 'Véhicule personnel non-fumeur, stationné en parking souterrain à Paris 11e. Carnet complet, pneus Michelin récents, contrôle technique vierge.', 2090000, 'Paris', 'Île-de-France', 'particulier', 'tres_bon_etat', 'publie', '+33 6 12 45 78 90', 'demo@hexavo.fr', 87, '2026-10-15T14:30:00Z')`
    ).run(userId, bpId, v1, userId, v4);

    // Calendar Events & Tasks
    db.prepare(
      `INSERT INTO calendar_events (user_id, vehicle_id, contact_id, event_type, title, description, start_at, end_at, location, status)
       VALUES
       (?, ?, ?, 'rdv_client', 'Essai routier Golf VIII — Thomas Bernard', 'Présentation véhicule et vérification dossier reprise', '2026-11-22T10:30:00', '2026-11-22T11:30:00', '42 Av. Jean Jaurès, Pantin', 'planifie'),
       (?, ?, NULL, 'controle_technique', 'Contrôle technique Peugeot 3008', 'Renouvellement CT pré-vente', '2026-11-24T09:00:00', '2026-11-24T10:00:00', 'Dekra Pantin', 'planifie'),
       (?, ?, NULL, 'reparation', 'Pose jantes & detailing Golf VIII', 'Préparation esthétique complète', '2026-11-21T14:00:00', '2026-11-21T17:00:00', 'Atelier CleanCar 93', 'planifie')`
    ).run(userId, v3, c3, userId, v1, userId, v3);

    db.prepare(
      `INSERT INTO tasks (user_id, vehicle_id, title, description, due_date, priority, status)
       VALUES
       (?, ?, 'Publier l''annonce de la Golf VIII sur HexaVO', 'Prendre les photos finales après detailing et publier sur la marketplace', '2026-11-23', 'high', 'todo'),
       (?, ?, 'Préparer la déclaration URSSAF mensuelle', 'Vérifier le chiffre d''affaires encaissé sur la période', '2026-11-30', 'medium', 'in_progress')`
    ).run(userId, v3, userId, null);

    db.prepare(
      `INSERT INTO notifications (user_id, type, title, message, link_url, is_read)
       VALUES
       (?, 'calendar', 'Rendez-vous client à venir', 'Essai routier Golf VIII prévu avec Thomas Bernard.', '/calendrier', 0),
       (?, 'vehicle', 'Préparation en cours', 'La Volkswagen Golf VIII est en préparation depuis plus de 30 jours.', '/vehicles/' || ?, 0)`
    ).run(userId, userId, v3);
  })();
}
