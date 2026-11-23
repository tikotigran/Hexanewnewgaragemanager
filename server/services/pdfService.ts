import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  hexToRgbTuple,
  parseImageDataUrl,
  type PdfBrandingConfig,
} from './brandingPdfHelpers';

export type { PdfBrandingConfig };

function sanitizeWinAnsi(input: string): string {
  // pdf-lib StandardFonts (Helvetica) use WinAnsi encoding.
  // Normalize characters outside WinAnsi safely while keeping French/accented chars intact.
  return (input || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');
}

function formatEuroFr(cents: number): string {
  const val = (cents / 100).toFixed(2).replace('.', ',');
  return `${val} EUR`;
}

export interface PdfPartyBlock {
  title: string;
  name: string;
  subtitle?: string;
  address?: string;
  siret?: string;
  vatNumber?: string;
  email?: string;
  phone?: string;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  seller: PdfPartyBlock;
  buyer: PdfPartyBlock;
  vehicleSummary?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceHtCents: number;
    vatRateBps: number;
    totalTtcCents: number;
  }>;
  subtotalHtCents: number;
  vatCents: number;
  totalTtcCents: number;
  paidCents: number;
  showVatBreakdown: boolean;
  vatLegalMention: string;
  paymentTerms: string;
  facturxXml?: string;
  branding?: PdfBrandingConfig;
}

async function embedOptionalImage(
  pdfDoc: PDFDocument,
  dataUrl: string | undefined
): Promise<PDFImage | null> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;
  try {
    if (parsed.mime === 'image/png') {
      return await pdfDoc.embedPng(parsed.bytes);
    }
    return await pdfDoc.embedJpg(parsed.bytes);
  } catch {
    return null;
  }
}

