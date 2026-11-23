import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database';
import { type AuthedRequest, logAudit, optionalAuth, requireAuth } from '../middleware/auth';
import { aggregateCashFlow } from '../services/financeService';
import {
  calculateTaxEstimate,
  selectApplicableTaxRule,
  type FiscalRegime,
  type TaxRuleConfig,
  type VatRegime,
} from '../services/taxService';
import {
  computeAnalyticsOverview,
  type AnalyticsContextFilter,
  type AnalyticsExpenseRow,
  type AnalyticsSaleRow,
  type AnalyticsTransactionRow,
  type AnalyticsVehicleRow,
} from '../services/analyticsService';
import { createSqliteBackup, exportUserDataJson, listSqliteBackups } from '../services/backupService';
import {
  formatExpensesCsv,
  formatFullAddress,
  formatSalesCsv,
  isValidHexColor,
  isValidImageDataUrlOrEmpty,
  type ExpenseCsvRow,
  type SalesCsvRow,
} from '../services/brandingPdfHelpers';

const router = Router();

// ==================== DASHBOARD ====================
router.get('/dashboard', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const contextFilter = String(req.query.legal_context || '').trim();

  const vehicles = db
    .prepare('SELECT id, status, legal_context, marque, modele, immatriculation, date_achat, prix_achat_cents, prix_vente_prevu_cents, updated_at FROM vehicles WHERE user_id = ? AND deleted_at IS NULL')
    .all(userId) as Array<Record<string, unknown>>;

  const filteredVehicles =
    contextFilter === 'personal' || contextFilter === 'professional'
      ? vehicles.filter((v) => v.legal_context === contextFilter)
      : vehicles;

  const countByStatus = (st: string) => filteredVehicles.filter((v) => v.status === st).length;
  const inStockCount = filteredVehicles.filter((v) => !['vendu', 'archive'].includes(String(v.status))).length;

  // Date filter clause helper
  const dateWhere = (col: string) => {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (from) {
      clauses.push(`${col} >= ?`);
      args.push(from);
    }
    if (to) {
      clauses.push(`${col} <= ?`);
      args.push(to);
    }
    return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args };
  };

  const pDate = dateWhere('purchase_date');
  const sDate = dateWhere('sale_date');
  const eDate = dateWhere('operation_date');
  const tDate = dateWhere('operation_date');
  const ctxSql = contextFilter === 'personal' || contextFilter === 'professional' ? ' AND legal_context = ?' : '';
  const ctxArg = ctxSql ? [contextFilter] : [];

  const totalPurchasesCents = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_ttc_cents), 0) as s FROM purchases WHERE user_id = ? AND deleted_at IS NULL${pDate.sql}${ctxSql}`
      )
      .get(userId, ...pDate.args, ...ctxArg) as { s: number }
  ).s;

  const salesRows = db
    .prepare(
      `SELECT s.*, v.prix_achat_cents,
        (SELECT COALESCE(SUM(e.amount_ttc_cents), 0) FROM expenses e WHERE e.vehicle_id = s.vehicle_id AND e.deleted_at IS NULL) AS direct_exp_cents
       FROM sales s
       JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.user_id = ? AND s.deleted_at IS NULL${sDate.sql}${ctxSql ? ' AND s.legal_context = ?' : ''}`
    )
    .all(userId, ...sDate.args, ...ctxArg) as Array<Record<string, unknown>>;

  const totalSalesCents = salesRows.reduce(
    (sum, s) => sum + Number(s.amount_ttc_cents || 0) + Number(s.extra_services_cents || 0),
    0
  );
  const proRevenueCents = salesRows
    .filter((s) => s.legal_context === 'professional')
    .reduce((sum, s) => sum + Number(s.amount_ttc_cents || 0) + Number(s.extra_services_cents || 0), 0);

  const estimatedGrossMarginCents = salesRows.reduce((sum, s) => {
    const rev = Number(s.amount_ttc_cents || 0) + Number(s.extra_services_cents || 0);
    return sum + (rev - Number(s.prix_achat_cents || 0) - Number(s.direct_exp_cents || 0));
  }, 0);

  const totalExpensesCents = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_ttc_cents), 0) as s FROM expenses WHERE user_id = ? AND deleted_at IS NULL${eDate.sql}`
      )
      .get(userId, ...eDate.args) as { s: number }
  ).s;

  const txRows = db
    .prepare(
      `SELECT direction, amount_cents, operation_date, payment_date, payment_status, category
       FROM financial_transactions
       WHERE user_id = ?${tDate.sql}${ctxSql}`
    )
    .all(userId, ...tDate.args, ...ctxArg) as Array<{
    direction: 'inflow' | 'outflow';
    amount_cents: number;
    operation_date: string;
    payment_date: string | null;
    payment_status: string;
    category: string;
  }>;

  const cashFlow = aggregateCashFlow(txRows);

  // Tax estimation using default business profile & configurable rules
  const defaultBp = db
    .prepare(
      `SELECT bp.* FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
       ORDER BY ubp.is_default DESC LIMIT 1`
    )
    .get(userId) as { regime_fiscal?: FiscalRegime; regime_tva?: VatRegime } | undefined;

  const rules = db
    .prepare('SELECT * FROM tax_rules WHERE user_id = ? OR user_id IS NULL ORDER BY effective_from DESC')
    .all(userId) as TaxRuleConfig[];

  const applicableRule = selectApplicableTaxRule(
    rules,
    new Date().toISOString().slice(0, 10),
    defaultBp?.regime_fiscal || 'micro_bic'
  ) || {
    rule_code: 'MICRO_BIC_VENTES_2026',
    label: 'Micro-entrepreneur Base 2026',
    activity_type: 'achat_revente_vo',
    regime_fiscal: 'micro_bic' as FiscalRegime,
    regime_tva: 'franchise_en_base' as VatRegime,
    social_rate_bps: 1230,
    income_tax_rate_bps: 100,
    vat_rate_bps: 2000,
    effective_from: '2026-01-01',
    effective_to: null,
    legal_notice: 'TVA non applicable, art. 293 B du CGI',
  };

  const vatCollectedCents = salesRows
    .filter((s) => s.legal_context === 'professional')
    .reduce((sum, s) => sum + Number(s.vat_cents || 0), 0);
  const vatDeductibleCents = (
    db
      .prepare(
        `SELECT COALESCE(SUM(vat_cents), 0) as s FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND vat_deductible = 1${eDate.sql}`
      )
      .get(userId, ...eDate.args) as { s: number }
  ).s;

  const taxEstimate = defaultBp
    ? calculateTaxEstimate({
        grossProfessionalRevenueCents: proRevenueCents,
        vatCollectedCents,
        vatDeductibleCents,
        regimeFiscal: defaultBp.regime_fiscal || 'micro_bic',
        regimeTva: defaultBp.regime_tva || 'franchise_en_base',
        rule: applicableRule,
        useVersementLiberatoire: false,
      })
    : {
        grossRevenueCents: 0,
        taxableBaseCents: 0,
        estimatedSocialCents: 0,
        estimatedIncomeTaxCents: 0,
        vatCollectedCents: 0,
        vatDeductibleCents: 0,
        vatPayableCents: 0,
        isEstimate: true as const,
        disclaimer: 'Aucun profil professionnel configuré.',
      };

  // Monthly charts
  const monthBuckets = new Map<
    string,
    { month: string; salesCents: number; purchasesCents: number; expensesCents: number; inflowsCents: number; outflowsCents: number }
  >();
  const touchMonth = (m: string) => {
    if (!m) return null;
    if (!monthBuckets.has(m)) {
      monthBuckets.set(m, {
        month: m,
        salesCents: 0,
        purchasesCents: 0,
        expensesCents: 0,
        inflowsCents: 0,
        outflowsCents: 0,
      });
    }
    return monthBuckets.get(m)!;
  };

  for (const s of salesRows) {
    const b = touchMonth(String(s.sale_date).slice(0, 7));
    if (b) b.salesCents += Number(s.amount_ttc_cents || 0);
  }
  const purchaseRows = db
    .prepare(`SELECT purchase_date, amount_ttc_cents FROM purchases WHERE user_id = ? AND deleted_at IS NULL${pDate.sql}${ctxSql}`)
    .all(userId, ...pDate.args, ...ctxArg) as Array<{ purchase_date: string; amount_ttc_cents: number }>;
  for (const p of purchaseRows) {
    const b = touchMonth(p.purchase_date.slice(0, 7));
    if (b) b.purchasesCents += p.amount_ttc_cents;
  }
  const expenseRows = db
    .prepare(`SELECT operation_date, amount_ttc_cents FROM expenses WHERE user_id = ? AND deleted_at IS NULL${eDate.sql}`)
    .all(userId, ...eDate.args) as Array<{ operation_date: string; amount_ttc_cents: number }>;
  for (const e of expenseRows) {
    const b = touchMonth(e.operation_date.slice(0, 7));
    if (b) b.expensesCents += e.amount_ttc_cents;
  }
  for (const cs of cashFlow.monthlySeries) {
    const b = touchMonth(cs.month);
    if (b) {
      b.inflowsCents = cs.inflowsCents;
      b.outflowsCents = cs.outflowsCents;
    }
  }

  const monthlyCharts = Array.from(monthBuckets.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Vehicle profitability chart
  const vehicleProfitability = filteredVehicles.slice(0, 8).map((v) => {
    const exp = (
      db
        .prepare('SELECT COALESCE(SUM(amount_ttc_cents), 0) as s FROM expenses WHERE vehicle_id = ? AND deleted_at IS NULL')
        .get(v.id) as { s: number }
    ).s;
    const sale = db
      .prepare('SELECT amount_ttc_cents FROM sales WHERE vehicle_id = ? AND deleted_at IS NULL LIMIT 1')
      .get(v.id) as { amount_ttc_cents: number } | undefined;
    const refPrice = sale?.amount_ttc_cents ?? Number(v.prix_vente_prevu_cents || 0);
    const margin = refPrice > 0 ? refPrice - Number(v.prix_achat_cents || 0) - exp : 0;
    return {
      id: v.id,
      name: `${v.marque} ${v.modele}`,
      marginEur: Math.round(margin / 100),
      realized: Boolean(sale),
    };
  });

  const recentTransactions = db
    .prepare(
      `SELECT ft.*, v.marque, v.modele
       FROM financial_transactions ft
       LEFT JOIN vehicles v ON v.id = ft.vehicle_id
       WHERE ft.user_id = ?
       ORDER BY ft.operation_date DESC, ft.id DESC
       LIMIT 8`
    )
    .all(userId);

  const upcomingEvents = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE user_id = ? AND status = 'planifie'
       ORDER BY start_at ASC
       LIMIT 5`
    )
    .all(userId);

  const attentionVehicles = filteredVehicles.filter((v) =>
    ['en_preparation', 'en_reparation', 'brouillon'].includes(String(v.status))
  );

  res.json({
    kpis: {
      vehiclesInStock: inStockCount,
      vehiclesInPreparation: countByStatus('en_preparation') + countByStatus('en_reparation'),
      vehiclesForSale: countByStatus('en_vente') + countByStatus('reserve'),
      vehiclesSold: countByStatus('vendu'),
      totalPurchasesCents,
      totalSalesCents,
      proRevenueCents,
      totalExpensesCents,
      estimatedGrossMarginCents,
      cashFlowNetCents: cashFlow.netCashFlowCents,
      estimatedSocialCents: taxEstimate.estimatedSocialCents,
      estimatedVatPayableCents: taxEstimate.vatPayableCents,
    },
    monthlyCharts,
    vehicleProfitability,
    recentTransactions,
    upcomingEvents,
    attentionVehicles,
  });
});

// ==================== FINANCE & TAX ENGINE ====================
router.get('/finance/overview', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const direction = String(req.query.direction || '').trim();
  const category = String(req.query.category || '').trim();

  const where = ['ft.user_id = ?'];
  const params: unknown[] = [userId];
  if (from) {
    where.push('ft.operation_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('ft.operation_date <= ?');
    params.push(to);
  }
  if (direction === 'inflow' || direction === 'outflow') {
    where.push('ft.direction = ?');
    params.push(direction);
  }
  if (category && category !== 'all') {
    where.push('ft.category = ?');
    params.push(category);
  }

  const transactions = db
    .prepare(
      `SELECT ft.*, v.marque, v.modele, v.immatriculation,
        c.first_name, c.last_name, c.company_name
       FROM financial_transactions ft
       LEFT JOIN vehicles v ON v.id = ft.vehicle_id
       LEFT JOIN contacts c ON c.id = ft.contact_id
       WHERE ${where.join(' AND ')}
       ORDER BY ft.operation_date DESC, ft.id DESC`
    )
    .all(...params) as Array<{
    direction: 'inflow' | 'outflow';
    amount_cents: number;
    operation_date: string;
    payment_date: string | null;
    payment_status: string;
    category: string;
  }>;

  const cashFlow = aggregateCashFlow(transactions);
  const rules = db
    .prepare('SELECT * FROM tax_rules WHERE user_id = ? OR user_id IS NULL ORDER BY effective_from DESC, id DESC')
    .all(userId);
  const savedCalculations = db
    .prepare('SELECT * FROM tax_calculations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(userId);

  res.json({ transactions, cashFlow, taxRules: rules, savedCalculations });
});

router.get('/finance/analytics', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const rawCtx = String(req.query.legal_context || 'all').trim();
  const contextFilter: AnalyticsContextFilter =
    rawCtx === 'professional' || rawCtx === 'personal' ? rawCtx : 'all';

  const dateWhere = (col: string) => {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (from) {
      clauses.push(`${col} >= ?`);
      args.push(from);
    }
    if (to) {
      clauses.push(`${col} <= ?`);
      args.push(to);
    }
    return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args };
  };

  const vehicles = db
    .prepare(
      `SELECT id, legal_context, status, marque, modele, immatriculation, date_achat,
        prix_achat_cents, prix_vente_prevu_cents, prix_vente_final_cents
       FROM vehicles
       WHERE user_id = ? AND deleted_at IS NULL`
    )
    .all(userId) as AnalyticsVehicleRow[];

  const allVehicleExpRows = db
    .prepare(
      `SELECT vehicle_id, COALESCE(SUM(amount_ttc_cents), 0) AS total_cents
       FROM expenses
       WHERE user_id = ? AND deleted_at IS NULL AND vehicle_id IS NOT NULL
       GROUP BY vehicle_id`
    )
    .all(userId) as Array<{ vehicle_id: number; total_cents: number }>;

  const allVehicleDirectExpensesMap = new Map<number, number>();
  for (const row of allVehicleExpRows) {
    allVehicleDirectExpensesMap.set(row.vehicle_id, Number(row.total_cents || 0));
  }

  const sDate = dateWhere('s.sale_date');
  const sales = db
    .prepare(
      `SELECT s.id, s.vehicle_id, s.legal_context, s.sale_date,
        s.amount_ttc_cents, s.extra_services_cents, s.vat_cents, s.sales_channel,
        v.marque, v.modele, v.immatriculation, v.date_achat, v.prix_achat_cents,
        (SELECT COALESCE(SUM(e.amount_ttc_cents), 0) FROM expenses e WHERE e.vehicle_id = s.vehicle_id AND e.deleted_at IS NULL) AS direct_expenses_cents
       FROM sales s
       JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.user_id = ? AND s.deleted_at IS NULL${sDate.sql}
       ORDER BY s.sale_date DESC`
    )
    .all(userId, ...sDate.args) as AnalyticsSaleRow[];

  const eDate = dateWhere('e.operation_date');
  const expenses = db
    .prepare(
      `SELECT e.id, e.vehicle_id, e.scope, v.legal_context AS vehicle_legal_context,
        ec.code AS category_code, ec.label_fr, ec.label_ru, ec.label_en,
        e.operation_date, e.amount_ttc_cents, e.vat_cents, e.vat_deductible,
        v.marque, v.modele, v.immatriculation
       FROM expenses e
       JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       WHERE e.user_id = ? AND e.deleted_at IS NULL${eDate.sql}
       ORDER BY e.operation_date DESC`
    )
    .all(userId, ...eDate.args) as AnalyticsExpenseRow[];

  const tDate = dateWhere('ft.operation_date');
  const ctxSql = contextFilter === 'all' ? '' : ' AND ft.legal_context = ?';
  const ctxArg = contextFilter === 'all' ? [] : [contextFilter];
  const transactions = db
    .prepare(
      `SELECT ft.id, ft.vehicle_id, ft.legal_context, ft.direction, ft.category,
        ft.amount_cents, ft.operation_date, ft.payment_date, ft.payment_status, ft.description,
        v.marque, v.modele, v.immatriculation
       FROM financial_transactions ft
       LEFT JOIN vehicles v ON v.id = ft.vehicle_id
       WHERE ft.user_id = ?${tDate.sql}${ctxSql}
       ORDER BY ft.operation_date DESC, ft.id DESC`
    )
    .all(userId, ...tDate.args, ...ctxArg) as AnalyticsTransactionRow[];

  const defaultBp = db
    .prepare(
      `SELECT bp.* FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
       ORDER BY ubp.is_default DESC LIMIT 1`
    )
    .get(userId) as { regime_fiscal?: FiscalRegime; regime_tva?: VatRegime } | undefined;

  const rules = db
    .prepare('SELECT * FROM tax_rules WHERE user_id = ? OR user_id IS NULL ORDER BY effective_from DESC, id DESC')
    .all(userId) as TaxRuleConfig[];

  const todayIso = new Date().toISOString().slice(0, 10);
  const applicableRule = selectApplicableTaxRule(
    rules,
    todayIso,
    defaultBp?.regime_fiscal || 'micro_bic'
  ) || {
    rule_code: 'MICRO_BIC_VENTES_2026',
    label: 'Micro-entrepreneur Base 2026',
    activity_type: 'achat_revente_vo',
    regime_fiscal: 'micro_bic' as FiscalRegime,
    regime_tva: 'franchise_en_base' as VatRegime,
    social_rate_bps: 1230,
    income_tax_rate_bps: 100,
    vat_rate_bps: 2000,
    effective_from: '2026-01-01',
    effective_to: null,
    legal_notice: 'TVA non applicable, art. 293 B du CGI',
  };

  const savedCalculations = db
    .prepare('SELECT * FROM tax_calculations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(userId);

  const analytics = computeAnalyticsOverview({
    nowIso: todayIso,
    contextFilter,
    vehicles,
    sales,
    expenses,
    allVehicleDirectExpensesMap,
    transactions,
    regimeFiscal: defaultBp?.regime_fiscal || 'micro_bic',
    regimeTva: defaultBp?.regime_tva || 'franchise_en_base',
    taxRule: applicableRule,
    hasBusinessProfile: Boolean(defaultBp),
  });

  res.json({
    ...analytics,
    transactions,
    taxRules: rules,
    savedCalculations,
  });
});

router.post('/finance/tax-rules', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    rule_code: z.string().min(2).max(60),
    label: z.string().min(2).max(160),
    activity_type: z.string().min(2).max(80),
    regime_fiscal: z.enum(['particulier', 'micro_bic', 'micro_bnc', 'reel_simplifie', 'reel_normal', 'is']),
    regime_tva: z.enum(['franchise_en_base', 'tva_sur_marge', 'tva_sur_prix_total', 'autre_regime']),
    social_rate_bps: z.number().int().min(0).max(6000),
    income_tax_rate_bps: z.number().int().min(0).max(5000),
    vat_rate_bps: z.number().int().min(0).max(5000),
    effective_from: z.string().min(8),
    effective_to: z.string().nullable().optional(),
    legal_notice: z.string().max(400).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Règle fiscale invalide.' });
    return;
  }

  const d = parsed.data;
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO tax_rules (user_id, rule_code, label, activity_type, regime_fiscal, regime_tva, social_rate_bps, income_tax_rate_bps, vat_rate_bps, effective_from, effective_to, legal_notice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user!.id,
      d.rule_code,
      d.label,
      d.activity_type,
      d.regime_fiscal,
      d.regime_tva,
      d.social_rate_bps,
      d.income_tax_rate_bps,
      d.vat_rate_bps,
      d.effective_from,
      d.effective_to ?? null,
      d.legal_notice
    );

  res.status(201).json({ rule: db.prepare('SELECT * FROM tax_rules WHERE id = ?').get(info.lastInsertRowid) });
});

router.post('/finance/tax-calculate', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    period_start: z.string().min(8),
    period_end: z.string().min(8),
    business_profile_id: z.number().int().positive().nullable().optional(),
    rule_id: z.number().int().positive(),
    use_versement_liberatoire: z.boolean().optional().default(false),
    save_snapshot: z.boolean().optional().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Paramètres de calcul invalides.' });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const userId = req.user!.id;

  const rule = db
    .prepare('SELECT * FROM tax_rules WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .get(d.rule_id, userId) as TaxRuleConfig | undefined;
  if (!rule) {
    res.status(404).json({ error: 'Règle fiscale introuvable.' });
    return;
  }

  // Strictly count ONLY professional sales (never mix personal sales into pro tax declaration!)
  const proSales = db
    .prepare(
      `SELECT amount_ttc_cents, extra_services_cents, vat_cents FROM sales
       WHERE user_id = ? AND deleted_at IS NULL AND legal_context = 'professional'
       AND sale_date >= ? AND sale_date <= ?
       ${d.business_profile_id ? 'AND business_profile_id = ?' : ''}`
    )
    .all(
      ...(d.business_profile_id
        ? [userId, d.period_start, d.period_end, d.business_profile_id]
        : [userId, d.period_start, d.period_end])
    ) as Array<{ amount_ttc_cents: number; extra_services_cents: number; vat_cents: number }>;

  const grossProRev = proSales.reduce((s, x) => s + x.amount_ttc_cents + (x.extra_services_cents || 0), 0);
  const vatCollected = proSales.reduce((s, x) => s + (x.vat_cents || 0), 0);

  const vatDeductible = (
    db
      .prepare(
        `SELECT COALESCE(SUM(vat_cents), 0) as s FROM expenses
         WHERE user_id = ? AND deleted_at IS NULL AND vat_deductible = 1
         AND operation_date >= ? AND operation_date <= ?`
      )
      .get(userId, d.period_start, d.period_end) as { s: number }
  ).s;

  const estimate = calculateTaxEstimate({
    grossProfessionalRevenueCents: grossProRev,
    vatCollectedCents: vatCollected,
    vatDeductibleCents: vatDeductible,
    regimeFiscal: rule.regime_fiscal,
    regimeTva: rule.regime_tva,
    rule,
    useVersementLiberatoire: d.use_versement_liberatoire,
  });

  let savedId: number | null = null;
  if (d.save_snapshot) {
    const info = db
      .prepare(
        `INSERT INTO tax_calculations (
          user_id, business_profile_id, period_start, period_end, rule_id, rule_snapshot_json,
          gross_revenue_cents, taxable_base_cents, estimated_social_cents, estimated_income_tax_cents,
          vat_collected_cents, vat_deductible_cents, vat_payable_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        d.business_profile_id ?? null,
        d.period_start,
        d.period_end,
        rule.id ?? null,
        JSON.stringify(rule),
        estimate.grossRevenueCents,
        estimate.taxableBaseCents,
        estimate.estimatedSocialCents,
        estimate.estimatedIncomeTaxCents,
        estimate.vatCollectedCents,
        estimate.vatDeductibleCents,
        estimate.vatPayableCents
      );
    savedId = Number(info.lastInsertRowid);
  }

  res.json({ estimate, rule, savedId });
});

