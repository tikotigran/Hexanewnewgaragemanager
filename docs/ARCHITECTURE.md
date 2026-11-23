# HexaVO — Architecture & Technical Documentation

## 1. Overview & Unified Account Architecture

HexaVO is a full-stack automotive trading and fleet operations SaaS built specifically for the French market. Rather than splitting users into rigid account types (`Particulier` vs `Professionnel`), HexaVO uses **one unified user account** (`users`) that can hold zero, one, or multiple optional `business_profiles` (added or edited anytime via `/parametres`).

- **Per-Operation Legal Context**: Every vehicle, purchase, sale, financial transaction, and document stores `legal_context` (`'personal' | 'professional'`) plus an optional `business_profile_id`.
- **Non-Retroactive Evolution**: Adding a professional business profile never mutates historical personal vehicles, sales, taxes, or Cerfa preparations.
- **Strict Boundaries**:
  - Personal vehicles are **excluded** from the professional Livre de Police and professional revenue/tax bases.
  - Vehicle expenses (`scope = 'vehicle'`) attach directly to vehicle profitability; business overheads (`scope = 'business'`) remain strictly separate.
  - Monetary amounts are persisted in **integer EUR centimes**, tax/VAT rates in **basis points (`bps`)**, and dates/times aligned to `Europe/Paris`.

---

## 2. Stack & Project Structure

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4 (`@import "tailwindcss";`), React Router v7, TanStack Query, Recharts, Lucide Icons, `vite-plugin-pwa`.
- **Backend**: Node.js, Express (`server.ts`), Zod validation, `helmet`, `express-rate-limit`, `multer`, `pdf-lib`.
- **Database**: SQLite via `better-sqlite3` (WAL mode, `PRAGMA foreign_keys = ON`, indexed relational schema, automated migrations).

```
├── server.ts                          # Unified Express + Vite/Static entrypoint (port 3000)
├── server/
│   ├── db/
│   │   ├── database.ts                # SQLite connection, WAL, data/uploads/backups dirs
│   │   ├── migrations.ts              # 30 normalized tables & indexes
│   │   └── seed.ts                    # System categories, 2026 French tax rules, demo user & dataset
│   ├── middleware/
│   │   └── auth.ts                    # scryptSync password hashing, SHA-256 session tokens, CSRF checks, audit log
│   ├── services/
│   │   ├── automationService.ts       # Idempotent sale confirmation, status history, Livre de Police triggers
│   │   ├── backupService.ts           # User JSON export & SQLite online backup
│   │   ├── facturxService.ts          # UN/CEFACT CII Factur-X XML generation/validation + PA adapter stub
│   │   ├── financeService.ts          # Cash flow inflows/outflows vs revenue aggregation
│   │   ├── pdfService.ts              # Structured PDF, Invoice PDF (with embedded factur-x.xml), Cerfa 15776*02 sheet
│   │   └── taxService.ts              # Configurable French VAT & Tax rules engine + eligibility checker
│   └── routes/
│       ├── auth.ts                    # Auth, profile, password reset, business profiles CRUD
│       ├── vehicles.ts                # Vehicles inventory, photo upload/reorder/primary/delete, history
│       ├── operations.ts              # Purchases, idempotent Sales, Contacts CRM, Expenses
│       ├── documentsAndBilling.ts     # Invoices, Factur-X XML/PDF, Payments, Documents, Cerfa, Livre de Police
│       └── financeMarketplaceCalendar.ts # Dashboard KPIs, Cash Flow, Tax Engine, Marketplace, Calendar/Tasks, Backups
└── src/
    ├── context/                       # AuthContext, I18nContext (FR/RU/EN), ThemeContext, ToastContext
    ├── components/                    # Reusable UI primitives, AppShell, VehicleFormModal
    ├── pages/                         # 16 domain pages (Workspace + Public Marketplace)
    └── types/index.ts                 # Shared TypeScript interfaces
```

---

## 3. Database Schema (30 Tables)

