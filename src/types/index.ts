export type Language = 'fr' | 'ru' | 'en';
export type LegalContext = 'personal' | 'professional';
export type VehicleStatus =
  | 'brouillon'
  | 'en_preparation'
  | 'en_reparation'
  | 'en_vente'
  | 'reserve'
  | 'vendu'
  | 'archive';

export interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  language: Language;
  theme: 'light' | 'dark';
  currency: string;
  role: string;
}

export interface BusinessProfile {
  id: number;
  nom_commercial: string;
  raison_sociale: string;
  siren: string;
  siret: string;
  adresse_pro: string;
  telephone: string;
  email: string;
  code_ape: string;
  forme_juridique: string;
  regime_fiscal: 'micro_bic' | 'micro_bnc' | 'reel_simplifie' | 'reel_normal' | 'is';
  regime_tva: 'franchise_en_base' | 'tva_sur_marge' | 'tva_sur_prix_total' | 'autre_regime';
  tva_intracom: string;
  iban: string;
  bic: string;
  logo_url: string;
  is_default: number;
}

export interface Vehicle {
  id: number;
  user_id: number;
  business_profile_id: number | null;
  business_profile_name?: string;
  legal_context: LegalContext;
  status: VehicleStatus;
  marque: string;
  modele: string;
  version: string;
  immatriculation: string;
  vin: string;
  annee: number | null;
  kilometrage: number | null;
  energie: string;
  boite_vitesses: string;
  couleur: string;
  portes: number | null;
  puissance_fiscale: number | null;
  co2: number | null;
  date_achat: string;
  prix_achat_cents: number;
  prix_vente_prevu_cents: number | null;
  prix_vente_final_cents: number | null;
  fournisseur_nom: string;
  fournisseur_tel: string;
  notes: string;
  primary_photo_url?: string | null;
  direct_expenses_cents?: number;
  ct_ok?: number | boolean;
  paperwork_done?: number | boolean;
  listing_status?: string | null;
  listing_slug?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehiclePhoto {
  id: number;
  vehicle_id: number;
  url: string;
  original_name: string;
  sort_order: number;
  is_primary: number;
}

export interface Contact {
  id: number;
  type: 'particulier' | 'professionnel' | 'fournisseur' | 'client' | 'prospect';
  is_buyer: number;
  is_supplier: number;
  first_name: string;
  last_name: string;
  company_name: string;
  siren: string;
  siret: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postal_code: string;
  notes: string;
  purchases_count?: number;
  sales_count?: number;
}

export interface Purchase {
  id: number;
  vehicle_id: number;
  contact_id: number | null;
  business_profile_id: number | null;
  legal_context: LegalContext;
  seller_type: 'particulier' | 'professionnel' | 'societe' | 'autre';
  purchase_date: string;
  amount_ht_cents: number;
  vat_cents: number;
  amount_ttc_cents: number;
  vat_regime: string;
  payment_method: string;
  payment_status: 'a_payer' | 'partiellement_paye' | 'paye' | 'en_retard';
  document_number: string;
  notes: string;
  marque?: string;
  modele?: string;
  immatriculation?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
}

export interface Sale {
  id: number;
  vehicle_id: number;
  contact_id: number | null;
  business_profile_id: number | null;
  legal_context: LegalContext;
  seller_type: 'particulier' | 'professionnel';
  buyer_type: 'particulier' | 'professionnel' | 'societe';
  sale_date: string;
  amount_ht_cents: number;
  vat_cents: number;
  amount_ttc_cents: number;
  vat_regime: string;
  payment_method: string;
  payment_status: 'a_payer' | 'partiellement_paye' | 'paye' | 'en_retard';
  invoice_number: string;
  extra_services_cents: number;
  extra_services_desc: string;
  sales_channel?: 'leboncoin' | 'direct' | 'recommandation' | 'autre' | string;
  notes: string;
  marque?: string;
  modele?: string;
  immatriculation?: string;
  prix_achat_cents?: number;
  first_name?: string;
  last_name?: string;
  company_name?: string;
}

export interface ExpenseCategory {
  id: number;
  scope: 'vehicle' | 'business';
  code: string;
  label_fr: string;
  label_ru: string;
  label_en: string;
}

export interface Expense {
  id: number;
  vehicle_id: number | null;
  category_id: number;
  scope: 'vehicle' | 'business';
  supplier_name: string;
  operation_date: string;
  payment_date: string | null;
  amount_ht_cents: number;
  vat_rate_bps: number;
  vat_cents: number;
  amount_ttc_cents: number;
  vat_deductible: number;
  payment_method: string;
  payment_status: 'a_payer' | 'partiellement_paye' | 'paye' | 'en_retard';
  is_recurring: number;
  recurrence_interval: string | null;
  notes: string;
  category_code?: string;
  label_fr?: string;
  label_ru?: string;
  label_en?: string;
  marque?: string;
  modele?: string;
  immatriculation?: string;
}

export interface Invoice {
  id: number;
  business_profile_id: number;
  sale_id: number | null;
  vehicle_id: number | null;
  contact_id: number | null;
  invoice_number: string;
  status: 'brouillon' | 'emise' | 'partiellement_payee' | 'payee' | 'en_retard' | 'annulee';
  issue_date: string;
  due_date: string;
  vat_regime: string;
  vat_legal_mention: string;
  subtotal_ht_cents: number;
  vat_cents: number;
  total_ttc_cents: number;
  paid_cents: number;
  payment_terms: string;
  facturx_profile: string;
  xml_content: string;
  pa_transmission_status: string;
  business_profile_name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  marque?: string;
  modele?: string;
  immatriculation?: string;
}

export interface DocumentRecord {
  id: number;
  vehicle_id: number | null;
  doc_type: string;
  title: string;
  doc_number: string;
  file_name: string;
  created_at: string;
  marque?: string;
  modele?: string;
  immatriculation?: string;
}

export interface PoliceRegisterEntry {
  id: number;
  vehicle_id: number;
  entry_number: string;
  entry_sequence: number;
  recorded_at: string;
  supplier_snapshot_json: string;
  buyer_snapshot_json: string | null;
  immatriculation: string;
  vin: string;
  marque_modele: string;
  purchase_date: string;
  purchase_price_cents: number;
  sale_date: string | null;
  sale_price_cents: number | null;
  supporting_doc_ref: string;
  status: 'active' | 'disposed' | 'corrected';
  entry_hash: string;
  business_profile_name?: string;
}

export interface MarketplaceListing {
  id: number;
  user_id: number;
  vehicle_id: number;
  slug: string;
  title: string;
  description: string;
  price_cents: number;
  location_city: string;
  location_region: string;
  seller_type: 'particulier' | 'professionnel';
  vehicle_condition: string;
  status: 'brouillon' | 'en_attente' | 'publie' | 'suspendu' | 'vendu' | 'expire';
  contact_phone: string;
  contact_email: string;
  views_count: number;
  published_at: string | null;
  marque: string;
  modele: string;
  version: string;
  annee: number | null;
  kilometrage: number | null;
  energie: string;
  boite_vitesses: string;
  couleur: string;
  primary_photo_url: string | null;
  business_profile_name?: string;
  owner_first_name?: string;
  owner_last_name?: string;
}

export interface CalendarEvent {
  id: number;
  vehicle_id: number | null;
  event_type: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string | null;
  location: string;
  status: 'planifie' | 'termine' | 'annule';
  marque?: string;
  modele?: string;
}

export interface TaskItem {
  id: number;
  vehicle_id: number | null;
  title: string;
  description: string;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  marque?: string;
  modele?: string;
}

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