// ==================== MARKETPLACE (PUBLIC + OWNER) ====================
router.get('/marketplace/listings', optionalAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const search = String(req.query.search || '').trim();
  const marque = String(req.query.marque || '').trim();
  const energie = String(req.query.energie || '').trim();
  const boite = String(req.query.boite_vitesses || '').trim();
  const region = String(req.query.location_region || '').trim();
  const sellerType = String(req.query.seller_type || '').trim();
  const maxPrice = req.query.max_price_cents ? Number(req.query.max_price_cents) : null;
  const minYear = req.query.min_year ? Number(req.query.min_year) : null;
  const maxKm = req.query.max_km ? Number(req.query.max_km) : null;
  const sort = String(req.query.sort || 'recent').trim();
  const mine = req.query.mine === '1';

  const where = ['ml.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (mine && req.user) {
    where.push('ml.user_id = ?');
    params.push(req.user.id);
  } else {
    where.push("ml.status = 'publie'");
  }

  if (search) {
    where.push('(ml.title LIKE ? OR v.marque LIKE ? OR v.modele LIKE ? OR ml.location_city LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (marque) {
    where.push('v.marque = ?');
    params.push(marque);
  }
  if (energie) {
    where.push('v.energie = ?');
    params.push(energie);
  }
  if (boite) {
    where.push('v.boite_vitesses = ?');
    params.push(boite);
  }
  if (region) {
    where.push('ml.location_region = ?');
    params.push(region);
  }
  if (sellerType === 'particulier' || sellerType === 'professionnel') {
    where.push('ml.seller_type = ?');
    params.push(sellerType);
  }
  if (maxPrice) {
    where.push('ml.price_cents <= ?');
    params.push(maxPrice);
  }
  if (minYear) {
    where.push('v.annee >= ?');
    params.push(minYear);
  }
  if (maxKm) {
    where.push('v.kilometrage <= ?');
    params.push(maxKm);
  }

  const orderSql =
    sort === 'price_asc'
      ? 'ml.price_cents ASC'
      : sort === 'price_desc'
      ? 'ml.price_cents DESC'
      : sort === 'km_asc'
      ? 'v.kilometrage ASC'
      : 'ml.published_at DESC, ml.id DESC';

  const listings = db
    .prepare(
      `SELECT ml.*, v.marque, v.modele, v.version, v.annee, v.kilometrage, v.energie, v.boite_vitesses, v.couleur,
        bp.nom_commercial AS business_profile_name,
        u.first_name AS owner_first_name, u.last_name AS owner_last_name,
        (SELECT url FROM vehicle_photos vp WHERE vp.vehicle_id = v.id ORDER BY vp.is_primary DESC, vp.sort_order ASC LIMIT 1) AS primary_photo_url
       FROM marketplace_listings ml
       JOIN vehicles v ON v.id = ml.vehicle_id
       JOIN users u ON u.id = ml.user_id
       LEFT JOIN business_profiles bp ON bp.id = ml.business_profile_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderSql}`
    )
    .all(...params);

  res.json({ listings });
});