function drawHeaderAndFooter(
  _doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  boldFont: PDFFont,
  title: string,
  docNumber: string,
  pageIndex: number,
  totalPages: number,
  branding?: PdfBrandingConfig,
  logoImage?: PDFImage | null
) {
  const { width, height } = page.getSize();
  const [pr, pg, pb] = hexToRgbTuple(branding?.primaryColor, [0.145, 0.388, 0.922]);
  const [sr, sg, sb] = hexToRgbTuple(branding?.secondaryColor, [0.08, 0.1, 0.13]);
  const primaryRgb = rgb(pr, pg, pb);
  const secondaryRgb = rgb(sr, sg, sb);
  const brandLabel = sanitizeWinAnsi(branding?.companyName?.trim() || 'HexaVO').slice(0, 34);

  // Header brand mark / logo
  if (logoImage) {
    const dims = logoImage.scaleToFit(76, 28);
    page.drawImage(logoImage, {
      x: 40,
      y: height - 58 + (28 - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    });
    page.drawText(brandLabel, {
      x: 40 + dims.width + 10,
      y: height - 48,
      size: 13.5,
      font: boldFont,
      color: secondaryRgb,
    });
  } else {
    page.drawRectangle({ x: 40, y: height - 56, width: 22, height: 22, color: primaryRgb });
    page.drawText(brandLabel, {
      x: 70,
      y: height - 50,
      size: 15,
      font: boldFont,
      color: secondaryRgb,
    });
  }

  // Subtle top accent line under header brand
  page.drawLine({
    start: { x: 40, y: height - 64 },
    end: { x: width - 40, y: height - 64 },
    thickness: 1.5,
    color: primaryRgb,
  });

  page.drawText(sanitizeWinAnsi(title), {
    x: 40,
    y: height - 88,
    size: 17,
    font: boldFont,
    color: secondaryRgb,
  });
  page.drawText(sanitizeWinAnsi(docNumber), {
    x: width - 200,
    y: height - 48,
    size: 11,
    font: boldFont,
    color: primaryRgb,
  });

  // Footer with page numbering
  page.drawLine({
    start: { x: 40, y: 45 },
    end: { x: width - 40, y: 45 },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  page.drawText(
    sanitizeWinAnsi(`Document généré par ${brandLabel} · Page ${pageIndex + 1} / ${totalPages}`),
    { x: 40, y: 28, size: 8.5, font, color: rgb(0.48, 0.51, 0.56) }
  );
}

export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Facture ${input.invoiceNumber}`);
  pdfDoc.setCreator('HexaVO Automotive Platform');
  pdfDoc.setProducer('HexaVO PDF Engine (pdf-lib)');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await embedOptionalImage(pdfDoc, input.branding?.logoDataUrl);
  const signatureImage = await embedOptionalImage(pdfDoc, input.branding?.signatureDataUrl);
  const [pr, pg, pb] = hexToRgbTuple(input.branding?.primaryColor, [0.145, 0.388, 0.922]);
  const primaryRgb = rgb(pr, pg, pb);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  // Dates top-right
  page.drawText(sanitizeWinAnsi(`Date d'émission : ${input.issueDate}`), {
    x: width - 200,
    y: height - 68,
    size: 9.5,
    font,
    color: rgb(0.35, 0.38, 0.43),
  });
  page.drawText(sanitizeWinAnsi(`Échéance : ${input.dueDate}`), {
    x: width - 200,
    y: height - 82,
    size: 9.5,
    font,
    color: rgb(0.35, 0.38, 0.43),
  });

  // Seller & Buyer boxes
  const drawParty = (party: PdfPartyBlock, x: number, topY: number) => {
    page.drawRectangle({
      x,
      y: topY - 105,
      width: 245,
      height: 105,
      borderColor: rgb(0.9, 0.92, 0.94),
      borderWidth: 1,
      color: rgb(0.985, 0.988, 0.992),
    });
    let y = topY - 18;
    page.drawText(sanitizeWinAnsi(party.title), {
      x: x + 12,
      y,
      size: 8.5,
      font: boldFont,
      color: rgb(0.48, 0.51, 0.56),
    });
    y -= 16;
    page.drawText(sanitizeWinAnsi(party.name), {
      x: x + 12,
      y,
      size: 10.5,
      font: boldFont,
      color: rgb(0.08, 0.1, 0.13),
    });
    const extras = [
      party.subtitle,
      party.address,
      party.siret ? `SIRET : ${party.siret}` : '',
      party.vatNumber ? `TVA : ${party.vatNumber}` : '',
      party.phone ? `Tél : ${party.phone}` : '',
      party.email,
    ].filter(Boolean) as string[];
    for (const line of extras.slice(0, 4)) {
      y -= 13;
      page.drawText(sanitizeWinAnsi(line.slice(0, 46)), {
        x: x + 12,
        y,
        size: 8.5,
        font,
        color: rgb(0.3, 0.33, 0.38),
      });
    }
  };

  drawParty(input.seller, 40, height - 115);
  drawParty(input.buyer, 310, height - 115);

  let cursorY = height - 245;

  if (input.vehicleSummary) {
    page.drawText(sanitizeWinAnsi(`Véhicule concerné : ${input.vehicleSummary}`), {
      x: 40,
      y: cursorY,
      size: 10,
      font: boldFont,
      color: primaryRgb,
    });
    cursorY -= 22;
  }

  // Table header
  page.drawRectangle({
    x: 40,
    y: cursorY - 20,
    width: width - 80,
    height: 22,
    color: rgb(0.95, 0.96, 0.98),
  });
  page.drawText('Désignation', { x: 48, y: cursorY - 14, size: 9, font: boldFont, color: rgb(0.15, 0.18, 0.24) });
  page.drawText('Qté', { x: 325, y: cursorY - 14, size: 9, font: boldFont, color: rgb(0.15, 0.18, 0.24) });
  page.drawText('PU HT', { x: 370, y: cursorY - 14, size: 9, font: boldFont, color: rgb(0.15, 0.18, 0.24) });
  page.drawText('TVA', { x: 440, y: cursorY - 14, size: 9, font: boldFont, color: rgb(0.15, 0.18, 0.24) });
  page.drawText('Total TTC', { x: 492, y: cursorY - 14, size: 9, font: boldFont, color: rgb(0.15, 0.18, 0.24) });

  cursorY -= 36;
  for (const line of input.lines) {
    page.drawText(sanitizeWinAnsi(line.description.slice(0, 52)), {
      x: 48,
      y: cursorY,
      size: 9.5,
      font,
      color: rgb(0.1, 0.12, 0.16),
    });
    page.drawText(String(line.quantity), { x: 328, y: cursorY, size: 9.5, font, color: rgb(0.1, 0.12, 0.16) });
    page.drawText(formatEuroFr(line.unitPriceHtCents), { x: 365, y: cursorY, size: 9, font, color: rgb(0.1, 0.12, 0.16) });
    page.drawText(input.showVatBreakdown ? `${(line.vatRateBps / 100).toFixed(1)}%` : '-', {
      x: 440,
      y: cursorY,
      size: 9,
      font,
      color: rgb(0.1, 0.12, 0.16),
    });
    page.drawText(formatEuroFr(line.totalTtcCents), {
      x: 488,
      y: cursorY,
      size: 9.5,
      font: boldFont,
      color: rgb(0.1, 0.12, 0.16),
    });
    cursorY -= 20;
  }

  // Totals block
  cursorY -= 16;
  page.drawLine({
    start: { x: 340, y: cursorY + 8 },
    end: { x: width - 40, y: cursorY + 8 },
    thickness: 1,
    color: rgb(0.88, 0.9, 0.93),
  });

  if (input.showVatBreakdown) {
    page.drawText('Total HT :', { x: 350, y: cursorY - 8, size: 9.5, font, color: rgb(0.35, 0.38, 0.43) });
    page.drawText(formatEuroFr(input.subtotalHtCents), { x: 475, y: cursorY - 8, size: 9.5, font, color: rgb(0.1, 0.12, 0.16) });
    cursorY -= 16;
    page.drawText('TVA :', { x: 350, y: cursorY - 8, size: 9.5, font, color: rgb(0.35, 0.38, 0.43) });
    page.drawText(formatEuroFr(input.vatCents), { x: 475, y: cursorY - 8, size: 9.5, font, color: rgb(0.1, 0.12, 0.16) });
    cursorY -= 18;
  }

  page.drawText('TOTAL TTC :', { x: 350, y: cursorY - 8, size: 11, font: boldFont, color: rgb(0.08, 0.1, 0.13) });
  page.drawText(formatEuroFr(input.totalTtcCents), {
    x: 470,
    y: cursorY - 8,
    size: 11,
    font: boldFont,
    color: primaryRgb,
  });

  if (input.paidCents > 0) {
    cursorY -= 18;
    page.drawText('Déjà réglé :', { x: 350, y: cursorY - 8, size: 9.5, font, color: rgb(0.09, 0.64, 0.42) });
    page.drawText(formatEuroFr(input.paidCents), { x: 475, y: cursorY - 8, size: 9.5, font, color: rgb(0.09, 0.64, 0.42) });
    cursorY -= 16;
    page.drawText('Reste dû :', { x: 350, y: cursorY - 8, size: 9.5, font: boldFont, color: rgb(0.08, 0.1, 0.13) });
    page.drawText(formatEuroFr(Math.max(0, input.totalTtcCents - input.paidCents)), {
      x: 475,
      y: cursorY - 8,
      size: 9.5,
      font: boldFont,
      color: rgb(0.08, 0.1, 0.13),
    });
  }

  // Legal mentions
  page.drawText(sanitizeWinAnsi(`Régime TVA : ${input.vatLegalMention}`), {
    x: 40,
    y: 120,
    size: 8.5,
    font: boldFont,
    color: rgb(0.3, 0.33, 0.38),
  });
  page.drawText(sanitizeWinAnsi(`Conditions de règlement : ${input.paymentTerms}`), {
    x: 40,
    y: 104,
    size: 8.5,
    font,
    color: rgb(0.4, 0.43, 0.48),
  });

  // Embed Factur-X XML attachment if provided
  if (input.facturxXml) {
    await pdfDoc.attach(Buffer.from(input.facturxXml, 'utf-8'), 'factur-x.xml', {
      mimeType: 'application/xml',
      description: 'Factur-X CII XML data',
      creationDate: new Date(),
      modificationDate: new Date(),
    });
    page.drawText('Format hybride Factur-X (XML factur-x.xml embarqué)', {
      x: 40,
      y: 88,
      size: 8,
      font,
      color: primaryRgb,
    });
  }

  if (signatureImage) {
    page.drawRectangle({
      x: 375,
      y: 62,
      width: 180,
      height: 62,
      borderColor: rgb(0.88, 0.9, 0.93),
      borderWidth: 0.75,
    });
    page.drawText('Cachet / Signature vendeur', {
      x: 383,
      y: 112,
      size: 7.5,
      font: boldFont,
      color: rgb(0.42, 0.45, 0.5),
    });
    const sigDims = signatureImage.scaleToFit(155, 40);
    page.drawImage(signatureImage, {
      x: 387 + (155 - sigDims.width) / 2,
      y: 66 + (40 - sigDims.height) / 2,
      width: sigDims.width,
      height: sigDims.height,
    });
  }

  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) =>
    drawHeaderAndFooter(
      pdfDoc,
      p,
      font,
      boldFont,
      'FACTURE',
      input.invoiceNumber,
      idx,
      pages.length,
      input.branding,
      logoImage
    )
  );

  return pdfDoc.save();
}

