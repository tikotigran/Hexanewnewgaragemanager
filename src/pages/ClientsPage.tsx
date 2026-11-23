import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users, Edit2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { translateValue } from '../i18n/translations';
import type { Contact, Purchase, Sale } from '../types';
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

export const ClientsPage: React.FC = () => {
  const { t, money, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const [type, setType] = useState<Contact['type']>('particulier');
  const [isBuyer, setIsBuyer] = useState(true);
  const [isSupplier, setIsSupplier] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [siren, setSiren] = useState('');
  const [siret, setSiret] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openCreate();
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, typeFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (typeFilter !== 'all') p.set('type', typeFilter);
      return apiFetch<{ contacts: Contact[] }>(`/api/contacts?${p.toString()}`);
    },
  });

  const { data: detailData } = useQuery({
    queryKey: ['contact-detail', detailId],
    enabled: Boolean(detailId),
    queryFn: () =>
      apiFetch<{ contact: Contact; purchases: Purchase[]; sales: Sale[] }>(`/api/contacts/${detailId}`),
  });

  const openCreate = () => {
    setEditing(null);
    setType('particulier');
    setIsBuyer(true);
    setIsSupplier(false);
    setFirstName('');
    setLastName('');
    setCompanyName('');
    setSiren('');
    setSiret('');
    setEmail('');
    setPhone('');
    setAddress('');
    setPostalCode('');
    setCity('');
    setNotes('');
    setModalOpen(true);
  };

  const openEdit = (c: Contact) => {
    setEditing(c);
    setType(c.type);
    setIsBuyer(Boolean(c.is_buyer));
    setIsSupplier(Boolean(c.is_supplier));
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setCompanyName(c.company_name);
    setSiren(c.siren);
    setSiret(c.siret);
    setEmail(c.email);
    setPhone(c.phone);
    setAddress(c.address);
    setPostalCode(c.postal_code);
    setCity(c.city);
    setNotes(c.notes);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        type,
        is_buyer: isBuyer,
        is_supplier: isSupplier,
        first_name: firstName,
        last_name: lastName,
        company_name: companyName,
        siren,
        siret,
        email,
        phone,
        address,
        postal_code: postalCode,
        city,
        notes,
      };
      if (editing) {
        await apiFetch(`/api/contacts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast(t('client.updatedToast'), 'success');
      } else {
        await apiFetch('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
        toast(t('client.createdToast'), 'success');
      }
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const contacts = data?.contacts || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.clients')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('client.subtitle')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" />
          {t('client.newBtn')}
        </Button>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('client.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="sm:w-52">
          <option value="all">{t('client.allTypes')}</option>
          <option value="particulier">{t('party.particulier')}</option>
          <option value="professionnel">{t('party.professionnel')}</option>
          <option value="fournisseur">{t('party.fournisseur')}</option>
          <option value="client">{t('party.client')}</option>
          <option value="prospect">{t('party.prospect')}</option>
        </Select>
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : contacts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="w-10 h-10" />}
            title={t('client.emptyTitle')}
            description={t('client.emptyDesc')}
            action={<Button onClick={openCreate}>{t('client.emptyBtn')}</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                  <th className="py-3 px-4 font-medium">{t('client.colName')}</th>
                  <th className="py-3 px-3 font-medium">{t('client.colTypeRole')}</th>
                  <th className="py-3 px-3 font-medium">{t('client.colContact')}</th>
                  <th className="py-3 px-3 font-medium">{t('client.colCity')}</th>
                  <th className="py-3 px-3 font-medium text-right">{t('client.colDeals')}</th>
                  <th className="py-3 px-4 font-medium text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => setDetailId(c.id)}
                        className="text-left font-semibold hover:text-[#2563EB]"
                      >
                        {c.company_name || `${c.first_name} ${c.last_name}`.trim()}
                      </button>
                      {c.company_name && (c.first_name || c.last_name) && (
                        <div className="text-xs text-[#7A8290]">
                          {c.first_name} {c.last_name} {c.siret ? `· SIRET ${c.siret}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290]">
                      <span className="font-medium text-[#151922] dark:text-gray-200">
                        {translateValue(t, 'party', c.type)}
                      </span>
                      {' · '}
                      {[c.is_buyer ? t('client.buyerRole') : null, c.is_supplier ? t('client.supplierRole') : null]
                        .filter(Boolean)
                        .join(' / ') || '—'}
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-mono-num">{c.phone || '—'}</div>
                      <div className="text-[#7A8290]">{c.email || '—'}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290]">
                      {[c.postal_code, c.city].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-xs">
                      {c.purchases_count || 0} / {c.sales_count || 0}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        aria-label={t('common.edit')}
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded hover:bg-[#F0F2F6] text-[#7A8290] hover:text-[#151922]"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create/Edit Contact Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t('client.editModalTitle') : t('client.newModalTitle')}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('client.category')}</FieldLabel>
              <Select value={type} onChange={(e) => setType(e.target.value as Contact['type'])}>
                <option value="particulier">{t('party.particulier')}</option>
                <option value="professionnel">{t('party.professionnel')}</option>
                <option value="fournisseur">{t('party.fournisseur')}</option>
                <option value="client">{t('party.client')}</option>
                <option value="prospect">{t('party.prospect')}</option>
              </Select>
            </div>
            <div className="flex items-end gap-4 pb-2 text-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isBuyer} onChange={(e) => setIsBuyer(e.target.checked)} />
                {t('client.buyerRole')}
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isSupplier} onChange={(e) => setIsSupplier(e.target.checked)} />
                {t('client.supplierRole')}
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('auth.firstName')}</FieldLabel>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('auth.lastName')}</FieldLabel>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('client.company')}</FieldLabel>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div>
              <FieldLabel>SIREN</FieldLabel>
              <Input value={siren} onChange={(e) => setSiren(e.target.value)} />
            </div>
            <div>
              <FieldLabel>SIRET</FieldLabel>
              <Input value={siret} onChange={(e) => setSiret(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('auth.email')}</FieldLabel>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('auth.phone')}</FieldLabel>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <FieldLabel>{t('client.postalCode')}</FieldLabel>
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>{t('vehDetail.adCity')}</FieldLabel>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div>
            <FieldLabel>{t('auth.address')}</FieldLabel>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <FieldLabel>{t('client.notesLabel')}</FieldLabel>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Contact History Modal */}
      <Modal
        open={Boolean(detailId && detailData)}
        onClose={() => setDetailId(null)}
        title={
          detailData
            ? detailData.contact.company_name || `${detailData.contact.first_name} ${detailData.contact.last_name}`
            : t('client.detailTitle')
        }
      >
        {detailData && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-[#7A8290]">{t('auth.email')} :</span> {detailData.contact.email || '—'}</div>
              <div><span className="text-[#7A8290]">{t('auth.phone')} :</span> {detailData.contact.phone || '—'}</div>
              <div><span className="text-[#7A8290]">{t('auth.address')} :</span> {detailData.contact.address || '—'} {detailData.contact.city}</div>
              <div><span className="text-[#7A8290]">SIRET :</span> {detailData.contact.siret || '—'}</div>
            </div>
            <div>
              <h3 className="font-semibold mb-2">{t('client.purchasesFrom', { count: detailData.purchases.length })}</h3>
              {detailData.purchases.length === 0 ? (
                <p className="text-xs text-[#7A8290]">{t('client.noPurchase')}</p>
              ) : (
                detailData.purchases.map((p) => (
                  <div key={p.id} className="py-1.5 flex justify-between text-xs border-b border-[#E7EAF0] dark:border-gray-800">
                    <span>{date(p.purchase_date)} · {p.marque} {p.modele}</span>
                    <span className="font-mono-num font-medium">{money(p.amount_ttc_cents)}</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <h3 className="font-semibold mb-2">{t('client.salesTo', { count: detailData.sales.length })}</h3>
              {detailData.sales.length === 0 ? (
                <p className="text-xs text-[#7A8290]">{t('client.noSale')}</p>
              ) : (
                detailData.sales.map((s) => (
                  <div key={s.id} className="py-1.5 flex justify-between text-xs border-b border-[#E7EAF0] dark:border-gray-800">
                    <span>{date(s.sale_date)} · {s.marque} {s.modele}</span>
                    <span className="font-mono-num font-medium text-[#16A36A]">{money(s.amount_ttc_cents)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
