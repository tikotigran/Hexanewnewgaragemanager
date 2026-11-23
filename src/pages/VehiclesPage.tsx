import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Car,
  ExternalLink,
  LayoutGrid,
  List,
  Plus,
  Search,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import { translateValue } from '../i18n/translations';
import {
  INLINE_VEHICLE_STATUSES,
  calculateInventoryTotals,
  calculateTotalInvestedCents,
  getNextSortState,
  isVehicleFlagEnabled,
  sortVehicles,
  type VehicleSortKey,
  type VehicleSortState,
} from '../utils/vehicleList';
import type { Vehicle, VehicleStatus } from '../types';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  StatusLabel,
  TableSkeleton,
} from '../components/ui/Primitives';
import { QuickExpenseModal } from '../components/vehicles/QuickExpenseModal';

function statusTone(status: string): 'blue' | 'green' | 'amber' | 'red' | 'neutral' {
  if (status === 'vendu') return 'green';
  if (status === 'en_vente' || status === 'reserve') return 'blue';
  if (status === 'en_preparation' || status === 'en_reparation') return 'amber';
  return 'neutral';
}

function statusSelectClasses(status: string): string {
  if (status === 'vendu') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  }
  if (status === 'en_vente' || status === 'reserve') {
    return 'border-blue-500/40 bg-blue-500/10 text-[#2563EB] dark:text-blue-400';
  }
  if (status === 'en_preparation' || status === 'en_reparation') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  return 'border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] text-[#7A8290] dark:text-gray-300';
}

function yesNoSelectClasses(enabled: boolean): string {
  return enabled
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium'
    : 'border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] text-[#7A8290] dark:text-gray-400';
}

