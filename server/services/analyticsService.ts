import { aggregateCashFlow, type CashFlowTx } from './financeService';
import { calculateTaxEstimate, type FiscalRegime, type TaxRuleConfig, type VatRegime } from './taxService';

export type AnalyticsContextFilter = 'all' | 'professional' | 'personal';
export type SalesChannel = 'leboncoin' | 'direct' | 'recommandation' | 'autre';

export interface AnalyticsVehicleRow {
  id: number;
  legal_context: 'personal' | 'professional';
  status: string;
  marque: string;
  modele: string;
  immatriculation: string;
  date_achat: string;
  prix_achat_cents: number;
  prix_vente_prevu_cents: number | null;
  prix_vente_final_cents: number | null;
}

export interface AnalyticsSaleRow {
  id: number;
  vehicle_id: number;
  legal_context: 'personal' | 'professional';
  sale_date: string;
  amount_ttc_cents: number;
  extra_services_cents: number;
  vat_cents: number;
  sales_channel?: string | null;
  marque: string;
  modele: string;
  immatriculation: string;
  date_achat: string;
  prix_achat_cents: number;
  direct_expenses_cents: number;
}

export interface AnalyticsExpenseRow {
  id: number;
  vehicle_id: number | null;
  scope: 'vehicle' | 'business';
  vehicle_legal_context?: 'personal' | 'professional' | null;
  category_code: string;
  label_fr: string;
  label_ru: string;
  label_en: string;
  operation_date: string;
  amount_ttc_cents: number;
  vat_cents: number;
  vat_deductible: number;
  marque?: string | null;
  modele?: string | null;
  immatriculation?: string | null;
}

export interface AnalyticsTransactionRow extends CashFlowTx {
  id: number;
  vehicle_id: number | null;
  legal_context: 'personal' | 'professional';
  description: string;
  marque?: string | null;
  modele?: string | null;
  immatriculation?: string | null;
}

export interface ComputeAnalyticsInput {
  nowIso: string;
  contextFilter: AnalyticsContextFilter;
  vehicles: AnalyticsVehicleRow[];
  sales: AnalyticsSaleRow[];
  expenses: AnalyticsExpenseRow[];
  allVehicleDirectExpensesMap: Map<number, number>;
  transactions: AnalyticsTransactionRow[];
  regimeFiscal: FiscalRegime;
  regimeTva: VatRegime;
  taxRule: TaxRuleConfig;
  hasBusinessProfile: boolean;
}

