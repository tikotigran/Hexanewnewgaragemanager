import { eurosToCents } from '../lib/utils';
import type { LegalContext, VehicleStatus } from '../types';

export const MAX_PHOTO_SIZE_BYTES = 1024 * 1024; // 1 MB limit
export const ALLOWED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const SUPPLIER_PRESET_OPTIONS = [
  { code: 'particulier', labelKey: 'vehNew.sourceParticulier' },
  { code: 'concession', labelKey: 'vehNew.sourceConcession' },
  { code: 'encheres', labelKey: 'vehNew.sourceEncheres' },
  { code: 'leasing', labelKey: 'vehNew.sourceLeasing' },
  { code: 'import_ue', labelKey: 'vehNew.sourceImport' },
] as const;

export const INTAKE_STATUS_OPTIONS: VehicleStatus[] = [
  'en_preparation',
  'brouillon',
  'en_reparation',
  'en_vente',
  'reserve',
];

export interface VehicleIntakeInput {
  marque: string;
  modele: string;
  annee: string;
  immatriculation: string;
  prixAchat: string;
  prixVentePrevu: string;
  dateAchat: string;
  kilometrage: string;
  legalContext: LegalContext;
  businessProfileId: string;
}

export interface VehicleIntakeValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof VehicleIntakeInput, string>>;
}

export function validateVehicleIntake(input: VehicleIntakeInput): VehicleIntakeValidationResult {
  const errors: Partial<Record<keyof VehicleIntakeInput, string>> = {};

  if (!input.marque.trim()) {
    errors.marque = 'vehNew.errRequired';
  }
  if (!input.modele.trim()) {
    errors.modele = 'vehNew.errRequired';
  }

  const yearStr = input.annee.trim();
  const yearNum = Number(yearStr);
  if (!yearStr || !Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2035) {
    errors.annee = !yearStr ? 'vehNew.errRequired' : 'vehNew.errYear';
  }

  if (!input.immatriculation.trim()) {
    errors.immatriculation = 'vehNew.errRequired';
  }

  const purchaseStr = input.prixAchat.trim().replace(',', '.');
  const purchaseNum = Number(purchaseStr);
  if (!purchaseStr || Number.isNaN(purchaseNum) || purchaseNum < 0) {
    errors.prixAchat = !purchaseStr ? 'vehNew.errRequired' : 'vehNew.errPrice';
  }

  if (input.prixVentePrevu.trim()) {
    const targetNum = Number(input.prixVentePrevu.trim().replace(',', '.'));
    if (Number.isNaN(targetNum) || targetNum < 0) {
      errors.prixVentePrevu = 'vehNew.errPrice';
    }
  }

  if (!input.dateAchat.trim()) {
    errors.dateAchat = 'vehNew.errRequired';
  }

  if (input.kilometrage.trim()) {
    const kmNum = Number(input.kilometrage.trim());
    if (!Number.isInteger(kmNum) || kmNum < 0 || kmNum > 2_000_000) {
      errors.kilometrage = 'vehNew.errMileage';
    }
  }

  if (input.legalContext === 'professional' && !input.businessProfileId.trim()) {
    errors.businessProfileId = 'vehForm.proRequiredToast';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface IntakeMarginPreview {
  purchaseCents: number;
  targetCents: number | null;
  marginCents: number | null;
  marginPct: number | null;
}

export function calculateIntakeMarginPreview(
  prixAchat: string,
  prixVentePrevu: string
): IntakeMarginPreview {
  const purchaseCents = prixAchat.trim() ? eurosToCents(prixAchat) : 0;
  if (!prixVentePrevu.trim()) {
    return {
      purchaseCents,
      targetCents: null,
      marginCents: null,
      marginPct: null,
    };
  }
  const targetCents = eurosToCents(prixVentePrevu);
  const marginCents = targetCents - purchaseCents;
  const marginPct =
    purchaseCents > 0 ? Math.round((marginCents / purchaseCents) * 1000) / 10 : null;

  return {
    purchaseCents,
    targetCents,
    marginCents,
    marginPct,
  };
}

export function validateVehiclePhotoFile(file: {
  type: string;
  size: number;
}): { valid: boolean; reason?: 'invalid_type' | 'too_large' } {
  if (!ALLOWED_PHOTO_MIME_TYPES.has(file.type)) {
    return { valid: false, reason: 'invalid_type' };
  }
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    return { valid: false, reason: 'too_large' };
  }
  return { valid: true };
}

export function resolveSupplierSource(params: {
  sourceSelect: string;
  presetLabels: Record<string, string>;
  contactLabels: Record<string, string>;
  customSupplier: string;
}): string {
  const { sourceSelect, presetLabels, contactLabels, customSupplier } = params;
  if (!sourceSelect || sourceSelect === 'none') return '';
  if (sourceSelect === 'custom') return customSupplier.trim();
  if (sourceSelect.startsWith('preset:')) {
    const code = sourceSelect.slice('preset:'.length);
    return (presetLabels[code] || code).trim();
  }
  if (sourceSelect.startsWith('contact:')) {
    const id = sourceSelect.slice('contact:'.length);
    return (contactLabels[id] || '').trim();
  }
  return customSupplier.trim();
}
