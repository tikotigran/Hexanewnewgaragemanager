export interface VehicleProfitabilityInput {
  purchasePriceCents: number;
  directExpensesCents: number;
  salePriceCents: number | null;
  plannedSalePriceCents: number | null;
  allocatedGeneralExpensesCents?: number;
}

export interface VehicleProfitabilityResult {
  totalInvestmentCents: number;
  directExpensesCents: number;
  revenueReferenceCents: number;
  isRealized: boolean;
  estimatedGrossMarginCents: number;
  estimatedMarginPct: number;
  netAfterGeneralAllocationCents: number;
}

/**
 * Pure vehicle profitability calculator in integer centimes.
 * Formula: Sale price (or planned price) - Purchase price - Direct vehicle expenses = Gross Margin.
 * General business overhead is tracked separately so vehicle economics remain accurate.
 */
export function calculateVehicleProfitability(
  input: VehicleProfitabilityInput
): VehicleProfitabilityResult {
  const purchase = Math.max(0, Math.round(input.purchasePriceCents));
  const directExpenses = Math.max(0, Math.round(input.directExpensesCents));
  const totalInvestmentCents = purchase + directExpenses;

  const isRealized = input.salePriceCents !== null && input.salePriceCents > 0;
  const revenueReferenceCents = isRealized
    ? Math.round(input.salePriceCents!)
    : Math.max(0, Math.round(input.plannedSalePriceCents ?? 0));

  const estimatedGrossMarginCents =
    revenueReferenceCents > 0 ? revenueReferenceCents - totalInvestmentCents : -totalInvestmentCents;

  const estimatedMarginPct =
    revenueReferenceCents > 0
      ? Math.round((estimatedGrossMarginCents / revenueReferenceCents) * 1000) / 10
      : 0;

  const generalAlloc = Math.max(0, Math.round(input.allocatedGeneralExpensesCents ?? 0));
  const netAfterGeneralAllocationCents = estimatedGrossMarginCents - generalAlloc;

  return {
    totalInvestmentCents,
    directExpensesCents: directExpenses,
    revenueReferenceCents,
    isRealized,
    estimatedGrossMarginCents,
    estimatedMarginPct,
    netAfterGeneralAllocationCents,
  };
}

export interface CashFlowTx {
  direction: 'inflow' | 'outflow';
  amount_cents: number;
  operation_date: string;
  payment_date: string | null;
  payment_status: string;
  category: string;
}

export interface CashFlowSummary {
  totalInflowsPaidCents: number;
  totalOutflowsPaidCents: number;
  netCashFlowCents: number;
  pendingInflowsCents: number;
  pendingOutflowsCents: number;
  monthlySeries: Array<{
    month: string;
    inflowsCents: number;
    outflowsCents: number;
    netCents: number;
  }>;
}

export function aggregateCashFlow(transactions: CashFlowTx[]): CashFlowSummary {
  let totalInflowsPaidCents = 0;
  let totalOutflowsPaidCents = 0;
  let pendingInflowsCents = 0;
  let pendingOutflowsCents = 0;

  const monthMap = new Map<string, { inflowsCents: number; outflowsCents: number }>();

  for (const tx of transactions) {
    const amount = Math.max(0, Math.round(tx.amount_cents));
    const dateStr = (tx.payment_date || tx.operation_date || '').slice(0, 7);

    if (tx.payment_status === 'paye') {
      if (tx.direction === 'inflow') {
        totalInflowsPaidCents += amount;
      } else {
        totalOutflowsPaidCents += amount;
      }

      if (dateStr) {
        const entry = monthMap.get(dateStr) || { inflowsCents: 0, outflowsCents: 0 };
        if (tx.direction === 'inflow') {
          entry.inflowsCents += amount;
        } else {
          entry.outflowsCents += amount;
        }
        monthMap.set(dateStr, entry);
      }
    } else {
      if (tx.direction === 'inflow') {
        pendingInflowsCents += amount;
      } else {
        pendingOutflowsCents += amount;
      }
    }
  }

  const monthlySeries = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      inflowsCents: data.inflowsCents,
      outflowsCents: data.outflowsCents,
      netCents: data.inflowsCents - data.outflowsCents,
    }));

  return {
    totalInflowsPaidCents,
    totalOutflowsPaidCents,
    netCashFlowCents: totalInflowsPaidCents - totalOutflowsPaidCents,
    pendingInflowsCents,
    pendingOutflowsCents,
    monthlySeries,
  };
}