export const VehiclesPage: React.FC = () => {
  const { t, money, date, num } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [contextFilter, setContextFilter] = useState('all');
  const [listingFilter, setListingFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [sortState, setSortState] = useState<VehicleSortState>({ key: null, direction: 'asc' });

  const [quickExpenseVehicle, setQuickExpenseVehicle] = useState<Vehicle | null>(null);
  const [updatingFieldKey, setUpdatingFieldKey] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      navigate('/vehicles/new', { replace: true });
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', debouncedSearch, statusFilter, contextFilter, listingFilter, page],
    queryFn: () => {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set('search', debouncedSearch);
      if (statusFilter !== 'all') p.set('status', statusFilter);
      if (contextFilter !== 'all') p.set('legal_context', contextFilter);
      if (listingFilter !== 'all') p.set('has_listing', listingFilter);
      p.set('page', String(page));
      p.set('limit', '20');
      return apiFetch<{ vehicles: Vehicle[]; total: number }>(`/api/vehicles?${p.toString()}`);
    },
  });

  const handleQuickPatch = async (
    v: Vehicle,
    field: 'ct_ok' | 'paperwork_done' | 'status',
    patch: Partial<Pick<Vehicle, 'ct_ok' | 'paperwork_done' | 'status'>> & { status_reason?: string }
  ) => {
    const key = `${v.id}:${field}`;
    setUpdatingFieldKey(key);

    const previousQueries = qc.getQueriesData<{ vehicles: Vehicle[]; total: number }>({
      queryKey: ['vehicles'],
    });

    qc.setQueriesData<{ vehicles: Vehicle[]; total: number }>(
      { queryKey: ['vehicles'] },
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          vehicles: prev.vehicles.map((row) =>
            row.id === v.id ? { ...row, ...patch } : row
          ),
        };
      }
    );

    try {
      await apiFetch(`/api/vehicles/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      toast(
        field === 'status' ? t('vehDetail.toastStatus') : t('veh.quickFlagUpdated'),
        'success'
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['vehicles'] }),
        qc.invalidateQueries({ queryKey: ['vehicle', String(v.id)] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    } catch (err) {
      for (const [qKey, qData] of previousQueries) {
        qc.setQueryData(qKey, qData);
      }
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setUpdatingFieldKey(null);
    }
  };

  const vehicles = data?.vehicles || [];
  const sortedVehicles = useMemo(() => sortVehicles(vehicles, sortState), [vehicles, sortState]);
  const totals = useMemo(() => calculateInventoryTotals(sortedVehicles), [sortedVehicles]);

  const activeQuickExpenseVehicle = quickExpenseVehicle
    ? sortedVehicles.find((v) => v.id === quickExpenseVehicle.id) || quickExpenseVehicle
    : null;

  const toggleSort = (key: VehicleSortKey) => {
    setSortState((prev) => getNextSortState(prev, key));
  };

  const renderSortIcon = (key: VehicleSortKey) => {
    if (sortState.key !== key) {
      return <ArrowUpDown className="w-3 h-3 opacity-40 shrink-0" />;
    }
    return sortState.direction === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#2563EB] dark:text-blue-400 shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#2563EB] dark:text-blue-400 shrink-0" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('veh.title')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">
            {data ? t('veh.subtitle', { count: data.total }) : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-lg bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-800">
            <button
              type="button"
              aria-label={t('veh.tableMode')}
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md cursor-pointer ${
                viewMode === 'table' ? 'bg-[#F0F2F6] dark:bg-gray-800 text-[#151922] dark:text-white' : 'text-[#7A8290]'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={t('veh.cardsMode')}
              onClick={() => setViewMode('cards')}
              className={`p-1.5 rounded-md cursor-pointer ${
                viewMode === 'cards' ? 'bg-[#F0F2F6] dark:bg-gray-800 text-[#151922] dark:text-white' : 'text-[#7A8290]'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          <Button onClick={() => navigate('/vehicles/new')}>
            <Plus className="w-4 h-4" />
            {t('veh.addVehicle')}
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('veh.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('veh.filterStatusAria')}>
            <option value="all">{t('common.allStatuses')}</option>
            <option value="brouillon">{t('status.brouillon')}</option>
            <option value="en_preparation">{t('status.en_preparation')}</option>
            <option value="en_reparation">{t('status.en_reparation')}</option>
            <option value="en_vente">{t('status.en_vente')}</option>
            <option value="reserve">{t('status.reserve')}</option>
            <option value="vendu">{t('status.vendu')}</option>
            <option value="archive">{t('status.archive')}</option>
          </Select>
          <Select
            value={contextFilter}
            onChange={(e) => setContextFilter(e.target.value)}
            aria-label={t('veh.filterContextAria')}
          >
            <option value="all">{t('veh.filterContextAll')}</option>
            <option value="professional">{t('common.professional')}</option>
            <option value="personal">{t('common.personal')}</option>
          </Select>
          <Select value={listingFilter} onChange={(e) => setListingFilter(e.target.value)} aria-label={t('veh.filterMktAria')}>
            <option value="all">{t('veh.filterMktAll')}</option>
            <option value="yes">{t('veh.filterMktYes')}</option>
            <option value="no">{t('veh.filterMktNo')}</option>
          </Select>
        </div>
      </Card>

      {/* Content */}
      {isLoading ? (
        <Card>
          <TableSkeleton rows={6} />
        </Card>
      ) : sortedVehicles.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Car className="w-10 h-10" />}
            title={t('veh.emptyTitle')}
            description={t('veh.emptyDesc')}
            action={
              <Button onClick={() => navigate('/vehicles/new')}>
                <Plus className="w-4 h-4" />
                {t('veh.addVehicle')}
              </Button>
            }
          />
        </Card>
      ) : viewMode === 'table' ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-[11px] uppercase text-[#7A8290]">
                  <th className="py-2.5 pl-3 pr-2.5 font-semibold whitespace-nowrap w-[255px] max-w-[270px]">
                    <button
                      type="button"
                      onClick={() => toggleSort('vehicle')}
                      className="inline-flex items-center gap-1 hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('veh.colVehicle')}</span>
                      {renderSortIcon('vehicle')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('km')}
                      className="inline-flex items-center gap-1 hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('veh.colKm')}</span>
                      {renderSortIcon('km')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('status')}
                      className="inline-flex items-center gap-1 hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('common.status')}</span>
                      {renderSortIcon('status')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 font-semibold text-center whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('ct')}
                      className="inline-flex items-center justify-center gap-1 hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('veh.colCt')}</span>
                      {renderSortIcon('ct')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 font-semibold text-center whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('paperwork')}
                      className="inline-flex items-center justify-center gap-1 hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('veh.colPaperwork')}</span>
                      {renderSortIcon('paperwork')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 font-semibold text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('purchase')}
                      className="inline-flex items-center justify-end gap-1 ml-auto hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('veh.colPurchasePrice')}</span>
                      {renderSortIcon('purchase')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2.5 font-semibold text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('expenses')}
                      className="inline-flex items-center justify-end gap-1 ml-auto hover:text-[#151922] dark:hover:text-white cursor-pointer"
                    >
                      <span>{t('veh.colExpenses')}</span>
                      {renderSortIcon('expenses')}
                    </button>
                  </th>
                  <th className="py-2.5 pl-2.5 pr-3 font-semibold text-right leading-tight max-w-[105px]">
                    <button
                      type="button"
                      onClick={() => toggleSort('totalInvested')}
                      className="inline-flex items-center justify-end gap-1 ml-auto hover:text-[#151922] dark:hover:text-white cursor-pointer text-right"
                    >
                      <span>{t('veh.colTotalInvested')}</span>
                      {renderSortIcon('totalInvested')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {sortedVehicles.map((v) => {
                  const vehicleName = `${v.marque} ${v.modele}`;
                  const subtitle = [
                    v.version || null,
                    v.energie ? translateValue(t, 'fuel', v.energie) : null,
                    v.boite_vitesses ? translateValue(t, 'gear', v.boite_vitesses) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const expensesCents = v.direct_expenses_cents || 0;
                  const totalInvestedCents = calculateTotalInvestedCents(v.prix_achat_cents, expensesCents);
                  const ctEnabled = isVehicleFlagEnabled(v.ct_ok);
                  const paperworkEnabled = isVehicleFlagEnabled(v.paperwork_done);

                  return (
                    <tr
                      key={v.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, button, select, input, option')) return;
                        navigate(`/vehicles/${v.id}`);
                      }}
                      className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 pl-3 pr-2.5 w-[255px] max-w-[270px]">
                        <Link
                          to={`/vehicles/${v.id}`}
                          aria-label={t('veh.openDetailAria', { name: vehicleName })}
                          className="flex items-center gap-2 group"
                        >
                          <div className="w-10 h-8 rounded-md overflow-hidden bg-[#F0F2F6] dark:bg-gray-800 shrink-0 flex items-center justify-center">
                            {v.primary_photo_url ? (
                              <img
                                src={v.primary_photo_url}
                                alt={vehicleName}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Car className="w-4 h-4 text-[#7A8290]" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 max-w-[198px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[13px] text-[#151922] dark:text-white group-hover:text-[#2563EB] truncate">
                                {vehicleName}
                              </span>
                              {v.annee && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#F0F2F6] dark:bg-gray-800 text-[11px] font-medium font-mono text-[#7A8290] dark:text-gray-300 shrink-0">
                                  {v.annee}
                                </span>
                              )}
                              <ExternalLink className="w-3 h-3 text-[#7A8290] group-hover:text-[#2563EB] shrink-0 transition-colors" />
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 min-w-0">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-[#E7EAF0] dark:border-gray-700 bg-[#F6F7F9] dark:bg-[#0B0F17] font-mono text-xs font-semibold tracking-wide text-[#151922] dark:text-gray-100 whitespace-nowrap shrink-0">
                                {v.immatriculation || '—'}
                              </span>
                              <span className="text-[11px] text-[#7A8290] truncate">
                                {subtitle || '—'}
                              </span>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono text-xs whitespace-nowrap">
                        {v.kilometrage !== null ? `${num(v.kilometrage)} ${t('common.kmUnit')}` : '—'}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <select
                          aria-label={t('veh.statusAria', { name: vehicleName })}
                          value={v.status}
                          disabled={updatingFieldKey === `${v.id}:status`}
                          onChange={(e) =>
                            handleQuickPatch(v, 'status', {
                              status: e.target.value as VehicleStatus,
                              status_reason: 'Mise à jour rapide depuis la liste',
                            })
                          }
                          className={`max-w-[114px] rounded-md border px-1.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer disabled:opacity-60 ${statusSelectClasses(v.status)}`}
                        >
                          {INLINE_VEHICLE_STATUSES.map((st) => (
                            <option key={st} value={st} className="bg-white dark:bg-[#111827] text-[#151922] dark:text-gray-100">
                              {t(`status.${st}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <select
                          aria-label={t('veh.ctAria', { name: vehicleName })}
                          value={ctEnabled ? 'yes' : 'no'}
                          disabled={updatingFieldKey === `${v.id}:ct_ok`}
                          onChange={(e) =>
                            handleQuickPatch(v, 'ct_ok', { ct_ok: e.target.value === 'yes' ? 1 : 0 })
                          }
                          className={`rounded-md border px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer disabled:opacity-60 ${yesNoSelectClasses(ctEnabled)}`}
                        >
                          <option value="yes">{t('veh.yes')}</option>
                          <option value="no">{t('veh.no')}</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <select
                          aria-label={t('veh.paperworkAria', { name: vehicleName })}
                          value={paperworkEnabled ? 'yes' : 'no'}
                          disabled={updatingFieldKey === `${v.id}:paperwork_done`}
                          onChange={(e) =>
                            handleQuickPatch(v, 'paperwork_done', {
                              paperwork_done: e.target.value === 'yes' ? 1 : 0,
                            })
                          }
                          className={`rounded-md border px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer disabled:opacity-60 ${yesNoSelectClasses(paperworkEnabled)}`}
                        >
                          <option value="yes">{t('veh.yes')}</option>
                          <option value="no">{t('veh.no')}</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                        <div className="font-mono text-[13px] font-medium text-[#151922] dark:text-gray-100">
                          {money(v.prix_achat_cents)}
                        </div>
                        <div className="text-[10px] text-[#7A8290]">{date(v.date_achat)}</div>
                      </td>
                      <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <span className="font-mono text-[13px] text-[#151922] dark:text-gray-200">
                            {money(expensesCents)}
                          </span>
                          <button
                            type="button"
                            aria-label={t('veh.quickAddExpenseAria', { name: vehicleName })}
                            onClick={() => setQuickExpenseVehicle(v)}
                            className="w-5 h-5 inline-flex items-center justify-center rounded border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] text-[#7A8290] hover:text-[#2563EB] hover:border-[#2563EB] transition-colors cursor-pointer shrink-0"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 pl-2.5 pr-3 text-right font-mono text-[13px] font-semibold text-[#151922] dark:text-white whitespace-nowrap">
                        {money(totalInvestedCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#E7EAF0] dark:border-gray-800 bg-[#F6F7F9]/80 dark:bg-[#0B0F17]/80 text-xs font-semibold">
                  <td colSpan={5} className="py-2.5 pl-3 pr-2.5 text-[#151922] dark:text-gray-200 whitespace-nowrap">
                    {t('veh.totalRow', { count: totals.count })}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-[#151922] dark:text-white whitespace-nowrap">
                    {money(totals.totalPurchaseCents)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-[#151922] dark:text-white whitespace-nowrap">
                    <span className="pr-[24px]">{money(totals.totalExpensesCents)}</span>
                  </td>
                  <td className="py-2.5 pl-2.5 pr-3 text-right font-mono text-[#2563EB] dark:text-blue-400 whitespace-nowrap">
                    {money(totals.totalInvestedCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {sortedVehicles.map((v) => (
            <Card key={v.id} className="overflow-hidden flex flex-col">
              <Link to={`/vehicles/${v.id}`} className="block aspect-[4/3] bg-[#F0F2F6] dark:bg-gray-800 overflow-hidden">
                {v.primary_photo_url ? (
                  <img
                    src={v.primary_photo_url}
                    alt={`${v.marque} ${v.modele}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover hover:scale-[1.02] transition-transform"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#7A8290]">
                    <Car className="w-10 h-10" />
                  </div>
                )}
              </Link>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#7A8290]">
                      {v.legal_context === 'professional' ? t('common.professionalLabel') : t('common.personalLabel')} · {v.immatriculation || '—'}
                    </span>
                    <StatusLabel tone={statusTone(v.status)} label={t(`status.${v.status}`)} />
                  </div>
                  <Link
                    to={`/vehicles/${v.id}`}
                    className="mt-1 block text-base font-semibold text-[#151922] dark:text-white hover:text-[#2563EB] font-display"
                  >
                    {v.marque} {v.modele}
                  </Link>
                  <div className="mt-1 text-xs text-[#7A8290]">
                    {[
                      v.annee,
                      v.kilometrage ? `${num(v.kilometrage)} ${t('common.kmUnit')}` : null,
                      v.energie ? translateValue(t, 'fuel', v.energie) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-[#E7EAF0] dark:border-gray-800 flex items-center justify-between text-sm">
                  <div>
                    <div className="text-[11px] text-[#7A8290]">{t('veh.colPurchase')}</div>
                    <div className="font-mono font-semibold">{money(v.prix_achat_cents)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-[#7A8290]">{t('veh.colPlannedPrice')}</div>
                    <div className="font-mono font-semibold text-[#2563EB]">
                      {v.prix_vente_prevu_cents ? money(v.prix_vente_prevu_cents) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <QuickExpenseModal
        open={Boolean(activeQuickExpenseVehicle)}
        onClose={() => setQuickExpenseVehicle(null)}
        vehicle={activeQuickExpenseVehicle}
      />
    </div>
  );
};
