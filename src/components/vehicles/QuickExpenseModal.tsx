import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useI18n } from '../../context/I18nContext';
import { useToast } from '../../context/ToastContext';
import { localizeCategory } from '../../i18n/translations';
import {
  QUICK_EXPENSE_PRESETS,
  type QuickExpensePreset,
  resolveExpenseCategoryId,
  validateQuickExpenseInput,
} from '../../utils/vehicleList';
import type { Expense, ExpenseCategory, Vehicle } from '../../types';
import { Button, FieldLabel, Input, Modal, Select } from '../ui/Primitives';

interface Props {
  vehicle: Vehicle | null;
  open: boolean;
  onClose: () => void;
}

export const QuickExpenseModal: React.FC<Props> = ({ vehicle, open, onClose }) => {
  const { lang, t, money, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const amountInputRef = useRef<HTMLInputElement | null>(null);

  const { data: catData } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => apiFetch<{ categories: ExpenseCategory[] }>('/api/expense-categories'),
    enabled: open,
  });

  const vehicleCategories = (catData?.categories || []).filter((c) => c.scope === 'vehicle');

  const {
    data: expensesData,
    isLoading: expensesLoading,
  } = useQuery({
    queryKey: ['vehicle-expenses', vehicle?.id],
    queryFn: () =>
      apiFetch<{ expenses: Expense[] }>(`/api/expenses?scope=vehicle&vehicle_id=${vehicle!.id}`),
    enabled: open && Boolean(vehicle?.id),
  });

  const vehicleExpenses = expensesData?.expenses || [];

  useEffect(() => {
    if (!open) return;
    setSelectedPresetId('');
    setDescription('');
    setAmount('');
  }, [open, vehicle?.id]);

  useEffect(() => {
    if (open && vehicleCategories.length > 0 && !categoryId) {
      setCategoryId(resolveExpenseCategoryId(vehicleCategories, 'reparation'));
    }
  }, [open, vehicleCategories, categoryId]);

  const applyPreset = (preset: QuickExpensePreset) => {
    setSelectedPresetId(preset.id);
    setDescription(t(preset.descriptionKey));
    const resolved = resolveExpenseCategoryId(vehicleCategories, preset.categoryCode);
    if (resolved) setCategoryId(resolved);
    requestAnimationFrame(() => amountInputRef.current?.focus());
  };

  const syncAllExpenseCaches = async (vehicleId: number, deltaCents: number) => {
    qc.setQueriesData<{ vehicles: Vehicle[]; total: number }>(
      { queryKey: ['vehicles'] },
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          vehicles: prev.vehicles.map((row) =>
            row.id === vehicleId
              ? {
                  ...row,
                  direct_expenses_cents: Math.max(0, (row.direct_expenses_cents || 0) + deltaCents),
                }
              : row
          ),
        };
      }
    );

    await Promise.all([
      qc.invalidateQueries({ queryKey: ['vehicle-expenses', vehicleId] }),
      qc.invalidateQueries({ queryKey: ['vehicles'] }),
      qc.invalidateQueries({ queryKey: ['vehicle', String(vehicleId)] }),
      qc.invalidateQueries({ queryKey: ['expenses'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicle) return;

    const effectiveCategoryId =
      categoryId || resolveExpenseCategoryId(vehicleCategories, 'reparation');
    const validation = validateQuickExpenseInput({
      amountInput: amount,
      categoryId: effectiveCategoryId,
    });

    if (!validation.valid) {
      toast(t(validation.errorKey || 'exp.requiredToast'), 'error');
      return;
    }

    setSubmitting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'vehicle',
          vehicle_id: vehicle.id,
          category_id: Number(effectiveCategoryId),
          supplier_name: '',
          operation_date: today,
          amount_ht_cents: validation.amountCents,
          vat_rate_bps: 0,
          vat_cents: 0,
          amount_ttc_cents: validation.amountCents,
          notes: description.trim(),
        }),
      });

      setAmount('');
      setDescription('');
      setSelectedPresetId('');
      toast(t('vehDetail.toastExpenseAdded'), 'success');
      await syncAllExpenseCaches(vehicle.id, validation.amountCents);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (expense: Expense) => {
    if (!vehicle) return;
    setDeletingId(expense.id);
    try {
      await apiFetch(`/api/expenses/${expense.id}`, { method: 'DELETE' });
      toast(t('exp.deletedToast'), 'success');
      await syncAllExpenseCaches(vehicle.id, -(expense.amount_ttc_cents || 0));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const totalVehicleExpensesCents = vehicleExpenses.reduce(
    (sum, item) => sum + (item.amount_ttc_cents || 0),
    0
  );

  if (!vehicle) return null;

  const vehicleSubtitle = [
    `${vehicle.marque} ${vehicle.modele}`,
    vehicle.immatriculation || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t('quickExp.title')} — ${vehicleSubtitle}`}
      maxWidth="max-w-xl"
    >
      <div className="space-y-5">
        {/* Preset chips */}
        <div>
          <div className="text-xs font-medium text-[#7A8290] mb-2">{t('quickExp.presetsLabel')}</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_EXPENSE_PRESETS.map((preset) => {
              const active = selectedPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'border-[#2563EB] bg-[#2563EB]/15 text-[#2563EB] dark:text-blue-400'
                      : 'border-[#E7EAF0] dark:border-gray-700 bg-[#F6F7F9] dark:bg-[#0B0F17] text-[#151922] dark:text-gray-200 hover:border-[#2563EB]/60'
                  }`}
                >
                  {t(preset.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="quick-exp-desc">{t('quickExp.description')}</FieldLabel>
              <Input
                id="quick-exp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('quickExp.descPlaceholder')}
              />
            </div>
            <div>
              <FieldLabel htmlFor="quick-exp-amount" required>
                {t('quickExp.amount')}
              </FieldLabel>
              <Input
                ref={amountInputRef}
                id="quick-exp-amount"
                type="number"
                step="0.01"
                min="0.01"
                className="font-mono-num"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="120"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <FieldLabel htmlFor="quick-exp-cat">{t('quickExp.category')}</FieldLabel>
              <Select
                id="quick-exp-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {vehicleCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {localizeCategory(cat, lang)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={submitting} className="sm:w-auto w-full">
              <Plus className="w-4 h-4" />
              {submitting ? t('common.loading') : t('quickExp.addBtn')}
            </Button>
          </div>
        </form>

        {/* Existing expenses list */}
        <div className="pt-4 border-t border-[#E7EAF0] dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#151922] dark:text-gray-200">
              {t('quickExp.existingTitle', { count: vehicleExpenses.length })}
            </span>
            <span className="text-xs text-[#7A8290]">
              {t('quickExp.totalForVehicle')}:{' '}
              <strong className="font-mono-num text-[#151922] dark:text-white">
                {money(totalVehicleExpensesCents)}
              </strong>
            </span>
          </div>

          {expensesLoading ? (
            <div className="py-6 text-center text-xs text-[#7A8290]">{t('common.loading')}</div>
          ) : vehicleExpenses.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#7A8290] rounded-lg border border-dashed border-[#E7EAF0] dark:border-gray-800">
              {t('quickExp.empty')}
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y divide-[#E7EAF0] dark:divide-gray-800 rounded-lg border border-[#E7EAF0] dark:border-gray-800 bg-[#F6F7F9]/50 dark:bg-[#0B0F17]/60">
              {vehicleExpenses.map((exp) => {
                const catLabel = localizeCategory(exp, lang);
                const detailText = exp.notes || exp.supplier_name || '';
                return (
                  <div
                    key={exp.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[#151922] dark:text-gray-100 truncate">
                        {detailText || catLabel}
                      </div>
                      <div className="text-[11px] text-[#7A8290] truncate">
                        {[catLabel, date(exp.operation_date)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono-num font-semibold text-[#151922] dark:text-white whitespace-nowrap">
                        {money(exp.amount_ttc_cents)}
                      </span>
                      <button
                        type="button"
                        disabled={deletingId === exp.id}
                        onClick={() => handleDelete(exp)}
                        aria-label={`${t('common.delete')} ${detailText || catLabel}`}
                        className="p-1.5 rounded text-[#7A8290] hover:text-[#DC4545] hover:bg-red-500/10 disabled:opacity-40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
