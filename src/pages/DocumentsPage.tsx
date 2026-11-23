import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, ExternalLink, FileCheck2, FilePlus2, FileText } from 'lucide-react';
import { apiFetch, downloadProtectedFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { eurosToCents } from '../lib/utils';
import type { BrandingSettingsData, CompanySettingsData, Contact, DocumentRecord, Vehicle } from '../types';
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  Modal,
  Select,
  TableSkeleton,
  Textarea,
} from '../components/ui/Primitives';

const CERFA_OFFICIAL_URL =
  'https://www.formulaires.service-public.fr/gf/showFormulaireSignaletiqueConsulter.do?numCerfaAndExtension=15776%2A02';

const DOC_TYPES = [
  'cerfa_15776',
  'facture_vente',
  'facture_achat',
  'bon_commande',
  'recu_paiement',
  'rapport_vehicule',
  'document_interne',
] as const;

export const DocumentsPage: React.FC = () => {
  const { user, businessProfiles } = useAuth();
  const { t, lang, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [docTypeFilter, setDocTypeFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Generation Form
  const [docType, setDocType] = useState<
    'cerfa_15776' | 'bon_commande' | 'recu_paiement' | 'facture_achat' | 'rapport_vehicule' | 'document_interne'
  >('cerfa_15776');
  const [vehicleId, setVehicleId] = useState('');
  const [contactId, setContactId] = useState('');
  const [title, setTitle] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountEuros, setAmountEuros] = useState('');
  const [notes, setNotes] = useState('');

  // Editable Cerfa fields
  const [sellerName, setSellerName] = useState('');
  const [sellerIsPro, setSellerIsPro] = useState(false);
  const [sellerSiret, setSellerSiret] = useState('');
  const [sellerAddress, setSellerAddress] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerIsPro, setBuyerIsPro] = useState(false);
  const [buyerSiret, setBuyerSiret] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [immatriculation, setImmatriculation] = useState('');
  const [vin, setVin] = useState('');
  const [marque, setMarque] = useState('');
  const [modele, setModele] = useState('');
  const [dateMec, setDateMec] = useState('');
  const [kilometrage, setKilometrage] = useState('');
  const [genreNational, setGenreNational] = useState('VP');
  const [heureCession, setHeureCession] = useState('14:00');

  const { data, isLoading } = useQuery({
    queryKey: ['documents', docTypeFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (docTypeFilter !== 'all') p.set('doc_type', docTypeFilter);
      return apiFetch<{ documents: DocumentRecord[] }>(`/api/documents?${p.toString()}`);
    },
  });

  const { data: vehData } = useQuery({
    queryKey: ['vehicles-docs-select'],
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-docs-select'],
    queryFn: () => apiFetch<{ contacts: Contact[] }>('/api/contacts'),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings-docs-branding'],
    queryFn: () => apiFetch<{ settings: Record<string, unknown> }>('/api/settings'),
  });

  const savedCompany = (settingsData?.settings?.company_settings || {}) as Partial<CompanySettingsData>;
  const savedBranding = (settingsData?.settings?.branding_settings || {}) as Partial<BrandingSettingsData>;
  const formattedCompanyAddress = [
    savedCompany.address?.trim(),
    [savedCompany.postalCode?.trim(), savedCompany.city?.trim()].filter(Boolean).join(' '),
    savedCompany.country?.trim(),
  ]
    .filter(Boolean)
    .join(', ');

  const docTypeLabel = (type: string) => {
    const key = `docType.${type}`;
    const res = t(key);
    return res === key ? type : res;
  };

  const openModalWithType = (type: typeof docType) => {
    setDocType(type);
    setTitle(docTypeLabel(type));
    setModalOpen(true);
  };

  // Auto-fill respecting legal_context (personal vs professional)
  useEffect(() => {
    const v = vehData?.vehicles.find((x) => x.id === Number(vehicleId));
    const bpDefault = businessProfiles[0];
    const hasProInfo = Boolean(bpDefault || savedCompany.companyName);

    if (v) {
      setImmatriculation(v.immatriculation || '');
      setVin(v.vin || '');
      setMarque(v.marque || '');
      setModele(v.modele || '');
      setDateMec(v.annee ? `01/01/${v.annee}` : '');
      setKilometrage(v.kilometrage ? String(v.kilometrage) : '');
      const refCents = v.prix_vente_final_cents || v.prix_vente_prevu_cents || v.prix_achat_cents || 0;
      if (refCents) setAmountEuros(String(refCents / 100));

      const isPro = v.legal_context === 'professional';
      const bp = businessProfiles.find((b) => b.id === v.business_profile_id) || bpDefault;
      if (isPro && (bp || savedCompany.companyName)) {
        setSellerIsPro(true);
        setSellerName(
          savedCompany.companyName ||
            (bp ? `${bp.nom_commercial}${bp.raison_sociale ? ` (${bp.raison_sociale})` : ''}` : '')
        );
        setSellerSiret(savedCompany.siret || bp?.siret || '');
        setSellerAddress(formattedCompanyAddress || bp?.adresse_pro || '');
      } else {
        setSellerIsPro(false);
        setSellerName(`${user?.first_name || ''} ${user?.last_name || ''}`.trim());
        setSellerSiret('');
        setSellerAddress(user?.address || '');
      }
      if (docType === 'cerfa_15776') {
        setTitle(`${docTypeLabel('cerfa_15776')} — ${v.marque} ${v.modele}`);
      }
    } else if (hasProInfo) {
      setSellerIsPro(true);
      setSellerName(
        savedCompany.companyName ||
          (bpDefault ? `${bpDefault.nom_commercial}${bpDefault.raison_sociale ? ` (${bpDefault.raison_sociale})` : ''}` : '')
      );
      setSellerSiret(savedCompany.siret || bpDefault?.siret || '');
      setSellerAddress(formattedCompanyAddress || bpDefault?.adresse_pro || '');
    } else if (user) {
      setSellerIsPro(false);
      setSellerName(`${user.first_name} ${user.last_name}`);
      setSellerSiret('');
      setSellerAddress(user.address || '');
    }
  }, [vehicleId, vehData, businessProfiles, user, docType, lang, savedCompany.companyName, savedCompany.siret, formattedCompanyAddress]);

  useEffect(() => {
    const c = contactsData?.contacts.find((x) => x.id === Number(contactId));
    if (c) {
      setBuyerName(c.company_name || `${c.first_name} ${c.last_name}`.trim());
      setBuyerIsPro(c.type === 'professionnel');
      setBuyerSiret(c.siret || '');
      setBuyerAddress(`${c.address || ''} ${c.postal_code || ''} ${c.city || ''}`.trim());
    }
  }, [contactId, contactsData]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;
    setGenerating(true);
    try {
      const res = await apiFetch<{ document: DocumentRecord }>('/api/documents/generate', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: docType,
          vehicle_id: vehicleId ? Number(vehicleId) : null,
          contact_id: contactId ? Number(contactId) : null,
          title,
          date: docDate,
          amount_cents: amountEuros ? eurosToCents(amountEuros) : 0,
          notes,
          cerfa_fields:
            docType === 'cerfa_15776'
              ? {
                  sellerName,
                  sellerIsPro,
                  sellerSiret,
                  sellerAddress,
                  buyerName,
                  buyerIsPro,
                  buyerSiret,
                  buyerAddress,
                  immatriculation,
                  vin,
                  marque,
                  modele,
                  dateMiseEnCirculation: dateMec,
                  kilometrage,
                  genreNational,
                  heureCession,
                }
              : undefined,
        }),
      });
      toast(t('doc.generatedToast'), 'success');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['documents'] });
      await downloadProtectedFile(`/api/documents/${res.document.id}/download`, res.document.file_name);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const docs = data?.documents || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.documents')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('doc.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => openModalWithType('cerfa_15776')}>
            <FileCheck2 className="w-4 h-4" />
            {t('doc.prepCerfa')}
          </Button>
          <Button onClick={() => openModalWithType('bon_commande')}>
            <FilePlus2 className="w-4 h-4" />
            {t('doc.genDoc')}
          </Button>
        </div>
      </div>

      {/* Official Cerfa Notice */}
      <Card className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="text-xs text-[#7A8290] leading-relaxed">
          <strong className="text-[#151922] dark:text-gray-100 font-semibold">
            {t('doc.cerfaNoticeTitle')}
          </strong>{' '}
          {t('doc.cerfaNoticeBody')}
        </div>
        <a
          href={CERFA_OFFICIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] hover:underline whitespace-nowrap shrink-0"
        >
          {t('doc.officialLink')}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </Card>

      <Card className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-[#7A8290]">
          {t('doc.filterHint', { count: docs.length })}
        </div>
        <Select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)} className="sm:w-64">
          <option value="all">{t('doc.allTypes')}</option>
          {DOC_TYPES.map((k) => (
            <option key={k} value={k}>
              {docTypeLabel(k)}
            </option>
          ))}
        </Select>
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : docs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="w-10 h-10" />}
            title={t('doc.emptyTitle')}
            description={t('doc.emptyDesc')}
            action={<Button onClick={() => openModalWithType('cerfa_15776')}>{t('doc.prepCerfa')}</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                  <th className="py-3 px-4 font-medium">{t('doc.colDoc')}</th>
                  <th className="py-3 px-3 font-medium">{t('doc.colType')}</th>
                  <th className="py-3 px-3 font-medium">{t('doc.colRef')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.vehicle')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.date')}</th>
                  <th className="py-3 px-4 font-medium text-right">{t('common.download')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4 font-medium">{doc.title}</td>
                    <td className="py-3 px-3 text-xs text-[#7A8290]">
                      {docTypeLabel(doc.doc_type)}
                    </td>
                    <td className="py-3 px-3 font-mono-num text-xs">{doc.doc_number}</td>
                    <td className="py-3 px-3 text-xs">
                      {doc.marque ? `${doc.marque} ${doc.modele} (${doc.immatriculation || '—'})` : '—'}
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290] whitespace-nowrap">{date(doc.created_at)}</td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => downloadProtectedFile(`/api/documents/${doc.id}/download`, doc.file_name)}
                      >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={docType === 'cerfa_15776' ? t('doc.modalCerfaTitle') : t('doc.modalGenTitle')}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('doc.docTypeLabel')}</FieldLabel>
              <Select
                value={docType}
                onChange={(e) => {
                  const val = e.target.value as typeof docType;
                  setDocType(val);
                  setTitle(docTypeLabel(val));
                }}
              >
                <option value="cerfa_15776">{t('docType.cerfa_15776')}</option>
                <option value="bon_commande">{t('docType.bon_commande')}</option>
                <option value="recu_paiement">{t('docType.recu_paiement')}</option>
                <option value="facture_achat">{t('docType.facture_achat')}</option>
                <option value="rapport_vehicule">{t('docType.rapport_vehicule')}</option>
                <option value="document_interne">{t('docType.document_interne')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel required>{t('doc.docTitleLabel')}</FieldLabel>
              <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('doc.linkedVehicle')}</FieldLabel>
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">{t('doc.noVehicle')}</option>
                {(vehData?.vehicles || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.marque} {v.modele} ({v.immatriculation || '—'}) ·{' '}
                    {v.legal_context === 'professional' ? t('common.professionalShort') : t('common.personalShort')}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>{t('doc.contactBuyer')}</FieldLabel>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('doc.noContact')}</option>
                {(contactsData?.contacts || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || `${c.first_name} ${c.last_name}`}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel required>{t('doc.docDate')}</FieldLabel>
              <Input type="date" required value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
          </div>

          {docType === 'cerfa_15776' ? (
            <div className="space-y-4 pt-2 border-t border-[#E7EAF0] dark:border-gray-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2.5 p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{t('doc.cerfaSeller')}</span>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={sellerIsPro}
                        onChange={(e) => setSellerIsPro(e.target.checked)}
                      />
                      {t('common.professionalLabel')}
                    </label>
                  </div>
                  <Input
                    value={sellerName}
                    onChange={(e) => setSellerName(e.target.value)}
                    placeholder={t('doc.fullNameOrCompany')}
                  />
                  {sellerIsPro && (
                    <Input
                      value={sellerSiret}
                      onChange={(e) => setSellerSiret(e.target.value)}
                      placeholder={t('doc.sellerSiret')}
                    />
                  )}
                  <Input
                    value={sellerAddress}
                    onChange={(e) => setSellerAddress(e.target.value)}
                    placeholder={t('doc.fullAddress')}
                  />
                </div>

                <div className="space-y-2.5 p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{t('doc.cerfaBuyer')}</span>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={buyerIsPro}
                        onChange={(e) => setBuyerIsPro(e.target.checked)}
                      />
                      {t('common.professionalLabel')}
                    </label>
                  </div>
                  <Input
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder={t('doc.fullNameOrCompany')}
                  />
                  {buyerIsPro && (
                    <Input
                      value={buyerSiret}
                      onChange={(e) => setBuyerSiret(e.target.value)}
                      placeholder={t('doc.buyerSiret')}
                    />
                  )}
                  <Input
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                    placeholder={t('doc.fullAddress')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <FieldLabel>{t('veh.immat')}</FieldLabel>
                  <Input value={immatriculation} onChange={(e) => setImmatriculation(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>VIN (E)</FieldLabel>
                  <Input value={vin} onChange={(e) => setVin(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>{t('veh.marque')} (D.1)</FieldLabel>
                  <Input value={marque} onChange={(e) => setMarque(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>{t('veh.modele')} (D.3)</FieldLabel>
                  <Input value={modele} onChange={(e) => setModele(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>{t('doc.firstMec')}</FieldLabel>
                  <Input value={dateMec} onChange={(e) => setDateMec(e.target.value)} placeholder="JJ/MM/AAAA" />
                </div>
                <div>
                  <FieldLabel>{t('veh.km')}</FieldLabel>
                  <Input value={kilometrage} onChange={(e) => setKilometrage(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>{t('doc.genre')}</FieldLabel>
                  <Input value={genreNational} onChange={(e) => setGenreNational(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>{t('doc.saleTime')}</FieldLabel>
                  <Input value={heureCession} onChange={(e) => setHeureCession(e.target.value)} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('vehDetail.amountTtc')}</FieldLabel>
              <Input
                type="number"
                step="0.01"
                value={amountEuros}
                onChange={(e) => setAmountEuros(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <FieldLabel>{t('doc.extraNotes')}</FieldLabel>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {(savedBranding.logoDataUrl || savedBranding.signatureDataUrl || savedCompany.companyName) && (
            <div className="p-2.5 rounded-lg bg-[#2563EB]/10 border border-[#2563EB]/20 text-xs text-[#2563EB] dark:text-blue-300 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{t('doc.brandingActiveNotice')}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={generating}>
              {generating ? t('common.loading') : t('doc.submitGenerate')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