router.get('/marketplace/listings/:slug', optionalAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const listing = db
    .prepare(
      `SELECT ml.*, v.marque, v.modele, v.version, v.annee, v.kilometrage, v.energie, v.boite_vitesses, v.couleur, v.portes, v.puissance_fiscale, v.co2,
        bp.nom_commercial AS business_profile_name, bp.siret AS business_siret, bp.adresse_pro AS business_address,
        u.id AS seller_user_id, u.first_name AS owner_first_name, u.last_name AS owner_last_name
       FROM marketplace_listings ml
       JOIN vehicles v ON v.id = ml.vehicle_id
       JOIN users u ON u.id = ml.user_id
       LEFT JOIN business_profiles bp ON bp.id = ml.business_profile_id
       WHERE ml.slug = ? AND ml.deleted_at IS NULL`
    )
    .get(req.params.slug) as Record<string, unknown> | undefined;

  if (!listing) {
    res.status(404).json({ error: 'Annonce introuvable.' });
    return;
  }

  db.prepare('UPDATE marketplace_listings SET views_count = views_count + 1 WHERE id = ?').run(listing.id);
  const photos = db
    .prepare('SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY is_primary DESC, sort_order ASC')
    .all(listing.vehicle_id);

  res.json({ listing, photos });
});

