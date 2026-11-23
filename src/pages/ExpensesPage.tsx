import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { localizeCategory } from '../i18n/translations';
import { eurosToCents } from '../lib/utils';
import type { Expense, ExpenseCategory, Vehicle } from '../types';
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
} from '../components/ui/Primitives';

export const ExpensesPage: React.FC = () => {
  const { businessProfiles } = useAuth();
  const { lang, t, money, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [scopeTab, setScopeTab] = useState<'all' | 'vehicle' | 'business'>('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [scope, setScope] = useState<'vehicle' | 'business'>('vehicle');
  const [vehicleId, setVehicleId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [operationDate, setOperationDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountHt, setAmountHt] = useState('');
  const [vatRateBps, setVatRateBps] = useState('2000');
  const [vatDeductible, setVatDeductible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('carte');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState('monthly');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setModalOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', scopeTab, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (scopeTab !== 'all') p.set('scope', scopeTab);
      if (search) p.set('search', search);
      return apiFetch<{ expenses: Expense[] }>(`/api/expenses?${p.toString()}`);
    },
  });

  const { data: catData } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => apiFetch<{ categories: ExpenseCategory[] }>('/api/expense-categories'),
  });

  const { data: vehData } = useQuery({
    queryKey: ['vehicles-select'],
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const filteredCats = (catData?.categories || []).filter((c) => c.scope === scope);
  const expenses = data?.expenses || [];

  const totalVehicleExpenses = expenses
    .filter((e) => e.scope === 'vehicle')
    .reduce((s, e) => s + e.amount_ttc_cents, 0);
  const totalBusinessExpenses = expenses
    .filter((e) => e.scope === 'business')
    .reduce((s, e) => s + e.amount_ttc_cents, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId || !amountHt) {
      toast(t('exp.requiredToast'), 'error');
      return;
    }
    if (scope === 'vehicle' && !vehicleId) {
      toast(t('exp.vehicleRequiredToast'), 'error');
      return;
    }
    const ht = eurosToCents(amountHt);
    const bps = Number(vatRateBps || 0);
    const vat = Math.round((ht * bps) / 10000);
    const ttc = ht + vat;

    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          vehicle_id: scope === 'vehicle' ? Number(vehicleId) : null,
          business_profile_id: businessProfiles[0]?.id || null,
          category_id: Number(categoryId),
          supplier_name: supplierName,
          operation_date: operationDate,
          amount_ht_cents: ht,
          vat_rate_bps: bps,
          vat_cents: vat,
          amount_ttc_cents: ttc,
          vat_deductible: vatDeductible,
          payment_method: paymentMethod,
          payment_status: 'paye',
          is_recurring: scope === 'business' && isRecurring,
          recurrence_interval: scope === 'business' && isRecurring ? recurrenceInterval : null,
          notes,
        }),
      });
      toast(t('exp.createdToast'), 'success');
      setModalOpen(false);
      setAmountHt('');
      setSupplierName('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const handleDelete = async (id: number) => {
    await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    toast(t('exp.deletedToast'), 'success');
    qc.invalidateQueries({ queryKey: ['expenses'] });
  };

  const exportCsv = () => {
    const rows = [
      ['Date', 'Scope', 'Category', 'Vehicle', 'Supplier', 'HT (EUR)', 'VAT (EUR)', 'TTC (EUR)', 'Notes'].join(';'),
      ...expenses.map((e) =>
        [
          e.operation_date,
          e.scope === 'vehicle' ? t('exp.tabVehicle') : t('exp.tabBusiness'),
          localizeCategory(e, lang),
          e.marque ? `${e.marque} ${e.modele}` : '',
          e.supplier_name || '',
          (e.amount_ht_cents / 100).toFixed(2),
          (e.vat_cents / 100).toFixed(2),
          (e.amount_ttc_cents / 100).toFixed(2),
          `"${(e.notes || '').replace(/"/g, '""')}"`,
        ].join(';')
      ),
    ].join('\n');
    const blob = new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'depenses-hexavo.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.expenses')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('exp.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="w-4 h-4" />
            {t('common.exportCsv')}
          </Button>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4" />
            {t('exp.addBtn')}
          </Button>
        </div>
      </div>

      {/* Summary & Scope Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">{t('exp.summaryVehicle')}</div>
          <div className="mt-1 text-xl font-semibold font-mono-num">{money(totalVehicleExpenses)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-[#7A8290]">{t('exp.summaryBusiness')}</div>
          <div className="mt-1 text-xl font-semibold font-mono-num">{money(totalBusinessExpenses)}</div>
        </Card>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17]">
          {(['all', 'vehicle', 'business'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScopeTab(sc)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                scopeTab === sc
                  ? 'bg-white dark:bg-[#111827] text-[#151922] dark:text-white shadow-sm'
                  : 'text-[#7A8290]'
              }`}
            >
              {sc === 'all' ? t('exp.tabAll') : sc === 'vehicle' ? t('exp.tabVehicle') : t('exp.tabBusiness')}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('exp.searchPlaceholder')}
            className="pl-9"
          />
        </div>
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : expenses.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="w-10 h-10" />}
            title={t('exp.emptyTitle')}
            description={t('exp.emptyDesc')}
            action={<Button onClick={() => setModalOpen(true)}>{t('exp.addBtn')}</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                  <th className="py-3 px-4 font-medium">{t('common.date')}</th>
                  <th className="py-3 px-3 font-medium">{t('exp.colTypeCat')}</th>
                  <th className="py-3 px-3 font-medium">{t('exp.colAllocation')}</th>
                  <th className="py-3 px-3 font-medium">{t('exp.colSupplier')}</th>
                  <th className="py-3 px-3 font-medium text-right">{t('exp.colHt')}</th>
                  <th className="py-3 px-3 font-medium text-right">{t('exp.colTtc')}</th>
                  <th className="py-3 px-4 font-medium text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4 text-xs text-[#7A8290] whitespace-nowrap">{date(exp.operation_date)}</td>
                    <td className="py-3 px-3">
                      <div className="font-medium">{localizeCategory(exp, lang)}</div>
                      <div className="text-xs text-[#7A8290]">
                        {exp.scope === 'vehicle' ? t('exp.scopeVehicleLabel') : t('exp.scopeBusinessLabel')}
                        {exp.is_recurring ? t('exp.recurringTag') : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      {exp.vehicle_id ? (
                        <Link to={`/vehicles/${exp.vehicle_id}`} className="text-[#2563EB] hover:underline font-medium">
                          {exp.marque} {exp.modele} ({exp.immatriculation})
                        </Link>
                      ) : (
                        <StatusLabel tone="neutral" label={t('exp.unattachedBusiness')} />
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs">{exp.supplier_name || '—'}</td>
                    <td className="py-3 px-3 text-right font-mono-num text-xs text-[#7A8290]">
                      {money(exp.amount_ht_cents)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-semibold">
                      {money(exp.amount_ttc_cents)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        aria-label={t('common.delete')}
                        onClick={() => handleDelete(exp.id)}
                        className="p-1.5 rounded hover:bg-[#F0F2F6] text-[#7A8290] hover:text-[#DC4545]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('exp.modalTitle')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setScope('vehicle');
                setCategoryId('');
              }}
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium text-left ${
                scope === 'vehicle' ? 'border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB]' : 'border-[#E7EAF0] text-[#7A8290]'
              }`}
            >
              {t('exp.scopeA')}
            </button>
            <button
              type="button"
              onClick={() => {
                setScope('business');
                setCategoryId('');
              }}
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium text-left ${
                scope === 'business' ? 'border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB]' : 'border-[#E7EAF0] text-[#7A8290]'
              }`}
            >
              {t('exp.scopeB')}
            </button>
          </div>

          {scope === 'vehicle' && (
            <div>
              <FieldLabel required>{t('common.vehicle')}</FieldLabel>
              <Select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">{t('purch.selectVehicle')}</option>
                {(vehData?.vehicles || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.marque} {v.modele} ({v.immatriculation || t('common.noPlate')})
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('vehDetail.category')}</FieldLabel>
              <Select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('exp.choose')}</option>
                {filteredCats.map((c) => (
                  <option key={c.id} value={c.id}>{localizeCategory(c, lang)}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>{t('vehForm.supplier')}</FieldLabel>
              <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>{t('exp.opDate')}</FieldLabel>
              <Input type="date" required value={operationDate} onChange={(e) => setOperationDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('exp.amountHt')}</FieldLabel>
              <Input type="number" step="0.01" required value={amountHt} onChange={(e) => setAmountHt(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('exp.vatRate')}</FieldLabel>
              <Select value={vatRateBps} onChange={(e) => setVatRateBps(e.target.value)}>
                <option value="2000">20 %</option>
                <option value="0">{t('exp.vatZero')}</option>
                <option value="1000">10 %</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <FieldLabel>{t('sale.paymentMethod')}</FieldLabel>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="carte">{t('payMethod.carte')}</option>
                <option value="virement">{t('payMethod.virement')}</option>
                <option value="prelevement">{t('payMethod.prelevement')}</option>
                <option value="especes">{t('payMethod.especes')}</option>
              </Select>
            </div>
            <div className="pt-4 space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={vatDeductible} onChange={(e) => setVatDeductible(e.target.checked)} />
                {t('exp.vatDeductible')}
              </label>
              {scope === 'business' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                  {t('exp.isRecurring')}
                </label>
              )}
            </div>
          </div>

          {scope === 'business' && isRecurring && (
            <div>
              <FieldLabel>{t('exp.frequency')}</FieldLabel>
              <Select value={recurrenceInterval} onChange={(e) => setRecurrenceInterval(e.target.value)}>
                <option value="monthly">{t('exp.freqMonthly')}</option>
                <option value="quarterly">{t('exp.freqQuarterly')}</option>
                <option value="yearly">{t('exp.freqYearly')}</option>
              </Select>
            </div>
          )}

          <div>
            <FieldLabel>{t('common.comments')}</FieldLabel>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
