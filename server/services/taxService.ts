export type VatRegime =
  | 'franchise_en_base'
  | 'tva_sur_marge'
  | 'tva_sur_prix_total'
  | 'autre_regime'
  | 'hors_tva';

export type FiscalRegime =
  | 'particulier'
  | 'micro_bic'
  | 'micro_bnc'
  | 'reel_simplifie'
  | 'reel_normal'
  | 'is';

export interface TaxRuleConfig {
  id?: number;
  rule_code: string;
  label: string;
  activity_type: string;
  regime_fiscal: FiscalRegime;
  regime_tva: VatRegime;
  social_rate_bps: number; // e.g., 1230 = 12.30%
  income_tax_rate_bps: number; // e.g., 100 = 1.00% versement liberatoire
  vat_rate_bps: number; // e.g., 2000 = 20.00%
  effective_from: string;
  effective_to: string | null;
  legal_notice: string;
}

export interface VatEligibilityInput {
  legalContext: 'personal' | 'professional';
  requestedRegime: VatRegime;
  purchaseVatRegime: string;
  sellerTypeAtPurchase: string;
}

export interface VatEligibilityResult {
  eligible: boolean;
  reasonCode: string;
  warningMessage?: string;
}

export interface VatCalculationInput {
  amountTtcCents: number;
  purchasePriceTtcCents?: number;
  vatRegime: VatRegime;
  vatRateBps: number;
  customMention?: string;
}

export interface VatCalculationResult {
  subtotalHtCents: number;
  vatCents: number;
  totalTtcCents: number;
  marginCents: number;
  legalMention: string;
  showVatBreakdownOnInvoice: boolean;
}

export const DEFAULT_FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI';
export const DEFAULT_MARGIN_MENTION =
  "Régime particulier — Biens d'occasion — Article 297 A du CGI (TVA sur la marge non déductible par l'acheteur)";

/**
 * Decimal-safe integer rounding: (amount * bps) / 10000
 */
export function multiplyByBps(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10000);
}

/**
 * Validates whether a chosen VAT regime is legally coherent with the vehicle's acquisition context.
 * Prevents blindly applying "TVA sur marge" to every sale.
 */
export function checkVatRegimeEligibility(input: VatEligibilityInput): VatEligibilityResult {
  if (input.legalContext === 'personal') {
    if (input.requestedRegime === 'hors_tva' || input.requestedRegime === 'franchise_en_base') {
      return { eligible: true, reasonCode: 'PERSONAL_PRIVATE_SALE' };
    }
    return {
      eligible: false,
      reasonCode: 'PERSONAL_CANNOT_CHARGE_VAT',
      warningMessage:
        'Une vente personnelle (particulier) est hors champ TVA. Elle ne peut pas être soumise à la TVA sur marge ou sur prix total.',
    };
  }

  if (input.requestedRegime === 'tva_sur_marge') {
    const acquiredWithDeductibleVat =
      input.purchaseVatRegime === 'tva_sur_prix_total' &&
      (input.sellerTypeAtPurchase === 'professionnel' || input.sellerTypeAtPurchase === 'societe');

    if (acquiredWithDeductibleVat) {
      return {
        eligible: false,
        reasonCode: 'MARGIN_VAT_INELIGIBLE_DEDUCTIBLE_PURCHASE',
        warningMessage:
          "Attention : ce véhicule a été acquis avec TVA déductible sur le prix total auprès d'un professionnel. Le régime de la TVA sur la marge (art. 297 A CGI) n'est en principe pas applicable.",
      };
    }

    return { eligible: true, reasonCode: 'MARGIN_VAT_ELIGIBLE' };
  }

  return { eligible: true, reasonCode: 'REGIME_VALID' };
}

/**
 * Computes HT, VAT, and TTC in integer centimes according to the selected French VAT regime.
 */
export function calculateVatBreakdown(input: VatCalculationInput): VatCalculationResult {
  const totalTtc = Math.max(0, Math.round(input.amountTtcCents));
  const rateBps = Math.max(0, Math.round(input.vatRateBps));

  if (input.vatRegime === 'hors_tva') {
    return {
      subtotalHtCents: totalTtc,
      vatCents: 0,
      totalTtcCents: totalTtc,
      marginCents: 0,
      legalMention: input.customMention || 'Opération hors champ TVA (particulier)',
      showVatBreakdownOnInvoice: false,
    };
  }

  if (input.vatRegime === 'franchise_en_base') {
    return {
      subtotalHtCents: totalTtc,
      vatCents: 0,
      totalTtcCents: totalTtc,
      marginCents: 0,
      legalMention: input.customMention || DEFAULT_FRANCHISE_MENTION,
      showVatBreakdownOnInvoice: false,
    };
  }

  if (input.vatRegime === 'tva_sur_marge') {
    const purchaseTtc = Math.max(0, Math.round(input.purchasePriceTtcCents ?? 0));
    const grossMarginTtc = totalTtc - purchaseTtc;
    // If margin <= 0, VAT on margin is 0 in France
    const vatCents =
      grossMarginTtc > 0
        ? Math.round((grossMarginTtc * rateBps) / (10000 + rateBps))
        : 0;
    return {
      subtotalHtCents: totalTtc - vatCents,
      vatCents,
      totalTtcCents: totalTtc,
      marginCents: grossMarginTtc,
      legalMention: input.customMention || DEFAULT_MARGIN_MENTION,
      // Under French law (art. 297 E CGI), VAT on margin must NOT appear separately on the invoice
      showVatBreakdownOnInvoice: false,
    };
  }

  if (input.vatRegime === 'tva_sur_prix_total') {
    const htCents = Math.round((totalTtc * 10000) / (10000 + rateBps));
    const vatCents = totalTtc - htCents;
    return {
      subtotalHtCents: htCents,
      vatCents,
      totalTtcCents: totalTtc,
      marginCents: 0,
      legalMention: input.customMention || `TVA ${(rateBps / 100).toFixed(1)}% incluse sur prix total`,
      showVatBreakdownOnInvoice: true,
    };
  }

  // autre_regime (e.g., export / intracom 0% or custom rate)
  const htCents = rateBps > 0 ? Math.round((totalTtc * 10000) / (10000 + rateBps)) : totalTtc;
  const vatCents = totalTtc - htCents;
  return {
    subtotalHtCents: htCents,
    vatCents,
    totalTtcCents: totalTtc,
    marginCents: 0,
    legalMention: input.customMention || 'Régime TVA spécifique configuré',
    showVatBreakdownOnInvoice: vatCents > 0,
  };
}