router.get('/marketplace/sellers/:userId', (req, res) => {
  const sellerId = Number(req.params.userId);
  const db = getDb();
  const seller = db
    .prepare('SELECT id, first_name, last_name, country, created_at FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(sellerId);
  if (!seller) {
    res.status(404).json({ error: 'Vendeur introuvable.' });
    return;
  }
  const businessProfiles = db
    .prepare(
      `SELECT bp.id, bp.nom_commercial, bp.siret, bp.adresse_pro, bp.telephone, bp.email
       FROM business_profiles bp
       JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
       WHERE ubp.user_id = ? AND bp.deleted_at IS NULL`
    )
    .all(sellerId);
  const listings = db
    .prepare(
      `SELECT ml.*, v.marque, v.modele, v.annee, v.kilometrage, v.energie, v.boite_vitesses,
        (SELECT url FROM vehicle_photos vp WHERE vp.vehicle_id = v.id ORDER BY vp.is_primary DESC, vp.sort_order ASC LIMIT 1) AS primary_photo_url
       FROM marketplace_listings ml
       JOIN vehicles v ON v.id = ml.vehicle_id
       WHERE ml.user_id = ? AND ml.status = 'publie' AND ml.deleted_at IS NULL`
    )
    .all(sellerId);

  res.json({ seller, businessProfiles, listings });
});

router.post('/marketplace/listings', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    vehicle_id: z.number().int().positive(),
    title: z.string().min(4).max(180),
    description: z.string().max(4000).default(''),
    price_cents: z.number().int().positive(),
    location_city: z.string().min(1).max(100),
    location_region: z.string().min(1).max(100).default('Île-de-France'),
    vehicle_condition: z.string().max(60).default('tres_bon_etat'),
    status: z.enum(['brouillon', 'en_attente', 'publie', 'suspendu']).default('publie'),
    contact_phone: z.string().max(40).default(''),
    contact_email: z.string().max(180).default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données annonce invalides', details: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const db = getDb();
  const userId = req.user!.id;

  const vehicle = db
    .prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(d.vehicle_id, userId) as Record<string, unknown> | undefined;

  if (!vehicle) {
    res.status(404).json({ error: 'Véhicule introuvable.' });
    return;
  }

  const sellerType = vehicle.legal_context === 'professional' ? 'professionnel' : 'particulier';
  const baseSlug = `${vehicle.marque}-${vehicle.modele}-${d.location_city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = `${baseSlug}-${Date.now().toString().slice(-5)}`;

  const existing = db
    .prepare('SELECT id FROM marketplace_listings WHERE vehicle_id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(d.vehicle_id, userId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE marketplace_listings SET
        title = ?, description = ?, price_cents = ?, location_city = ?, location_region = ?,
        seller_type = ?, vehicle_condition = ?, status = ?, contact_phone = ?, contact_email = ?,
        published_at = CASE WHEN ? = 'publie' AND published_at IS NULL THEN datetime('now') ELSE published_at END,
        updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(
      d.title,
      d.description,
      d.price_cents,
      d.location_city,
      d.location_region,
      sellerType,
      d.vehicle_condition,
      d.status,
      d.contact_phone,
      d.contact_email,
      d.status,
      existing.id,
      userId
    );
    const updated = db.prepare('SELECT * FROM marketplace_listings WHERE id = ?').get(existing.id);
    res.json({ listing: updated });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO marketplace_listings (
        user_id, business_profile_id, vehicle_id, slug, title, description, price_cents,
        location_city, location_region, seller_type, vehicle_condition, status,
        contact_phone, contact_email, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      vehicle.business_profile_id ?? null,
      d.vehicle_id,
      slug,
      d.title,
      d.description,
      d.price_cents,
      d.location_city,
      d.location_region,
      sellerType,
      d.vehicle_condition,
      d.status,
      d.contact_phone,
      d.contact_email,
      d.status === 'publie' ? new Date().toISOString() : null
    );

  const created = db.prepare('SELECT * FROM marketplace_listings WHERE id = ?').get(info.lastInsertRowid);
  logAudit(userId, 'LISTING_CREATE', 'marketplace_listing', Number(info.lastInsertRowid), { slug }, req.ip || '');
  res.status(201).json({ listing: created });
});

router.patch('/marketplace/listings/:id/status', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['brouillon', 'en_attente', 'publie', 'suspendu', 'vendu', 'expire'].includes(status)) {
    res.status(400).json({ error: 'Statut invalide.' });
    return;
  }
  const db = getDb();
  const r = db
    .prepare("UPDATE marketplace_listings SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(status, id, req.user!.id);
  if (r.changes === 0) {
    res.status(404).json({ error: 'Annonce introuvable.' });
    return;
  }
  res.json({ listing: db.prepare('SELECT * FROM marketplace_listings WHERE id = ?').get(id) });
});

router.get('/marketplace/favorites', optionalAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const anonId = String(req.query.anon_id || '').trim();
  if (!req.user && !anonId) {
    res.json({ favoriteListingIds: [] });
    return;
  }
  const rows = req.user
    ? db.prepare('SELECT listing_id FROM marketplace_favorites WHERE user_id = ?').all(req.user.id)
    : db.prepare('SELECT listing_id FROM marketplace_favorites WHERE session_anon_id = ?').all(anonId);
  res.json({ favoriteListingIds: (rows as Array<{ listing_id: number }>).map((r) => r.listing_id) });
});

router.post('/marketplace/favorites/toggle', optionalAuth, (req: AuthedRequest, res) => {
  const listingId = Number(req.body?.listing_id);
  const anonId = String(req.body?.anon_id || 'guest').slice(0, 80);
  if (!listingId) {
    res.status(400).json({ error: 'listing_id requis.' });
    return;
  }
  const db = getDb();
  const existing = req.user
    ? db.prepare('SELECT id FROM marketplace_favorites WHERE user_id = ? AND listing_id = ?').get(req.user.id, listingId)
    : db.prepare('SELECT id FROM marketplace_favorites WHERE session_anon_id = ? AND listing_id = ?').get(anonId, listingId);

  if (existing) {
    db.prepare('DELETE FROM marketplace_favorites WHERE id = ?').run((existing as { id: number }).id);
    res.json({ favorited: false });
  } else {
    db.prepare('INSERT INTO marketplace_favorites (user_id, session_anon_id, listing_id) VALUES (?, ?, ?)').run(
      req.user?.id ?? null,
      req.user ? null : anonId,
      listingId
    );
    res.json({ favorited: true });
  }
});

router.post('/marketplace/listings/:id/contact', optionalAuth, (req: AuthedRequest, res) => {
  const listingId = Number(req.params.id);
  const schema = z.object({
    sender_name: z.string().min(2).max(120),
    sender_email: z.string().email().max(180),
    sender_phone: z.string().max(40).optional().default(''),
    message: z.string().min(10).max(2000),
    honeypot: z.string().optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Veuillez compléter tous les champs du message (min 10 caractères).' });
    return;
  }
  // Simple anti-spam honeypot check
  if (parsed.data.honeypot) {
    res.status(200).json({ ok: true });
    return;
  }

  const db = getDb();
  const listing = db
    .prepare('SELECT id, user_id, title FROM marketplace_listings WHERE id = ?')
    .get(listingId) as { id: number; user_id: number; title: string } | undefined;
  if (!listing) {
    res.status(404).json({ error: 'Annonce introuvable.' });
    return;
  }

  db.prepare(
    `INSERT INTO marketplace_messages (listing_id, sender_user_id, sender_name, sender_email, sender_phone, message)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    listingId,
    req.user?.id ?? null,
    parsed.data.sender_name,
    parsed.data.sender_email,
    parsed.data.sender_phone,
    parsed.data.message
  );

  db.prepare(
    `INSERT INTO notifications (user_id, type, title, message, link_url)
     VALUES (?, 'marketplace', ?, ?, '/marketplace')`
  ).run(
    listing.user_id,
    'Nouveau message Marketplace',
    `${parsed.data.sender_name} vous a contacté pour "${listing.title}".`
  );

  res.status(201).json({ ok: true });
});

