import type Database from 'better-sqlite3';
import crypto from 'crypto';

export function computePoliceEntryHash(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export interface CreatePurchaseParams {
  userId: number;
  businessProfileId: number | null;
  vehicleId: number;
  contactId: number | null;
  legalContext: 'personal' | 'professional';
  sellerType: 'particulier' | 'professionnel' | 'societe' | 'autre';
  purchaseDate: string;
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
  vatRegime: string;
  paymentMethod: string;
  paymentStatus: 'a_payer' | 'partiellement_paye' | 'paye' | 'en_retard';
  documentNumber: string;
  notes: string;
}

/**
 * Transactionally creates a purchase, links a financial outflow, and appends an immutable
 * Livre de Police entry ONLY if legalContext === 'professional'.
 */
export function executePurchaseTransaction(db: Database.Database, params: CreatePurchaseParams) {
  return db.transaction(() => {
    const vehicle = db
      .prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .get(params.vehicleId, params.userId) as Record<string, unknown> | undefined;

    if (!vehicle) {
      throw new Error('VEHICLE_NOT_FOUND');
    }

    if (params.legalContext === 'professional' && !params.businessProfileId) {
      throw new Error('BUSINESS_PROFILE_REQUIRED_FOR_PRO');
    }

    const purchaseRes = db
      .prepare(
        `INSERT INTO purchases (
          user_id, business_profile_id, vehicle_id, contact_id, legal_context,
          seller_type, purchase_date, amount_ht_cents, vat_cents, amount_ttc_cents,
          vat_regime, payment_method, payment_status, document_number, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.userId,
        params.businessProfileId,
        params.vehicleId,
        params.contactId,
        params.legalContext,
        params.sellerType,
        params.purchaseDate,
        params.amountHtCents,
        params.vatCents,
        params.amountTtcCents,
        params.vatRegime,
        params.paymentMethod,
        params.paymentStatus,
        params.documentNumber,
        params.notes
      );

    const purchaseId = Number(purchaseRes.lastInsertRowid);

    // Sync vehicle purchase price & date
    db.prepare(
      `UPDATE vehicles SET date_achat = ?, prix_achat_cents = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(params.purchaseDate, params.amountTtcCents, params.vehicleId, params.userId);

    // Create financial outflow
    db.prepare(
      `INSERT INTO financial_transactions (
        user_id, business_profile_id, vehicle_id, contact_id, purchase_id,
        legal_context, direction, category, amount_cents, currency,
        operation_date, payment_date, payment_method, payment_status, description
      ) VALUES (?, ?, ?, ?, ?, ?, 'outflow', 'achat_vehicule', ?, 'EUR', ?, ?, ?, ?, ?)`
    ).run(
      params.userId,
      params.businessProfileId,
      params.vehicleId,
      params.contactId,
      purchaseId,
      params.legalContext,
      params.amountTtcCents,
      params.purchaseDate,
      params.paymentStatus === 'paye' ? params.purchaseDate : null,
      params.paymentMethod,
      params.paymentStatus,
      `Achat ${vehicle.marque} ${vehicle.modele}`
    );

    // Livre de Police: ONLY for professional operations
    let policeEntryId: number | null = null;
    if (params.legalContext === 'professional' && params.businessProfileId) {
      const existingEntry = db
        .prepare('SELECT id FROM police_register_entries WHERE vehicle_id = ? AND user_id = ?')
        .get(params.vehicleId, params.userId);

      if (!existingEntry) {
        const seqRow = db
          .prepare('SELECT COALESCE(MAX(entry_sequence), 0) AS max_seq FROM police_register_entries WHERE user_id = ?')
          .get(params.userId) as { max_seq: number };
        const nextSeq = seqRow.max_seq + 1;
        const year = params.purchaseDate.slice(0, 4) || new Date().getFullYear().toString();
        const entryNumber = `LP-${year}-${String(nextSeq).padStart(4, '0')}`;

        let supplierSnapshot: Record<string, unknown> = {
          name: (vehicle.fournisseur_nom as string) || 'Fournisseur non renseigné',
          phone: (vehicle.fournisseur_tel as string) || '',
          seller_type: params.sellerType,
        };
        if (params.contactId) {
          const contact = db
            .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?')
            .get(params.contactId, params.userId) as Record<string, unknown> | undefined;
          if (contact) {
            supplierSnapshot = {
              id: contact.id,
              name:
                (contact.company_name as string) ||
                `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
              siret: contact.siret,
              address: `${contact.address || ''} ${contact.postal_code || ''} ${contact.city || ''}`.trim(),
              phone: contact.phone,
              email: contact.email,
              seller_type: params.sellerType,
            };
          }
        }

        const vehicleSnapshot = {
          marque: vehicle.marque,
          modele: vehicle.modele,
          immatriculation: vehicle.immatriculation,
          vin: vehicle.vin,
          annee: vehicle.annee,
          kilometrage: vehicle.kilometrage,
          energie: vehicle.energie,
        };

        const entryHash = computePoliceEntryHash({
          userId: params.userId,
          entryNumber,
          nextSeq,
          vehicleSnapshot,
          supplierSnapshot,
          purchaseDate: params.purchaseDate,
          purchasePriceCents: params.amountTtcCents,
        });

        const policeRes = db
          .prepare(
            `INSERT INTO police_register_entries (
              user_id, business_profile_id, vehicle_id, purchase_id,
              entry_number, entry_sequence, supplier_snapshot_json, vehicle_snapshot_json,
              immatriculation, vin, marque_modele, purchase_date, purchase_price_cents,
              supporting_doc_ref, status, entry_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
          )
          .run(
            params.userId,
            params.businessProfileId,
            params.vehicleId,
            purchaseId,
            entryNumber,
            nextSeq,
            JSON.stringify(supplierSnapshot),
            JSON.stringify(vehicleSnapshot),
            (vehicle.immatriculation as string) || '',
            (vehicle.vin as string) || '',
            `${vehicle.marque} ${vehicle.modele}`,
            params.purchaseDate,
            params.amountTtcCents,
            params.documentNumber || `ACHAT-${purchaseId}`,
            entryHash
          );
        policeEntryId = Number(policeRes.lastInsertRowid);
      }
    }

    return { purchaseId, policeEntryId };
  })();
}

export interface CreateSaleParams {
  userId: number;
  businessProfileId: number | null;
  vehicleId: number;
  contactId: number | null;
  legalContext: 'personal' | 'professional';
  sellerType: 'particulier' | 'professionnel';
  buyerType: 'particulier' | 'professionnel' | 'societe';
  saleDate: string;
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
  vatRegime: string;
  paymentMethod: string;
  paymentStatus: 'a_payer' | 'partiellement_paye' | 'paye' | 'en_retard';
  invoiceNumber: string;
  extraServicesCents: number;
  extraServicesDesc: string;
  notes: string;
  salesChannel?: string;
  idempotencyKey?: string;
}

/**
 * Transactionally confirms a vehicle sale with idempotency protection against duplicate clicks:
 * 1. Prevents double-sale of an already sold vehicle or duplicate idempotencyKey
 * 2. Sets vehicle status -> 'vendu' + logs status history
 * 3. Creates financial inflow transaction
 * 4. Updates Livre de Police exit fields if professional entry exists
 * 5. Marks active Marketplace listings for this vehicle as 'vendu'
 */
export function executeSaleTransaction(db: Database.Database, params: CreateSaleParams) {
  return db.transaction(() => {
    if (params.idempotencyKey) {
      const dup = db
        .prepare('SELECT id, invoice_number FROM sales WHERE idempotency_key = ? AND user_id = ?')
        .get(params.idempotencyKey, params.userId) as { id: number; invoice_number: string } | undefined;
      if (dup) {
        return { saleId: dup.id, duplicate: true, invoiceNumber: dup.invoice_number };
      }
    }

    const vehicle = db
      .prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .get(params.vehicleId, params.userId) as Record<string, unknown> | undefined;

    if (!vehicle) {
      throw new Error('VEHICLE_NOT_FOUND');
    }

    if (vehicle.status === 'vendu') {
      throw new Error('VEHICLE_ALREADY_SOLD');
    }

    const existingSale = db
      .prepare('SELECT id FROM sales WHERE vehicle_id = ? AND user_id = ? AND deleted_at IS NULL')
      .get(params.vehicleId, params.userId);
    if (existingSale) {
      throw new Error('VEHICLE_ALREADY_SOLD');
    }

    const totalWithServices = params.amountTtcCents + (params.extraServicesCents || 0);
    const invNum =
      params.invoiceNumber ||
      (params.legalContext === 'professional'
        ? `FAC-${params.saleDate.slice(0, 4)}-${String(Date.now()).slice(-5)}`
        : `VNT-${params.saleDate.slice(0, 4)}-${String(Date.now()).slice(-5)}`);

    const saleRes = db
      .prepare(
        `INSERT INTO sales (
          user_id, business_profile_id, vehicle_id, contact_id, legal_context,
          seller_type, buyer_type, sale_date, amount_ht_cents, vat_cents,
          amount_ttc_cents, vat_regime, payment_method, payment_status,
          invoice_number, extra_services_cents, extra_services_desc, notes, sales_channel, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.userId,
        params.businessProfileId,
        params.vehicleId,
        params.contactId,
        params.legalContext,
        params.sellerType,
        params.buyerType,
        params.saleDate,
        params.amountHtCents,
        params.vatCents,
        params.amountTtcCents,
        params.vatRegime,
        params.paymentMethod,
        params.paymentStatus,
        invNum,
        params.extraServicesCents || 0,
        params.extraServicesDesc || '',
        params.notes || '',
        params.salesChannel || 'direct',
        params.idempotencyKey || null
      );

    const saleId = Number(saleRes.lastInsertRowid);

    // 1. Update vehicle status to vendu + status history
    const oldStatus = vehicle.status as string;
    db.prepare(
      `UPDATE vehicles SET status = 'vendu', prix_vente_final_cents = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(totalWithServices, params.vehicleId);

    db.prepare(
      `INSERT INTO vehicle_status_history (vehicle_id, user_id, old_status, new_status, reason)
       VALUES (?, ?, ?, 'vendu', ?)`
    ).run(params.vehicleId, params.userId, oldStatus, `Vente enregistrée (${invNum})`);

    // 2. Create financial inflow
    db.prepare(
      `INSERT INTO financial_transactions (
        user_id, business_profile_id, vehicle_id, contact_id, sale_id,
        legal_context, direction, category, amount_cents, currency,
        operation_date, payment_date, payment_method, payment_status, description
      ) VALUES (?, ?, ?, ?, ?, ?, 'inflow', 'vente_vehicule', ?, 'EUR', ?, ?, ?, ?, ?)`
    ).run(
      params.userId,
      params.businessProfileId,
      params.vehicleId,
      params.contactId,
      saleId,
      params.legalContext,
      totalWithServices,
      params.saleDate,
      params.paymentStatus === 'paye' ? params.saleDate : null,
      params.paymentMethod,
      params.paymentStatus,
      `Vente ${vehicle.marque} ${vehicle.modele} (${invNum})`
    );

    // 3. Update Livre de Police exit if professional & entry exists
    if (params.legalContext === 'professional') {
      const policeEntry = db
        .prepare('SELECT id FROM police_register_entries WHERE vehicle_id = ? AND user_id = ?')
        .get(params.vehicleId, params.userId) as { id: number } | undefined;

      let buyerSnapshot: Record<string, unknown> = {
        name: 'Acquéreur',
        buyer_type: params.buyerType,
      };
      if (params.contactId) {
        const contact = db
          .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?')
          .get(params.contactId, params.userId) as Record<string, unknown> | undefined;
        if (contact) {
          buyerSnapshot = {
            id: contact.id,
            name:
              (contact.company_name as string) ||
              `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
            siret: contact.siret,
            address: `${contact.address || ''} ${contact.postal_code || ''} ${contact.city || ''}`.trim(),
            email: contact.email,
            phone: contact.phone,
            buyer_type: params.buyerType,
          };
        }
      }

      if (policeEntry) {
        db.prepare(
          `UPDATE police_register_entries
           SET sale_id = ?, buyer_snapshot_json = ?, sale_date = ?, sale_price_cents = ?, status = 'disposed'
           WHERE id = ? AND status = 'active'`
        ).run(saleId, JSON.stringify(buyerSnapshot), params.saleDate, totalWithServices, policeEntry.id);
      } else if (params.businessProfileId) {
        // Create entry at sale if vehicle was added directly as pro without separate purchase form
        const seqRow = db
          .prepare('SELECT COALESCE(MAX(entry_sequence), 0) AS max_seq FROM police_register_entries WHERE user_id = ?')
          .get(params.userId) as { max_seq: number };
        const nextSeq = seqRow.max_seq + 1;
        const year = (vehicle.date_achat as string).slice(0, 4) || new Date().getFullYear().toString();
        const entryNumber = `LP-${year}-${String(nextSeq).padStart(4, '0')}`;
        const supplierSnapshot = {
          name: (vehicle.fournisseur_nom as string) || 'Fournisseur initial',
          phone: (vehicle.fournisseur_tel as string) || '',
        };
        const vehicleSnapshot = {
          marque: vehicle.marque,
          modele: vehicle.modele,
          immatriculation: vehicle.immatriculation,
          vin: vehicle.vin,
        };
        const entryHash = computePoliceEntryHash({
          userId: params.userId,
          entryNumber,
          nextSeq,
          vehicleSnapshot,
          buyerSnapshot,
        });

        db.prepare(
          `INSERT INTO police_register_entries (
            user_id, business_profile_id, vehicle_id, sale_id,
            entry_number, entry_sequence, supplier_snapshot_json, buyer_snapshot_json,
            vehicle_snapshot_json, immatriculation, vin, marque_modele,
            purchase_date, purchase_price_cents, sale_date, sale_price_cents,
            supporting_doc_ref, status, entry_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disposed', ?)`
        ).run(
          params.userId,
          params.businessProfileId,
          params.vehicleId,
          saleId,
          entryNumber,
          nextSeq,
          JSON.stringify(supplierSnapshot),
          JSON.stringify(buyerSnapshot),
          JSON.stringify(vehicleSnapshot),
          (vehicle.immatriculation as string) || '',
          (vehicle.vin as string) || '',
          `${vehicle.marque} ${vehicle.modele}`,
          vehicle.date_achat as string,
          vehicle.prix_achat_cents as number,
          params.saleDate,
          totalWithServices,
          invNum,
          entryHash
        );
      }
    }

    // 4. Mark any marketplace listing for this vehicle as 'vendu'
    db.prepare(
      `UPDATE marketplace_listings
       SET status = 'vendu', updated_at = datetime('now')
       WHERE vehicle_id = ? AND user_id = ? AND status IN ('publie', 'en_attente', 'suspendu')`
    ).run(params.vehicleId, params.userId);

    // 5. Notification
    db.prepare(
      `INSERT INTO notifications (user_id, type, title, message, link_url)
       VALUES (?, 'sale', ?, ?, ?)`
    ).run(
      params.userId,
      'Vente confirmée',
      `${vehicle.marque} ${vehicle.modele} vendu (${invNum}).`,
      `/vehicles/${params.vehicleId}`
    );

    return { saleId, duplicate: false, invoiceNumber: invNum };
  })();
}
