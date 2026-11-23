import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFacturXXml, validateFacturXXml } from './facturxService';
import { generateCerfaPreparationPdf, generateInvoicePdf } from './pdfService';

test('Factur-X XML generation passes structural validation', () => {
  const xml = generateFacturXXml({
    invoiceNumber: 'FAC-2026-0099',
    issueDate: '2026-11-20',
    dueDate: '2026-12-20',
    currency: 'EUR',
    profile: 'BASIC',
    seller: { name: 'Moreau Auto Sélection', siret: '89452130400018', address: 'Pantin' },
    buyer: { name: 'Camille Laurent', address: 'Lyon' },
    lines: [
      {
        description: 'Peugeot 3008 Allure Pack',
        quantity: 1,
        unitPriceHtCents: 2390000,
        vatRateBps: 0,
        vatCents: 0,
        totalTtcCents: 2390000,
      },
    ],
    subtotalHtCents: 2390000,
    vatCents: 0,
    totalTtcCents: 2390000,
    vatLegalMention: 'TVA non applicable, art. 293 B du CGI',
  });

  const validation = validateFacturXXml(xml);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.match(xml, /FAC-2026-0099/);
});

test('PDF engine produces valid PDF bytes for Invoice (with Factur-X XML) and Cerfa 15776*02 prep', async () => {
  const invPdf = await generateInvoicePdf({
    invoiceNumber: 'FAC-2026-0099',
    issueDate: '2026-11-20',
    dueDate: '2026-12-20',
    seller: { title: 'VENDEUR', name: 'Moreau Auto', siret: '89452130400018' },
    buyer: { title: 'CLIENT', name: 'Camille Laurent' },
    lines: [
      {
        description: 'Peugeot 3008',
        quantity: 1,
        unitPriceHtCents: 2390000,
        vatRateBps: 0,
        totalTtcCents: 2390000,
      },
    ],
    subtotalHtCents: 2390000,
    vatCents: 0,
    totalTtcCents: 2390000,
    paidCents: 0,
    showVatBreakdown: false,
    vatLegalMention: 'TVA non applicable, art. 293 B du CGI',
    paymentTerms: 'Virement',
    facturxXml: '<rsm:CrossIndustryInvoice/>',
  });

  const header = Buffer.from(invPdf.slice(0, 5)).toString('ascii');
  assert.equal(header, '%PDF-');

  const cerfaPdf = await generateCerfaPreparationPdf({
    sellerName: 'Jean-Luc Moreau',
    sellerIsPro: false,
    sellerAddress: '18 Rue de la République, Paris',
    buyerName: 'Thomas Bernard',
    buyerIsPro: false,
    buyerAddress: '5 Place Bellecour, Lyon',
    immatriculation: 'GE-729-MN',
    vin: 'VR3FPHNSJMY502193',
    marque: 'Peugeot',
    modele: '308 GT',
    dateMiseEnCirculation: '10/03/2021',
    kilometrage: '39200',
    genreNational: 'VP',
    dateCession: '2026-11-20',
    heureCession: '15:00',
    prixCessionCents: 2090000,
  });

  assert.equal(Buffer.from(cerfaPdf.slice(0, 5)).toString('ascii'), '%PDF-');
});