router.post('/marketplace/listings/:id/report', (req, res) => {
  const listingId = Number(req.params.id);
  const schema = z.object({
    reason: z.string().min(3).max(120),
    details: z.string().max(1000).optional().default(''),
    reporter_email: z.string().max(180).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Motif de signalement requis.' });
    return;
  }
  const db = getDb();
  db.prepare(
    'INSERT INTO marketplace_reports (listing_id, reporter_email, reason, details) VALUES (?, ?, ?, ?)'
  ).run(listingId, parsed.data.reporter_email, parsed.data.reason, parsed.data.details);
  res.status(201).json({ ok: true });
});

// ==================== CALENDAR, TASKS, NOTIFICATIONS, SEARCH & SETTINGS ====================
router.get('/calendar', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const events = db
    .prepare(
      `SELECT ce.*, v.marque, v.modele, v.immatriculation
       FROM calendar_events ce
       LEFT JOIN vehicles v ON v.id = ce.vehicle_id
       WHERE ce.user_id = ?
       ORDER BY ce.start_at ASC`
    )
    .all(req.user!.id);
  const tasks = db
    .prepare(
      `SELECT t.*, v.marque, v.modele
       FROM tasks t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.user_id = ?
       ORDER BY t.due_date ASC, t.id DESC`
    )
    .all(req.user!.id);
  res.json({ events, tasks });
});

