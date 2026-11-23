import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOutflowBucket,
  computeAnalyticsOverview,
  daysBetweenIso,
  type ComputeAnalyticsInput,
} from './analyticsService';
import type { TaxRuleConfig } from './taxService';

const DEFAULT_RULE: TaxRuleConfig = {
  rule_code: 'MICRO_BIC_VENTES_2026',
  label: 'Micro-BIC Ventes 2026',
  activity_type: 'achat_revente_vo',
  regime_fiscal: 'micro_bic',
  regime_tva: 'franchise_en_base',
  social_rate_bps: 1230,
  income_tax_rate_bps: 100,
  vat_rate_bps: 2000,
  effective_from: '2026-01-01',
  effective_to: null,
  legal_notice: 'TVA non applicable, art. 293 B du CGI',
};

function makeBaseInput(overrides: Partial<ComputeAnalyticsInput> = {}): ComputeAnalyticsInput {
  const directExpMap = new Map<number, number>([
    [1, 28800], // Peugeot 3008 (en_vente)
    [2, 54000], // BMW Serie 3 (vendu)
    [3, 7800], // Golf VIII (en_preparation)
    [4, 0], // Peugeot 308 (personal, en_vente)
  ]);

  return {
    nowIso: '2026-11-22',
    contextFilter: 'all',
    vehicles: [
      {
        id: 1,
        legal_context: 'professional',
        status: 'en_vente',
        marque: 'Peugeot',
        modele: '3008',
        immatriculation: 'GC-482-KL',
        date_achat: '2026-09-12', // 71 days -> 61_90
        prix_achat_cents: 1940000,
        prix_vente_prevu_cents: 2390000,
        prix_vente_final_cents: null,
      },
      {
        id: 2,
        legal_context: 'professional',
        status: 'vendu',
        marque: 'BMW',
        modele: 'Série 3',
        immatriculation: 'FP-918-TR',
        date_achat: '2026-08-05',
        prix_achat_cents: 2580000,
        prix_vente_prevu_cents: 3150000,
        prix_vente_final_cents: 3090000,
      },
      {
        id: 3,
        legal_context: 'professional',
        status: 'en_preparation',
        marque: 'Volkswagen',
        modele: 'Golf VIII',
        immatriculation: 'GH-114-WX',
        date_achat: '2026-10-18', // 35 days -> 31_60, NOT en_vente
        prix_achat_cents: 2120000,
        prix_vente_prevu_cents: 2540000,
        prix_vente_final_cents: null,
      },
      {
        id: 4,
        legal_context: 'personal',
        status: 'en_vente',
        marque: 'Peugeot',
        modele: '308',
        immatriculation: 'GE-729-MN',
        date_achat: '2026-11-05', // 17 days -> 0_30, NOT > 30 days
        prix_achat_cents: 2250000,
        prix_vente_prevu_cents: 2090000,
        prix_vente_final_cents: null,
      },
    ],
    sales: [
      {
        id: 10,
        vehicle_id: 2,
        legal_context: 'professional',
        sale_date: '2026-09-24', // 50 days after 2026-08-05
        amount_ttc_cents: 3090000,
        extra_services_cents: 0,
        vat_cents: 0,
        sales_channel: 'leboncoin',
        marque: 'BMW',
        modele: 'Série 3',
        immatriculation: 'FP-918-TR',
        date_achat: '2026-08-05',
        prix_achat_cents: 2580000,
        direct_expenses_cents: 54000,
      },
      {
        id: 11,
        vehicle_id: 99,
        legal_context: 'personal',
        sale_date: '2026-10-10',
        amount_ttc_cents: 1200000,
        extra_services_cents: 0,
        vat_cents: 0,
        sales_channel: 'direct',
        marque: 'Renault',
        modele: 'Clio',
        immatriculation: 'AA-123-BB',
        date_achat: '2026-09-10', // 30 days
        prix_achat_cents: 1000000,
        direct_expenses_cents: 20000,
      },
    ],
    expenses: [
      {
        id: 1,
        vehicle_id: 1,
        scope: 'vehicle',
        vehicle_legal_context: 'professional',
        category_code: 'detailing',
        label_fr: 'Detailing',
        label_ru: 'Детейлинг',
        label_en: 'Detailing',
        operation_date: '2026-09-15',
        amount_ttc_cents: 28800,
        vat_cents: 4800,
        vat_deductible: 0,
        marque: 'Peugeot',
        modele: '3008',
        immatriculation: 'GC-482-KL',
      },
      {
        id: 2,
        vehicle_id: null,
        scope: 'business',
        vehicle_legal_context: null,
        category_code: 'loyer',
        label_fr: 'Loyer',
        label_ru: 'Аренда',
        label_en: 'Rent',
        operation_date: '2026-10-01',
        amount_ttc_cents: 85000,
        vat_cents: 0,
        vat_deductible: 0,
      },
    ],
    allVehicleDirectExpensesMap: directExpMap,
    transactions: [
      {
        id: 1,
        vehicle_id: 2,
        legal_context: 'professional',
        direction: 'inflow',
        category: 'vente_vehicule',
        amount_cents: 3090000,
        operation_date: '2026-09-24',
        payment_date: '2026-09-24',
        payment_status: 'paye',
        description: 'Vente BMW',
      },
      {
        id: 2,
        vehicle_id: 1,
        legal_context: 'professional',
        direction: 'outflow',
        category: 'achat_vehicule',
        amount_cents: 1940000,
        operation_date: '2026-09-12',
        payment_date: '2026-09-12',
        payment_status: 'paye',
        description: 'Achat 3008',
      },
      {
        id: 3,
        vehicle_id: 1,
        legal_context: 'professional',
        direction: 'outflow',
        category: 'detailing',
        amount_cents: 28800,
        operation_date: '2026-09-15',
        payment_date: '2026-09-15',
        payment_status: 'paye',
        description: 'Detailing 3008',
      },
      {
        id: 4,
        vehicle_id: null,
        legal_context: 'professional',
        direction: 'outflow',
        category: 'loyer',
        amount_cents: 85000,
        operation_date: '2026-10-01',
        payment_date: '2026-10-01',
        payment_status: 'paye',
        description: 'Loyer',
      },
      {
        id: 5,
        vehicle_id: null,
        legal_context: 'professional',
        direction: 'outflow',
        category: 'urssaf',
        amount_cents: 380070,
        operation_date: '2026-10-15',
        payment_date: '2026-10-15',
        payment_status: 'paye',
        description: 'Cotisations URSSAF',
      },
    ],
    regimeFiscal: 'micro_bic',
    regimeTva: 'franchise_en_base',
    taxRule: DEFAULT_RULE,
    hasBusinessProfile: true,
    ...overrides,
  };
}

