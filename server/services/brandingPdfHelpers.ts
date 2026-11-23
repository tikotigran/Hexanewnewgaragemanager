export interface CompanySettingsData {
  companyName: string;
  siret: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  vatNumber: string;
  iban: string;
}

export interface BrandingSettingsData {
  logoDataUrl: string;
  primaryColor: string;
  secondaryColor: string;
  signatureDataUrl: string;
}

export interface AccountingSettingsData {
  accountantEmail: string;
}

export interface PdfBrandingConfig {
  logoDataUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  signatureDataUrl?: string;
  companyName?: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = 1_500_000; // 1.5 MB decoded safety cap

export const DEFAULT_COMPANY_SETTINGS: CompanySettingsData = {
  companyName: '',
  siret: '',
  address: '',
  postalCode: '',
  city: '',
  country: 'France',
  phone: '',
  email: '',
  vatNumber: '',
  iban: '',
};

export const DEFAULT_BRANDING_SETTINGS: BrandingSettingsData = {
  logoDataUrl: '',
  primaryColor: '#2563EB',
  secondaryColor: '#151922',
  signatureDataUrl: '',
};

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettingsData = {
  accountantEmail: '',
};

export function isValidHexColor(hex: string | undefined | null): boolean {
  return Boolean(hex && HEX_COLOR_RE.test(hex.trim()));
}

export function hexToRgbTuple(
  hex: string | undefined | null,
  fallback: [number, number, number] = [0.145, 0.388, 0.922]
): [number, number, number] {
  if (!hex || !HEX_COLOR_RE.test(hex.trim())) {
    return fallback;
  }
  const clean = hex.trim().slice(1);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [
    Math.round(r * 1000) / 1000,
    Math.round(g * 1000) / 1000,
    Math.round(b * 1000) / 1000,
  ];
}

export function parseImageDataUrl(
  dataUrl: string | undefined | null
): { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  const match = IMAGE_DATA_URL_RE.exec(trimmed);
  if (!match) return null;

  const subtype = match[1].toLowerCase();
  const b64 = match[2];
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    return null;
  }
  return {
    mime: subtype === 'png' ? 'image/png' : 'image/jpeg',
    bytes: new Uint8Array(buf),
  };
}

export function isValidImageDataUrlOrEmpty(val: unknown): val is string {
  if (val === '' || val === undefined || val === null) return true;
  if (typeof val !== 'string') return false;
  return parseImageDataUrl(val) !== null;
}

export function formatFullAddress(parts: {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}): string {
  const street = (parts.address || '').trim();
  const cpCity = [parts.postalCode?.trim(), parts.city?.trim()].filter(Boolean).join(' ');
  const country = (parts.country || '').trim();
  return [street, cpCity, country].filter(Boolean).join(', ');
}

export function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let str = String(value).replace(/\r?\n/g, ' ');
  // Neutralize spreadsheet formula injection characters (=, +, @, tab, or non-numeric '-')
  if (/^[=+@\t]/.test(str) || (/^-/.test(str) && !/^-\d+(\.\d+)?$/.test(str.trim()))) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export interface SalesCsvRow {
  sale_date: string;
  invoice_number: string | null;
  marque: string | null;
  modele: string | null;
  immatriculation: string | null;
  buyer_name: string | null;
  legal_context: string;
  sales_channel: string | null;
  amount_ht_cents: number;
  vat_cents: number;
  amount_ttc_cents: number;
  payment_status: string;
  payment_method: string;
}

export interface ExpenseCsvRow {
  operation_date: string;
  scope: string;
  category_label: string | null;
  supplier_name: string | null;
  vehicle_label: string | null;
  amount_ht_cents: number;
  vat_cents: number;
  amount_ttc_cents: number;
  payment_status: string;
  payment_method: string;
  notes: string | null;
}

function centsToCsvAmount(cents: number): string {
  return (Number(cents || 0) / 100).toFixed(2);
}

export function formatSalesCsv(rows: SalesCsvRow[]): string {
  const headers = [
    'Date',
    'Facture / Ref',
    'Vehicule',
    'Immatriculation',
    'Acheteur',
    'Contexte',
    'Canal',
    'Montant HT (EUR)',
    'TVA (EUR)',
    'Montant TTC (EUR)',
    'Mode paiement',
    'Statut paiement',
  ];
  const lines = [headers.map(sanitizeCsvCell).join(';')];
  for (const r of rows) {
    const veh = [r.marque, r.modele].filter(Boolean).join(' ').trim() || '-';
    lines.push(
      [
        r.sale_date,
        r.invoice_number || '-',
        veh,
        r.immatriculation || '-',
        r.buyer_name || '-',
        r.legal_context,
        r.sales_channel || 'direct',
        centsToCsvAmount(r.amount_ht_cents),
        centsToCsvAmount(r.vat_cents),
        centsToCsvAmount(r.amount_ttc_cents),
        r.payment_method,
        r.payment_status,
      ]
        .map(sanitizeCsvCell)
        .join(';')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function formatExpensesCsv(rows: ExpenseCsvRow[]): string {
  const headers = [
    'Date',
    'Portee',
    'Categorie',
    'Fournisseur',
    'Vehicule',
    'Montant HT (EUR)',
    'TVA (EUR)',
    'Montant TTC (EUR)',
    'Mode paiement',
    'Statut paiement',
    'Notes',
  ];
  const lines = [headers.map(sanitizeCsvCell).join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.operation_date,
        r.scope,
        r.category_label || '-',
        r.supplier_name || '-',
        r.vehicle_label || '-',
        centsToCsvAmount(r.amount_ht_cents),
        centsToCsvAmount(r.vat_cents),
        centsToCsvAmount(r.amount_ttc_cents),
        r.payment_method,
        r.payment_status,
        r.notes || '',
      ]
        .map(sanitizeCsvCell)
        .join(';')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function resolvePdfBrandingFromSettings(
  settings: Record<string, unknown>,
  options?: { isPersonalOnly?: boolean; fallbackCompanyName?: string }
): PdfBrandingConfig {
  const company = (settings.company_settings || {}) as Partial<CompanySettingsData>;
  const branding = (settings.branding_settings || {}) as Partial<BrandingSettingsData>;

  if (options?.isPersonalOnly) {
    return {
      signatureDataUrl: typeof branding.signatureDataUrl === 'string' ? branding.signatureDataUrl : undefined,
      primaryColor: '#2563EB',
      secondaryColor: '#151922',
    };
  }

  return {
    logoDataUrl: typeof branding.logoDataUrl === 'string' ? branding.logoDataUrl : undefined,
    primaryColor: isValidHexColor(branding.primaryColor) ? branding.primaryColor : '#2563EB',
    secondaryColor: isValidHexColor(branding.secondaryColor) ? branding.secondaryColor : '#151922',
    signatureDataUrl: typeof branding.signatureDataUrl === 'string' ? branding.signatureDataUrl : undefined,
    companyName: (company.companyName || options?.fallbackCompanyName || 'HexaVO').trim(),
  };
}