router.post('/calendar/events', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    vehicle_id: z.number().int().positive().nullable().optional(),
    contact_id: z.number().int().positive().nullable().optional(),
    event_type: z.enum(['achat', 'vente', 'rdv_client', 'inspection', 'reparation', 'controle_technique', 'rappel']),
    title: z.string().min(2).max(180),
    description: z.string().max(1000).optional().default(''),
    start_at: z.string().min(10),
    end_at: z.string().nullable().optional(),
    location: z.string().max(180).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données d\'événement invalides.' });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO calendar_events (user_id, vehicle_id, contact_id, event_type, title, description, start_at, end_at, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user!.id,
      d.vehicle_id ?? null,
      d.contact_id ?? null,
      d.event_type,
      d.title,
      d.description,
      d.start_at,
      d.end_at ?? null,
      d.location
    );
  res.status(201).json({ event: db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/calendar/events/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['planifie', 'termine', 'annule'].includes(status)) {
    res.status(400).json({ error: 'Statut invalide.' });
    return;
  }
  const db = getDb();
  db.prepare("UPDATE calendar_events SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
    status,
    id,
    req.user!.id
  );
  res.json({ ok: true });
});

router.post('/tasks', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    vehicle_id: z.number().int().positive().nullable().optional(),
    title: z.string().min(2).max(180),
    description: z.string().max(1000).optional().default(''),
    due_date: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données tâche invalides.' });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const info = db
    .prepare(
      'INSERT INTO tasks (user_id, vehicle_id, title, description, due_date, priority) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.user!.id, d.vehicle_id ?? null, d.title, d.description, d.due_date ?? null, d.priority);
  res.status(201).json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/tasks/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['todo', 'in_progress', 'done'].includes(status)) {
    res.status(400).json({ error: 'Statut invalide.' });
    return;
  }
  const db = getDb();
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
    status,
    id,
    req.user!.id
  );
  res.json({ ok: true });
});

