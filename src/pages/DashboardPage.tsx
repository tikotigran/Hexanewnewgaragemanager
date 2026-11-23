import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { Plus, ArrowUpRight, ArrowDownRight, Calendar as CalendarIcon, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useI18n } from '../context/I18nContext';
import { Button, Card, Input, StatusLabel, TableSkeleton } from '../components/ui/Primitives';

interface DashboardResponse {
  kpis: {
    vehiclesInStock: number;
    vehiclesInPreparation: number;
    vehiclesForSale: number;
    vehiclesSold: number;
    totalPurchasesCents: number;
    totalSalesCents: number;
    proRevenueCents: number;
    totalExpensesCents: number;
    estimatedGrossMarginCents: number;
    cashFlowNetCents: number;
    estimatedSocialCents: number;
    estimatedVatPayableCents: number;
  };
  monthlyCharts: Array<{
    month: string;
    salesCents: number;
    purchasesCents: number;
    expensesCents: number;
    inflowsCents: number;
    outflowsCents: number;
  }>;
  vehicleProfitability: Array<{
    id: number;
    name: string;
    marginEur: number;
    realized: boolean;
  }>;
  recentTransactions: Array<{
    id: number;
    direction: 'inflow' | 'outflow';
    amount_cents: number;
    operation_date: string;
    description: string;
    legal_context: string;
  }>;
  upcomingEvents: Array<{
    id: number;
    title: string;
    start_at: string;
    event_type: string;
  }>;
  attentionVehicles: Array<{
    id: number;
    marque: string;
    modele: string;
    immatriculation: string;
    status: string;
  }>;
}

type PeriodPreset = 'all' | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

function computeDateRange(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'today') return { from: to, to };
  if (preset === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { from: d.toISOString().slice(0, 10), to };
  }
  if (preset === 'month') {
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  if (preset === 'quarter') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3 + 1;
    return { from: `${now.getFullYear()}-${String(qStartMonth).padStart(2, '0')}-01`, to };
  }
  if (preset === 'year') {
    return { from: `${now.getFullYear()}-01-01`, to };
  }
  return { from: '', to: '' };
}

