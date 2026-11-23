import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Edit2,
  Upload,
  Star,
  Trash2,
  ArrowLeftRight,
  Download,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { apiFetch, downloadProtectedFile } from '../lib/api';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { localizeCategory, translateValue } from '../i18n/translations';
import { centsToEurosInput, eurosToCents } from '../lib/utils';
import type {
  DocumentRecord,
  Expense,
  ExpenseCategory,
  MarketplaceListing,
  PoliceRegisterEntry,
  Purchase,
  Sale,
  Vehicle,
  VehiclePhoto,
  VehicleStatus,
} from '../types';
import {
  Button,
  Card,
  FieldLabel,
  Input,
  Select,
  StatusLabel,
  TableSkeleton,
  Textarea,
} from '../components/ui/Primitives';
import { VehicleFormModal } from '../components/vehicles/VehicleFormModal';

interface VehicleDetailResponse {
  vehicle: Vehicle;
  photos: VehiclePhoto[];
  statusHistory: Array<{
    id: number;
    old_status: string | null;
    new_status: string;
    reason: string;
    changed_at: string;
  }>;
  purchases: Purchase[];
  sales: Sale[];
  expenses: Expense[];
  documents: DocumentRecord[];
  listing: MarketplaceListing | null;
  policeEntry: PoliceRegisterEntry | null;
  profitability: {
    totalInvestmentCents: number;
    directExpensesCents: number;
    revenueReferenceCents: number;
    isRealized: boolean;
    estimatedGrossMarginCents: number;
    estimatedMarginPct: number;
  };
}

type TabKey =
  | 'informations'
  | 'photos'
  | 'achats'
  | 'depenses'
  | 'reparations'
  | 'documents'
  | 'annonce'
  | 'historique'
  | 'rentabilite';

