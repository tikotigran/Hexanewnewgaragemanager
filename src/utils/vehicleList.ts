import { eurosToCents } from '../lib/utils';
import type { ExpenseCategory, Vehicle, VehicleStatus } from '../types';

export interface InventoryTotals {
  count: number;
  totalPurchaseCents: number;
  totalExpensesCents: number;
  totalInvestedCents: number;
  totalPlannedPriceCents: number;
}

export interface QuickExpensePreset {
  id: string;
  categoryCode: string;
  labelKey: string;
  descriptionKey: string;
}

export const QUICK_EXPENSE_PRESETS: readonly QuickExpensePreset[] = [
  {
    id: 'ct',
    categoryCode: 'controle_technique',
    labelKey: 'quickExp.presetCt',
    descriptionKey: 'quickExp.descCt',
  },
  {
    id: 'tires',
    categoryCode: 'pieces',
    labelKey: 'quickExp.presetTires',
    descriptionKey: 'quickExp.descTires',
  },
  {
    id: 'parts_repair',
    categoryCode: 'reparation',
    labelKey: 'quickExp.presetRepair',
    descriptionKey: 'quickExp.descRepair',
  },
  {
    id: 'oil_filters',
    categoryCode: 'preparation',
    labelKey: 'quickExp.presetOil',
    descriptionKey: 'quickExp.descOil',
  },
];

export const INLINE_VEHICLE_STATUSES: readonly VehicleStatus[] = [
  'brouillon',
  'en_preparation',
  'en_reparation',
  'en_vente',
  'reserve',
  'vendu',
  'archive',
];

export function isVehicleFlagEnabled(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1;
}

export function calculateTotalInvestedCents(
  prixAchatCents: number | null | undefined,
  directExpensesCents: number | null | undefined
): number {
  const purchase = typeof prixAchatCents === 'number' && Number.isFinite(prixAchatCents) ? prixAchatCents : 0;
  const expenses =
    typeof directExpensesCents === 'number' && Number.isFinite(directExpensesCents) ? directExpensesCents : 0;
  return Math.max(0, purchase + expenses);
}

export function calculateInventoryTotals(
  vehicles: Array<Pick<Vehicle, 'prix_achat_cents' | 'direct_expenses_cents' | 'prix_vente_prevu_cents'>>
): InventoryTotals {
  return vehicles.reduce<InventoryTotals>(
    (acc, v) => {
      const purchase = v.prix_achat_cents || 0;
      const expenses = v.direct_expenses_cents || 0;
      const invested = calculateTotalInvestedCents(purchase, expenses);
      const planned = v.prix_vente_prevu_cents || 0;

      acc.count += 1;
      acc.totalPurchaseCents += purchase;
      acc.totalExpensesCents += expenses;
      acc.totalInvestedCents += invested;
      acc.totalPlannedPriceCents += planned;
      return acc;
    },
    {
      count: 0,
      totalPurchaseCents: 0,
      totalExpensesCents: 0,
      totalInvestedCents: 0,
      totalPlannedPriceCents: 0,
    }
  );
}

export function resolveExpenseCategoryId(
  categories: ExpenseCategory[],
  preferredCode: string
): string {
  const vehicleCats = categories.filter((c) => c.scope === 'vehicle');
  const match = vehicleCats.find((c) => c.code === preferredCode);
  if (match) return String(match.id);
  return vehicleCats[0] ? String(vehicleCats[0].id) : '';
}

export function validateQuickExpenseInput(params: {
  amountInput: string;
  categoryId: string;
}): { valid: boolean; amountCents: number; errorKey?: string } {
  const cleaned = params.amountInput.trim().replace(',', '.');
  const parsed = Number(cleaned);
  if (!cleaned || Number.isNaN(parsed) || parsed <= 0) {
    return { valid: false, amountCents: 0, errorKey: 'quickExp.amountRequired' };
  }
  const amountCents = eurosToCents(cleaned);
  if (amountCents <= 0) {
    return { valid: false, amountCents: 0, errorKey: 'quickExp.amountRequired' };
  }
  if (!params.categoryId || Number(params.categoryId) <= 0) {
    return { valid: false, amountCents: 0, errorKey: 'exp.requiredToast' };
  }
  return { valid: true, amountCents };
}

export type VehicleSortKey =
  | 'vehicle'
  | 'km'
  | 'status'
  | 'ct'
  | 'paperwork'
  | 'purchase'
  | 'expenses'
  | 'totalInvested';

export type SortDirection = 'asc' | 'desc';

export interface VehicleSortState {
  key: VehicleSortKey | null;
  direction: SortDirection;
}

export function getNextSortState(current: VehicleSortState, clickedKey: VehicleSortKey): VehicleSortState {
  if (current.key !== clickedKey) {
    return { key: clickedKey, direction: 'asc' };
  }
  if (current.direction === 'asc') {
    return { key: clickedKey, direction: 'desc' };
  }
  return { key: null, direction: 'asc' };
}

export function sortVehicles<T extends Pick<
  Vehicle,
  | 'id'
  | 'marque'
  | 'modele'
  | 'kilometrage'
  | 'status'
  | 'ct_ok'
  | 'paperwork_done'
  | 'prix_achat_cents'
  | 'direct_expenses_cents'
>>(vehicles: T[], sort: VehicleSortState): T[] {
  if (!sort.key) return vehicles;
  const factor = sort.direction === 'asc' ? 1 : -1;
  const key = sort.key;

  return [...vehicles].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'vehicle':
        cmp = `${a.marque} ${a.modele}`.localeCompare(`${b.marque} ${b.modele}`, undefined, {
          sensitivity: 'base',
        });
        break;
      case 'km':
        cmp = (a.kilometrage ?? -1) - (b.kilometrage ?? -1);
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'ct':
        cmp = Number(isVehicleFlagEnabled(a.ct_ok)) - Number(isVehicleFlagEnabled(b.ct_ok));
        break;
      case 'paperwork':
        cmp = Number(isVehicleFlagEnabled(a.paperwork_done)) - Number(isVehicleFlagEnabled(b.paperwork_done));
        break;
      case 'purchase':
        cmp = (a.prix_achat_cents || 0) - (b.prix_achat_cents || 0);
        break;
      case 'expenses':
        cmp = (a.direct_expenses_cents || 0) - (b.direct_expenses_cents || 0);
        break;
      case 'totalInvested':
        cmp =
          calculateTotalInvestedCents(a.prix_achat_cents, a.direct_expenses_cents) -
          calculateTotalInvestedCents(b.prix_achat_cents, b.direct_expenses_cents);
        break;
    }
    if (cmp !== 0) return cmp * factor;
    return (a.id - b.id) * factor;
  });
}
