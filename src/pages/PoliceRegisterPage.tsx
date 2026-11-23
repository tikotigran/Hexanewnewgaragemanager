import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, FileSpreadsheet, PenLine, Printer, Search, ShieldCheck } from 'lucide-react';
import { apiFetch, downloadProtectedFile } from '../lib/api';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import type { PoliceRegisterEntry } from '../types';
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

interface CorrectionItem {
  id: number;
  entry_id: number;
  correction_sequence: number;
  reason: string;
  field_changes_json: string;
  author_name: string;
  corrected_at: string;
}

export const PoliceRegisterPage: React.FC = () => {
  const { t, money, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [correctModalEntry, setCorrectModalEntry] = useState<PoliceRegisterEntry | null>(null);
  const [reason, setReason] = useState('');
  const [fieldName, setFieldName] = useState('immatriculation');
  const [fieldValue, setFieldValue] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['police-register', search, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (statusFilter !== 'all') p.set('status', statusFilter);
      return apiFetch<{ entries: PoliceRegisterEntry[]; corrections: CorrectionItem[] }>(
        `/api/livre-de-police?${p.toString()}`
      );
    },
  });

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctModalEntry || savingCorrection) return;
    if (reason.trim().length < 5 || !fieldValue.trim()) {
      toast(t('police.requiredToast'), 'error');
      return;
    }

    setSavingCorrection(true);
    try {
      await apiFetch(`/api/livre-de-police/${correctModalEntry.id}/corrections`, {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim(),
          field_changes: { [fieldName]: fieldValue.trim() },
        }),
      });
      toast(t('police.addedToast'), 'success');
      setCorrectModalEntry(null);
      setReason('');
      setFieldValue('');
      qc.invalidateQueries({ queryKey: ['police-register'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSavingCorrection(false);
    }
  };

  const entries = data?.entries || [];
  const corrections = data?.corrections || [];

  const statusTone = (st: string) =>
    st === 'disposed' ? 'green' : st === 'corrected' ? 'amber' : 'blue';
  const statusLabel = (st: string) =>
    st === 'disposed'
      ? t('police.statusDisposed')
      : st === 'corrected'
        ? t('police.statusCorrected')
        : t('police.statusActive');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">
            {t('nav.policeRegister')}
          </h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('police.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadProtectedFile('/api/livre-de-police/export/csv', 'livre-de-police-hexavo.csv')}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {t('common.exportCsv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadProtectedFile('/api/livre-de-police/export/pdf', 'livre-de-police-hexavo.pdf')}
          >
            <Download className="w-4 h-4" />
            {t('common.exportPdf')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
            {t('common.print')}
          </Button>
        </div>
      </div>

      <Card className="p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-[#2563EB] shrink-0 mt-0.5" />
        <div className="text-xs text-[#7A8290] leading-relaxed">
          <strong className="text-[#151922] dark:text-gray-100">{t('police.bannerTitle')}</strong>{' '}
          {t('police.bannerBody')}
        </div>
      </Card>

      <Card className="p-4 flex flex-col sm:flex-row gap-3 no-print">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('police.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-52">
          <option value="all">{t('common.allStatuses')}</option>
          <option value="active">{t('police.statusActive')}</option>
          <option value="disposed">{t('police.statusDisposed')}</option>
          <option value="corrected">{t('police.statusCorrected')}</option>
        </Select>
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="w-10 h-10" />}
            title={t('police.emptyTitle')}
            description={t('police.emptyDesc')}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                  <th className="py-3 px-4 font-medium">{t('police.colOrder')}</th>
                  <th className="py-3 px-3 font-medium">{t('police.colVehicleVin')}</th>
                  <th className="py-3 px-3 font-medium">{t('police.colIn')}</th>
                  <th className="py-3 px-3 font-medium">{t('police.colOut')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.status')}</th>
                  <th className="py-3 px-3 font-medium">{t('police.colHash')}</th>
                  <th className="py-3 px-4 font-medium text-right no-print">{t('police.colRectify')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {entries.map((e) => {
                  const sup = JSON.parse(e.supplier_snapshot_json || '{}');
                  const buy = e.buyer_snapshot_json ? JSON.parse(e.buyer_snapshot_json) : null;
                  return (
                    <tr key={e.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                      <td className="py-3 px-4">
                        <div className="font-mono-num font-semibold text-xs">{e.entry_number}</div>
                        <div className="text-[11px] text-[#7A8290]">{date(e.recorded_at)}</div>
                      </td>
                      <td className="py-3 px-3">
                        <Link to={`/vehicles/${e.vehicle_id}`} className="font-medium hover:text-[#2563EB]">
                          {e.marque_modele}
                        </Link>
                        <div className="text-xs font-mono-num text-[#7A8290]">
                          {e.immatriculation || t('common.noPlate')} · {e.vin || t('common.noVin')}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <div className="font-medium">
                          {date(e.purchase_date)} · <span className="font-mono-num">{money(e.purchase_price_cents)}</span>
                        </div>
                        <div className="text-[#7A8290]">{sup.name || '—'}</div>
                      </td>
                      <td className="py-3 px-3 text-xs">
                        {e.sale_date ? (
                          <>
                            <div className="font-medium text-[#16A36A]">
                              {date(e.sale_date)} ·{' '}
                              <span className="font-mono-num">{money(e.sale_price_cents)}</span>
                            </div>
                            <div className="text-[#7A8290]">{buy?.name || '—'}</div>
                          </>
                        ) : (
                          <span className="text-[#7A8290]">{t('police.inStock')}</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <StatusLabel tone={statusTone(e.status)} label={statusLabel(e.status)} />
                      </td>
                      <td className="py-3 px-3 font-mono-num text-[11px] text-[#7A8290]" title={e.entry_hash}>
                        {e.entry_hash.slice(0, 14)}…
                      </td>
                      <td className="py-3 px-4 text-right no-print">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setCorrectModalEntry(e);
                            setFieldName('immatriculation');
                            setFieldValue(e.immatriculation || '');
                            setReason('');
                          }}
                        >
                          <PenLine className="w-3.5 h-3.5" />
                          {t('police.annotateBtn')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Corrections Audit Log */}
      {corrections.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold font-display mb-3">{t('police.logTitle')}</h2>
          <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-xs">
            {corrections.map((c) => {
              const entry = entries.find((x) => x.id === c.entry_id);
              return (
                <div key={c.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-[#151922] dark:text-gray-100">
                      {entry?.entry_number || `#${c.entry_id}`} ·{' '}
                      {t('police.rectificationN', { n: c.correction_sequence })} —{' '}
                      <span className="text-[#D97706]">{c.reason}</span>
                    </div>
                    <div className="text-[#7A8290] mt-0.5 font-mono-num">{c.field_changes_json}</div>
                  </div>
                  <div className="text-[#7A8290] whitespace-nowrap">
                    {c.author_name} · {date(c.corrected_at)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(correctModalEntry)}
        onClose={() => setCorrectModalEntry(null)}
        title={t('police.modalTitle', { num: correctModalEntry?.entry_number || '' })}
      >
        <form onSubmit={handleSubmitCorrection} className="space-y-4">
          <p className="text-xs text-[#7A8290]">{t('police.modalHint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('police.fieldConcerned')}</FieldLabel>
              <Select value={fieldName} onChange={(e) => setFieldName(e.target.value)}>
                <option value="immatriculation">{t('police.fieldImmat')}</option>
                <option value="vin">{t('police.fieldVin')}</option>
                <option value="fournisseur">{t('police.fieldSupplier')}</option>
                <option value="acquereur">{t('police.fieldBuyer')}</option>
                <option value="prix_achat">{t('police.fieldPurchasePrice')}</option>
                <option value="observation">{t('police.fieldObservation')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel required>{t('police.fieldValue')}</FieldLabel>
              <Input required value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} />
            </div>
          </div>
          <div>
            <FieldLabel required>{t('police.reasonLabel')}</FieldLabel>
            <Textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('police.reasonPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setCorrectModalEntry(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingCorrection}>
              {savingCorrection ? t('common.loading') : t('police.submitBtn')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
