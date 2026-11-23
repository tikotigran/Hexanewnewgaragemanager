import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeEuro, Plus, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { translateValue } from '../i18n/translations';
import { eurosToCents } from '../lib/utils';
import type { Contact, LegalContext, Sale, Vehicle } from '../types';
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

export const SalesPage: React.FC = () => {
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
  const [buyerType, setBuyerType] = useState<'particulier' | 'professionnel' | 'societe'>('particulier');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountTtc, setAmountTtc] = useState('');
  const [extraServices, setExtraServices] = useState('');
  const [extraDesc, setExtraDesc] = useState('');
  const [vatRegime, setVatRegime] = useState('franchise_en_base');
  const [paymentMethod, setPaymentMethod] = useState('virement');
  const [paymentStatus, setPaymentStatus] = useState<'paye' | 'a_payer' | 'partiellement_paye'>('paye');
  const [salesChannel, setSalesChannel] = useState<'leboncoin' | 'direct' | 'recommandation' | 'autre'>('direct');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saving, setSaving] = useState(false);

  const openNewSaleModal = (prefillVehicleId?: string) => {
    if (prefillVehicleId) setVehicleId(prefillVehicleId);
    setIdempotencyKey(`sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      const vid = searchParams.get('vehicle_id') || '';
      openNewSaleModal(vid);
      searchParams.delete('new');
      searchParams.delete('vehicle_id');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['sales', search, contextFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (contextFilter !== 'all') p.set('legal_context', contextFilter);
      return apiFetch<{ sales: Sale[] }>(`/api/sales?${p.toString()}`);
    },
  });

  const { data: vehData } = useQuery({
    queryKey: ['vehicles-unsold'],
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-select'],
    queryFn: () => apiFetch<{ contacts: Contact[] }>('/api/contacts'),
  });

  const availableVehicles = (vehData?.vehicles || []).filter((v) => v.status !== 'vendu');

  useEffect(() => {
    if (vehicleId && vehData?.vehicles) {
      const v = vehData.vehicles.find((x) => x.id === Number(vehicleId));
      if (v) {
        setLegalContext(v.legal_context);
        if (v.legal_context === 'personal') {
          setVatRegime('hors_tva');
          setBusinessProfileId('');
        } else {
          setBusinessProfileId(
            v.business_profile_id ? String(v.business_profile_id) : String(businessProfiles[0]?.id || '')
          );
          setVatRegime(businessProfiles[0]?.regime_tva || 'franchise_en_base');
        }
        if (v.prix_vente_prevu_cents) {
          setAmountTtc(String(v.prix_vente_prevu_cents / 100));
        }
      }
    }
  }, [vehicleId, vehData, businessProfiles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!vehicleId || !amountTtc) {
      toast(t('sale.requiredToast'), 'error');
      return;
    }

    setSaving(true);
    try {
      const ttc = eurosToCents(amountTtc);
      const res = await apiFetch<{ sale: Sale; duplicate: boolean; vatWarning?: string }>('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: Number(vehicleId),
          contact_id: contactId ? Number(contactId) : null,
          business_profile_id: legalContext === 'professional' && businessProfileId ? Number(businessProfileId) : null,
          legal_context: legalContext,
          seller_type: legalContext === 'personal' ? 'particulier' : 'professionnel',
          buyer_type: buyerType,
          sale_date: saleDate,
          amount_ht_cents: ttc,
          vat_cents: 0,
          amount_ttc_cents: ttc,
          vat_regime: vatRegime,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          invoice_number: invoiceNumber,
          extra_services_cents: extraServices ? eurosToCents(extraServices) : 0,
          extra_services_desc: extraDesc,
          sales_channel: salesChannel,
          notes,
          idempotency_key: idempotencyKey,
        }),
      });

      if (res.vatWarning) {
        toast(res.vatWarning, 'warning');
      } else {
        toast(t('sale.confirmedToast'), 'success');
      }
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicles-unsold'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const sales = data?.sales || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.sales')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('sale.subtitle')}</p>
        </div>
        <Button onClick={() => openNewSaleModal()}>
          <Plus className="w-4 h-4" />
          {t('sale.confirmBtn')}
        </Button>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sale.searchPlaceholder')}
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
      ) : sales.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BadgeEuro className="w-10 h-10" />}
            title={t('sale.emptyTitle')}
            description={t('sale.emptyDesc')}
            action={<Button onClick={() => openNewSaleModal()}>{t('sale.confirmBtn')}</Button>}
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
                  <th className="py-3 px-3 font-medium">{t('sale.colBuyer')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.context')}</th>
                  <th className="py-3 px-3 font-medium">{t('sale.colInvoice')}</th>
                  <th className="py-3 px-3 font-medium">{t('sale.colPayment')}</th>
                  <th className="py-3 px-4 font-medium text-right">{t('sale.colTotalTtc')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4 text-xs text-[#7A8290] whitespace-nowrap">{date(s.sale_date)}</td>
                    <td className="py-3 px-3">
                      <Link to={`/vehicles/${s.vehicle_id}`} className="font-medium hover:text-[#2563EB]">
                        {s.marque} {s.modele}
                      </Link>
                      <div className="text-xs font-mono-num text-[#7A8290]">{s.immatriculation || '—'}</div>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      {s.company_name || `${s.first_name || ''} ${s.last_name || ''}`.trim() || translateValue(t, 'party', s.buyer_type)}
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290]">
                      {s.legal_context === 'professional' ? t('common.professionalLabel') : t('common.personalLabel')}
                    </td>
                    <td className="py-3 px-3 font-mono-num text-xs">{s.invoice_number || '—'}</td>
                    <td className="py-3 px-3">
                      <StatusLabel
                        tone={s.payment_status === 'paye' ? 'green' : 'amber'}
                        label={t(`pay.${s.payment_status}`)}
                      />
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#16A36A]">
                      {money(s.amount_ttc_cents + (s.extra_services_cents || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('sale.modalTitle')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel required>{t('sale.vehicleToSell')}</FieldLabel>
            <Select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">{t('sale.selectAvailable')}</option>
              {availableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.marque} {v.modele} ({v.immatriculation || t('common.noPlate')}) —{' '}
                  {v.legal_context === 'professional' ? t('common.professionalShort') : t('common.personalShort')}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('sale.legalContext')}</FieldLabel>
              <Select value={legalContext} onChange={(e) => setLegalContext(e.target.value as LegalContext)}>
                <option value="professional">{t('common.professional')}</option>
                <option value="personal">{t('common.personal')}</option>
              </Select>
            </div>
            {legalContext === 'professional' && (
              <div>
                <FieldLabel required>{t('sale.sellerProfile')}</FieldLabel>
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
              <FieldLabel>{t('sale.buyerCrm')}</FieldLabel>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('sale.selectBuyer')}</option>
                {(contactsData?.contacts || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || `${c.first_name} ${c.last_name}`}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel required>{t('sale.buyerType')}</FieldLabel>
              <Select value={buyerType} onChange={(e) => setBuyerType(e.target.value as typeof buyerType)}>
                <option value="particulier">{t('party.particulier')}</option>
                <option value="professionnel">{t('party.professionnel')}</option>
                <option value="societe">{t('party.societe')}</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>{t('sale.saleDate')}</FieldLabel>
              <Input type="date" required value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('sale.priceTtc')}</FieldLabel>
              <Input type="number" step="0.01" required value={amountTtc} onChange={(e) => setAmountTtc(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('sale.vatRegime')}</FieldLabel>
              <Select
                value={vatRegime}
                onChange={(e) => setVatRegime(e.target.value)}
                disabled={legalContext === 'personal'}
              >
                {legalContext === 'personal' ? (
                  <option value="hors_tva">{t('vat.hors_tva')}</option>
                ) : (
                  <>
                    <option value="franchise_en_base">{t('vat.franchise_en_base')}</option>
                    <option value="tva_sur_marge">{t('vat.tva_sur_marge')}</option>
                    <option value="tva_sur_prix_total">{t('vat.tva_sur_prix_total')}</option>
                    <option value="autre_regime">{t('vat.autre_regime')}</option>
                  </>
                )}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('sale.extraServices')}</FieldLabel>
              <Input
                type="number"
                step="0.01"
                value={extraServices}
                onChange={(e) => setExtraServices(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <FieldLabel>{t('sale.extraDesc')}</FieldLabel>
              <Input value={extraDesc} onChange={(e) => setExtraDesc(e.target.value)} placeholder={t('sale.extraDescPlaceholder')} />
            </div>
            <div>
              <FieldLabel>{t('sale.invoiceRef')}</FieldLabel>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={t('sale.autoIfEmpty')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('sale.paymentMethod')}</FieldLabel>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="virement">{t('payMethod.virement')}</option>
                <option value="cheque_banque">{t('payMethod.cheque_banque')}</option>
                <option value="carte">{t('payMethod.carte')}</option>
                <option value="especes">{t('payMethod.especes_plafond')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('sale.collectionStatus')}</FieldLabel>
              <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}>
                <option value="paye">{t('pay.paye')}</option>
                <option value="partiellement_paye">{t('pay.partiellement_paye')}</option>
                <option value="a_payer">{t('pay.a_payer')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('sale.channelLabel')}</FieldLabel>
              <Select value={salesChannel} onChange={(e) => setSalesChannel(e.target.value as typeof salesChannel)}>
                <option value="direct">{t('channel.direct')}</option>
                <option value="leboncoin">{t('channel.leboncoin')}</option>
                <option value="recommandation">{t('channel.recommandation')}</option>
                <option value="autre">{t('channel.autre')}</option>
              </Select>
            </div>
          </div>

          <div>
            <FieldLabel>{t('common.comments')}</FieldLabel>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.loading') : t('sale.submitBtn')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
