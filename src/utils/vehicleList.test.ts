import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_EXPENSE_PRESETS,
  calculateInventoryTotals,
  calculateTotalInvestedCents,
  getNextSortState,
  isVehicleFlagEnabled,
  resolveExpenseCategoryId,
  sortVehicles,
  validateQuickExpenseInput,
} from './vehicleList';
import type { ExpenseCategory } from '../types';

test('isVehicleFlagEnabled handles SQLite integers, booleans, and nullish values', () => {
  assert.equal(isVehicleFlagEnabled(1), true);
  assert.equal(isVehicleFlagEnabled(true), true);
  assert.equal(isVehicleFlagEnabled(0), false);
  assert.equal(isVehicleFlagEnabled(false), false);
  assert.equal(isVehicleFlagEnabled(null), false);
  assert.equal(isVehicleFlagEnabled(undefined), false);
});

test('calculateTotalInvestedCents sums purchase price and direct expenses safely', () => {
  assert.equal(calculateTotalInvestedCents(1940000, 28800), 1968800);
  assert.equal(calculateTotalInvestedCents(2120000, undefined), 2120000);
  assert.equal(calculateTotalInvestedCents(0, 5000), 5000);
});

test('calculateInventoryTotals aggregates purchase, expenses, total invested, and target prices', () => {
  const totals = calculateInventoryTotals([
    { prix_achat_cents: 1940000, direct_expenses_cents: 28800, prix_vente_prevu_cents: 2390000 },
    { prix_achat_cents: 2120000, direct_expenses_cents: 7800, prix_vente_prevu_cents: null },
  ]);

  assert.equal(totals.count, 2);
  assert.equal(totals.totalPurchaseCents, 4060000);
  assert.equal(totals.totalExpensesCents, 36600);
  assert.equal(totals.totalInvestedCents, 4096600);
  assert.equal(totals.totalPlannedPriceCents, 2390000);
});

test('resolveExpenseCategoryId finds vehicle-scoped category and falls back cleanly', () => {
  const categories: ExpenseCategory[] = [
    { id: 10, scope: 'business', code: 'loyer', label_fr: 'Loyer', label_ru: 'Аренда', label_en: 'Rent' },
    { id: 1, scope: 'vehicle', code: 'reparation', label_fr: 'Réparation', label_ru: 'Ремонт', label_en: 'Repair' },
    { id: 7, scope: 'vehicle', code: 'controle_technique', label_fr: 'CT', label_ru: 'Техосмотр', label_en: 'CT' },
  ];

  assert.equal(resolveExpenseCategoryId(categories, 'controle_technique'), '7');
  assert.equal(resolveExpenseCategoryId(categories, 'unknown_code'), '1');
  assert.equal(QUICK_EXPENSE_PRESETS.length, 4);
});

test('validateQuickExpenseInput enforces positive amounts and valid category IDs', () => {
  assert.deepEqual(validateQuickExpenseInput({ amountInput: '120.50', categoryId: '7' }), {
    valid: true,
    amountCents: 12050,
  });
  assert.deepEqual(validateQuickExpenseInput({ amountInput: '78,5', categoryId: '2' }), {
    valid: true,
    amountCents: 7850,
  });

  const zeroRes = validateQuickExpenseInput({ amountInput: '0', categoryId: '7' });
  assert.equal(zeroRes.valid, false);
  assert.equal(zeroRes.errorKey, 'quickExp.amountRequired');

  const noCatRes = validateQuickExpenseInput({ amountInput: '50', categoryId: '' });
  assert.equal(noCatRes.valid, false);
  assert.equal(noCatRes.errorKey, 'exp.requiredToast');
});

test('getNextSortState cycles asc -> desc -> null and sortVehicles orders rows accurately', () => {
  let state = getNextSortState({ key: null, direction: 'asc' }, 'totalInvested');
  assert.deepEqual(state, { key: 'totalInvested', direction: 'asc' });

  state = getNextSortState(state, 'totalInvested');
  assert.deepEqual(state, { key: 'totalInvested', direction: 'desc' });

  state = getNextSortState(state, 'totalInvested');
  assert.deepEqual(state, { key: null, direction: 'asc' });

  const sample = [
    {
      id: 1,
      marque: 'Volkswagen',
      modele: 'Golf',
      kilometrage: 34900,
      status: 'en_preparation' as const,
      ct_ok: 0,
      paperwork_done: 0,
      prix_achat_cents: 2120000,
      direct_expenses_cents: 7800,
    },
    {
      id: 2,
      marque: 'Peugeot',
      modele: '3008',
      kilometrage: 48500,
      status: 'en_vente' as const,
      ct_ok: 1,
      paperwork_done: 1,
      prix_achat_cents: 1940000,
      direct_expenses_cents: 28800,
    },
  ];

  const byTotalDesc = sortVehicles(sample, { key: 'totalInvested', direction: 'desc' });
  assert.deepEqual(
    byTotalDesc.map((v) => v.id),
    [1, 2]
  );

  const byVehicleAsc = sortVehicles(sample, { key: 'vehicle', direction: 'asc' });
  assert.deepEqual(
    byVehicleAsc.map((v) => v.id),
    [2, 1]
  );

  const byCtDesc = sortVehicles(sample, { key: 'ct', direction: 'desc' });
  assert.deepEqual(
    byCtDesc.map((v) => v.id),
    [2, 1]
  );
});
