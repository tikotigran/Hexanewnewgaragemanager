import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CreditCard,
  Download,
  FileCode2,
  Plus,
  Receipt,
  Search,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { apiFetch, downloadProtectedFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { translateValue } from '../i18n/translations';
import { useToast } from '../context/ToastContext';
import { eurosToCents } from '../lib/utils';
import type { Contact, Invoice, Vehicle } from '../types';
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

const VAT_MENTIONS: Record<string, string> = {
  franchise_en_base: 'TVA non applicable, art. 293 B du CGI',
  tva_sur_marge: "Régime particulier – Biens d'occasion – Article 297 A du CGI",
  tva_sur_prix_total: 'TVA sur le prix total (taux normal 20 %)',
  autre_regime: 'Exonération ou régime spécifique (préciser mention)',
};

export const InvoicingPage: React.FC = () => {
  const { businessProfiles } = useAuth();
  const { t, money, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Create invoice modal
  const [createOpen, setCreateOpen] = useState(false);
  const [bpId, setBpId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [contactId, setContactId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [vatRegime, setVatRegime] = useState<
    'franchise_en_base' | 'tva_sur_marge' | 'tva_sur_prix_total' | 'autre_regime'
  >('franchise_en_base');
  const [vatMention, setVatMention] = useState(VAT_MENTIONS.franchise_en_base);
  const [facturxProfile, setFacturxProfile] = useState<'MINIMUM' | 'BASIC' | 'EN16931'>('BASIC');
  const [paymentTerms, setPaymentTerms] = useState('Paiement à réception par virement ou chèque de banque');
  const [issueImmediately, setIssueImmediately] = useState(true);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ description: string; quantity: number; unitPriceEuros: string }>>([
    { description: 'Vente véhicule d’occasion', quantity: 1, unitPriceEuros: '' },
  ]);
  const [saving, setSaving] = useState(false);

  // Payment modal
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('virement');
  const [payRef, setPayRef] = useState('');
  const [payIdemKey, setPayIdemKey] = useState('');
  const [paying, setPaying] = useState(false);

  // Detail / PA modal
  const [detailInvoiceId, setDetailInvoiceId] = useState<number | null>(null);
  const [paResult, setPaResult] = useState<{
    status: string;
    message: string;
    validation?: { valid: boolean; errors: string[] };
  } | null>(null);

  useEffect(() => {
    if (businessProfiles.length > 0 && !bpId) {
      setBpId(String(businessProfiles[0].id));
      const reg = businessProfiles[0].regime_tva;
      setVatRegime(reg);
      setVatMention(VAT_MENTIONS[reg] || '');
    }
  }, [businessProfiles, bpId]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreateOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (statusFilter !== 'all') p.set('status', statusFilter);
      return apiFetch<{ invoices: Invoice[] }>(`/api/invoices?${p.toString()}`);
    },
  });

  const { data: vehData } = useQuery({
    queryKey: ['vehicles-inv-select'],
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-inv-select'],
    queryFn: () => apiFetch<{ contacts: Contact[] }>('/api/contacts'),
  });

  const { data: detailData } = useQuery({
    queryKey: ['invoice-detail', detailInvoiceId],
    enabled: Boolean(detailInvoiceId),
    queryFn: () =>
      apiFetch<{
        invoice: Invoice;
        lines: Array<{ id: number; description: string; quantity: number; total_ttc_cents: number }>;
        payments: Array<{ id: number; amount_cents: number; payment_date: string; payment_method: string; reference: string }>;
      }>(`/api/invoices/${detailInvoiceId}`),
  });

  const handleVehicleSelect = (vid: string) => {
    setVehicleId(vid);
    const v = vehData?.vehicles.find((x) => x.id === Number(vid));
    if (v) {
      const refCents = v.prix_vente_final_cents || v.prix_vente_prevu_cents || 0;
      setLines([
        {
          description: `${v.marque} ${v.modele} ${v.version || ''} — Immat ${v.immatriculation || '—'} — VIN ${v.vin || '—'}`.trim(),
          quantity: 1,
          unitPriceEuros: refCents ? String(refCents / 100) : '',
        },
      ]);
    }
  };

  const handleRegimeChange = (reg: typeof vatRegime) => {
    setVatRegime(reg);
    setVatMention(VAT_MENTIONS[reg] || '');
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !bpId) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ invoice: Invoice; eligibilityWarning?: string }>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          business_profile_id: Number(bpId),
          vehicle_id: vehicleId ? Number(vehicleId) : null,
          contact_id: contactId ? Number(contactId) : null,
          issue_date: issueDate,
          due_date: dueDate,
          vat_regime: vatRegime,
          vat_rate_bps: 2000,
          vat_legal_mention: vatMention,
          payment_terms: paymentTerms,
          facturx_profile: facturxProfile,
          notes,
          issue_immediately: issueImmediately,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 1,
            unit_price_ttc_cents: eurosToCents(l.unitPriceEuros),
          })),
        }),
      });
      if (res.eligibilityWarning) {
        toast(res.eligibilityWarning, 'warning');
      } else {
        toast(t('inv.createdToast', { num: res.invoice.invoice_number }), 'success');
      }
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleIssueDraft = async (invId: number) => {
    await apiFetch(`/api/invoices/${invId}/issue`, { method: 'POST' });
    toast(t('inv.issuedToast'), 'success');
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const openPaymentModal = (inv: Invoice) => {
    const remaining = Math.max(0, inv.total_ttc_cents - inv.paid_cents);
    setPayInvoice(inv);
    setPayAmount(String(remaining / 100));
    setPayIdemKey(`pay-${inv.id}-${Date.now()}`);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payInvoice || paying) return;
    setPaying(true);
    try {
      await apiFetch(`/api/invoices/${payInvoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount_cents: eurosToCents(payAmount),
          payment_date: payDate,
          payment_method: payMethod,
          reference: payRef,
          idempotency_key: payIdemKey,
        }),
      });
      toast(t('inv.paidToast'), 'success');
      setPayInvoice(null);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice-detail', payInvoice.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setPaying(false);
    }
  };

  const testPaTransmission = async (invId: number) => {
    try {
      const res = await apiFetch<typeof paResult>(`/api/invoices/${invId}/pa-transmit`, { method: 'POST' });
      setPaResult(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const invoices = data?.invoices || [];

  const statusTone = (st: string) =>
    st === 'payee' ? 'green' : st === 'partiellement_payee' || st === 'emise' ? 'amber' : st === 'en_retard' ? 'red' : 'neutral';

  const statusLabel = (st: string) => translateValue(t, 'invStatus', st);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.invoicing')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('inv.subtitle')}</p>
        </div>
        {businessProfiles.length > 0 ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" />
            {t('inv.newBtn')}
          </Button>
        ) : (
          <Link to="/parametres">
            <Button variant="secondary">{t('inv.setupProBtn')}</Button>
          </Link>
        )}
      </div>

      {/* Honest Factur-X & PA Compliance Banner */}
      <Card className="p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-[#2563EB] shrink-0 mt-0.5" />
        <div className="text-xs text-[#7A8290] leading-relaxed">
          <strong className="text-[#151922] dark:text-gray-100">{t('inv.bannerTitle')}</strong> {t('inv.bannerBody')}
        </div>
      </Card>

      <Card className="p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7A8290] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inv.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-52">
          <option value="all">{t('common.allStatuses')}</option>
          <option value="brouillon">{t('invStatus.brouillon')}</option>
          <option value="emise">{t('invStatus.emise')}</option>
          <option value="partiellement_payee">{t('invStatus.partiellement_payee')}</option>
          <option value="payee">{t('invStatus.payee')}</option>
          <option value="en_retard">{t('invStatus.en_retard')}</option>
        </Select>
      </Card>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : invoices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt className="w-10 h-10" />}
            title={t('inv.emptyTitle')}
            description={t('inv.emptyDesc')}
            action={
              businessProfiles.length > 0 ? (
                <Button onClick={() => setCreateOpen(true)}>{t('inv.newBtn')}</Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E7EAF0] dark:border-gray-800 text-xs text-[#7A8290]">
                  <th className="py-3 px-4 font-medium">{t('inv.colNumber')}</th>
                  <th className="py-3 px-3 font-medium">{t('inv.colClientVehicle')}</th>
                  <th className="py-3 px-3 font-medium">{t('inv.colVatRegime')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.date')}</th>
                  <th className="py-3 px-3 font-medium">{t('common.status')}</th>
                  <th className="py-3 px-3 font-medium text-right">{t('inv.colTotalPaid')}</th>
                  <th className="py-3 px-4 font-medium text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[#F6F7F9]/60 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => {
                          setPaResult(null);
                          setDetailInvoiceId(inv.id);
                        }}
                        className="font-mono-num font-semibold text-[#2563EB] hover:underline"
                      >
                        {inv.invoice_number}
                      </button>
                      <div className="text-[11px] text-[#7A8290]">Factur-X {inv.facturx_profile}</div>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-medium">
                        {inv.company_name || `${inv.first_name || ''} ${inv.last_name || ''}`.trim() || t('inv.walkInClient')}
                      </div>
                      <div className="text-[#7A8290]">
                        {inv.marque ? `${inv.marque} ${inv.modele} (${inv.immatriculation || '—'})` : '—'}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290] max-w-[200px] truncate" title={inv.vat_legal_mention}>
                      {translateValue(t, 'vat', inv.vat_regime)}
                    </td>
                    <td className="py-3 px-3 text-xs text-[#7A8290] whitespace-nowrap">{date(inv.issue_date)}</td>
                    <td className="py-3 px-3">
                      <StatusLabel tone={statusTone(inv.status)} label={statusLabel(inv.status)} />
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num">
                      <div className="font-semibold">{money(inv.total_ttc_cents)}</div>
                      <div className="text-[11px] text-[#7A8290]">{t('inv.paidPrefix')} {money(inv.paid_cents)}</div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {inv.status === 'brouillon' && (
                          <Button variant="secondary" size="sm" onClick={() => handleIssueDraft(inv.id)}>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t('inv.issueBtn')}
                          </Button>
                        )}
                        {inv.paid_cents < inv.total_ttc_cents && (
                          <Button variant="secondary" size="sm" onClick={() => openPaymentModal(inv)}>
                            <CreditCard className="w-3.5 h-3.5" />
                            {t('inv.payBtn')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          title={t('inv.hybridPdf')}
                          onClick={() => downloadProtectedFile(`/api/invoices/${inv.id}/pdf`, `facture-${inv.invoice_number}.pdf`)}
                        >
                          <Download className="w-3.5 h-3.5" />
                          PDF
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="XML Factur-X"
                          onClick={() => downloadProtectedFile(`/api/invoices/${inv.id}/xml`, `facturx-${inv.invoice_number}.xml`)}
                        >
                          <FileCode2 className="w-3.5 h-3.5" />
                          XML
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Invoice Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('inv.modalTitle')} maxWidth="max-w-3xl">
        <form onSubmit={handleCreateInvoice} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>{t('inv.emitterPro')}</FieldLabel>
              <Select required value={bpId} onChange={(e) => setBpId(e.target.value)}>
                {businessProfiles.map((bp) => (
                  <option key={bp.id} value={bp.id}>
                    {bp.nom_commercial}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>{t('common.vehicle')}</FieldLabel>
              <Select value={vehicleId} onChange={(e) => handleVehicleSelect(e.target.value)}>
                <option value="">{t('inv.noLinkedVehicle')}</option>
                {(vehData?.vehicles || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.marque} {v.modele} ({v.immatriculation || '—'})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>{t('inv.clientCrm')}</FieldLabel>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('inv.walkInClient')}</option>
                {(contactsData?.contacts || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || `${c.first_name} ${c.last_name}`}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <FieldLabel required>{t('inv.issueDate')}</FieldLabel>
              <Input type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('inv.dueDate')}</FieldLabel>
              <Input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('sale.vatRegime')}</FieldLabel>
              <Select value={vatRegime} onChange={(e) => handleRegimeChange(e.target.value as typeof vatRegime)}>
                <option value="franchise_en_base">{t('vat.franchise_en_base')}</option>
                <option value="tva_sur_marge">{t('vat.tva_sur_marge')}</option>
                <option value="tva_sur_prix_total">{t('vat.tva_sur_prix_total')}</option>
                <option value="autre_regime">{t('vat.autre_regime')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('inv.facturxProfile')}</FieldLabel>
              <Select value={facturxProfile} onChange={(e) => setFacturxProfile(e.target.value as typeof facturxProfile)}>
                <option value="MINIMUM">MINIMUM</option>
                <option value="BASIC">BASIC</option>
                <option value="EN16931">EN16931</option>
              </Select>
            </div>
          </div>

          <div>
            <FieldLabel>{t('inv.vatMentionLabel')}</FieldLabel>
            <Input value={vatMention} onChange={(e) => setVatMention(e.target.value)} />
          </div>

          {/* Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel required>{t('inv.linesLabel')}</FieldLabel>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setLines([...lines, { description: '', quantity: 1, unitPriceEuros: '' }])}
              >
                {t('inv.addLine')}
              </Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-7">
                  <Input
                    required
                    value={line.description}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx].description = e.target.value;
                      setLines(next);
                    }}
                    placeholder={t('inv.lineDescPlaceholder')}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    min={1}
                    required
                    value={line.quantity}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx].quantity = Number(e.target.value) || 1;
                      setLines(next);
                    }}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    required
                    value={line.unitPriceEuros}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx].unitPriceEuros = e.target.value;
                      setLines(next);
                    }}
                    placeholder="TTC €"
                  />
                </div>
                <div className="col-span-1 text-right">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                      className="p-2 text-[#DC4545]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('inv.paymentTerms')}</FieldLabel>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('common.notes')}</FieldLabel>
              <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#151922] dark:text-gray-200">
            <input
              type="checkbox"
              checked={issueImmediately}
              onChange={(e) => setIssueImmediately(e.target.checked)}
            />
            {t('inv.issueImmediately')}
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.loading') : t('inv.submitCreate')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Payment Modal */}
      <Modal
        open={Boolean(payInvoice)}
        onClose={() => setPayInvoice(null)}
        title={t('inv.payModalTitle', { num: payInvoice?.invoice_number || '' })}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel required>{t('inv.amountPaid')}</FieldLabel>
              <Input
                type="number"
                step="0.01"
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel required>{t('inv.payDate')}</FieldLabel>
              <Input type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>{t('inv.payMethod')}</FieldLabel>
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="virement">{t('payMethod.virement')}</option>
                <option value="cheque_banque">{t('payMethod.cheque_banque')}</option>
                <option value="carte">{t('payMethod.carte')}</option>
                <option value="especes">{t('payMethod.especes')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('inv.bankRef')}</FieldLabel>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="VIR-..." />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setPayInvoice(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={paying}>
              {paying ? t('common.loading') : t('inv.submitPay')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detail & PA Validation Modal */}
      <Modal
        open={Boolean(detailInvoiceId)}
        onClose={() => setDetailInvoiceId(null)}
        title={t('inv.detailTitle', { num: detailData?.invoice.invoice_number || '' })}
      >
        {detailData ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17] text-xs">
              <div>
                <div className="text-[#7A8290]">{t('inv.colVatRegime')}</div>
                <div className="font-medium mt-0.5">{detailData.invoice.vat_legal_mention}</div>
              </div>
              <div className="text-right">
                <div className="text-[#7A8290]">{t('inv.remainingDue')}</div>
                <div className="font-mono-num font-bold text-base">
                  {money(detailData.invoice.total_ttc_cents - detailData.invoice.paid_cents)}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#7A8290] mb-1.5">{t('inv.linesHeading')}</div>
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800">
                {detailData.lines.map((l) => (
                  <div key={l.id} className="py-2 flex justify-between">
                    <span>
                      {l.description} × {l.quantity}
                    </span>
                    <span className="font-mono-num font-medium">{money(l.total_ttc_cents)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#7A8290] mb-1.5">{t('inv.paymentsReceived')}</div>
              {detailData.payments.length === 0 ? (
                <p className="text-xs text-[#7A8290]">{t('inv.noPayments')}</p>
              ) : (
                <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-xs">
                  {detailData.payments.map((p) => (
                    <div key={p.id} className="py-2 flex justify-between">
                      <span>
                        {date(p.payment_date)} · {translateValue(t, 'payMethod', p.payment_method)}{' '}
                        {p.reference ? `(${p.reference})` : ''}
                      </span>
                      <span className="font-mono-num font-semibold text-[#16A36A]">{money(p.amount_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[#E7EAF0] dark:border-gray-800 flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" size="sm" onClick={() => testPaTransmission(detailData.invoice.id)}>
                <Send className="w-3.5 h-3.5" />
                {t('inv.verifyPa')}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    downloadProtectedFile(
                      `/api/invoices/${detailData.invoice.id}/xml`,
                      `facturx-${detailData.invoice.invoice_number}.xml`
                    )
                  }
                >
                  XML
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    downloadProtectedFile(
                      `/api/invoices/${detailData.invoice.id}/pdf`,
                      `facture-${detailData.invoice.invoice_number}.pdf`
                    )
                  }
                >
                  {t('inv.hybridPdf')}
                </Button>
              </div>
            </div>

            {paResult && (
              <div className="p-3 rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-[#F6F7F9] dark:bg-[#0B0F17] text-xs">
                <div className="font-semibold">
                  {t('inv.paStatus')} {paResult.status}
                </div>
                <div className="text-[#7A8290] mt-1">{paResult.message}</div>
              </div>
            )}
          </div>
        ) : (
          <TableSkeleton rows={3} />
        )}
      </Modal>
    </div>
  );
};