export function daysBetweenIso(startIso: string, endIso: string): number {
  const s = Date.parse(`${String(startIso || '').slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${String(endIso || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(0, Math.floor((e - s) / 86400000));
}

export function normalizeSalesChannel(raw: string | null | undefined): SalesChannel {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'leboncoin') return 'leboncoin';
  if (val === 'recommandation' || val === 'referral') return 'recommandation';
  if (val === 'autre' || val === 'other') return 'autre';
  return 'direct';
}

const VEHICLE_OUTFLOW_CATEGORIES = new Set([
  'reparation',
  'pieces',
  'detailing',
  'lavage',
  'diagnostic',
  'transport',
  'controle_technique',
  'preparation',
  'autre_vehicule',
]);

const TAX_OUTFLOW_CATEGORIES = new Set(['urssaf', 'impot', 'tva', 'taxe']);

export function classifyOutflowBucket(
  category: string
): 'vehiclePurchases' | 'workshopParts' | 'generalExpenses' | 'taxes' {
  const cat = String(category || '').trim().toLowerCase();
  if (cat === 'achat_vehicule') return 'vehiclePurchases';
  if (TAX_OUTFLOW_CATEGORIES.has(cat)) return 'taxes';
  if (VEHICLE_OUTFLOW_CATEGORIES.has(cat)) return 'workshopParts';
  return 'generalExpenses';
}

export function computeAnalyticsOverview(input: ComputeAnalyticsInput) {
  const matchesCtx = (ctx: string) => input.contextFilter === 'all' || ctx === input.contextFilter;

  const filteredVehicles = input.vehicles.filter((v) => matchesCtx(v.legal_context));
  const filteredSales = input.sales.filter((s) => matchesCtx(s.legal_context));
  const filteredExpenses = input.expenses.filter((e) => {
    const effectiveCtx: 'personal' | 'professional' =
      e.scope === 'business' ? 'professional' : e.vehicle_legal_context || 'professional';
    return matchesCtx(effectiveCtx);
  });
  const filteredTransactions = input.transactions.filter((tx) => matchesCtx(tx.legal_context));

  // ---------- TAB 1: OVERVIEW & P&L ----------
  let grossRevenueCents = 0;
  let grossMarginCents = 0;
  let proRevenueCents = 0;
  let proVatCollectedCents = 0;

  const profitableVehicles = filteredSales
    .map((s) => {
      const revenueCents = Math.round((s.amount_ttc_cents || 0) + (s.extra_services_cents || 0));
      const purchaseCents = Math.round(s.prix_achat_cents || 0);
      const directExpensesCents = Math.round(s.direct_expenses_cents || 0);
      const grossMargin = revenueCents - purchaseCents - directExpensesCents;
      const marginPct = revenueCents > 0 ? Math.round((grossMargin / revenueCents) * 1000) / 10 : 0;
      const daysToSell = daysBetweenIso(s.date_achat, s.sale_date);

      grossRevenueCents += revenueCents;
      grossMarginCents += grossMargin;
      if (s.legal_context === 'professional') {
        proRevenueCents += revenueCents;
        proVatCollectedCents += Math.round(s.vat_cents || 0);
      }

      return {
        vehicleId: s.vehicle_id,
        saleId: s.id,
        marque: s.marque,
        modele: s.modele,
        immatriculation: s.immatriculation,
        legalContext: s.legal_context,
        saleDate: s.sale_date,
        daysToSell,
        purchaseCents,
        directExpensesCents,
        revenueCents,
        grossMarginCents: grossMargin,
        marginPct,
      };
    })
    .sort((a, b) => b.grossMarginCents - a.grossMarginCents);

  const generalExpensesCents = filteredExpenses
    .filter((e) => e.scope === 'business')
    .reduce((sum, e) => sum + Math.round(e.amount_ttc_cents || 0), 0);

  const vatDeductibleCents = filteredExpenses
    .filter((e) => e.vat_deductible === 1)
    .reduce((sum, e) => sum + Math.round(e.vat_cents || 0), 0);

  // Strictly apply URSSAF / Micro-BIC tax estimation ONLY to professional turnover
  const taxEstimate =
    input.contextFilter === 'personal' || !input.hasBusinessProfile
      ? {
          grossRevenueCents: 0,
          taxableBaseCents: 0,
          estimatedSocialCents: 0,
          estimatedIncomeTaxCents: 0,
          vatCollectedCents: 0,
          vatDeductibleCents: 0,
          vatPayableCents: 0,
          isEstimate: true as const,
          disclaimer:
            input.contextFilter === 'personal'
              ? 'Les ventes de véhicules personnels (Particulier) ne sont pas soumises aux cotisations URSSAF / Micro-BIC.'
              : 'Aucun profil professionnel configuré.',
        }
      : calculateTaxEstimate({
          grossProfessionalRevenueCents: proRevenueCents,
          vatCollectedCents: proVatCollectedCents,
          vatDeductibleCents,
          regimeFiscal: input.regimeFiscal,
          regimeTva: input.regimeTva,
          rule: input.taxRule,
          useVersementLiberatoire: false,
        });

  const estimatedTaxesTotalCents =
    taxEstimate.estimatedSocialCents + taxEstimate.estimatedIncomeTaxCents;
  const netProfitCents = grossMarginCents - generalExpensesCents - estimatedTaxesTotalCents;
  const grossMarginPct =
    grossRevenueCents > 0 ? Math.round((grossMarginCents / grossRevenueCents) * 1000) / 10 : 0;
  const netMarginPct =
    grossRevenueCents > 0 ? Math.round((netProfitCents / grossRevenueCents) * 1000) / 10 : 0;

  // ---------- TAB 2: STOCK & ROTATION ----------
  const activeStock = filteredVehicles.filter(
    (v) => v.status !== 'vendu' && v.status !== 'archive'
  );

  let stockTotalValueCents = 0;
  let stockInvestedCapitalCents = 0;
  let stockPotentialProfitCents = 0;

  const brackets = {
    '0_30': { bracket: '0_30' as const, label: '0–30 j', count: 0, investedCents: 0 },
    '31_60': { bracket: '31_60' as const, label: '31–60 j', count: 0, investedCents: 0 },
    '61_90': { bracket: '61_90' as const, label: '61–90 j', count: 0, investedCents: 0 },
    gt_90: { bracket: 'gt_90' as const, label: '> 90 j', count: 0, investedCents: 0 },
  };

  const longStockVehicles: Array<{
    vehicleId: number;
    marque: string;
    modele: string;
    immatriculation: string;
    legalContext: 'personal' | 'professional';
    dateAchat: string;
    daysInStock: number;
    investedCents: number;
    targetPriceCents: number | null;
  }> = [];

  for (const v of activeStock) {
    const directExp = Math.round(input.allVehicleDirectExpensesMap.get(v.id) || 0);
    const purchase = Math.round(v.prix_achat_cents || 0);
    const invested = purchase + directExp;
    const target = v.prix_vente_prevu_cents && v.prix_vente_prevu_cents > 0 ? Math.round(v.prix_vente_prevu_cents) : null;
    const valuation = target ?? purchase;

    stockTotalValueCents += valuation;
    stockInvestedCapitalCents += invested;
    if (target !== null) {
      stockPotentialProfitCents += target - invested;
    }

    const days = daysBetweenIso(v.date_achat, input.nowIso);
    if (days <= 30) {
      brackets['0_30'].count += 1;
      brackets['0_30'].investedCents += invested;
    } else if (days <= 60) {
      brackets['31_60'].count += 1;
      brackets['31_60'].investedCents += invested;
    } else if (days <= 90) {
      brackets['61_90'].count += 1;
      brackets['61_90'].investedCents += invested;
    } else {
      brackets.gt_90.count += 1;
      brackets.gt_90.investedCents += invested;
    }

    // Strictly vehicles in 'en_vente' status for > 30 days
    if (v.status === 'en_vente' && days > 30) {
      longStockVehicles.push({
        vehicleId: v.id,
        marque: v.marque,
        modele: v.modele,
        immatriculation: v.immatriculation,
        legalContext: v.legal_context,
        dateAchat: v.date_achat,
        daysInStock: days,
        investedCents: invested,
        targetPriceCents: target,
      });
    }
  }

  longStockVehicles.sort((a, b) => b.daysInStock - a.daysInStock);

  const avgDaysToSell =
    profitableVehicles.length > 0
      ? Math.round(
          profitableVehicles.reduce((s, x) => s + x.daysToSell, 0) / profitableVehicles.length
        )
      : null;

  // ---------- TAB 3: CASH FLOW & EXPENSES ----------
  const cashFlowSummary = aggregateCashFlow(filteredTransactions);
  const outflowsSplit = {
    vehiclePurchasesCents: 0,
    workshopPartsCents: 0,
    generalExpensesCents: 0,
    taxesCents: 0,
  };

  for (const tx of filteredTransactions) {
    if (tx.direction === 'outflow' && tx.payment_status === 'paye') {
      const amt = Math.max(0, Math.round(tx.amount_cents || 0));
      const bucket = classifyOutflowBucket(tx.category);
      if (bucket === 'vehiclePurchases') outflowsSplit.vehiclePurchasesCents += amt;
      else if (bucket === 'workshopParts') outflowsSplit.workshopPartsCents += amt;
      else if (bucket === 'taxes') outflowsSplit.taxesCents += amt;
      else outflowsSplit.generalExpensesCents += amt;
    }
  }

  const expenseCategoryMap = new Map<
    string,
    {
      code: string;
      scope: 'vehicle' | 'business';
      label_fr: string;
      label_ru: string;
      label_en: string;
      totalCents: number;
      count: number;
    }
  >();

  const vehicleContribMap = new Map<
    number,
    {
      vehicleId: number;
      marque: string;
      modele: string;
      immatriculation: string;
      directExpensesCents: number;
      expenseCount: number;
    }
  >();

  for (const e of filteredExpenses) {
    const amt = Math.round(e.amount_ttc_cents || 0);
    const catKey = `${e.scope}:${e.category_code}`;
    const existingCat = expenseCategoryMap.get(catKey) || {
      code: e.category_code,
      scope: e.scope,
      label_fr: e.label_fr,
      label_ru: e.label_ru,
      label_en: e.label_en,
      totalCents: 0,
      count: 0,
    };
    existingCat.totalCents += amt;
    existingCat.count += 1;
    expenseCategoryMap.set(catKey, existingCat);

    if (e.vehicle_id) {
      const existingVeh = vehicleContribMap.get(e.vehicle_id) || {
        vehicleId: e.vehicle_id,
        marque: e.marque || '',
        modele: e.modele || '',
        immatriculation: e.immatriculation || '',
        directExpensesCents: 0,
        expenseCount: 0,
      };
      existingVeh.directExpensesCents += amt;
      existingVeh.expenseCount += 1;
      vehicleContribMap.set(e.vehicle_id, existingVeh);
    }
  }

  const totalExpensesPeriodCents = filteredExpenses.reduce(
    (s, e) => s + Math.round(e.amount_ttc_cents || 0),
    0
  );

  const expenseCategories = Array.from(expenseCategoryMap.values())
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((c) => ({
      ...c,
      sharePct:
        totalExpensesPeriodCents > 0
          ? Math.round((c.totalCents / totalExpensesPeriodCents) * 1000) / 10
          : 0,
    }));

  const vehicleContributors = Array.from(vehicleContribMap.values()).sort(
    (a, b) => b.directExpensesCents - a.directExpensesCents
  );

  // ---------- TAB 4: SALES & CHANNELS ----------
  const soldCount = profitableVehicles.length;
  const avgPurchaseCents =
    soldCount > 0
      ? Math.round(profitableVehicles.reduce((s, x) => s + x.purchaseCents, 0) / soldCount)
      : 0;
  const avgSaleCents =
    soldCount > 0
      ? Math.round(profitableVehicles.reduce((s, x) => s + x.revenueCents, 0) / soldCount)
      : 0;
  const avgExpensesPerVehicleCents =
    soldCount > 0
      ? Math.round(profitableVehicles.reduce((s, x) => s + x.directExpensesCents, 0) / soldCount)
      : 0;
  const avgNetMarginCents =
    soldCount > 0
      ? Math.round((grossMarginCents - estimatedTaxesTotalCents) / soldCount)
      : 0;

  const channelSeed: Record<
    SalesChannel,
    {
      channel: SalesChannel;
      salesCount: number;
      revenueCents: number;
      grossMarginCents: number;
      netMarginCents: number;
      totalDays: number;
    }
  > = {
    leboncoin: { channel: 'leboncoin', salesCount: 0, revenueCents: 0, grossMarginCents: 0, netMarginCents: 0, totalDays: 0 },
    direct: { channel: 'direct', salesCount: 0, revenueCents: 0, grossMarginCents: 0, netMarginCents: 0, totalDays: 0 },
    recommandation: { channel: 'recommandation', salesCount: 0, revenueCents: 0, grossMarginCents: 0, netMarginCents: 0, totalDays: 0 },
    autre: { channel: 'autre', salesCount: 0, revenueCents: 0, grossMarginCents: 0, netMarginCents: 0, totalDays: 0 },
  };

  for (const s of filteredSales) {
    const ch = normalizeSalesChannel(s.sales_channel);
    const rev = Math.round((s.amount_ttc_cents || 0) + (s.extra_services_cents || 0));
    const margin = rev - Math.round(s.prix_achat_cents || 0) - Math.round(s.direct_expenses_cents || 0);
    const proTaxShare =
      s.legal_context === 'professional' && proRevenueCents > 0
        ? Math.round((estimatedTaxesTotalCents * rev) / proRevenueCents)
        : 0;
    const days = daysBetweenIso(s.date_achat, s.sale_date);

    channelSeed[ch].salesCount += 1;
    channelSeed[ch].revenueCents += rev;
    channelSeed[ch].grossMarginCents += margin;
    channelSeed[ch].netMarginCents += margin - proTaxShare;
    channelSeed[ch].totalDays += days;
  }

  const channels = (['leboncoin', 'direct', 'recommandation', 'autre'] as SalesChannel[]).map((ch) => {
    const row = channelSeed[ch];
    return {
      channel: row.channel,
      salesCount: row.salesCount,
      revenueCents: row.revenueCents,
      grossMarginCents: row.grossMarginCents,
      netMarginCents: row.netMarginCents,
      avgDaysToSell: row.salesCount > 0 ? Math.round(row.totalDays / row.salesCount) : null,
    };
  });

  return {
    summary: {
      salesCount: soldCount,
      grossRevenueCents,
      proRevenueCents,
      grossMarginCents,
      grossMarginPct,
      generalExpensesCents,
      estimatedTaxesTotalCents,
      netProfitCents,
      netMarginPct,
    },
    taxBreakdown: {
      ...taxEstimate,
      socialRateBps: input.taxRule.social_rate_bps,
      incomeTaxRateBps: input.taxRule.income_tax_rate_bps,
      ruleLabel: input.taxRule.label,
      regimeFiscal: input.regimeFiscal,
    },
    topProfitableVehicles: profitableVehicles,
    stock: {
      activeCount: activeStock.length,
      forSaleCount: activeStock.filter((v) => v.status === 'en_vente').length,
      totalValueCents: stockTotalValueCents,
      investedCapitalCents: stockInvestedCapitalCents,
      potentialProfitCents: stockPotentialProfitCents,
      avgDaysToSell,
      ageDistribution: [brackets['0_30'], brackets['31_60'], brackets['61_90'], brackets.gt_90],
      longStockVehicles,
    },
    cashFlow: {
      ...cashFlowSummary,
      outflowsSplit,
    },
    expenseCategories,
    vehicleContributors,
    salesMetrics: {
      salesCount: soldCount,
      avgPurchaseCents,
      avgSaleCents,
      avgExpensesPerVehicleCents,
      avgNetMarginCents,
    },
    channels,
  };
}
