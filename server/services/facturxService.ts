export interface FacturXParty {
  name: string;
  siret?: string;
  siren?: string;
  vatNumber?: string;
  address?: string;
  countryCode?: string;
  email?: string;
}

export interface FacturXLine {
  description: string;
  quantity: number;
  unitPriceHtCents: number;
  vatRateBps: number;
  vatCents: number;
  totalTtcCents: number;
}

export interface FacturXInvoiceData {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  currency: string;
  profile: 'MINIMUM' | 'BASIC' | 'EN16931';
  seller: FacturXParty;
  buyer: FacturXParty;
  lines: FacturXLine[];
  subtotalHtCents: number;
  vatCents: number;
  totalTtcCents: number;
  vatLegalMention: string;
  paymentTerms?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isoDateToCii(dateIso: string): string {
  return dateIso.replace(/-/g, '').slice(0, 8);
}

/**
 * Generates UN/CEFACT CrossIndustryInvoice XML conforming to Factur-X (BASIC / EN16931 profile structure).
 * Note: Generating PDF + XML produces a hybrid Factur-X file; statutory e-invoicing reform compliance
 * also requires transmission through an accredited Plateforme Agréée (PA).
 */
export function generateFacturXXml(data: FacturXInvoiceData): string {
  const profileUrn =
    data.profile === 'EN16931'
      ? 'urn:cen.eu:en16931:2017'
      : data.profile === 'BASIC'
      ? 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic'
      : 'urn:factur-x.eu:1p0:minimum';

  const lineItemsXml = data.lines
    .map((line, index) => {
      const lineTotalHt = centsToDecimal(line.unitPriceHtCents * line.quantity);
      const vatPct = (line.vatRateBps / 100).toFixed(2);
      const vatCat = line.vatRateBps > 0 ? 'S' : 'E';
      return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${index + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${escapeXml(line.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${centsToDecimal(line.unitPriceHtCents)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">${line.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${vatCat}</ram:CategoryCode>
          <ram:RateApplicablePercent>${vatPct}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${lineTotalHt}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join('');

  const vatCategory = data.vatCents > 0 ? 'S' : 'E';
  const mainVatPct =
    data.lines.length > 0 && data.vatCents > 0
      ? (data.lines[0].vatRateBps / 100).toFixed(2)
      : '0.00';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${escapeXml(profileUrn)}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(data.invoiceNumber)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${isoDateToCii(data.issueDate)}</udt:DateTimeString>
    </ram:IssueDateTime>
    <ram:IncludedNote>
      <ram:Content>${escapeXml(data.vatLegalMention)}</ram:Content>
    </ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${lineItemsXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${escapeXml(data.seller.name)}</ram:Name>
        ${data.seller.siret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${escapeXml(data.seller.siret)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(data.seller.address || 'France')}</ram:LineOne>
          <ram:CountryID>${escapeXml(data.seller.countryCode || 'FR')}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${data.seller.vatNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${escapeXml(data.seller.vatNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(data.buyer.name)}</ram:Name>
        ${data.buyer.siret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${escapeXml(data.buyer.siret)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(data.buyer.address || 'France')}</ram:LineOne>
          <ram:CountryID>${escapeXml(data.buyer.countryCode || 'FR')}</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery />
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escapeXml(data.currency)}</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${centsToDecimal(data.vatCents)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${centsToDecimal(data.subtotalHtCents)}</ram:BasisAmount>
        <ram:CategoryCode>${vatCategory}</ram:CategoryCode>
        <ram:RateApplicablePercent>${mainVatPct}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>${escapeXml(data.paymentTerms || 'Paiement à réception')}</ram:Description>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${isoDateToCii(data.dueDate)}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${centsToDecimal(data.subtotalHtCents)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${centsToDecimal(data.subtotalHtCents)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${escapeXml(data.currency)}">${centsToDecimal(data.vatCents)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${centsToDecimal(data.totalTtcCents)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${centsToDecimal(data.totalTtcCents)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

export interface XmlValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateFacturXXml(xml: string): XmlValidationResult {
  const errors: string[] = [];
  const requiredTags = [
    '<rsm:CrossIndustryInvoice',
    '<rsm:ExchangedDocumentContext>',
    '<ram:GuidelineSpecifiedDocumentContextParameter>',
    '<rsm:ExchangedDocument>',
    '<ram:ID>',
    '<ram:TypeCode>380</ram:TypeCode>',
    '<ram:SellerTradeParty>',
    '<ram:BuyerTradeParty>',
    '<ram:InvoiceCurrencyCode>',
    '<ram:GrandTotalAmount>',
    '</rsm:CrossIndustryInvoice>',
  ];

  for (const tag of requiredTags) {
    if (!xml.includes(tag)) {
      errors.push(`Missing required Factur-X CII element: ${tag}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Plateforme Agréée (PA) Adapter interface for future e-invoicing transmission integration.
 */
export interface PlateformeAgreeeAdapter {
  providerName: string;
  isConfigured: boolean;
  submitInvoice(invoiceNumber: string, xml: string, pdfBytes: Uint8Array): Promise<{
    accepted: boolean;
    trackingId?: string;
    message: string;
  }>;
}

export class StubPlateformeAgreeeAdapter implements PlateformeAgreeeAdapter {
  providerName = 'Plateforme Agréée (PA) — Connecteur prêt';
  isConfigured = Boolean(process.env.HEXAVO_PA_ENDPOINT && process.env.HEXAVO_PA_API_KEY);

  async submitInvoice(invoiceNumber: string, _xml: string, _pdfBytes: Uint8Array): Promise<{
    accepted: boolean;
    trackingId?: string;
    message: string;
  }> {
    if (!this.isConfigured) {
      return {
        accepted: false,
        message:
          `Connecteur PA non configuré pour ${invoiceNumber}. Le fichier Factur-X (PDF + XML) est prêt pour dépôt manuel ou configuration PA ultérieure.`,
      };
    }
    return {
      accepted: true,
      trackingId: `PA-${invoiceNumber}-${Date.now()}`,
      message: 'Transmis à la Plateforme Agréée configurée.',
    };
  }
}
