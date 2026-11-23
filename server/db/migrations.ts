import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        country TEXT NOT NULL DEFAULT 'France',
        language TEXT NOT NULL DEFAULT 'fr',
        theme TEXT NOT NULL DEFAULT 'light',
        currency TEXT NOT NULL DEFAULT 'EUR',
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        ip_address TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS business_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom_commercial TEXT NOT NULL,
        raison_sociale TEXT NOT NULL,
        siren TEXT DEFAULT '',
        siret TEXT DEFAULT '',
        adresse_pro TEXT DEFAULT '',
        telephone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        code_ape TEXT DEFAULT '',
        forme_juridique TEXT DEFAULT 'Entrepreneur individuel (Micro-entreprise)',
        regime_fiscal TEXT DEFAULT 'micro_bic',
        regime_tva TEXT DEFAULT 'franchise_en_base',
        tva_intracom TEXT DEFAULT '',
        iban TEXT DEFAULT '',
        bic TEXT DEFAULT '',
        logo_url TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS user_business_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, business_profile_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        legal_context TEXT NOT NULL CHECK(legal_context IN ('personal', 'professional')),
        status TEXT NOT NULL DEFAULT 'en_preparation' CHECK(status IN ('brouillon', 'en_preparation', 'en_reparation', 'en_vente', 'reserve', 'vendu', 'archive')),
        marque TEXT NOT NULL,
        modele TEXT NOT NULL,
        version TEXT DEFAULT '',
        immatriculation TEXT DEFAULT '',
        vin TEXT DEFAULT '',
        annee INTEGER DEFAULT NULL,
        kilometrage INTEGER DEFAULT NULL,
        energie TEXT DEFAULT '',
        boite_vitesses TEXT DEFAULT '',
        couleur TEXT DEFAULT '',
        portes INTEGER DEFAULT NULL,
        puissance_fiscale INTEGER DEFAULT NULL,
        co2 INTEGER DEFAULT NULL,
        date_achat TEXT NOT NULL,
        prix_achat_cents INTEGER NOT NULL DEFAULT 0,
        prix_vente_prevu_cents INTEGER DEFAULT NULL,
        prix_vente_final_cents INTEGER DEFAULT NULL,
        fournisseur_nom TEXT DEFAULT '',
        fournisseur_tel TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
      CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
      CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
      CREATE INDEX IF NOT EXISTS idx_vehicles_immat ON vehicles(immatriculation);
      CREATE INDEX IF NOT EXISTS idx_vehicles_context ON vehicles(legal_context);

      CREATE TABLE IF NOT EXISTS vehicle_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        original_name TEXT DEFAULT '',
        mime_type TEXT DEFAULT 'image/jpeg',
        size_bytes INTEGER DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON vehicle_photos(vehicle_id);

      CREATE TABLE IF NOT EXISTS vehicle_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        old_status TEXT DEFAULT NULL,
        new_status TEXT NOT NULL,
        reason TEXT DEFAULT '',
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'particulier' CHECK(type IN ('particulier', 'professionnel', 'fournisseur', 'client', 'prospect')),
        is_buyer INTEGER NOT NULL DEFAULT 0,
        is_supplier INTEGER NOT NULL DEFAULT 0,
        first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '',
        company_name TEXT DEFAULT '',
        siren TEXT DEFAULT '',
        siret TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        city TEXT DEFAULT '',
        postal_code TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER NOT NULL,
        contact_id INTEGER DEFAULT NULL,
        legal_context TEXT NOT NULL CHECK(legal_context IN ('personal', 'professional')),
        seller_type TEXT NOT NULL DEFAULT 'particulier' CHECK(seller_type IN ('particulier', 'professionnel', 'societe', 'autre')),
        purchase_date TEXT NOT NULL,
        amount_ht_cents INTEGER NOT NULL DEFAULT 0,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        amount_ttc_cents INTEGER NOT NULL DEFAULT 0,
        vat_regime TEXT NOT NULL DEFAULT 'hors_tva',
        payment_method TEXT NOT NULL DEFAULT 'virement',
        payment_status TEXT NOT NULL DEFAULT 'paye' CHECK(payment_status IN ('a_payer', 'partiellement_paye', 'paye', 'en_retard')),
        document_number TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_purchases_user_date ON purchases(user_id, purchase_date);
      CREATE INDEX IF NOT EXISTS idx_purchases_vehicle ON purchases(vehicle_id);

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER NOT NULL,
        contact_id INTEGER DEFAULT NULL,
        legal_context TEXT NOT NULL CHECK(legal_context IN ('personal', 'professional')),
        seller_type TEXT NOT NULL DEFAULT 'particulier' CHECK(seller_type IN ('particulier', 'professionnel')),
        buyer_type TEXT NOT NULL DEFAULT 'particulier' CHECK(buyer_type IN ('particulier', 'professionnel', 'societe')),
        sale_date TEXT NOT NULL,
        amount_ht_cents INTEGER NOT NULL DEFAULT 0,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        amount_ttc_cents INTEGER NOT NULL DEFAULT 0,
        vat_regime TEXT NOT NULL DEFAULT 'hors_tva',
        payment_method TEXT NOT NULL DEFAULT 'virement',
        payment_status TEXT NOT NULL DEFAULT 'paye' CHECK(payment_status IN ('a_payer', 'partiellement_paye', 'paye', 'en_retard')),
        invoice_number TEXT DEFAULT '',
        extra_services_cents INTEGER NOT NULL DEFAULT 0,
        extra_services_desc TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        idempotency_key TEXT DEFAULT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sales_user_date ON sales(user_id, sale_date);
      CREATE INDEX IF NOT EXISTS idx_sales_vehicle ON sales(vehicle_id);

      CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('vehicle', 'business')),
        code TEXT NOT NULL,
        label_fr TEXT NOT NULL,
        label_ru TEXT NOT NULL,
        label_en TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER DEFAULT NULL,
        category_id INTEGER NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('vehicle', 'business')),
        supplier_contact_id INTEGER DEFAULT NULL,
        supplier_name TEXT DEFAULT '',
        operation_date TEXT NOT NULL,
        payment_date TEXT DEFAULT NULL,
        amount_ht_cents INTEGER NOT NULL DEFAULT 0,
        vat_rate_bps INTEGER NOT NULL DEFAULT 2000,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        amount_ttc_cents INTEGER NOT NULL DEFAULT 0,
        vat_deductible INTEGER NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'carte',
        payment_status TEXT NOT NULL DEFAULT 'paye' CHECK(payment_status IN ('a_payer', 'partiellement_paye', 'paye', 'en_retard')),
        is_recurring INTEGER NOT NULL DEFAULT 0,
        recurrence_interval TEXT DEFAULT NULL,
        document_url TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
        FOREIGN KEY (category_id) REFERENCES expense_categories(id),
        FOREIGN KEY (supplier_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, operation_date);
      CREATE INDEX IF NOT EXISTS idx_expenses_vehicle ON expenses(vehicle_id);

      CREATE TABLE IF NOT EXISTS financial_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER DEFAULT NULL,
        contact_id INTEGER DEFAULT NULL,
        purchase_id INTEGER DEFAULT NULL,
        sale_id INTEGER DEFAULT NULL,
        expense_id INTEGER DEFAULT NULL,
        invoice_id INTEGER DEFAULT NULL,
        legal_context TEXT NOT NULL DEFAULT 'personal',
        direction TEXT NOT NULL CHECK(direction IN ('inflow', 'outflow')),
        category TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'EUR',
        operation_date TEXT NOT NULL,
        payment_date TEXT DEFAULT NULL,
        payment_method TEXT DEFAULT 'virement',
        payment_status TEXT NOT NULL DEFAULT 'paye' CHECK(payment_status IN ('a_payer', 'partiellement_paye', 'paye', 'en_retard')),
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fin_tx_user_date ON financial_transactions(user_id, operation_date);

      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        sale_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER DEFAULT NULL,
        contact_id INTEGER DEFAULT NULL,
        invoice_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon', 'emise', 'partiellement_payee', 'payee', 'en_retard', 'annulee')),
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        vat_regime TEXT NOT NULL DEFAULT 'franchise_en_base',
        vat_legal_mention TEXT NOT NULL DEFAULT 'TVA non applicable, art. 293 B du CGI',
        currency TEXT NOT NULL DEFAULT 'EUR',
        subtotal_ht_cents INTEGER NOT NULL DEFAULT 0,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        total_ttc_cents INTEGER NOT NULL DEFAULT 0,
        paid_cents INTEGER NOT NULL DEFAULT 0,
        payment_terms TEXT DEFAULT 'Paiement à réception',
        facturx_profile TEXT NOT NULL DEFAULT 'BASIC',
        xml_content TEXT DEFAULT '',
        pdf_document_id INTEGER DEFAULT NULL,
        pa_transmission_status TEXT NOT NULL DEFAULT 'not_configured',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, invoice_number),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_user_num ON invoices(user_id, invoice_number);

      CREATE TABLE IF NOT EXISTS invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price_ht_cents INTEGER NOT NULL DEFAULT 0,
        vat_rate_bps INTEGER NOT NULL DEFAULT 0,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        total_ttc_cents INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        transaction_id INTEGER DEFAULT NULL,
        invoice_id INTEGER DEFAULT NULL,
        amount_cents INTEGER NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'virement',
        reference TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        idempotency_key TEXT DEFAULT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (transaction_id) REFERENCES financial_transactions(id) ON DELETE SET NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER DEFAULT NULL,
        purchase_id INTEGER DEFAULT NULL,
        sale_id INTEGER DEFAULT NULL,
        invoice_id INTEGER DEFAULT NULL,
        doc_type TEXT NOT NULL CHECK(doc_type IN ('cerfa_15776', 'facture_vente', 'facture_achat', 'bon_commande', 'recu_paiement', 'rapport_vehicule', 'document_interne', 'facturx_xml')),
        title TEXT NOT NULL,
        doc_number TEXT DEFAULT '',
        language TEXT NOT NULL DEFAULT 'fr',
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/pdf',
        storage_path TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
      CREATE INDEX IF NOT EXISTS idx_documents_vehicle ON documents(vehicle_id);

      CREATE TABLE IF NOT EXISTS document_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT NULL,
        doc_type TEXT NOT NULL,
        name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'fr',
        template_config_json TEXT NOT NULL DEFAULT '{}',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS police_register_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        purchase_id INTEGER DEFAULT NULL,
        sale_id INTEGER DEFAULT NULL,
        entry_number TEXT NOT NULL,
        entry_sequence INTEGER NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        supplier_snapshot_json TEXT NOT NULL,
        buyer_snapshot_json TEXT DEFAULT NULL,
        vehicle_snapshot_json TEXT NOT NULL,
        immatriculation TEXT DEFAULT '',
        vin TEXT DEFAULT '',
        marque_modele TEXT NOT NULL,
        purchase_date TEXT NOT NULL,
        purchase_price_cents INTEGER NOT NULL,
        sale_date TEXT DEFAULT NULL,
        sale_price_cents INTEGER DEFAULT NULL,
        supporting_doc_ref TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disposed', 'corrected')),
        entry_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, entry_sequence),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE RESTRICT,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_police_user_seq ON police_register_entries(user_id, entry_sequence);

      CREATE TABLE IF NOT EXISTS police_register_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        correction_sequence INTEGER NOT NULL,
        corrected_at TEXT NOT NULL DEFAULT (datetime('now')),
        reason TEXT NOT NULL,
        field_changes_json TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (entry_id) REFERENCES police_register_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS marketplace_listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        vehicle_id INTEGER NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL,
        location_city TEXT NOT NULL DEFAULT '',
        location_region TEXT NOT NULL DEFAULT 'Île-de-France',
        seller_type TEXT NOT NULL DEFAULT 'particulier' CHECK(seller_type IN ('particulier', 'professionnel')),
        vehicle_condition TEXT NOT NULL DEFAULT 'tres_bon_etat',
        status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon', 'en_attente', 'publie', 'suspendu', 'vendu', 'expire')),
        contact_phone TEXT DEFAULT '',
        contact_email TEXT DEFAULT '',
        views_count INTEGER NOT NULL DEFAULT 0,
        published_at TEXT DEFAULT NULL,
        expires_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_status ON marketplace_listings(status);
      CREATE INDEX IF NOT EXISTS idx_marketplace_slug ON marketplace_listings(slug);

      CREATE TABLE IF NOT EXISTS marketplace_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT NULL,
        session_anon_id TEXT DEFAULT NULL,
        listing_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS marketplace_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        sender_user_id INTEGER DEFAULT NULL,
        sender_name TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        sender_phone TEXT DEFAULT '',
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'replied', 'spam')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS marketplace_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        reporter_email TEXT DEFAULT '',
        reason TEXT NOT NULL,
        details TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'dismissed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER DEFAULT NULL,
        contact_id INTEGER DEFAULT NULL,
        event_type TEXT NOT NULL DEFAULT 'rdv_client' CHECK(event_type IN ('achat', 'vente', 'rdv_client', 'inspection', 'reparation', 'controle_technique', 'rappel')),
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        start_at TEXT NOT NULL,
        end_at TEXT DEFAULT NULL,
        location TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planifie' CHECK(status IN ('planifie', 'termine', 'annule')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER DEFAULT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        due_date TEXT DEFAULT NULL,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link_url TEXT DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tax_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT NULL,
        rule_code TEXT NOT NULL,
        label TEXT NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'achat_revente_vo',
        regime_fiscal TEXT NOT NULL DEFAULT 'micro_bic',
        regime_tva TEXT NOT NULL DEFAULT 'franchise_en_base',
        social_rate_bps INTEGER NOT NULL DEFAULT 1230,
        income_tax_rate_bps INTEGER NOT NULL DEFAULT 100,
        vat_rate_bps INTEGER NOT NULL DEFAULT 2000,
        effective_from TEXT NOT NULL DEFAULT '2026-01-01',
        effective_to TEXT DEFAULT NULL,
        legal_notice TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tax_calculations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_profile_id INTEGER DEFAULT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        rule_id INTEGER DEFAULT NULL,
        rule_snapshot_json TEXT NOT NULL,
        gross_revenue_cents INTEGER NOT NULL DEFAULT 0,
        taxable_base_cents INTEGER NOT NULL DEFAULT 0,
        estimated_social_cents INTEGER NOT NULL DEFAULT 0,
        estimated_income_tax_cents INTEGER NOT NULL DEFAULT 0,
        vat_collected_cents INTEGER NOT NULL DEFAULT 0,
        vat_deductible_cents INTEGER NOT NULL DEFAULT 0,
        vat_payable_cents INTEGER NOT NULL DEFAULT 0,
        disclaimer_ack INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (rule_id) REFERENCES tax_rules(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT DEFAULT '',
        details_json TEXT DEFAULT '{}',
        ip_address TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);

      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: '002_vehicle_quick_flags',
    sql: `
      ALTER TABLE vehicles ADD COLUMN ct_ok INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vehicles ADD COLUMN paperwork_done INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: '003_sales_channel',
    sql: `
      ALTER TABLE sales ADD COLUMN sales_channel TEXT NOT NULL DEFAULT 'direct';
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row: unknown) => (row as { id: string }).id)
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.id)) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.id);
      })();
    }
  }
}