router.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30')
    .all(req.user!.id);
  res.json({ notifications });
});

router.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

router.get('/search', requireAuth, (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ vehicles: [], contacts: [], invoices: [] });
    return;
  }
  const db = getDb();
  const like = `%${q}%`;
  const userId = req.user!.id;

  const vehicles = db
    .prepare(
      `SELECT id, marque, modele, immatriculation, vin, status FROM vehicles
       WHERE user_id = ? AND deleted_at IS NULL AND (marque LIKE ? OR modele LIKE ? OR immatriculation LIKE ? OR vin LIKE ?)
       LIMIT 6`
    )
    .all(userId, like, like, like, like);

  const contacts = db
    .prepare(
      `SELECT id, first_name, last_name, company_name, type, phone FROM contacts
       WHERE user_id = ? AND deleted_at IS NULL AND (first_name LIKE ? OR last_name LIKE ? OR company_name LIKE ? OR email LIKE ?)
       LIMIT 5`
    )
    .all(userId, like, like, like, like);

  const invoices = db
    .prepare(
      `SELECT id, invoice_number, status, total_ttc_cents FROM invoices
       WHERE user_id = ? AND invoice_number LIKE ?
       LIMIT 5`
    )
    .all(userId, like);

  res.json({ vehicles, contacts, invoices });
});

// ==================== SETTINGS, EXPORT & BACKUPS ====================
router.get('/settings', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value_json FROM app_settings WHERE user_id = ?').all(req.user!.id) as Array<{
    key: string;
    value_json: string;
  }>;
  const settings: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      settings[r.key] = JSON.parse(r.value_json);
    } catch {
      settings[r.key] = r.value_json;
    }
  }
  const backups = listSqliteBackups();
  res.json({ settings, backups });
});

const companySettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  siret: z.string().trim().max(40).optional().default(''),
  address: z.string().trim().max(240).optional().default(''),
  postalCode: z.string().trim().max(20).optional().default(''),
  city: z.string().trim().max(100).optional().default(''),
  country: z.string().trim().max(100).optional().default('France'),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(160)]).optional().default(''),
  vatNumber: z.string().trim().max(50).optional().default(''),
  iban: z.string().trim().max(64).optional().default(''),
});

const brandingSettingsSchema = z.object({
  logoDataUrl: z
    .string()
    .optional()
    .default('')
    .refine(isValidImageDataUrlOrEmpty, 'Format logo invalide (PNG/JPEG <= 1.5 Mo)'),
  primaryColor: z
    .string()
    .optional()
    .default('#2563EB')
    .refine((v) => isValidHexColor(v), 'Couleur principale hexadécimale invalide (#RRGGBB)'),
  secondaryColor: z
    .string()
    .optional()
    .default('#151922')
    .refine((v) => isValidHexColor(v), 'Couleur secondaire hexadécimale invalide (#RRGGBB)'),
  signatureDataUrl: z
    .string()
    .optional()
    .default('')
    .refine(isValidImageDataUrlOrEmpty, 'Format signature invalide (PNG/JPEG <= 1.5 Mo)'),
});

const accountingSettingsSchema = z.object({
  accountantEmail: z.union([z.literal(''), z.string().trim().email().max(160)]).optional().default(''),
});