1. `users` — Unified accounts (credentials hash, locale `fr|ru|en`, theme, currency).
2. `user_sessions` — Hashed (`SHA-256`) session tokens stored in `HttpOnly` cookies.
3. `password_reset_tokens` — Expiring hashed reset tokens.
4. `business_profiles` — Optional legal entities (SIRET, SIREN, APE, regime fiscal, regime TVA, IBAN).
5. `user_business_profiles` — Many-to-many link with `role` and `is_default`.
6. `vehicles` — Inventory records with `legal_context`, status workflow, pricing in centimes.
7. `vehicle_photos` — Ordered uploaded/static images with `is_primary`.
8. `vehicle_status_history` — Audit log of vehicle status transitions.
9. `contacts` — Unified CRM (`particulier`, `professionnel`, `fournisseur`, `client`, `prospect`) supporting buyer & supplier roles simultaneously.
10. `purchases` — Vehicle acquisition records.
11. `sales` — Vehicle sale records with `idempotency_key` preventing double confirmation.
12. `expense_categories` — System & user categories separated by `scope` (`vehicle` vs `business`).
13. `expenses` — Direct vehicle costs and general business overhead with VAT deductibility & recurrence flags.
14. `financial_transactions` — Cash Flow ledger (`inflow` / `outflow`).
15. `invoices` — Commercial invoices with VAT regime, legal mentions, Factur-X profile, and XML payload.
16. `invoice_lines` — Line items per invoice.
17. `payments` — Partial/full invoice payments with `idempotency_key`.
18. `documents` — Persisted PDF document registry (Cerfa prep sheets, orders, receipts, invoices, vehicle reports).
19. `police_register_entries` — Append-only chronological Livre de Police entries (`entry_sequence`, `entry_hash` SHA-256).
20. `police_register_corrections` — Append-only motivated rectifications linked to original Livre de Police entries.
21. `tax_rules` — Configurable date-effective French tax/social barèmes (`social_rate_bps`, `income_tax_rate_bps`).
22. `tax_calculations` — Saved declaration preparation snapshots.
23. `marketplace_listings` — Public vehicle listings decoupled from accounting status until sold.
24. `marketplace_favorites` — Authenticated and guest favorites.
25. `marketplace_messages` — Buyer inquiries with honeypot anti-spam protection.
26. `marketplace_reports` — Listing moderation reports.
27. `calendar_events` — Scheduled appointments, inspections, CT, deliveries.
28. `tasks` — Operational tasks linked to vehicles.
29. `notifications` — In-app alerts (e.g., new marketplace inquiry).
30. `audit_logs` & `app_settings` — System audit trail and per-user preferences.

---

## 4. Legal, Compliance & Tax Disclaimers (France)

1. **Cerfa n° 15776*02 (Déclaration de cession d'un véhicule d'occasion)**:
   HexaVO does **not** mimic, alter, or substitute the official government Cerfa 15776*02 PDF. It generates an explicit *"Fiche de préparation récapitulative Cerfa 15776*02"* and provides a direct link to Service-Public.fr (`numCerfaAndExtension=15776%2A02`). Personal vs professional seller identity is strictly derived from the vehicle's `legal_context`.
2. **Livre de Police Électronique**:
   Only professional vehicles enter the Livre de Police. Entries are sequential and hashed with SHA-256; rows cannot be deleted or edited destructively. Corrections append a dated, authored justification record (`police_register_corrections`). Users remain responsible for statutory retention and regulatory conformity of electronic registers under French law.
3. **TVA & Factur-X / Réforme Facturation Électronique 2026**:
   - Four VAT regimes are supported: `franchise_en_base` (art. 293 B CGI), `tva_sur_marge` (art. 297 A CGI), `tva_sur_prix_total` (20%), and configurable regimes. Eligibility checks warn against applying margin VAT to non-eligible vehicles.
   - HexaVO generates UN/CEFACT CII `factur-x.xml` embedded inside PDF invoices (`pdf-lib`) and exposes a `StubPlateformeAgreeeAdapter` ready for accredited PA (Plateforme Agréée) API credentials. Generating Factur-X files locally alone does not fulfill statutory B2B e-invoicing transmission without a registered PA.
4. **Fiscalité (URSSAF / Micro-BIC)**:
   Tax simulations use configurable `tax_rules` (including a 2026 Micro-BIC 12.3% purchase/resale social baseline) on **professional** turnover only. All tax figures are preparatory estimates; validate official filings with an expert-comptable or URSSAF/DGFiP.

---

## 5. Design System

- **Palette**: `#F6F7F9` light canvas / `#0B0F17` dark canvas, `#FFFFFF` / `#111827` surface cards with crisp `1px solid #E7EAF0` borders, `#2563EB` primary Cobalt, `#16A36A` Emerald, `#D97706` Amber, `#DC4545` Red.
- **Typography**: Inter + Plus Jakarta Sans UI typography with JetBrains Mono / tabular numerals (`font-mono-num`) for all prices, VAT, SIRET, VIN, and registration numbers.
- **Zero-Pill Metadata**: Inline metadata uses plain text separated by `·` and concise semantic `StatusLabel` colors instead of noisy pill badges.