export interface MicroTaxInput {
  grossProfessionalRevenueCents: number;
  vatCollectedCents: number;
  vatDeductibleCents: number;
  regimeFiscal: FiscalRegime;
  regimeTva: VatRegime;
  rule: TaxRuleConfig;
  useVersementLiberatoire: boolean;
}

export interface MicroTaxEstimate {
  grossRevenueCents: number;
  taxableBaseCents: number;
  estimatedSocialCents: number;
  estimatedIncomeTaxCents: number;
  vatCollectedCents: number;
  vatDeductibleCents: number;
  vatPayableCents: number;
  isEstimate: true;
  disclaimer: string;
}

/**
 * Computes preliminary French social & tax estimates without mixing:
 * - personal sales (excluded from professional revenue)
 * - social contributions vs income tax
 * - micro-entrepreneur revenue base (expenses are NOT deductible from micro-BIC taxable turnover)
 */
export function calculateTaxEstimate(input: MicroTaxInput): MicroTaxEstimate {
  const grossRevenue = Math.max(0, Math.round(input.grossProfessionalRevenueCents));

  let estimatedSocialCents = 0;
  let estimatedIncomeTaxCents = 0;
  let taxableBaseCents = grossRevenue;

  if (input.regimeFiscal === 'micro_bic' || input.regimeFiscal === 'micro_bnc') {
    // Micro-entrepreneur: social contributions apply on gross encaissements (no expense deduction)
    estimatedSocialCents = multiplyByBps(grossRevenue, input.rule.social_rate_bps);
    if (input.useVersementLiberatoire) {
      estimatedIncomeTaxCents = multiplyByBps(grossRevenue, input.rule.income_tax_rate_bps);
    } else {
      // Standard micro-BIC abattement 71% for vente de marchandises (29% taxable base estimate)
      taxableBaseCents =
        input.regimeFiscal === 'micro_bic'
          ? multiplyByBps(grossRevenue, 2900)
          : multiplyByBps(grossRevenue, 6600);
      estimatedIncomeTaxCents = 0; // Progressif IR depends on household foyer fiscal
    }
  } else if (
    input.regimeFiscal === 'reel_simplifie' ||
    input.regimeFiscal === 'reel_normal' ||
    input.regimeFiscal === 'is'
  ) {
    // Under reel / IS, social charges & IS depend on net accounting profit, so only configurable rate estimate if requested
    estimatedSocialCents = multiplyByBps(grossRevenue, input.rule.social_rate_bps);
    estimatedIncomeTaxCents = multiplyByBps(grossRevenue, input.rule.income_tax_rate_bps);
  }

  const vatCollected =
    input.regimeTva === 'franchise_en_base' || input.regimeTva === 'hors_tva'
      ? 0
      : Math.max(0, Math.round(input.vatCollectedCents));

  const vatDeductible =
    input.regimeTva === 'franchise_en_base' || input.regimeTva === 'hors_tva'
      ? 0
      : Math.max(0, Math.round(input.vatDeductibleCents));

  const vatPayable = Math.max(0, vatCollected - vatDeductible);

  return {
    grossRevenueCents: grossRevenue,
    taxableBaseCents,
    estimatedSocialCents,
    estimatedIncomeTaxCents,
    vatCollectedCents: vatCollected,
    vatDeductibleCents: vatDeductible,
    vatPayableCents: vatPayable,
    isEstimate: true,
    disclaimer:
      "Ces calculs sont fournis à titre indicatif par HexaVO selon les règles configurées et ne remplacent pas l'avis d'un expert-comptable.",
  };
}

export function selectApplicableTaxRule(
  rules: TaxRuleConfig[],
  dateIso: string,
  regimeFiscal?: FiscalRegime
): TaxRuleConfig | null {
  const matching = rules.filter((r) => {
    const afterStart = !r.effective_from || dateIso >= r.effective_from;
    const beforeEnd = !r.effective_to || dateIso <= r.effective_to;
    const matchesRegime = !regimeFiscal || r.regime_fiscal === regimeFiscal;
    return afterStart && beforeEnd && matchesRegime;
  });

  if (matching.length === 0) return null;
  matching.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return matching[0];
}