router.put('/settings', requireAuth, (req: AuthedRequest, res) => {
  const entries = req.body?.settings;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    res.status(400).json({ error: 'Format paramètres invalide.' });
    return;
  }

  const normalizedEntries: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (k === 'company_settings') {
      const parsed = companySettingsSchema.safeParse(v);
      if (!parsed.success) {
        res.status(400).json({ error: 'Données entreprise invalides.', details: parsed.error.flatten() });
        return;
      }
      normalizedEntries[k] = parsed.data;
    } else if (k === 'branding_settings') {
      const parsed = brandingSettingsSchema.safeParse(v);
      if (!parsed.success) {
        res.status(400).json({ error: 'Données branding ou signature invalides.', details: parsed.error.flatten() });
        return;
      }
      normalizedEntries[k] = parsed.data;
    } else if (k === 'accounting_settings') {
      const parsed = accountingSettingsSchema.safeParse(v);
      if (!parsed.success) {
        res.status(400).json({ error: 'E-mail expert-comptable invalide.', details: parsed.error.flatten() });
        return;
      }
      normalizedEntries[k] = parsed.data;
    } else {
      normalizedEntries[k] = v;
    }
  }

  const db = getDb();
  const userId = req.user!.id;
  const stmt = db.prepare(
    `INSERT INTO app_settings (user_id, key, value_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  );

  db.transaction(() => {
    for (const [k, v] of Object.entries(normalizedEntries)) {
      stmt.run(userId, k, JSON.stringify(v));
    }

    // Keep default business_profile synchronized with company_settings & logo_url
    const company = normalizedEntries.company_settings as z.infer<typeof companySettingsSchema> | undefined;
    const branding = normalizedEntries.branding_settings as z.infer<typeof brandingSettingsSchema> | undefined;

    if (company || branding) {
      const defaultBp = db
        .prepare(
          `SELECT bp.id FROM business_profiles bp
           JOIN user_business_profiles ubp ON ubp.business_profile_id = bp.id
           WHERE ubp.user_id = ? AND bp.deleted_at IS NULL
           ORDER BY ubp.is_default DESC, bp.id ASC LIMIT 1`
        )
        .get(userId) as { id: number } | undefined;

      if (defaultBp) {
        if (company) {
          const fullAddress = formatFullAddress({
            address: company.address,
            postalCode: company.postalCode,
            city: company.city,
            country: company.country,
          });
          const siretClean = company.siret.replace(/\s+/g, '');
          const sirenDerived = /^\d{9,14}$/.test(siretClean) ? siretClean.slice(0, 9) : '';
          db.prepare(
            `UPDATE business_profiles SET
              nom_commercial = ?,
              raison_sociale = CASE WHEN raison_sociale = '' THEN ? ELSE raison_sociale END,
              siren = CASE WHEN ? != '' THEN ? ELSE siren END,
              siret = ?,
              adresse_pro = ?,
              telephone = ?,
              email = ?,
              tva_intracom = ?,
              iban = ?,
              updated_at = datetime('now')
             WHERE id = ?`
          ).run(
            company.companyName,
            company.companyName,
            sirenDerived,
            sirenDerived,
            company.siret,
            fullAddress,
            company.phone,
            company.email,
            company.vatNumber,
            company.iban,
            defaultBp.id
          );
        }
        if (branding) {
          db.prepare("UPDATE business_profiles SET logo_url = ?, updated_at = datetime('now') WHERE id = ?").run(
            branding.logoDataUrl || '',
            defaultBp.id
          );
        }
      } else if (company && company.companyName) {
        const fullAddress = formatFullAddress({
          address: company.address,
          postalCode: company.postalCode,
          city: company.city,
          country: company.country,
        });
        const siretClean = company.siret.replace(/\s+/g, '');
        const sirenDerived = /^\d{9,14}$/.test(siretClean) ? siretClean.slice(0, 9) : '';
        const info = db
          .prepare(
            `INSERT INTO business_profiles (
              nom_commercial, raison_sociale, siren, siret, adresse_pro, telephone, email, tva_intracom, iban, logo_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            company.companyName,
            company.companyName,
            sirenDerived,
            company.siret,
            fullAddress,
            company.phone,
            company.email,
            company.vatNumber,
            company.iban,
            branding?.logoDataUrl || ''
          );
        db.prepare(
          'INSERT INTO user_business_profiles (user_id, business_profile_id, role, is_default) VALUES (?, ?, ?, 1)'
        ).run(userId, Number(info.lastInsertRowid), 'owner');
      }
    }
  })();

  logAudit(userId, 'SETTINGS_UPDATE', 'settings', userId, { keys: Object.keys(normalizedEntries) }, req.ip || '');
  res.json({ ok: true });
});

router.get('/export/json', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const data = exportUserDataJson(db, req.user!.id);
  logAudit(req.user!.id, 'DATA_EXPORT_JSON', 'user', req.user!.id, {}, req.ip || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hexavo-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

const dateParamRe = /^\d{4}-\d{2}-\d{2}$/;

router.get('/export/sales.csv', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const where = ['s.user_id = ?', 's.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (dateParamRe.test(from)) {
    where.push('s.sale_date >= ?');
    params.push(from);
  }
  if (dateParamRe.test(to)) {
    where.push('s.sale_date <= ?');
    params.push(to);
  }

  const rows = db
    .prepare(
      `SELECT s.sale_date, s.invoice_number, v.marque, v.modele, v.immatriculation,
              COALESCE(NULLIF(c.company_name, ''), TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS buyer_name,
              s.legal_context, s.sales_channel, s.amount_ht_cents, s.vat_cents, s.amount_ttc_cents,
              s.payment_status, s.payment_method
       FROM sales s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.sale_date DESC, s.id DESC`
    )
    .all(...params) as SalesCsvRow[];

  const csv = formatSalesCsv(rows);
  const stamp = from || to ? `${from || 'debut'}_${to || 'fin'}` : new Date().toISOString().slice(0, 10);
  logAudit(userId, 'DATA_EXPORT_SALES_CSV', 'sale', userId, { from, to, count: rows.length }, req.ip || '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="journal-ventes-${stamp}.csv"`);
  res.send(csv);
});

router.get('/export/expenses.csv', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const where = ['e.user_id = ?', 'e.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (dateParamRe.test(from)) {
    where.push('e.operation_date >= ?');
    params.push(from);
  }
  if (dateParamRe.test(to)) {
    where.push('e.operation_date <= ?');
    params.push(to);
  }

  const rows = db
    .prepare(
      `SELECT e.operation_date, e.scope, ec.label_fr AS category_label, e.supplier_name,
              TRIM(COALESCE(v.marque, '') || ' ' || COALESCE(v.modele, '') || ' ' || COALESCE(v.immatriculation, '')) AS vehicle_label,
              e.amount_ht_cents, e.vat_cents, e.amount_ttc_cents, e.payment_status, e.payment_method, e.notes
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.operation_date DESC, e.id DESC`
    )
    .all(...params) as ExpenseCsvRow[];

  const csv = formatExpensesCsv(rows);
  const stamp = from || to ? `${from || 'debut'}_${to || 'fin'}` : new Date().toISOString().slice(0, 10);
  logAudit(userId, 'DATA_EXPORT_EXPENSES_CSV', 'expense', userId, { from, to, count: rows.length }, req.ip || '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="depenses-${stamp}.csv"`);
  res.send(csv);
});

router.post('/backups', requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const info = await createSqliteBackup(db);
  logAudit(req.user!.id, 'BACKUP_CREATE', 'system', info.fileName, { sizeBytes: info.sizeBytes }, req.ip || '');
  res.status(201).json({ backup: info });
});

export default router;