export interface GenericDocumentPdfInput {
  title: string;
  docNumber: string;
  date: string;
  subtitle?: string;
  sections: Array<{
    heading: string;
    rows: Array<[string, string]>;
  }>;
  disclaimer?: string;
  includeSignatureBoxes?: boolean;
  branding?: PdfBrandingConfig;
}

export async function generateStructuredPdf(input: GenericDocumentPdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(input.title);
  pdfDoc.setCreator('HexaVO Automotive Platform');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await embedOptionalImage(pdfDoc, input.branding?.logoDataUrl);
  const signatureImage = await embedOptionalImage(pdfDoc, input.branding?.signatureDataUrl);
  const [pr, pg, pb] = hexToRgbTuple(input.branding?.primaryColor, [0.145, 0.388, 0.922]);
  const [sr, sg, sb] = hexToRgbTuple(input.branding?.secondaryColor, [0.1, 0.12, 0.16]);
  const primaryRgb = rgb(pr, pg, pb);
  const secondaryRgb = rgb(sr, sg, sb);

  let page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  let y = height - 115;

  if (input.subtitle) {
    page.drawText(sanitizeWinAnsi(input.subtitle), {
      x: 40,
      y: y + 12,
      size: 9.5,
      font,
      color: rgb(0.42, 0.45, 0.5),
    });
    y -= 10;
  }

  page.drawText(sanitizeWinAnsi(`Date : ${input.date}`), {
    x: width - 200,
    y: height - 68,
    size: 9.5,
    font,
    color: rgb(0.35, 0.38, 0.43),
  });

  for (const section of input.sections) {
    if (y < 140) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - 115;
    }

    page.drawRectangle({
      x: 40,
      y: y - 18,
      width: width - 80,
      height: 20,
      color: rgb(0.95, 0.96, 0.98),
    });
    page.drawRectangle({
      x: 40,
      y: y - 18,
      width: 3,
      height: 20,
      color: primaryRgb,
    });
    page.drawText(sanitizeWinAnsi(section.heading), {
      x: 50,
      y: y - 12,
      size: 9.5,
      font: boldFont,
      color: secondaryRgb,
    });
    y -= 32;

    for (const [label, value] of section.rows) {
      if (y < 90) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = height - 115;
      }
      page.drawText(sanitizeWinAnsi(label), {
        x: 48,
        y,
        size: 9,
        font: boldFont,
        color: rgb(0.4, 0.43, 0.48),
      });
      page.drawText(sanitizeWinAnsi((value || '-').slice(0, 72)), {
        x: 215,
        y,
        size: 9.5,
        font,
        color: rgb(0.08, 0.1, 0.13),
      });
      y -= 17;
    }
    y -= 10;
  }

  if (input.includeSignatureBoxes) {
    if (y < 170) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - 130;
    }
    page.drawRectangle({
      x: 40,
      y: y - 75,
      width: 245,
      height: 75,
      borderColor: rgb(0.85, 0.87, 0.9),
      borderWidth: 1,
    });
    page.drawText("Signature de l'ancien propriétaire (Vendeur)", {
      x: 50,
      y: y - 16,
      size: 8.5,
      font: boldFont,
      color: rgb(0.35, 0.38, 0.43),
    });
    if (signatureImage) {
      const sigDims = signatureImage.scaleToFit(215, 46);
      page.drawImage(signatureImage, {
        x: 55 + (215 - sigDims.width) / 2,
        y: y - 68 + (46 - sigDims.height) / 2,
        width: sigDims.width,
        height: sigDims.height,
      });
    }

    page.drawRectangle({
      x: 310,
      y: y - 75,
      width: 245,
      height: 75,
      borderColor: rgb(0.85, 0.87, 0.9),
      borderWidth: 1,
    });
    page.drawText('Signature du nouvel acquéreur (Acheteur)', {
      x: 320,
      y: y - 16,
      size: 8.5,
      font: boldFont,
      color: rgb(0.35, 0.38, 0.43),
    });
    y -= 95;
  }

  if (input.disclaimer) {
    page.drawText(sanitizeWinAnsi(input.disclaimer.slice(0, 115)), {
      x: 40,
      y: 62,
      size: 8,
      font,
      color: rgb(0.5, 0.35, 0.1),
    });
  }

  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) =>
    drawHeaderAndFooter(
      pdfDoc,
      p,
      font,
      boldFont,
      input.title,
      input.docNumber,
      idx,
      pages.length,
      input.branding,
      logoImage
    )
  );

  return pdfDoc.save();
}

