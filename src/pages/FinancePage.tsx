import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Calculator,
  Clock,
  Download,
  Megaphone,
  Package,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { translateValue } from '../i18n/translations';
import { useToast } from '../context/ToastContext';
import {
  Button,
  Card,
  FieldLabel,
  Input,
  Modal,
  Select,
  StatusLabel,
  TableSkeleton,
} from '../components/ui/Primitives';

type PeriodPreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom' | 'all';
type ContextFilter = 'all' | 'professional' | 'personal';
type SubTab = 'overview' | 'stock' | 'cashflow' | 'sales';

interface TaxRuleRow {
  id: number;
  rule_code: string;
  label: string;
  activity_type: string;
  regime_fiscal: 'particulier' | 'micro_bic' | 'micro_bnc' | 'reel_simplifie' | 'reel_normal' | 'is';
  regime_tva: 'franchise_en_base' | 'tva_sur_marge' | 'tva_sur_prix_total' | 'autre_regime';
  social_rate_bps: number;
  income_tax_rate_bps: number;
  vat_rate_bps: number;
  effective_from: string;
  legal_notice: string;
}

interface AnalyticsResponse {
  summary: {
    salesCount: number;
    grossRevenueCents: number;
    proRevenueCents: number;
    grossMarginCents: number;
    grossMarginPct: number;
    generalExpensesCents: number;
    estimatedTaxesTotalCents: number;
    netProfitCents: number;
    netMarginPct: number;
  };
  taxBreakdown: {
    grossRevenueCents: number;
    taxableBaseCents: number;
    estimatedSocialCents: number;
    estimatedIncomeTaxCents: number;
    vatCollectedCents: number;
    vatDeductibleCents: number;
    vatPayableCents: number;
    disclaimer: string;
    socialRateBps: number;
    incomeTaxRateBps: number;
    ruleLabel: string;
    regimeFiscal: string;
  };
  topProfitableVehicles: Array<{
    vehicleId: number;
    saleId: number;
    marque: string;
    modele: string;
    immatriculation: string;
    legalContext: 'personal' | 'professional';
    saleDate: string;
    daysToSell: number;
    purchaseCents: number;
    directExpensesCents: number;
    revenueCents: number;
    grossMarginCents: number;
    marginPct: number;
  }>;
  stock: {
    activeCount: number;
    forSaleCount: number;
    totalValueCents: number;
    investedCapitalCents: number;
    potentialProfitCents: number;
    avgDaysToSell: number | null;
    ageDistribution: Array<{
      bracket: '0_30' | '31_60' | '61_90' | 'gt_90';
      label: string;
      count: number;
      investedCents: number;
    }>;
    longStockVehicles: Array<{
      vehicleId: number;
      marque: string;
      modele: string;
      immatriculation: string;
      legalContext: 'personal' | 'professional';
      dateAchat: string;
      daysInStock: number;
      investedCents: number;
      targetPriceCents: number | null;
    }>;
  };
  cashFlow: {
    totalInflowsPaidCents: number;
    totalOutflowsPaidCents: number;
    netCashFlowCents: number;
    pendingInflowsCents: number;
    pendingOutflowsCents: number;
    monthlySeries: Array<{ month: string; inflowsCents: number; outflowsCents: number; netCents: number }>;
    outflowsSplit: {
      vehiclePurchasesCents: number;
      workshopPartsCents: number;
      generalExpensesCents: number;
      taxesCents: number;
    };
  };
  expenseCategories: Array<{
    code: string;
    scope: 'vehicle' | 'business';
    label_fr: string;
    label_ru: string;
    label_en: string;
    totalCents: number;
    count: number;
    sharePct: number;
  }>;
  vehicleContributors: Array<{
    vehicleId: number;
    marque: string;
    modele: string;
    immatriculation: string;
    directExpensesCents: number;
    expenseCount: number;
  }>;
  salesMetrics: {
    salesCount: number;
    avgPurchaseCents: number;
    avgSaleCents: number;
    avgExpensesPerVehicleCents: number;
    avgNetMarginCents: number;
  };
  channels: Array<{
    channel: 'leboncoin' | 'direct' | 'recommandation' | 'autre';
    salesCount: number;
    revenueCents: number;
    grossMarginCents: number;
    netMarginCents: number;
    avgDaysToSell: number | null;
  }>;
  transactions: Array<{
    id: number;
    direction: 'inflow' | 'outflow';
    category: string;
    legal_context: 'personal' | 'professional';
    amount_cents: number;
    operation_date: string;
    payment_status: string;
    description: string;
    marque?: string;
    modele?: string;
  }>;
  taxRules: TaxRuleRow[];
  savedCalculations: Array<{
    id: number;
    period_start: string;
    period_end: string;
    gross_revenue_cents: number;
    estimated_social_cents: number;
    estimated_income_tax_cents: number;
    vat_payable_cents: number;
    created_at: string;
  }>;
}

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