export const VehicleDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { lang, t, money, date, num } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabKey>('informations');
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Quick expense form state
  const [expCatId, setExpCatId] = useState('');
  const [expSupplier, setExpSupplier] = useState('');
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expAmount, setExpAmount] = useState('');
  const [expNotes, setExpNotes] = useState('');

  // Marketplace listing form state
  const [adTitle, setAdTitle] = useState('');
  const [adDesc, setAdDesc] = useState('');
  const [adPrice, setAdPrice] = useState('');
  const [adCity, setAdCity] = useState('Paris');
  const [adRegion, setAdRegion] = useState('Île-de-France');
  const [adPhone, setAdPhone] = useState('');
  const [adEmail, setAdEmail] = useState('');
  const [adStatus, setAdStatus] = useState<'brouillon' | 'publie' | 'suspendu'>('publie');
  const [adInitDone, setAdInitDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiFetch<VehicleDetailResponse>(`/api/vehicles/${id}`),
  });

  const { data: catData } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => apiFetch<{ categories: ExpenseCategory[] }>('/api/expense-categories'),
  });

  const vehicleCategories = (catData?.categories || []).filter((c) => c.scope === 'vehicle');

  React.useEffect(() => {
    if (data?.vehicle && !adInitDone) {
      const v = data.vehicle;
      const l = data.listing;
      setAdTitle(l?.title || `${v.marque} ${v.modele} ${v.version || ''}`.trim());
      setAdDesc(l?.description || v.notes || '');
      setAdPrice(centsToEurosInput(l?.price_cents || v.prix_vente_prevu_cents || v.prix_achat_cents));
      setAdCity(l?.location_city || 'Paris');
      setAdRegion(l?.location_region || 'Île-de-France');
      setAdPhone(l?.contact_phone || '');
      setAdEmail(l?.contact_email || '');
      setAdStatus((l?.status as 'brouillon' | 'publie' | 'suspendu') || 'publie');
      setAdInitDone(true);
    }
  }, [data, adInitDone]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['vehicle', id] });

  const handleStatusChange = async (nextStatus: VehicleStatus) => {
    try {
      await apiFetch(`/api/vehicles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, status_reason: 'Changement depuis la fiche véhicule' }),
      });
      toast(t('vehDetail.toastStatus'), 'success');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('photos', f));
    try {
      await apiFetch(`/api/vehicles/${id}/photos`, { method: 'POST', body: fd });
      toast(t('vehDetail.toastPhotosAdded'), 'success');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const setPrimaryPhoto = async (photoId: number) => {
    if (!data) return;
    await apiFetch(`/api/vehicles/${id}/photos/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({
        photoIds: data.photos.map((p) => p.id),
        primaryPhotoId: photoId,
      }),
    });
    toast(t('vehDetail.toastPrimaryUpdated'), 'success');
    refresh();
  };

  const movePhoto = async (index: number, delta: number) => {
    if (!data) return;
    const arr = [...data.photos];
    const target = index + delta;
    if (target < 0 || target >= arr.length) return;
    const [moved] = arr.splice(index, 1);
    arr.splice(target, 0, moved);
    await apiFetch(`/api/vehicles/${id}/photos/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ photoIds: arr.map((p) => p.id) }),
    });
    refresh();
  };

  const deletePhoto = async (photoId: number) => {
    await apiFetch(`/api/vehicles/${id}/photos/${photoId}`, { method: 'DELETE' });
    toast(t('vehDetail.toastPhotoDeleted'), 'success');
    refresh();
  };

  const addQuickExpense = async (e: React.FormEvent, defaultCategoryCode?: string) => {
    e.preventDefault();
    const chosenCat =
      expCatId ||
      String(
        vehicleCategories.find((c) => c.code === (defaultCategoryCode || 'reparation'))?.id ||
          vehicleCategories[0]?.id ||
          ''
      );
    if (!chosenCat || !expAmount) {
      toast(t('exp.requiredToast'), 'error');
      return;
    }
    const ttc = eurosToCents(expAmount);
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'vehicle',
          vehicle_id: Number(id),
          category_id: Number(chosenCat),
          supplier_name: expSupplier,
          operation_date: expDate,
          amount_ht_cents: ttc,
          vat_rate_bps: 0,
          vat_cents: 0,
          amount_ttc_cents: ttc,
          notes: expNotes,
        }),
      });
      setExpAmount('');
      setExpSupplier('');
      setExpNotes('');
      toast(t('vehDetail.toastExpenseAdded'), 'success');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const saveListing = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/marketplace/listings', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: Number(id),
          title: adTitle,
          description: adDesc,
          price_cents: eurosToCents(adPrice),
          location_city: adCity,
          location_region: adRegion,
          status: adStatus,
          contact_phone: adPhone,
          contact_email: adEmail,
        }),
      });
      toast(t('vehDetail.toastAdSaved'), 'success');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const generateVehicleReportOrCerfa = async (docType: 'rapport_vehicule' | 'cerfa_15776') => {
    if (!data) return;
    try {
      const res = await apiFetch<{ document: DocumentRecord }>('/api/documents/generate', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: docType,
          vehicle_id: Number(id),
          title:
            docType === 'cerfa_15776'
              ? `Préparation Cerfa 15776*02 — ${data.vehicle.marque} ${data.vehicle.modele}`
              : `Rapport Véhicule — ${data.vehicle.marque} ${data.vehicle.modele}`,
          date: new Date().toISOString().slice(0, 10),
        }),
      });
      toast(t('vehDetail.toastPdfGenerated'), 'success');
      refresh();
      await downloadProtectedFile(`/api/documents/${res.document.id}/download`, res.document.file_name);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  if (isLoading || !data) {
    return (
      <Card>
        <TableSkeleton rows={6} />
      </Card>
    );
  }

  const { vehicle, photos, statusHistory, purchases, sales, expenses, documents, listing, policeEntry, profitability } =
    data;
  const repairs = expenses.filter((e) =>
    ['reparation', 'pieces', 'diagnostic', 'controle_technique'].includes(e.category_code || '')
  );

  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: 'informations', label: t('vehDetail.tabInfo') },
    { key: 'photos', label: t('vehDetail.tabPhotos', { count: photos.length }) },
    { key: 'achats', label: t('vehDetail.tabPurchases', { count: purchases.length }) },
    { key: 'depenses', label: t('vehDetail.tabExpenses', { count: expenses.length }) },
    { key: 'reparations', label: t('vehDetail.tabRepairs', { count: repairs.length }) },
    { key: 'documents', label: t('vehDetail.tabDocuments', { count: documents.length }) },
    { key: 'annonce', label: t('vehDetail.tabListing') },
    { key: 'historique', label: t('vehDetail.tabHistory') },
    { key: 'rentabilite', label: t('vehDetail.tabProfitability') },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            aria-label={t('common.back')}
            onClick={() => navigate('/vehicles')}
            className="mt-1 p-2 rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#111827] hover:bg-[#F6F7F9]"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#7A8290]">
              <span>
                {vehicle.legal_context === 'professional'
                  ? `${t('common.professional')} (${vehicle.business_profile_name || t('common.professionalShort')})`
                  : t('common.personal')}
              </span>
              <span>·</span>
              <span className="font-mono-num">{vehicle.immatriculation || t('common.noPlate')}</span>
              <span>·</span>
              <span className="font-mono-num">{vehicle.vin || t('common.noVin')}</span>
            </div>
            <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display mt-0.5">
              {vehicle.marque} {vehicle.modele} {vehicle.version}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('vehDetail.changeStatus')}
            value={vehicle.status}
            onChange={(e) => handleStatusChange(e.target.value as VehicleStatus)}
            className="w-44"
          >
            <option value="brouillon">{t('status.brouillon')}</option>
            <option value="en_preparation">{t('status.en_preparation')}</option>
            <option value="en_reparation">{t('status.en_reparation')}</option>
            <option value="en_vente">{t('status.en_vente')}</option>
            <option value="reserve">{t('status.reserve')}</option>
            <option value="vendu">{t('status.vendu')}</option>
            <option value="archive">{t('status.archive')}</option>
          </Select>

          <Button variant="secondary" onClick={() => setEditModalOpen(true)}>
            <Edit2 className="w-4 h-4" />
            {t('common.edit')}
          </Button>

          {vehicle.status !== 'vendu' && (
            <Link to={`/ventes?vehicle_id=${vehicle.id}&new=1`}>
              <Button>{t('vehDetail.sellBtn')}</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">{t('vehDetail.purchasePrice')}</div>
          <div className="mt-1 text-lg font-semibold font-mono-num">{money(vehicle.prix_achat_cents)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">{t('vehDetail.directExpenses')}</div>
          <div className="mt-1 text-lg font-semibold font-mono-num">{money(profitability.directExpensesCents)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">{t('vehDetail.totalCost')}</div>
          <div className="mt-1 text-lg font-semibold font-mono-num">{money(profitability.totalInvestmentCents)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">
            {profitability.isRealized ? t('vehDetail.finalPrice') : t('vehDetail.plannedPrice')}
          </div>
          <div className="mt-1 text-lg font-semibold font-mono-num text-[#2563EB]">
            {profitability.revenueReferenceCents ? money(profitability.revenueReferenceCents) : '—'}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">
            {profitability.isRealized ? t('vehDetail.realizedMargin') : t('vehDetail.estimatedMargin')}
          </div>
          <div
            className={`mt-1 text-lg font-semibold font-mono-num ${
              profitability.estimatedGrossMarginCents >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
            }`}
          >
            {money(profitability.estimatedGrossMarginCents)} ({profitability.estimatedMarginPct}%)
          </div>
        </Card>
      </div>

      {/* 9 Tabs Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#E7EAF0] dark:border-gray-800">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`px-3.5 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap shrink-0 border-b-2 transition-colors ${
              tab === item.key
                ? 'border-[#2563EB] text-[#2563EB] bg-white dark:bg-[#111827]'
                : 'border-transparent text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'informations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold font-display mb-4">{t('vehDetail.specsTitle')}</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-y-4 gap-x-6 text-sm">
              {[
                [t('veh.marque'), vehicle.marque],
                [t('veh.modele'), vehicle.modele],
                [t('vehForm.version'), vehicle.version || '—'],
                [t('veh.immat'), vehicle.immatriculation || '—'],
                [t('veh.vin'), vehicle.vin || '—'],
                [t('veh.annee'), vehicle.annee ? String(vehicle.annee) : '—'],
                [t('veh.km'), vehicle.kilometrage ? `${num(vehicle.kilometrage)} ${t('common.kmUnit')}` : '—'],
                [t('vehForm.energie'), translateValue(t, 'fuel', vehicle.energie)],
                [t('vehForm.boite'), translateValue(t, 'gear', vehicle.boite_vitesses)],
                [t('vehForm.couleur'), vehicle.couleur || '—'],
                [t('vehForm.puissanceFiscale'), vehicle.puissance_fiscale ? `${vehicle.puissance_fiscale} ${t('common.cvUnit')}` : '—'],
                [t('vehForm.co2'), vehicle.co2 ? `${vehicle.co2} g/km` : '—'],
                [t('veh.purchaseDate'), date(vehicle.date_achat)],
                [t('vehForm.supplier'), vehicle.fournisseur_nom || '—'],
                [t('vehForm.supplierPhone'), vehicle.fournisseur_tel || '—'],
              ].map(([k, val]) => (
                <div key={k}>
                  <dt className="text-xs text-[#7A8290]">{k}</dt>
                  <dd className="mt-0.5 font-medium text-[#151922] dark:text-gray-100">{val}</dd>
                </div>
              ))}
            </dl>
            {vehicle.notes && (
              <div className="mt-6 pt-4 border-t border-[#E7EAF0] dark:border-gray-800">
                <div className="text-xs text-[#7A8290] mb-1">{t('common.notes')}</div>
                <p className="text-sm whitespace-pre-wrap">{vehicle.notes}</p>
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display">{t('vehDetail.mainPreview')}</h2>
            <div className="aspect-[4/3] rounded-lg overflow-hidden bg-[#F0F2F6] dark:bg-gray-800">
              {photos[0] ? (
                <img
                  src={photos[0].url}
                  alt={vehicle.marque}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-[#7A8290]">
                  {t('vehDetail.noPhoto')}
                </div>
              )}
            </div>
            {policeEntry && (
              <div className="pt-3 border-t border-[#E7EAF0] dark:border-gray-800 text-xs">
                <div className="text-[#7A8290]">{t('nav.policeRegister')}</div>
                <div className="mt-0.5 font-mono-num font-semibold text-[#151922] dark:text-white">
                  {policeEntry.entry_number} ·{' '}
                  {policeEntry.status === 'disposed'
                    ? t('police.statusDisposed')
                    : policeEntry.status === 'corrected'
                    ? t('police.statusCorrected')
                    : t('police.statusActive')}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'photos' && (
        <Card className="p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold font-display">{t('vehDetail.photosTitle')}</h2>
              <p className="text-xs text-[#7A8290]">{t('vehDetail.photosDesc')}</p>
            </div>
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-medium cursor-pointer hover:bg-blue-700">
              <Upload className="w-3.5 h-3.5" />
              {t('vehDetail.addPhotos')}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handlePhotoUpload} />
            </label>
          </div>

          {photos.length === 0 ? (
            <p className="text-sm text-[#7A8290] py-8 text-center">{t('vehDetail.noPhotosYet')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((p, idx) => (
                <div key={p.id} className="rounded-lg border border-[#E7EAF0] dark:border-gray-800 overflow-hidden">
                  <div className="aspect-[4/3] bg-[#F0F2F6] dark:bg-gray-800">
                    <img src={p.url} alt={p.original_name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  </div>
                  <div className="p-2.5 flex items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setPrimaryPhoto(p.id)}
                      className={`inline-flex items-center gap-1 font-medium ${
                        p.is_primary ? 'text-[#2563EB]' : 'text-[#7A8290] hover:text-[#151922]'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" />
                      {p.is_primary ? t('vehDetail.primary') : t('vehDetail.setPrimary')}
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={t('vehDetail.movePhoto')}
                        onClick={() => movePhoto(idx, idx > 0 ? -1 : 1)}
                        className="p-1 text-[#7A8290] hover:text-[#151922]"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('vehDetail.deletePhoto')}
                        onClick={() => deletePhoto(p.id)}
                        className="p-1 text-[#7A8290] hover:text-[#DC4545]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'achats' && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold font-display">{t('vehDetail.purchasesTitle')}</h2>
            <Link to={`/achats?vehicle_id=${vehicle.id}&new=1`}>
              <Button size="sm">
                <Plus className="w-3.5 h-3.5" />
                {t('purch.emptyBtn')}
              </Button>
            </Link>
          </div>
          {purchases.length === 0 ? (
            <p className="text-sm text-[#7A8290]">{t('vehDetail.noPurchases')}</p>
          ) : (
            <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
              {purchases.map((p) => (
                <div key={p.id} className="py-3 flex justify-between items-center">
                  <div>
                    <div className="font-medium">
                      {p.document_number || `#${p.id}`} · {translateValue(t, 'party', p.seller_type)}
                    </div>
                    <div className="text-xs text-[#7A8290]">
                      {date(p.purchase_date)} · {translateValue(t, 'payMethod', p.payment_method)} · {t(`pay.${p.payment_status}`)}
                    </div>
                  </div>
                  <div className="font-mono-num font-semibold">{money(p.amount_ttc_cents)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {(tab === 'depenses' || tab === 'reparations') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold font-display mb-4">
              {tab === 'reparations' ? t('vehDetail.repairsTitle') : t('vehDetail.expensesTitle')}
            </h2>
            {(tab === 'reparations' ? repairs : expenses).length === 0 ? (
              <p className="text-sm text-[#7A8290]">{t('vehDetail.noExpenses')}</p>
            ) : (
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
                {(tab === 'reparations' ? repairs : expenses).map((exp) => (
                  <div key={exp.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">
                        {localizeCategory(exp, lang)} {exp.supplier_name ? `— ${exp.supplier_name}` : ''}
                      </div>
                      <div className="text-xs text-[#7A8290]">
                        {date(exp.operation_date)} · {exp.notes || '—'}
                      </div>
                    </div>
                    <div className="font-mono-num font-semibold">{money(exp.amount_ttc_cents)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold font-display mb-3">
              {tab === 'reparations' ? t('vehDetail.addRepairTitle') : t('vehDetail.addExpenseTitle')}
            </h3>
            <form
              onSubmit={(e) => addQuickExpense(e, tab === 'reparations' ? 'reparation' : 'preparation')}
              className="space-y-3"
            >
              <div>
                <FieldLabel required>{t('vehDetail.category')}</FieldLabel>
                <Select value={expCatId} onChange={(e) => setExpCatId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {vehicleCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {localizeCategory(c, lang)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel>{t('vehDetail.supplierGarage')}</FieldLabel>
                <Input value={expSupplier} onChange={(e) => setExpSupplier(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel required>{t('common.date')}</FieldLabel>
                  <Input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
                </div>
                <div>
                  <FieldLabel required>{t('vehDetail.amountTtc')}</FieldLabel>
                  <Input
                    type="number"
                    step="0.01"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    placeholder="250"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>{t('common.notes')}</FieldLabel>
                <Input value={expNotes} onChange={(e) => setExpNotes(e.target.value)} />
              </div>
              <Button type="submit" className="w-full">
                {t('vehDetail.saveExpense')}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {tab === 'documents' && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold font-display">{t('vehDetail.docsTitle')}</h2>
              <p className="text-xs text-[#7A8290]">
                {t('vehDetail.docsContextHint', {
                  ctx: vehicle.legal_context === 'personal' ? t('common.personalLabel') : t('common.professionalLabel'),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => generateVehicleReportOrCerfa('cerfa_15776')}>
                {t('vehDetail.prepCerfa')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => generateVehicleReportOrCerfa('rapport_vehicule')}>
                {t('vehDetail.genReport')}
              </Button>
            </div>
          </div>

          {documents.length === 0 ? (
            <p className="text-sm text-[#7A8290]">{t('vehDetail.noDocs')}</p>
          ) : (
            <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
              {documents.map((doc) => (
                <div key={doc.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{doc.title}</div>
                    <div className="text-xs text-[#7A8290]">
                      {doc.doc_number} · {date(doc.created_at)}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => downloadProtectedFile(`/api/documents/${doc.id}/download`, doc.file_name)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    PDF
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'annonce' && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold font-display">{t('vehDetail.listingTitle')}</h2>
              <p className="text-xs text-[#7A8290]">{t('vehDetail.listingHint')}</p>
            </div>
            {listing && listing.status === 'publie' && (
              <Link
                to={`/marketplace/${listing.slug}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] hover:underline"
              >
                {t('vehDetail.viewPublicListing')}
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          <form onSubmit={saveListing} className="space-y-4 max-w-2xl">
            <div>
              <FieldLabel required>{t('vehDetail.adTitle')}</FieldLabel>
              <Input required value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <FieldLabel required>{t('vehDetail.adPrice')}</FieldLabel>
                <Input type="number" step="0.01" required value={adPrice} onChange={(e) => setAdPrice(e.target.value)} />
              </div>
              <div>
                <FieldLabel required>{t('vehDetail.adCity')}</FieldLabel>
                <Input required value={adCity} onChange={(e) => setAdCity(e.target.value)} />
              </div>
              <div>
                <FieldLabel required>{t('vehDetail.adRegion')}</FieldLabel>
                <Input required value={adRegion} onChange={(e) => setAdRegion(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <FieldLabel>{t('vehDetail.adStatus')}</FieldLabel>
                <Select value={adStatus} onChange={(e) => setAdStatus(e.target.value as 'brouillon' | 'publie' | 'suspendu')}>
                  <option value="publie">{t('mktStatus.publie')}</option>
                  <option value="brouillon">{t('mktStatus.brouillon')}</option>
                  <option value="suspendu">{t('mktStatus.suspendu')}</option>
                </Select>
              </div>
              <div>
                <FieldLabel>{t('vehDetail.adPhone')}</FieldLabel>
                <Input value={adPhone} onChange={(e) => setAdPhone(e.target.value)} />
              </div>
              <div>
                <FieldLabel>{t('vehDetail.adEmail')}</FieldLabel>
                <Input type="email" value={adEmail} onChange={(e) => setAdEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <FieldLabel>{t('vehDetail.adDesc')}</FieldLabel>
              <Textarea rows={4} value={adDesc} onChange={(e) => setAdDesc(e.target.value)} />
            </div>
            <Button type="submit">{t('vehDetail.adSaveBtn')}</Button>
          </form>
        </Card>
      )}

      {tab === 'historique' && (
        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold font-display">{t('vehDetail.historyTitle')}</h2>
          <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
            {statusHistory.map((h) => (
              <div key={h.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {h.old_status ? `${t(`status.${h.old_status}`)} → ` : ''}
                    <StatusLabel tone="blue" label={t(`status.${h.new_status}`)} />
                  </div>
                  <div className="text-xs text-[#7A8290]">{h.reason}</div>
                </div>
                <div className="text-xs text-[#7A8290] font-mono-num">{date(h.changed_at)}</div>
              </div>
            ))}
          </div>
          {sales.length > 0 && (
            <div className="pt-4 border-t border-[#E7EAF0] dark:border-gray-800 text-sm">
              <div className="font-semibold mb-1">{t('vehDetail.saleRecorded')}</div>
              <div>
                {sales[0].invoice_number} · {date(sales[0].sale_date)} · {money(sales[0].amount_ttc_cents)}
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'rentabilite' && (
        <Card className="p-5 max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold font-display">{t('vehDetail.profitTitle')}</h2>
          <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
            <div className="py-2.5 flex justify-between">
              <span className="text-[#7A8290]">{t('vehDetail.profitPurchase')}</span>
              <span className="font-mono-num">{money(vehicle.prix_achat_cents)}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-[#7A8290]">{t('vehDetail.profitExpenses')}</span>
              <span className="font-mono-num">{money(profitability.directExpensesCents)}</span>
            </div>
            <div className="py-2.5 flex justify-between font-medium">
              <span>{t('vehDetail.profitInvestment')}</span>
              <span className="font-mono-num">{money(profitability.totalInvestmentCents)}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-[#7A8290]">
                {profitability.isRealized ? t('vehDetail.profitSaleFinal') : t('vehDetail.profitSalePlanned')}
              </span>
              <span className="font-mono-num text-[#2563EB] font-medium">
                {money(profitability.revenueReferenceCents)}
              </span>
            </div>
            <div className="py-3 flex justify-between text-base font-bold">
              <span>
                {profitability.isRealized ? t('vehDetail.profitMarginRealized') : t('vehDetail.profitMarginEstimated')}
              </span>
              <span
                className={`font-mono-num ${
                  profitability.estimatedGrossMarginCents >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                }`}
              >
                {money(profitability.estimatedGrossMarginCents)} ({profitability.estimatedMarginPct}%)
              </span>
            </div>
          </div>
          <p className="text-xs text-[#7A8290]">{t('vehDetail.profitNote')}</p>
        </Card>
      )}

      <VehicleFormModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        initialVehicle={vehicle}
        onSaved={() => refresh()}
      />
    </div>
  );
};