export const DashboardPage: React.FC = () => {
  const { t, money, date, num } = useI18n();
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | 'personal' | 'professional'>('all');

  const range = preset === 'custom' ? { from: customFrom, to: customTo } : computeDateRange(preset);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', range.from, range.to, contextFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      if (contextFilter !== 'all') params.set('legal_context', contextFilter);
      return apiFetch<DashboardResponse>(`/api/dashboard?${params.toString()}`);
    },
  });

  const chartData = (data?.monthlyCharts || []).map((m) => ({
    month: m.month,
    sales: Math.round(m.salesCents / 100),
    purchases: Math.round(m.purchasesCents / 100),
    expenses: Math.round(m.expensesCents / 100),
    inflows: Math.round(m.inflowsCents / 100),
    outflows: Math.round(m.outflowsCents / 100),
  }));

  const periodLabels: Record<PeriodPreset, string> = {
    all: t('dash.periodAll'),
    today: t('dash.periodToday'),
    week: t('dash.periodWeek'),
    month: t('dash.periodMonth'),
    quarter: t('dash.periodQuarter'),
    year: t('dash.periodYear'),
    custom: t('dash.periodCustom'),
  };

  return (
    <div className="space-y-6">
      {/* Header + Period Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">
            {t('dash.title')}
          </h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('dash.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-800 max-w-full">
            {(['all', 'today', 'week', 'month', 'quarter', 'year', 'custom'] as PeriodPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  preset === p
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
                }`}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#111827] border border-[#E7EAF0] dark:border-gray-800">
            {(['all', 'professional', 'personal'] as const).map((ctx) => (
              <button
                key={ctx}
                type="button"
                onClick={() => setContextFilter(ctx)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  contextFilter === ctx
                    ? 'bg-[#151922] dark:bg-gray-200 text-white dark:text-[#151922]'
                    : 'text-[#7A8290]'
                }`}
              >
                {ctx === 'all' ? t('dash.ctxMixed') : ctx === 'professional' ? t('dash.ctxPro') : t('dash.ctxPerso')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-3">
          <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-44" />
          <span className="text-xs text-[#7A8290]">→</span>
          <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-44" />
        </div>
      )}

      {/* Quick Actions Strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/vehicles/new">
          <Button size="sm">
            <Plus className="w-3.5 h-3.5" />
            {t('veh.addVehicle')}
          </Button>
        </Link>
        <Link to="/achats?new=1">
          <Button variant="secondary" size="sm">{t('dash.actPurchase')}</Button>
        </Link>
        <Link to="/ventes?new=1">
          <Button variant="secondary" size="sm">{t('dash.actSale')}</Button>
        </Link>
        <Link to="/depenses?new=1">
          <Button variant="secondary" size="sm">{t('dash.actExpense')}</Button>
        </Link>
        <Link to="/facturation?new=1">
          <Button variant="secondary" size="sm">{t('dash.actInvoice')}</Button>
        </Link>
      </div>

      {/* KPI Grid (12 real metrics) */}
      {isLoading || !data ? (
        <Card>
          <TableSkeleton rows={4} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: t('dash.inStock'), value: num(data.kpis.vehiclesInStock), tone: 'neutral' as const },
              { label: t('dash.inPrep'), value: num(data.kpis.vehiclesInPreparation), tone: 'amber' as const },
              { label: t('dash.forSale'), value: num(data.kpis.vehiclesForSale), tone: 'blue' as const },
              { label: t('dash.sold'), value: num(data.kpis.vehiclesSold), tone: 'green' as const },
              { label: t('dash.totalPurchases'), value: money(data.kpis.totalPurchasesCents), tone: 'neutral' as const },
              { label: t('dash.totalSales'), value: money(data.kpis.totalSalesCents), tone: 'neutral' as const },
              { label: t('dash.proTurnover'), value: money(data.kpis.proRevenueCents), tone: 'blue' as const },
              { label: t('dash.expenses'), value: money(data.kpis.totalExpensesCents), tone: 'neutral' as const },
              {
                label: t('dash.grossMargin'),
                value: money(data.kpis.estimatedGrossMarginCents),
                tone: data.kpis.estimatedGrossMarginCents >= 0 ? ('green' as const) : ('red' as const),
              },
              {
                label: t('dash.cashFlow'),
                value: money(data.kpis.cashFlowNetCents),
                tone: data.kpis.cashFlowNetCents >= 0 ? ('green' as const) : ('red' as const),
              },
              { label: t('dash.socialCharges'), value: money(data.kpis.estimatedSocialCents), tone: 'amber' as const },
              { label: t('dash.vatEstimated'), value: money(data.kpis.estimatedVatPayableCents), tone: 'neutral' as const },
            ].map((kpi) => (
              <Card key={kpi.label} className="p-4">
                <div className="text-xs text-[#7A8290] truncate">{kpi.label}</div>
                <div
                  className={`mt-1.5 text-xl font-semibold font-mono-num ${
                    kpi.tone === 'green'
                      ? 'text-[#16A36A]'
                      : kpi.tone === 'red'
                      ? 'text-[#DC4545]'
                      : kpi.tone === 'blue'
                      ? 'text-[#2563EB]'
                      : kpi.tone === 'amber'
                      ? 'text-[#D97706]'
                      : 'text-[#151922] dark:text-white'
                  }`}
                >
                  {kpi.value}
                </div>
              </Card>
            ))}
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <h2 className="text-sm font-semibold font-display mb-4">{t('dash.chartMonthlyTitle')}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7EAF0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="sales" name={t('dash.seriesSales')} fill="#2563EB" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="purchases" name={t('dash.seriesPurchases')} fill="#7A8290" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name={t('dash.seriesExpenses')} fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold font-display mb-4">{t('dash.chartCashflowTitle')}</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7EAF0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="inflows" name={t('dash.seriesInflows')} stroke="#16A36A" fill="#16A36A" fillOpacity={0.14} />
                    <Area type="monotone" dataKey="outflows" name={t('dash.seriesOutflows')} stroke="#DC4545" fill="#DC4545" fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Vehicle Profitability + Activity Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-5">
              <h2 className="text-sm font-semibold font-display mb-4">{t('dash.chartProfitTitle')}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.vehicleProfitability} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7EAF0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="marginEur" name={t('dash.seriesMargin')} fill="#2563EB" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold font-display">{t('dash.recentOps')}</h2>
                <Link to="/finance" className="text-xs text-[#2563EB] hover:underline">
                  {t('dash.seeAll')}
                </Link>
              </div>
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {data.recentTransactions.length === 0 ? (
                  <p className="text-xs text-[#7A8290] py-4">{t('common.noData')}</p>
                ) : (
                  data.recentTransactions.slice(0, 5).map((tx) => (
                    <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {tx.direction === 'inflow' ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5 text-[#DC4545] shrink-0" />
                        )}
                        <div className="truncate">
                          <div className="font-medium text-[#151922] dark:text-gray-100 truncate">
                            {tx.description}
                          </div>
                          <div className="text-[#7A8290]">{date(tx.operation_date)}</div>
                        </div>
                      </div>
                      <span
                        className={`font-mono-num font-medium shrink-0 ${
                          tx.direction === 'inflow' ? 'text-[#16A36A]' : 'text-[#151922] dark:text-gray-100'
                        }`}
                      >
                        {tx.direction === 'inflow' ? '+' : '-'}
                        {money(tx.amount_cents)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold font-display flex items-center gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5 text-[#2563EB]" />
                    {t('dash.upcomingEvents')}
                  </h2>
                  <Link to="/calendrier" className="text-xs text-[#2563EB] hover:underline">
                    {t('dash.calendarLink')}
                  </Link>
                </div>
                <div className="space-y-2">
                  {data.upcomingEvents.length === 0 ? (
                    <p className="text-xs text-[#7A8290]">{t('dash.noEvents')}</p>
                  ) : (
                    data.upcomingEvents.slice(0, 3).map((ev) => (
                      <div key={ev.id} className="text-xs flex justify-between gap-2 py-1">
                        <span className="truncate font-medium">{ev.title}</span>
                        <span className="text-[#7A8290] shrink-0 font-mono-num">{date(ev.start_at)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-[#E7EAF0] dark:border-gray-800">
                <h2 className="text-sm font-semibold font-display flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
                  {t('dash.attentionVehicles')}
                </h2>
                <div className="space-y-2">
                  {data.attentionVehicles.length === 0 ? (
                    <p className="text-xs text-[#7A8290]">{t('dash.allVehiclesOk')}</p>
                  ) : (
                    data.attentionVehicles.slice(0, 3).map((v) => (
                      <Link
                        key={v.id}
                        to={`/vehicles/${v.id}`}
                        className="flex items-center justify-between text-xs py-1 hover:underline"
                      >
                        <span className="font-medium truncate">
                          {v.marque} {v.modele} · {v.immatriculation || t('common.noPlate')}
                        </span>
                        <StatusLabel tone="amber" label={t(`status.${v.status}`)} />
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
