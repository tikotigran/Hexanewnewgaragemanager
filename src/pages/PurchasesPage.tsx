import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ShoppingBag } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { translateValue } from '../i18n/translations';
import { eurosToCents } from '../lib/utils';
import type { Contact, LegalContext, Purchase, Vehicle } from '../types';
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  Modal,
  Select,
  StatusLabel,
  TableSkeleton,
  Textarea,
} from '../components/ui/Primitives';

export const PurchasesPage: React.FC = () => {
  const { businessProfiles } = useAuth();
  const { t, money, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [contextFilter, setContextFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);

  const [vehicleId, setVehicleId] = useState('');
  const [contactId, setContactId] = useState('');
  const [legalContext, setLegalContext] = useState<LegalContext>('professional');
  const [businessProfileId, setBusinessProfileId] = useState('');
  const [sellerType, setSellerType] = useState<'particulier' | 'professionnel' | 'societe' | 'autre'>('particulier');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountTtc, setAmountTtc] = useState('');
  const [vatRegime, setVatRegime] = useState('hors_tva');
  const [paymentMethod, setPaymentMethod] = useState('virement');
  const [paymentStatus, setPaymentStatus] = useState<'paye' | 'a_payer' | 'partiellement_paye'>('paye');
  const [docNumber, setDocNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const vid = searchParams.get('vehicle_id');
      if (vid) setVehicleId(vid);
      setModalOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', search, contextFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (contextFilter !== 'all') p.set('legal_context', contextFilter);
      return apiFetch<{ purchases: Purchase[] }>(`/api/purchases?${p.toString()}`);
    },
  });

  const { data: vehData } = useQuery({
    queryKey: ['vehicles-select'],
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-select'],
    queryFn: () => apiFetch<{ contacts: Contact[] }>('/api/contacts'),
  });

  useEffect(() => {
    if (vehicleId && vehData?.vehicles) {
      const v = vehData.vehicles.find((x) => x.id === Number(vehicleId));
      if (v) {
        setLegalContext(v.legal_context);
        if (v.business_profile_id) setBusinessProfileId(String(v.business_profile_id));
      }
    }
  }, [vehicleId, vehData]);

  useEffect(() => {
    if (!businessProfileId && businessProfiles[0]) {
      setBusinessProfileId(String(businessProfiles[0].id));
    }
  }, [businessProfiles, businessProfileId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId || !amountTtc) {
      toast(t('purch.requiredToast'), 'error');
      return;
    }
    setSaving(true);
    try {
      const ttc = eurosToCents(amountTtc);
      await apiFetch('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: Number(vehicleId),
          contact_id: contactId ? Number(contactId) : null,
          business_profile_id: legalContext === 'professional' && businessProfileId ? Number(businessProfileId) : null,
          legal_context: legalContext,
          seller_type: sellerType,
          purchase_date: purchaseDate,
          amount_ht_cents: ttc,
          vat_cents: 0,
          amount_ttc_cents: ttc,
          vat_regime: vatRegime,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          document_number: docNumber,
          notes,
        }),
      });
      toast(t('purch.createdToast'), 'success');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const purchases = data?.purchases || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.purchases')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('purch.subtitle')}</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4" />
          {t('purch.newBtn')}
        </Button>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('purch.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={contextFilter} onChange={(e) => setContextFilter(e.target.value)} className="sm:w-56">
          <option value="all">{t('common.allContexts')}</option>
          <option value="professional">{t('common.professional')}</option>
          <option value="personal">{t('common.personal')}</option>
        </Select>
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : purchases.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag className="w-10 h-10" />}
            title={t('purch.emptyTitle')}
            description={t('purch.emptyDesc')}
            action={<Button onClick={() => setModalOpen(true)}>{t('purch.emptyBtn')}</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                  <th className="py-3 px-4 font-medium">{t('common.date')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.vehicle')}</th>
                  <th className="py-3 px-3 font-medium">{t('purch.colSeller')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.context')}</th>
                  <th className="py-3 px-3 font-medium">{t('purch.colDocVat')}</th>
                  <th className="py-3 px-3 font-medium">{t('purch.colPayStatus')}</th>
                  <th className="py-3 px-4 font-medium text-right">{t('purch.colAmountTtc')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4 text-xs text-[#7A8290] whitespace-nowrap">{date(p.purchase_date)}</td>
                    <td className="py-3 px-3">
                      <Link to={`/vehicles/${p.vehicle_id}`} className="font-medium hover:text-[#2563EB]">
                        {p.marque} {p.modele}
                      </Link>
                      <div className="text-xs font-mono-num text-[#7A8290]">{p.immatriculation || '—'}</div>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      {p.company_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || translateValue(t, 'party', p.seller_type)}
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290]">
                      {p.legal_context === 'professional' ? t('common.professionalLabel') : t('common.personalLabel')}
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-mono-num">{p.document_number || '—'}</div>
                      <div className="text-[#7A8290]">{translateValue(t, 'vat', p.vat_regime)}</div>
                    </td>
                    <td className="py-3 px-3">
                      <StatusLabel
                        tone={p.payment_status === 'paye' ? 'green' : 'amber'}
                        label={t(`pay.${p.payment_status}`)}
                      />
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold">{money(p.amount_ttc_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('purch.modalTitle')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel required>{t('purch.vehicleField')}</FieldLabel>
            <Select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">{t('purch.selectVehicle')}</option>
              {(vehData?.vehicles || []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.marque} {v.modele} ({v.immatriculation || t('common.noPlate')}) — {v.legal_context === 'professional' ? t('common.professionalShort') : t('common.personalShort')}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('veh.context')}</FieldLabel>
              <Select value={legalContext} onChange={(e) => setLegalContext(e.target.value as LegalContext)}>
                <option value="professional">{t('common.professional')}</option>
                <option value="personal">{t('common.personal')}</option>
              </Select>
            </div>
            {legalContext === 'professional' && (
              <div>
                <FieldLabel required>{t('veh.businessProfile')}</FieldLabel>
                <Select value={businessProfileId} onChange={(e) => setBusinessProfileId(e.target.value)}>
                  {businessProfiles.map((bp) => (
                    <option key={bp.id} value={bp.id}>{bp.nom_commercial}</option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('purch.sellerCrm')}</FieldLabel>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('purch.noContactLinked')}</option>
                {(contactsData?.contacts || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || `${c.first_name} ${c.last_name}`}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel required>{t('purch.sellerType')}</FieldLabel>
              <Select value={sellerType} onChange={(e) => setSellerType(e.target.value as typeof sellerType)}>
                <option value="particulier">{t('party.particulier')}</option>
                <option value="professionnel">{t('party.professionnel')}</option>
                <option value="societe">{t('party.societe')}</option>
                <option value="autre">{t('party.autre')}</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>{t('veh.purchaseDate')}</FieldLabel>
              <Input type="date" required value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('vehDetail.amountTtc')}</FieldLabel>
              <Input type="number" step="0.01" required value={amountTtc} onChange={(e) => setAmountTtc(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('purch.vatAtPurchase')}</FieldLabel>
              <Select value={vatRegime} onChange={(e) => setVatRegime(e.target.value)}>
                <option value="hors_tva">{t('vat.hors_tva')}</option>
                <option value="tva_sur_marge_eligible">{t('vat.tva_sur_marge_eligible')}</option>
                <option value="tva_sur_prix_total">{t('vat.tva_sur_prix_total')}</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('purch.paymentMethod')}</FieldLabel>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="virement">{t('payMethod.virement')}</option>
                <option value="cheque_banque">{t('payMethod.cheque_banque')}</option>
                <option value="especes">{t('payMethod.especes')}</option>
                <option value="carte">{t('payMethod.carte')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('purch.colPayStatus')}</FieldLabel>
              <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>
                <option value="paye">{t('pay.paye')}</option>
                <option value="a_payer">{t('pay.a_payer')}</option>
                <option value="partiellement_paye">{t('pay.partiellement_paye')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('purch.docNumber')}</FieldLabel>
              <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="ACH-2026-..." />
            </div>
          </div>

          <div>
            <FieldLabel>{t('common.notes')}</FieldLabel>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.loading') : t('purch.submitBtn')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
