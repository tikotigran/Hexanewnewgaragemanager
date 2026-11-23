import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCashFlow, calculateVehicleProfitability } from './financeService';

test('Vehicle profitability separates direct vehicle expenses from general overhead', () => {
  const res = calculateVehicleProfitability({
    purchasePriceCents: 1500000, // 15,000 EUR
    directExpensesCents: 120000, // 1,200 EUR
    salePriceCents: 1950000, // 19,500 EUR
    plannedSalePriceCents: 2000000,
    allocatedGeneralExpensesCents: 30000, // 300 EUR overhead
  });

  assert.equal(res.totalInvestmentCents, 1620000);
  assert.equal(res.isRealized, true);
  assert.equal(res.estimatedGrossMarginCents, 330000); // 3,300 EUR
  assert.equal(res.netAfterGeneralAllocationCents, 300000); // 3,000 EUR
});

test('Cash Flow aggregation separates paid inflows/outflows from pending amounts', () => {
  const cf = aggregateCashFlow([
    {
      direction: 'outflow',
      amount_cents: 1000000,
      operation_date: '2026-09-01',
      payment_date: '2026-09-01',
      payment_status: 'paye',
      category: 'achat_vehicule',
    },
    {
      direction: 'inflow',
      amount_cents: 1250000,
      operation_date: '2026-09-15',
      payment_date: '2026-09-16',
      payment_status: 'paye',
      category: 'vente_vehicule',
    },
    {
      direction: 'inflow',
      amount_cents: 500000,
      operation_date: '2026-09-20',
      payment_date: null,
      payment_status: 'a_payer',
      category: 'vente_vehicule',
    },
  ]);

  assert.equal(cf.totalInflowsPaidCents, 1250000);
  assert.equal(cf.totalOutflowsPaidCents, 1000000);
  assert.equal(cf.netCashFlowCents, 250000);
  assert.equal(cf.pendingInflowsCents, 500000);
  assert.equal(cf.monthlySeries.length, 1);
  assert.equal(cf.monthlySeries[0].month, '2026-09');
});