export interface CerfaPrepData {
  sellerName: string;
  sellerIsPro: boolean;
  sellerSiret?: string;
  sellerAddress: string;
  buyerName: string;
  buyerIsPro: boolean;
  buyerSiret?: string;
  buyerAddress: string;
  immatriculation: string;
  vin: string;
  marque: string;
  modele: string;
  dateMiseEnCirculation: string;
  kilometrage: string;
  genreNational: string;
  dateCession: string;
  heureCession: string;
  prixCessionCents: number;
  branding?: PdfBrandingConfig;
}

/**
 * Generates an official-field-mapped Cerfa 15776*02 preparation sheet PDF.
 * Explicitly states it is a preparation guide referencing the official Service-Public Cerfa 15776*02
 * rather than impersonating the official government template.
 */
export async function generateCerfaPreparationPdf(data: CerfaPrepData): Promise<Uint8Array> {
  return generateStructuredPdf({
    title: 'FICHE DE PRÉPARATION CERFA 15776*02',
    docNumber: `PREP-${data.immatriculation || data.vin || 'VO'}`,
    date: data.dateCession,
    subtitle:
      'Aide au remplissage structurée selon le formulaire officiel Service-Public Cerfa n°15776*02',
    sections: [
      {
        heading: 'Cadre A — Le Véhicule',
        rows: [
          ['Immatriculation (A)', data.immatriculation],
          ['Numéro VIN / Série (E)', data.vin],
          ['Marque (D.1)', data.marque],
          ['Dénomination commerciale (D.3)', data.modele],
          ['1ère mise en circulation (B)', data.dateMiseEnCirculation],
          ['Kilométrage relevé', `${data.kilometrage} km`],
          ['Genre / Type', data.genreNational || 'VP (Voiture particulière)'],
        ],
      },
      {
        heading: `Cadre B — Ancien Propriétaire (${data.sellerIsPro ? 'Professionnel' : 'Particulier'})`,
        rows: [
          ['Nom / Raison sociale', data.sellerName],
          ['Statut juridique', data.sellerIsPro ? 'Personne morale / Professionnel' : 'Personne physique (Particulier)'],
          ['SIRET (si professionnel)', data.sellerSiret || 'Non applicable (Particulier)'],
          ['Adresse complète', data.sellerAddress],
        ],
      },
      {
        heading: `Cadre C — Nouveau Propriétaire (${data.buyerIsPro ? 'Professionnel' : 'Particulier'})`,
        rows: [
          ['Nom / Raison sociale', data.buyerName],
          ['Statut', data.buyerIsPro ? 'Professionnel / Société' : 'Particulier'],
          ['SIRET (si professionnel)', data.buyerSiret || 'Non applicable'],
          ['Adresse complète', data.buyerAddress],
        ],
      },
      {
        heading: 'Déclaration de Cession & Signatures',
        rows: [
          ['Date et heure de cession', `${data.dateCession} à ${data.heureCession || '14:00'}`],
          ['Prix de cession convenu', formatEuroFr(data.prixCessionCents)],
          [
            'Formulaire officiel',
            'https://www.formulaires.service-public.fr/gf/showFormulaireSignaletiqueConsulter.do?numCerfaAndExtension=15776%2A02',
          ],
        ],
      },
    ],
    includeSignatureBoxes: true,
    branding: data.branding,
    disclaimer:
      'Document préparatoire HexaVO : reportez ces champs vérifiés sur le formulaire officiel Cerfa 15776*02 et effectuez la déclaration ANTS.',
  });
}
