import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTaxEstimate,
  calculateVatBreakdown,
  checkVatRegimeEligibility,
  selectApplicableTaxRule,
  type TaxRuleConfig,
} from './taxService';

test('Personal sale rejects VAT regimes and keeps hors_tva eligible', () => {
  const ok = checkVatRegimeEligibility({
    legalContext: 'personal',
    requestedRegime: 'hors_tva',
    purchaseVatRegime: 'hors_tva',
    sellerTypeAtPurchase: 'particulier',
  });
  assert.equal(ok.eligible, true);

  const bad = checkVatRegimeEligibility({
    legalContext: 'personal',
    requestedRegime: 'tva_sur_marge',
    purchaseVatRegime: 'hors_tva',
    sellerTypeAtPurchase: 'particulier',
  });
  assert.equal(bad.eligible, false);
});

test('TVA sur marge is flagged ineligible when purchased with deductible VAT from a pro', () => {
  const res = checkVatRegimeEligibility({
    legalContext: 'professional',
    requestedRegime: 'tva_sur_marge',
    purchaseVatRegime: 'tva_sur_prix_total',
    sellerTypeAtPurchase: 'professionnel',
  });
  assert.equal(res.eligible, false);
  assert.equal(res.reasonCode, 'MARGIN_VAT_INELIGIBLE_DEDUCTIBLE_PURCHASE');
});

test('TVA sur marge calculates VAT strictly on positive margin and hides VAT breakdown on invoice', () => {
  // Bought 10,000 EUR, Sold 12,400 EUR -> margin 2,400 EUR -> VAT (20/120) = 400 EUR
  const res = calculateVatBreakdown({
    amountTtcCents: 1240000,
    purchasePriceTtcCents: 1000000,
    vatRegime: 'tva_sur_marge',
    vatRateBps: 2000,
  });
  assert.equal(res.marginCents, 240000);
  assert.equal(res.vatCents, 40000);
  assert.equal(res.totalTtcCents, 1240000);
  assert.equal(res.showVatBreakdownOnInvoice, false);
});

test('Franchise en base sets VAT to 0 and includes art. 293 B mention', () => {
  const res = calculateVatBreakdown({
    amountTtcCents: 1500000,
    vatRegime: 'franchise_en_base',
    vatRateBps: 2000,
  });
  assert.equal(res.vatCents, 0);
  assert.equal(res.subtotalHtCents, 1500000);
  assert.match(res.legalMention, /293 B/);
});

test('Micro-entrepreneur 2026 baseline (12.3%) applies to gross turnover without deducting expenses', () => {
  const rule: TaxRuleConfig = {
    rule_code: 'MICRO_BIC_VENTES_2026',
    label: 'Micro 2026',
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

  const est = calculateTaxEstimate({
    grossProfessionalRevenueCents: 1000000, // 10,000 EUR
    vatCollectedCents: 200000, // Should be ignored under franchise_en_base
    vatDeductibleCents: 50000,
    regimeFiscal: 'micro_bic',
    regimeTva: 'franchise_en_base',
    rule,
    useVersementLiberatoire: true,
  });

  assert.equal(est.estimatedSocialCents, 123000); // 1,230 EUR
  assert.equal(est.estimatedIncomeTaxCents, 10000); // 100 EUR
  assert.equal(est.vatPayableCents, 0);
  assert.equal(est.isEstimate, true);
});

test('Tax rule selection respects effective date versioning', () => {
  const rules: TaxRuleConfig[] = [
    {
      rule_code: 'R_2025',
      label: '2025',
      activity_type: 'achat_revente_vo',
      regime_fiscal: 'micro_bic',
      regime_tva: 'franchise_en_base',
      social_rate_bps: 1230,
      income_tax_rate_bps: 100,
      vat_rate_bps: 2000,
      effective_from: '2025-01-01',
      effective_to: '2025-12-31',
      legal_notice: '',
    },
    {
      rule_code: 'R_2026',
      label: '2026',
      activity_type: 'achat_revente_vo',
      regime_fiscal: 'micro_bic',
      regime_tva: 'franchise_en_base',
      social_rate_bps: 1250,
      income_tax_rate_bps: 100,
      vat_rate_bps: 2000,
      effective_from: '2026-01-01',
      effective_to: null,
      legal_notice: '',
    },
  ];

  assert.equal(selectApplicableTaxRule(rules, '2025-06-15', 'micro_bic')?.rule_code, 'R_2025');
  assert.equal(selectApplicableTaxRule(rules, '2026-03-01', 'micro_bic')?.rule_code, 'R_2026');
});