export const FinancePage: React.FC = () => {
  const { businessProfiles } = useAuth();
  const { t, lang, money, date, num } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [contextFilter, setContextFilter] = useState<ContextFilter>('all');
  const [showLedger, setShowLedger] = useState(false);

  // Tax simulator modal & state
  const [simModalOpen, setSimModalOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const [periodStart, setPeriodStart] = useState(`${currentYear}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${currentYear}-12-31`);
  const [bpId, setBpId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [useVl, setUseVl] = useState(false);
  const [calcResult, setCalcResult] = useState<{
    grossRevenueCents: number;
    taxableBaseCents: number;
    estimatedSocialCents: number;
    estimatedIncomeTaxCents: number;
    vatCollectedCents: number;
    vatDeductibleCents: number;
    vatPayableCents: number;
    disclaimer: string;
  } | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Custom tax rule modal
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleCode, setRuleCode] = useState('CUSTOM_VO_2026');
  const [ruleLabel, setRuleLabel] = useState('');
  const [ruleFiscal, setRuleFiscal] = useState<'micro_bic' | 'reel_simplifie' | 'is'>('micro_bic');
  const [ruleVat, setRuleVat] = useState<'franchise_en_base' | 'tva_sur_marge' | 'tva_sur_prix_total'>('franchise_en_base');
  const [socialPct, setSocialPct] = useState('12.3');
  const [incomePct, setIncomePct] = useState('1.0');
  const [effectiveFrom, setEffectiveFrom] = useState(`${currentYear}-01-01`);

  const range = preset === 'custom' ? { from: customFrom, to: customTo } : computeDateRange(preset);

  const { data, isLoading } = useQuery({
    queryKey: ['finance-analytics', range.from, range.to, contextFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (range.from) p.set('from', range.from);
      if (range.to) p.set('to', range.to);
      p.set('legal_context', contextFilter);
      return apiFetch<AnalyticsResponse>(`/api/finance/analytics?${p.toString()}`);
    },
  });

  useEffect(() => {
    if (data?.taxRules && data.taxRules.length > 0 && !ruleId) {
      setRuleId(String(data.taxRules[0].id));
    }
    if (businessProfiles.length > 0 && !bpId) {
      setBpId(String(businessProfiles[0].id));
    }
  }, [data?.taxRules, businessProfiles, ruleId, bpId]);

  const handleCalculateTax = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleId || calculating) return;
    setCalculating(true);
    try {
      const res = await apiFetch<{ estimate: NonNullable<typeof calcResult> }>('/api/finance/tax-calculate', {
        method: 'POST',
        body: JSON.stringify({
          period_start: periodStart,
          period_end: periodEnd,
          business_profile_id: bpId ? Number(bpId) : null,
          rule_id: Number(ruleId),
          use_versement_liberatoire: useVl,
          save_snapshot: true,
        }),
      });
      setCalcResult(res.estimate);
      toast(t('fin.calcToast'), 'success');
      qc.invalidateQueries({ queryKey: ['finance-analytics'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setCalculating(false);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ rule: TaxRuleRow }>('/api/finance/tax-rules', {
        method: 'POST',
        body: JSON.stringify({
          rule_code: ruleCode,
          label: ruleLabel,
          activity_type: 'achat_revente_vo',
          regime_fiscal: ruleFiscal,
          regime_tva: ruleVat,
          social_rate_bps: Math.round(parseFloat(socialPct || '0') * 100),
          income_tax_rate_bps: Math.round(parseFloat(incomePct || '0') * 100),
          vat_rate_bps: 2000,
          effective_from: effectiveFrom,
          legal_notice: ruleVat === 'franchise_en_base' ? 'TVA non applicable, art. 293 B du CGI' : '',
        }),
      });
      toast(t('fin.ruleToast'), 'success');
      setRuleModalOpen(false);
      setRuleId(String(res.rule.id));
      qc.invalidateQueries({ queryKey: ['finance-analytics'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const exportCashFlowCsv = () => {
    if (!data?.transactions) return;
    const header = [
      t('common.date'),
      t('fin.flow'),
      t('vehDetail.category'),
      t('common.context'),
      t('fin.colDesc'),
      `${t('fin.colAmount')} (EUR)`,
      t('common.status'),
    ].join(';');
    const rows = data.transactions.map((tx) =>
      [
        tx.operation_date,
        tx.direction === 'inflow' ? t('fin.seriesIn') : t('fin.seriesOut'),
        tx.category,
        tx.legal_context === 'professional' ? t('common.professionalLabel') : t('common.personalLabel'),
        `"${tx.description.replace(/"/g, '""')}"`,
        (tx.amount_cents / 100).toFixed(2),
        translateValue(t, 'pay', tx.payment_status),
      ].join(';')
    );
    const blob = new Blob(['\uFEFF' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tresorerie-hexavo-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const periodOptions: Array<{ id: PeriodPreset; label: string }> = [
    { id: 'today', label: t('dash.periodToday') },
    { id: 'week', label: t('fin.periodWeekFull') },
    { id: 'month', label: t('dash.periodMonth') },
    { id: 'quarter', label: t('dash.periodQuarter') },
    { id: 'year', label: t('dash.periodYear') },
    { id: 'custom', label: t('fin.periodCustomFull') },
    { id: 'all', label: t('dash.periodAll') },
  ];

  const contextOptions: Array<{ id: ContextFilter; label: string }> = [
    { id: 'all', label: t('fin.ctxAll') },
    { id: 'professional', label: t('fin.ctxPro') },
    { id: 'personal', label: t('fin.ctxPersonal') },
  ];

  const subTabs: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: t('fin.tabOverview'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'stock', label: t('fin.tabStock'), icon: <Package className="w-4 h-4" /> },
    { id: 'cashflow', label: t('fin.tabCashflowTab'), icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'sales', label: t('fin.tabSalesChannels'), icon: <Megaphone className="w-4 h-4" /> },
  ];

  const summary = data?.summary;
  const tax = data?.taxBreakdown;
  const stock = data?.stock;
  const cashFlow = data?.cashFlow;
  const chartData = (cashFlow?.monthlySeries || []).map((m) => ({
    month: m.month,
    inflows: Math.round(m.inflowsCents / 100),
    outflows: Math.round(m.outflowsCents / 100),
  }));

  const bracketTone = (b: '0_30' | '31_60' | '61_90' | 'gt_90') => {
    if (b === '0_30') return { bar: 'bg-[#16A36A]', text: 'text-[#16A36A]' };
    if (b === '31_60') return { bar: 'bg-[#2563EB]', text: 'text-[#2563EB]' };
    if (b === '61_90') return { bar: 'bg-[#D97706]', text: 'text-[#D97706]' };
    return { bar: 'bg-[#DC4545]', text: 'text-[#DC4545]' };
  };

  const formatBracketLabel = (b: '0_30' | '31_60' | '61_90' | 'gt_90') => {
    const unit = t('fin.daysUnit');
    if (b === '0_30') return `0–30 ${unit}`;
    if (b === '31_60') return `31–60 ${unit}`;
    if (b === '61_90') return `61–90 ${unit}`;
    return `> 90 ${unit}`;
  };

  const localizedCatLabel = (cat: { label_fr: string; label_ru: string; label_en: string }) => {
    if (lang === 'ru') return cat.label_ru || cat.label_fr;
    if (lang === 'en') return cat.label_en || cat.label_fr;
    return cat.label_fr;
  };

  return (
    <div className="space-y-5">
      {/* Shared Top Header + Filter Card */}
      <Card className="p-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">
              {t('fin.title')}
            </h1>
            <p className="text-sm text-[#7A8290] mt-0.5">{t('fin.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Period Selector */}
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17] border border-[#E7EAF0] dark:border-gray-800">
              {periodOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPreset(opt.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    preset === opt.id
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Legal Context Selector */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17] border border-[#E7EAF0] dark:border-gray-800">
              {contextOptions.map((ctx) => (
                <button
                  key={ctx.id}
                  type="button"
                  onClick={() => setContextFilter(ctx.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    contextFilter === ctx.id
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
                  }`}
                >
                  {ctx.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="mt-4 pt-3 border-t border-[#E7EAF0] dark:border-gray-800 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7A8290]">{t('fin.from')}</span>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7A8290]">{t('fin.to')}</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        )}
      </Card>

      {/* 4 Clean Horizontal Sub-Tabs */}
      <div
        role="tablist"
        aria-label={t('fin.title')}
        className="flex items-center gap-1.5 overflow-x-auto border-b border-[#E7EAF0] dark:border-gray-800 pb-px"
      >
        {subTabs.map((tabItem) => {
          const active = subTab === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(tabItem.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'border-[#2563EB] text-[#2563EB] dark:text-white'
                  : 'border-transparent text-[#7A8290] hover:text-[#151922] dark:hover:text-gray-200'
              }`}
            >
              {tabItem.icon}
              <span>{tabItem.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Sub-Tab Body */}
      {isLoading || !data ? (
        <Card>
          <TableSkeleton rows={5} />
        </Card>
      ) : subTab === 'overview' ? (
        <div className="space-y-5">
          {/* 3 Main P&L KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.kpiRevenue')}</div>
              <div className="text-2xl font-bold font-mono-num text-[#151922] dark:text-white mt-1.5">
                {money(summary?.grossRevenueCents)}
              </div>
              <div className="text-xs text-[#7A8290] mt-2 font-mono-num">
                {num(summary?.salesCount)} {t('fin.salesCountLabel')}
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.kpiGrossMargin')}</div>
              <div
                className={`text-2xl font-bold font-mono-num mt-1.5 ${
                  (summary?.grossMarginCents ?? 0) >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                }`}
              >
                {money(summary?.grossMarginCents)}
              </div>
              <div className="text-xs text-[#7A8290] mt-2 font-mono-num">
                {t('fin.marginRateLabel')} : {(summary?.grossMarginPct ?? 0).toFixed(1)} %
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.kpiNetProfit')}</div>
              <div
                className={`text-2xl font-bold font-mono-num mt-1.5 ${
                  (summary?.netProfitCents ?? 0) >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                }`}
              >
                {money(summary?.netProfitCents)}
              </div>
              <div className="text-xs text-[#7A8290] mt-2">
                {contextFilter === 'personal'
                  ? t('fin.personalTaxExemptSub')
                  : t('fin.afterOverheadAndTax')}
              </div>
            </Card>
          </div>

          {/* Tax Breakdown Card (URSSAF / Micro-BIC) */}
          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display">
                  {t('fin.taxCardTitle')}
                </h2>
                <p className="text-xs text-[#7A8290] mt-0.5">{tax?.ruleLabel}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setSimModalOpen(true)}>
                <Calculator className="w-3.5 h-3.5" />
                {t('fin.taxOpenSimulator')}
              </Button>
            </div>

            {contextFilter === 'personal' ? (
              <p className="text-xs text-[#7A8290] py-2">{t('fin.taxPersonalExemptNote')}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-2">
                  <div>
                    <div className="text-xs text-[#7A8290]">{t('fin.taxProEligibleTurnover')}</div>
                    <div className="text-lg font-bold font-mono-num text-[#151922] dark:text-white mt-1">
                      {money(tax?.grossRevenueCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#7A8290]">
                      {t('fin.socialEst')} ({((tax?.socialRateBps || 0) / 100).toFixed(1)}%)
                    </div>
                    <div className="text-lg font-bold font-mono-num text-[#D97706] mt-1">
                      {money(tax?.estimatedSocialCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#7A8290]">{t('fin.incomeTaxEst')}</div>
                    <div className="text-lg font-bold font-mono-num text-[#151922] dark:text-white mt-1">
                      {money(tax?.estimatedIncomeTaxCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#7A8290]">{t('fin.vatNetPayable')}</div>
                    <div className="text-lg font-bold font-mono-num text-[#151922] dark:text-white mt-1">
                      {money(tax?.vatPayableCents)}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[#7A8290] pt-3 mt-3 border-t border-[#E7EAF0] dark:border-gray-800">
                  {t('fin.taxDisclaimer')}
                </p>
              </>
            )}
          </Card>

          {/* Most Profitable Vehicles */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display">
                {t('fin.topProfitableTitle')}
              </h2>
              <span className="text-xs text-[#7A8290] font-mono-num">
                {num(data.topProfitableVehicles.length)} {t('fin.salesCountLabel')}
              </span>
            </div>

            {data.topProfitableVehicles.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#7A8290]">
                {t('fin.topProfitableEmpty')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                      <th className="py-2.5 px-5 font-medium">{t('common.vehicle')}</th>
                      <th className="py-2.5 px-3 font-medium">{t('common.context')}</th>
                      <th className="py-2.5 px-3 font-medium text-right">{t('fin.colDays')}</th>
                      <th className="py-2.5 px-3 font-medium text-right">{t('fin.colInvested')}</th>
                      <th className="py-2.5 px-3 font-medium text-right">{t('fin.colSalePrice')}</th>
                      <th className="py-2.5 px-5 font-medium text-right">{t('fin.kpiGrossMargin')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                    {data.topProfitableVehicles.map((v) => (
                      <tr
                        key={v.saleId}
                        className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40"
                      >
                        <td className="py-2.5 px-5">
                          <Link
                            to={`/vehicles/${v.vehicleId}`}
                            className="font-medium text-[#151922] dark:text-white hover:text-[#2563EB]"
                          >
                            {v.marque} {v.modele}
                          </Link>
                          <div className="text-xs font-mono text-[#7A8290]">
                            {v.immatriculation || '—'} · {date(v.saleDate)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-[#7A8290]">
                          {v.legalContext === 'professional'
                            ? t('common.professionalShort')
                            : t('common.personalShort')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs text-[#7A8290]">
                          {v.daysToSell} {t('fin.daysUnit')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs">
                          {money(v.purchaseCents + v.directExpensesCents)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs">
                          {money(v.revenueCents)}
                        </td>
                        <td
                          className={`py-2.5 px-5 text-right font-mono-num font-semibold ${
                            v.grossMarginCents >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                          }`}
                        >
                          {money(v.grossMarginCents)}{' '}
                          <span className="text-xs font-normal text-[#7A8290]">
                            ({v.marginPct.toFixed(1)}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : subTab === 'stock' ? (
        <div className="space-y-5">
          {/* Active Stock KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.stockValue')}</div>
              <div className="text-xl font-bold font-mono-num text-[#151922] dark:text-white mt-1.5">
                {money(stock?.totalValueCents)}
              </div>
              <div className="text-xs text-[#7A8290] mt-1.5 font-mono-num">
                {num(stock?.activeCount)} {t('fin.stockVehiclesCount')}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.stockCapital')}</div>
              <div className="text-xl font-bold font-mono-num text-[#151922] dark:text-white mt-1.5">
                {money(stock?.investedCapitalCents)}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.stockPotentialProfit')}</div>
              <div
                className={`text-xl font-bold font-mono-num mt-1.5 ${
                  (stock?.potentialProfitCents ?? 0) >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                }`}
              >
                {money(stock?.potentialProfitCents)}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.stockAvgDaysToSell')}</div>
              <div className="text-xl font-bold font-mono-num text-[#151922] dark:text-white mt-1.5">
                {stock?.avgDaysToSell !== null && stock?.avgDaysToSell !== undefined
                  ? `${stock.avgDaysToSell} ${t('fin.daysUnit')}`
                  : '—'}
              </div>
            </Card>
          </div>

          {/* Compact Stock Age Distribution Bar */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display">
                {t('fin.stockAgeTitle')}
              </h2>
              <span className="text-xs text-[#7A8290] font-mono-num">
                {num(stock?.activeCount)} {t('fin.stockVehiclesCount')}
              </span>
            </div>

            {/* Segmented proportion bar */}
            <div className="h-3 w-full rounded-full overflow-hidden bg-[#F0F2F6] dark:bg-gray-800 flex mb-4">
              {(stock?.ageDistribution || []).map((b) => {
                const total = stock?.activeCount || 0;
                const pct = total > 0 ? (b.count / total) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={b.bracket}
                    style={{ width: `${pct}%` }}
                    className={`${bracketTone(b.bracket).bar} h-full transition-all`}
                    title={`${formatBracketLabel(b.bracket)}: ${b.count}`}
                  />
                );
              })}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
              {(stock?.ageDistribution || []).map((b) => (
                <div
                  key={b.bracket}
                  className="pt-2 border-t border-[#E7EAF0] dark:border-gray-800"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-semibold ${bracketTone(b.bracket).text}`}>
                      {formatBracketLabel(b.bracket)}
                    </span>
                    <span className="font-mono-num font-semibold text-[#151922] dark:text-white">
                      {num(b.count)}
                    </span>
                  </div>
                  <div className="text-xs font-mono-num text-[#7A8290] mt-1">
                    {money(b.investedCents)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Aging Vehicles For Sale (> 30 days in en_vente) */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#D97706]" />
                <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display">
                  {t('fin.longStockTitle')}
                </h2>
              </div>
              <span className="text-xs text-[#7A8290]">{t('fin.longStockHint')}</span>
            </div>

            {!stock?.longStockVehicles || stock.longStockVehicles.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#7A8290]">{t('fin.longStockEmpty')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                      <th className="py-2.5 px-5 font-medium">{t('common.vehicle')}</th>
                      <th className="py-2.5 px-3 font-medium">{t('common.context')}</th>
                      <th className="py-2.5 px-3 font-medium text-right">{t('fin.colAgeInStock')}</th>
                      <th className="py-2.5 px-3 font-medium text-right">{t('fin.colInvested')}</th>
                      <th className="py-2.5 px-5 font-medium text-right">{t('fin.colTargetPrice')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                    {stock.longStockVehicles.map((v) => (
                      <tr
                        key={v.vehicleId}
                        className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40"
                      >
                        <td className="py-2.5 px-5">
                          <Link
                            to={`/vehicles/${v.vehicleId}`}
                            className="font-medium text-[#151922] dark:text-white hover:text-[#2563EB]"
                          >
                            {v.marque} {v.modele}
                          </Link>
                          <div className="text-xs font-mono text-[#7A8290]">
                            {v.immatriculation || '—'} · {date(v.dateAchat)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-[#7A8290]">
                          {v.legalContext === 'professional'
                            ? t('common.professionalShort')
                            : t('common.personalShort')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs font-semibold text-[#D97706]">
                          {v.daysInStock} {t('fin.daysUnit')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs">
                          {money(v.investedCents)}
                        </td>
                        <td className="py-2.5 px-5 text-right font-mono-num text-xs font-semibold">
                          {v.targetPriceCents ? money(v.targetPriceCents) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : subTab === 'cashflow' ? (
        <div className="space-y-5">
          {/* Cash Flow Summary Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.cfEncaissements')}</div>
              <div className="text-2xl font-bold font-mono-num text-[#16A36A] mt-1.5">
                {money(cashFlow?.totalInflowsPaidCents)}
              </div>
              {(cashFlow?.pendingInflowsCents ?? 0) > 0 && (
                <div className="text-xs text-[#7A8290] mt-2 font-mono-num">
                  + {money(cashFlow?.pendingInflowsCents)} {t('pay.a_payer').toLowerCase()}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.cfDecaissements')}</div>
              <div className="text-2xl font-bold font-mono-num text-[#DC4545] mt-1.5">
                {money(cashFlow?.totalOutflowsPaidCents)}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-[#E7EAF0] dark:border-gray-800 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7A8290] truncate">{t('fin.cfSplitPurchases')}</span>
                  <span className="font-mono-num font-medium text-[#151922] dark:text-gray-200">
                    {money(cashFlow?.outflowsSplit.vehiclePurchasesCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7A8290] truncate">{t('fin.cfSplitWorkshop')}</span>
                  <span className="font-mono-num font-medium text-[#151922] dark:text-gray-200">
                    {money(cashFlow?.outflowsSplit.workshopPartsCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7A8290] truncate">{t('fin.cfSplitOverhead')}</span>
                  <span className="font-mono-num font-medium text-[#151922] dark:text-gray-200">
                    {money(cashFlow?.outflowsSplit.generalExpensesCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7A8290] truncate">{t('fin.cfSplitTaxes')}</span>
                  <span className="font-mono-num font-medium text-[#151922] dark:text-gray-200">
                    {money(cashFlow?.outflowsSplit.taxesCents)}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.cfNet')}</div>
              <div
                className={`text-2xl font-bold font-mono-num mt-1.5 ${
                  (cashFlow?.netCashFlowCents ?? 0) >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                }`}
              >
                {money(cashFlow?.netCashFlowCents)}
              </div>
              <div className="text-xs text-[#7A8290] mt-2 font-mono-num">
                {num(data.transactions.length)} {t('fin.opsCount')}
              </div>
            </Card>
          </div>

          {/* Compact Bar Chart (h-40) */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display">
                {t('fin.chartTitle')}
              </h2>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowLedger((s) => !s)}>
                  {t('fin.ledgerToggle')} ({num(data.transactions.length)})
                </Button>
                <Button variant="secondary" size="sm" onClick={exportCashFlowCsv}>
                  <Download className="w-3.5 h-3.5" />
                  {t('common.exportCsv')}
                </Button>
              </div>
            </div>

            {chartData.length > 0 ? (
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" opacity={0.35} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#7A8290' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#7A8290' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        borderColor: '#1F2937',
                        color: '#F9FAFB',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="inflows" name={t('fin.seriesIn')} fill="#16A36A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outflows" name={t('fin.seriesOut')} fill="#DC4545" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-[#7A8290]">
                {t('fin.expEmpty')}
              </div>
            )}
          </Card>

          {/* Breakdown Grid: Expense Categories + Contributing Vehicles */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display mb-4">
                {t('fin.expByCategoryTitle')}
              </h2>
              {data.expenseCategories.length === 0 ? (
                <p className="text-sm text-[#7A8290]">{t('fin.expEmpty')}</p>
              ) : (
                <div className="space-y-3">
                  {data.expenseCategories.map((cat) => (
                    <div key={`${cat.scope}:${cat.code}`} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#151922] dark:text-gray-200">
                          {localizedCatLabel(cat)}
                          <span className="text-[#7A8290] font-normal ml-1.5">
                            · {cat.count}
                          </span>
                        </span>
                        <span className="font-mono-num font-semibold text-[#151922] dark:text-white">
                          {money(cat.totalCents)}{' '}
                          <span className="text-[#7A8290] font-normal">({cat.sharePct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#F0F2F6] dark:bg-gray-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            cat.scope === 'vehicle' ? 'bg-[#2563EB]' : 'bg-[#D97706]'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(3, cat.sharePct))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display mb-4">
                {t('fin.expByVehicleTitle')}
              </h2>
              {data.vehicleContributors.length === 0 ? (
                <p className="text-sm text-[#7A8290]">{t('fin.expEmpty')}</p>
              ) : (
                <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                  {data.vehicleContributors.map((v) => (
                    <div
                      key={v.vehicleId}
                      className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/vehicles/${v.vehicleId}`}
                          className="text-xs font-medium text-[#151922] dark:text-gray-100 hover:text-[#2563EB] truncate block"
                        >
                          {v.marque} {v.modele}
                        </Link>
                        <div className="text-[11px] font-mono text-[#7A8290]">
                          {v.immatriculation || '—'} · {v.expenseCount} {t('fin.opsCount')}
                        </div>
                      </div>
                      <div className="font-mono-num text-xs font-semibold text-[#DC4545] shrink-0">
                        {money(v.directExpensesCents)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {showLedger && (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                      <th className="py-2.5 px-4 font-medium">{t('common.date')}</th>
                      <th className="py-2.5 px-3 font-medium">{t('fin.colDesc')}</th>
                      <th className="py-2.5 px-3 font-medium">{t('common.context')}</th>
                      <th className="py-2.5 px-3 font-medium">{t('common.status')}</th>
                      <th className="py-2.5 px-4 font-medium text-right">{t('fin.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                    {data.transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                        <td className="py-2.5 px-4 text-xs text-[#7A8290] whitespace-nowrap">
                          {date(tx.operation_date)}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-xs">{tx.description}</div>
                          <div className="text-[11px] text-[#7A8290]">{tx.category}</div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-[#7A8290]">
                          {tx.legal_context === 'professional'
                            ? t('common.professionalLabel')
                            : t('common.personalLabel')}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusLabel
                            tone={tx.payment_status === 'paye' ? 'green' : 'amber'}
                            label={translateValue(t, 'pay', tx.payment_status)}
                          />
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono-num font-semibold ${
                            tx.direction === 'inflow' ? 'text-[#16A36A]' : 'text-[#DC4545]'
                          }`}
                        >
                          {tx.direction === 'inflow' ? '+' : '-'}
                          {money(tx.amount_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : (
        /* TAB 4: Sales & Channels */
        <div className="space-y-5">
          {/* 4 Key Averages */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.avgPurchase')}</div>
              <div className="text-xl font-bold font-mono-num text-[#151922] dark:text-white mt-1.5">
                {money(data.salesMetrics.avgPurchaseCents)}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.avgSale')}</div>
              <div className="text-xl font-bold font-mono-num text-[#151922] dark:text-white mt-1.5">
                {money(data.salesMetrics.avgSaleCents)}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.avgExpenses')}</div>
              <div className="text-xl font-bold font-mono-num text-[#D97706] mt-1.5">
                {money(data.salesMetrics.avgExpensesPerVehicleCents)}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs font-medium text-[#7A8290]">{t('fin.avgNetMargin')}</div>
              <div
                className={`text-xl font-bold font-mono-num mt-1.5 ${
                  data.salesMetrics.avgNetMarginCents >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                }`}
              >
                {money(data.salesMetrics.avgNetMarginCents)}
              </div>
            </Card>
          </div>

          {/* Breakdown by Sales Channel */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E7EAF0] dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#151922] dark:text-white font-display">
                {t('fin.channelsTitle')}
              </h2>
              <span className="text-xs text-[#7A8290] font-mono-num">
                {num(data.salesMetrics.salesCount)} {t('fin.salesCountLabel')}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                    <th className="py-2.5 px-5 font-medium">{t('fin.colChannel')}</th>
                    <th className="py-2.5 px-3 font-medium text-right">{t('fin.colSalesCount')}</th>
                    <th className="py-2.5 px-3 font-medium text-right">{t('fin.colRevenue')}</th>
                    <th className="py-2.5 px-3 font-medium text-right">{t('fin.colNetMargin')}</th>
                    <th className="py-2.5 px-5 font-medium text-right">{t('fin.colAvgDays')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                  {data.channels.map((ch) => (
                    <tr key={ch.channel} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                      <td className="py-3 px-5 font-medium text-[#151922] dark:text-gray-100">
                        {t(`channel.${ch.channel}`)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-xs">
                        {num(ch.salesCount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-xs">
                        {money(ch.revenueCents)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono-num text-xs font-semibold ${
                          ch.netMarginCents >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                        }`}
                      >
                        {money(ch.netMarginCents)}
                      </td>
                      <td className="py-3 px-5 text-right font-mono-num text-xs text-[#7A8290]">
                        {ch.avgDaysToSell !== null ? `${ch.avgDaysToSell} ${t('fin.daysUnit')}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tax Simulator & Custom Rules Modal */}
      <Modal
        open={simModalOpen}
        onClose={() => setSimModalOpen(false)}
        title={t('fin.tabTaxes')}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-5">
          <p className="text-xs text-[#7A8290] leading-relaxed">
            <strong className="text-[#151922] dark:text-gray-100">{t('fin.taxBannerTitle')}</strong>{' '}
            {t('fin.taxBannerBody')}
          </p>

          <form onSubmit={handleCalculateTax} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold font-display">{t('fin.simParams')}</h3>
              <Button variant="ghost" size="sm" onClick={() => setRuleModalOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                {t('fin.customRuleBtn')}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <FieldLabel required>{t('fin.periodStart')}</FieldLabel>
                <Input type="date" required value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <FieldLabel required>{t('fin.periodEnd')}</FieldLabel>
                <Input type="date" required value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
              {businessProfiles.length > 0 && (
                <div>
                  <FieldLabel>{t('veh.businessProfile')}</FieldLabel>
                  <Select value={bpId} onChange={(e) => setBpId(e.target.value)}>
                    <option value="">{t('fin.allProProfiles')}</option>
                    {businessProfiles.map((bp) => (
                      <option key={bp.id} value={bp.id}>
                        {bp.nom_commercial}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div>
                <FieldLabel required>{t('fin.taxRuleLabel')}</FieldLabel>
                <Select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
                  {(data?.taxRules || []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({(r.social_rate_bps / 100).toFixed(1)}%)
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={useVl} onChange={(e) => setUseVl(e.target.checked)} />
                {t('fin.vlOption')}
              </label>
              <Button type="submit" disabled={calculating || !ruleId}>
                {calculating ? t('fin.calculating') : t('fin.calcSaveBtn')}
              </Button>
            </div>
          </form>

          {calcResult && (
            <div className="pt-4 border-t border-[#E7EAF0] dark:border-gray-800 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-[#7A8290]">{t('fin.caProBrut')}</div>
                  <div className="text-base font-bold font-mono-num">{money(calcResult.grossRevenueCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#7A8290]">{t('fin.socialEst')}</div>
                  <div className="text-base font-bold font-mono-num text-[#D97706]">
                    {money(calcResult.estimatedSocialCents)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#7A8290]">{t('fin.incomeTaxEst')}</div>
                  <div className="text-base font-bold font-mono-num">{money(calcResult.estimatedIncomeTaxCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#7A8290]">{t('fin.vatCollected')}</div>
                  <div className="text-sm font-semibold font-mono-num">{money(calcResult.vatCollectedCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-[#7A8290]">{t('fin.vatDeductible')}</div>
                  <div className="text-sm font-semibold font-mono-num text-[#16A36A]">
                    {money(calcResult.vatDeductibleCents)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#7A8290]">{t('fin.vatNetPayable')}</div>
                  <div className="text-sm font-semibold font-mono-num">{money(calcResult.vatPayableCents)}</div>
                </div>
              </div>
              <p className="text-xs text-[#7A8290]">{calcResult.disclaimer}</p>
            </div>
          )}

          {(data?.savedCalculations || []).length > 0 && (
            <div className="pt-4 border-t border-[#E7EAF0] dark:border-gray-800">
              <h4 className="text-xs font-semibold text-[#7A8290] mb-2">{t('fin.calcHistory')}</h4>
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-xs max-h-40 overflow-y-auto">
                {data!.savedCalculations.map((sc) => (
                  <div key={sc.id} className="py-2 flex items-center justify-between gap-2">
                    <span>
                      {date(sc.period_start)} → {date(sc.period_end)}
                    </span>
                    <span className="font-mono-num">
                      CA {money(sc.gross_revenue_cents)} · URSSAF {money(sc.estimated_social_cents)} · TVA{' '}
                      {money(sc.vat_payable_cents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Custom Tax Rule Creation Modal */}
      <Modal open={ruleModalOpen} onClose={() => setRuleModalOpen(false)} title={t('fin.ruleModalTitle')}>
        <form onSubmit={handleCreateRule} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('fin.ruleCode')}</FieldLabel>
              <Input required value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('fin.ruleLabel')}</FieldLabel>
              <Input
                required
                value={ruleLabel}
                onChange={(e) => setRuleLabel(e.target.value)}
                placeholder={t('fin.ruleLabelPlaceholder')}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('fin.fiscalRegime')}</FieldLabel>
              <Select value={ruleFiscal} onChange={(e) => setRuleFiscal(e.target.value as typeof ruleFiscal)}>
                <option value="micro_bic">{t('fiscal.micro_bic')}</option>
                <option value="reel_simplifie">{t('fiscal.reel_simplifie')}</option>
                <option value="is">{t('fiscal.is')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('sale.vatRegime')}</FieldLabel>
              <Select value={ruleVat} onChange={(e) => setRuleVat(e.target.value as typeof ruleVat)}>
                <option value="franchise_en_base">{t('vat.franchise_en_base')}</option>
                <option value="tva_sur_marge">{t('vat.tva_sur_marge')}</option>
                <option value="tva_sur_prix_total">{t('vat.tva_sur_prix_total')}</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('fin.socialRatePct')}</FieldLabel>
              <Input type="number" step="0.1" value={socialPct} onChange={(e) => setSocialPct(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('fin.irRatePct')}</FieldLabel>
              <Input type="number" step="0.1" value={incomePct} onChange={(e) => setIncomePct(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('fin.effectiveFrom')}</FieldLabel>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setRuleModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('fin.saveRuleBtn')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
