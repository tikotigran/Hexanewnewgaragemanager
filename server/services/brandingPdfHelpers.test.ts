import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExpensesCsv,
  formatFullAddress,
  formatSalesCsv,
  hexToRgbTuple,
  isValidHexColor,
  parseImageDataUrl,
  resolvePdfBrandingFromSettings,
  sanitizeCsvCell,
} from './brandingPdfHelpers';
import { generateCerfaPreparationPdf, generateInvoicePdf } from './pdfService';

// Minimal 1x1 transparent PNG base64
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('hexToRgbTuple parses valid hex colors and falls back safely', () => {
  assert.deepEqual(hexToRgbTuple('#FF0000'), [1, 0, 0]);
  assert.deepEqual(hexToRgbTuple('#2563EB'), [0.145, 0.388, 0.922]);
  assert.deepEqual(hexToRgbTuple('invalid', [0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
  assert.equal(isValidHexColor('#1a2b3c'), true);
  assert.equal(isValidHexColor('#12345'), false);
});

test('parseImageDataUrl validates png/jpeg data URLs and rejects invalid formats', () => {
  const parsed = parseImageDataUrl(TINY_PNG_DATA_URL);
  assert.ok(parsed);
  assert.equal(parsed.mime, 'image/png');
  assert.ok(parsed.bytes.length > 10);

  assert.equal(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(parseImageDataUrl('https://evil.example/logo.png'), null);
  assert.equal(parseImageDataUrl(''), null);
});

test('formatFullAddress omits empty fields cleanly', () => {
  assert.equal(
    formatFullAddress({
      address: '12 Rue de la Paix',
      postalCode: '75002',
      city: 'Paris',
      country: 'France',
    }),
    '12 Rue de la Paix, 75002 Paris, France'
  );
  assert.equal(
    formatFullAddress({ address: '4 Avenue Victor Hugo', city: 'Lyon' }),
    '4 Avenue Victor Hugo, Lyon'
  );
  assert.equal(formatFullAddress({}), '');
});

test('sanitizeCsvCell prevents formula injection while preserving negative numbers', () => {
  assert.equal(sanitizeCsvCell('=CMD()'), `"'=CMD()"`);
  assert.equal(sanitizeCsvCell('+SUM(A1)'), `"'+SUM(A1)"`);
  assert.equal(sanitizeCsvCell('-125.50'), `"-125.50"`);
  assert.equal(sanitizeCsvCell('Garage "Auto"'), '"Garage ""Auto"""');
});

test('formatSalesCsv and formatExpensesCsv produce UTF-8 BOM semicolon CSV', () => {
  const salesCsv = formatSalesCsv([
    {
      sale_date: '2026-04-01',
      invoice_number: 'FAC-2026-0001',
      marque: 'Renault',
      modele: 'Clio',
      immatriculation: 'AA-123-BB',
      buyer_name: 'Jean Dupont',
      legal_context: 'professional',
      sales_channel: 'leboncoin',
      amount_ht_cents: 1200000,
      vat_cents: 0,
      amount_ttc_cents: 1200000,
      payment_status: 'paye',
      payment_method: 'virement',
    },
  ]);
  assert.ok(salesCsv.startsWith('\uFEFF'));
  assert.ok(salesCsv.includes('FAC-2026-0001'));
  assert.ok(salesCsv.includes('12000.00'));

  const expCsv = formatExpensesCsv([
    {
      operation_date: '2026-04-02',
      scope: 'vehicle',
      category_label: 'Entretien',
      supplier_name: 'Norauto',
      vehicle_label: 'Peugeot 208',
      amount_ht_cents: 10000,
      vat_cents: 2000,
      amount_ttc_cents: 12000,
      payment_status: 'paye',
      payment_method: 'carte',
      notes: 'Vidange',
    },
  ]);
  assert.ok(expCsv.startsWith('\uFEFF'));
  assert.ok(expCsv.includes('Norauto'));
  assert.ok(expCsv.includes('120.00'));
});

test('resolvePdfBrandingFromSettings respects personal-only legal isolation', () => {
  const settings = {
    company_settings: { companyName: 'Garage Prestige' },
    branding_settings: {
      logoDataUrl: TINY_PNG_DATA_URL,
      primaryColor: '#10B981',
      secondaryColor: '#0F172A',
      signatureDataUrl: TINY_PNG_DATA_URL,
    },
  };

  const proBranding = resolvePdfBrandingFromSettings(settings);
  assert.equal(proBranding.companyName, 'Garage Prestige');
  assert.equal(proBranding.primaryColor, '#10B981');
  assert.equal(proBranding.logoDataUrl, TINY_PNG_DATA_URL);
  assert.equal(proBranding.signatureDataUrl, TINY_PNG_DATA_URL);

  const personalBranding = resolvePdfBrandingFromSettings(settings, { isPersonalOnly: true });
  assert.equal(personalBranding.logoDataUrl, undefined);
  assert.equal(personalBranding.companyName, undefined);
  assert.equal(personalBranding.signatureDataUrl, TINY_PNG_DATA_URL);
});

test('pdfService embeds PNG logo, hex colors, and signature PNG without error', async () => {
  const branding = {
    companyName: 'Garage Prestige',
    logoDataUrl: TINY_PNG_DATA_URL,
    primaryColor: '#10B981',
    secondaryColor: '#0F172A',
    signatureDataUrl: TINY_PNG_DATA_URL,
  };

  const invoicePdf = await generateInvoicePdf({
    invoiceNumber: 'FAC-TEST-001',
    issueDate: '2026-04-01',
    dueDate: '2026-04-15',
    seller: { title: 'VENDEUR', name: 'Garage Prestige' },
    buyer: { title: 'CLIENT', name: 'Jean Test' },
    lines: [{ description: 'Renault Clio', quantity: 1, unitPriceHtCents: 1000000, vatRateBps: 0, totalTtcCents: 1000000 }],
    subtotalHtCents: 1000000,
    vatCents: 0,
    totalTtcCents: 1000000,
    paidCents: 0,
    showVatBreakdown: false,
    vatLegalMention: 'TVA non applicable',
    paymentTerms: 'Comptant',
    branding,
  });
  assert.ok(invoicePdf.length > 1000);

  const cerfaPdf = await generateCerfaPreparationPdf({
    sellerName: 'Garage Prestige',
    sellerIsPro: true,
    sellerSiret: '12345678900012',
    sellerAddress: '12 Rue de Paris, 75001 Paris',
    buyerName: 'Jean Test',
    buyerIsPro: false,
    buyerAddress: '5 Avenue Victor Hugo',
    immatriculation: 'AA-123-BB',
    vin: 'VF1TEST0000000001',
    marque: 'Renault',
    modele: 'Clio',
    dateMiseEnCirculation: '01/01/2020',
    kilometrage: '50000',
    genreNational: 'VP',
    dateCession: '2026-04-01',
    heureCession: '14:00',
    prixCessionCents: 1000000,
    branding,
  });
  assert.ok(cerfaPdf.length > 1000);
});