describe('analyticsService', () => {
  it('computes UTC day deltas accurately', () => {
    assert.equal(daysBetweenIso('2026-08-05', '2026-09-24'), 50);
    assert.equal(daysBetweenIso('2026-11-22', '2026-11-22'), 0);
  });

  it('applies URSSAF strictly to professional turnover and excludes personal turnover', () => {
    const allRes = computeAnalyticsOverview(makeBaseInput({ contextFilter: 'all' }));
    // Total revenue = 30900 + 12000 = 42900 EUR
    assert.equal(allRes.summary.grossRevenueCents, 4290000);
    // Pro revenue only = 30900 EUR -> 12.3% URSSAF = 3800.70 EUR (380070 cents)
    assert.equal(allRes.summary.proRevenueCents, 3090000);
    assert.equal(allRes.taxBreakdown.estimatedSocialCents, 380070);
    // Gross margin: BMW (30900 - 25800 - 540 = 4560) + Clio (12000 - 10000 - 200 = 1800) = 6360 EUR
    assert.equal(allRes.summary.grossMarginCents, 636000);
    // Net profit: 636000 - 85000 (loyer) - 380070 (URSSAF) = 170930 cents
    assert.equal(allRes.summary.netProfitCents, 170930);

    const personalRes = computeAnalyticsOverview(makeBaseInput({ contextFilter: 'personal' }));
    assert.equal(personalRes.summary.grossRevenueCents, 1200000);
    assert.equal(personalRes.summary.proRevenueCents, 0);
    assert.equal(personalRes.taxBreakdown.estimatedSocialCents, 0);
    assert.equal(personalRes.summary.generalExpensesCents, 0);
    assert.equal(personalRes.summary.netProfitCents, 180000);
  });

  it('filters stock aging brackets and longStockVehicles strictly to en_vente > 30 days', () => {
    const res = computeAnalyticsOverview(makeBaseInput({ contextFilter: 'all' }));
    // Active stock: v1 (3008, en_vente, 71d), v3 (Golf VIII, en_preparation, 35d), v4 (308, en_vente, 17d)
    assert.equal(res.stock.activeCount, 3);
    assert.equal(res.stock.forSaleCount, 2);
    assert.equal(res.stock.ageDistribution.find((b) => b.bracket === '0_30')?.count, 1);
    assert.equal(res.stock.ageDistribution.find((b) => b.bracket === '31_60')?.count, 1);
    assert.equal(res.stock.ageDistribution.find((b) => b.bracket === '61_90')?.count, 1);
    assert.equal(res.stock.ageDistribution.find((b) => b.bracket === 'gt_90')?.count, 0);

    // Only Peugeot 3008 is BOTH status==='en_vente' AND daysInStock > 30 (Golf is en_preparation; 308 is 17d)
    assert.equal(res.stock.longStockVehicles.length, 1);
    assert.equal(res.stock.longStockVehicles[0].vehicleId, 1);
    assert.equal(res.stock.longStockVehicles[0].daysInStock, 71);
    assert.equal(res.stock.avgDaysToSell, 40); // avg(50, 30)
  });

  it('splits cash flow outflows into vehiclePurchases, workshopParts, generalExpenses, and taxes', () => {
    assert.equal(classifyOutflowBucket('achat_vehicule'), 'vehiclePurchases');
    assert.equal(classifyOutflowBucket('detailing'), 'workshopParts');
    assert.equal(classifyOutflowBucket('loyer'), 'generalExpenses');
    assert.equal(classifyOutflowBucket('urssaf'), 'taxes');

    const res = computeAnalyticsOverview(makeBaseInput({ contextFilter: 'professional' }));
    assert.equal(res.cashFlow.outflowsSplit.vehiclePurchasesCents, 1940000);
    assert.equal(res.cashFlow.outflowsSplit.workshopPartsCents, 28800);
    assert.equal(res.cashFlow.outflowsSplit.generalExpensesCents, 85000);
    assert.equal(res.cashFlow.outflowsSplit.taxesCents, 380070);
  });

  it('computes sales averages and channel breakdown cleanly', () => {
    const res = computeAnalyticsOverview(makeBaseInput({ contextFilter: 'all' }));
    assert.equal(res.salesMetrics.salesCount, 2);
    assert.equal(res.salesMetrics.avgSaleCents, 2145000);
    const lbc = res.channels.find((c) => c.channel === 'leboncoin');
    const direct = res.channels.find((c) => c.channel === 'direct');
    assert.equal(lbc?.salesCount, 1);
    assert.equal(lbc?.revenueCents, 3090000);
    assert.equal(lbc?.avgDaysToSell, 50);
    assert.equal(direct?.salesCount, 1);
    assert.equal(direct?.revenueCents, 1200000);
    assert.equal(direct?.avgDaysToSell, 30);
  });
});
