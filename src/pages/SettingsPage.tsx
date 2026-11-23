import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  Database,
  Download,
  Eraser,
  FileSpreadsheet,
  Info,
  KeyRound,
  Mail,
  Palette,
  PenTool,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { apiFetch, downloadProtectedFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { translateValue } from '../i18n/translations';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import type {
  AccountingSettingsData,
  BrandingSettingsData,
  BusinessProfile,
  CompanySettingsData,
  Language,
} from '../types';
import { Button, Card, FieldLabel, Input, Modal, Select } from '../components/ui/Primitives';
import { cn } from '../lib/utils';

type SettingsTab = 'company' | 'branding' | 'accounting';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

async function fileToSafePngDataUrl(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
    throw new Error('INVALID_TYPE');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('TOO_LARGE');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('DECODE_FAILED'));
    image.src = rawDataUrl;
  });

  const maxW = 560;
  const maxH = 260;
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_FAILED');
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/png');
}

export const SettingsPage: React.FC = () => {
  const { user, businessProfiles, refreshMe } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<SettingsTab>('company');
  const [savedSection, setSavedSection] = useState<'company' | 'branding' | 'signature' | 'accountant' | null>(null);

  // Tab 1: Company Details & Banking
  const [companyForm, setCompanyForm] = useState<CompanySettingsData>({
    companyName: '',
    siret: '',
    address: '',
    postalCode: '',
    city: '',
    country: 'France',
    phone: '',
    email: '',
    vatNumber: '',
    iban: '',
  });
  const [savingCompany, setSavingCompany] = useState(false);

  // Secondary personal profile & password
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [address, setAddress] = useState(user?.address || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Business Profile Modal (multi-entity support)
  const [bpModalOpen, setBpModalOpen] = useState(false);
  const [editingBp, setEditingBp] = useState<BusinessProfile | null>(null);
  const [nomCommercial, setNomCommercial] = useState('');
  const [raisonSociale, setRaisonSociale] = useState('');
  const [siren, setSiren] = useState('');
  const [siret, setSiret] = useState('');
  const [adressePro, setAdressePro] = useState('');
  const [bpEmail, setBpEmail] = useState('');
  const [bpTel, setBpTel] = useState('');
  const [formeJuridique, setFormeJuridique] = useState('Entrepreneur individuel (Micro-entreprise)');
  const [regimeFiscal, setRegimeFiscal] = useState<BusinessProfile['regime_fiscal']>('micro_bic');
  const [regimeTva, setRegimeTva] = useState<BusinessProfile['regime_tva']>('franchise_en_base');
  const [tvaIntracom, setTvaIntracom] = useState('');

  // Tab 2: Branding & Signature
  const [brandingForm, setBrandingForm] = useState<BrandingSettingsData>({
    logoDataUrl: '',
    primaryColor: '#2563EB',
    secondaryColor: '#151922',
    signatureDataUrl: '',
  });
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const hasDrawnStrokeRef = useRef(false);

  // Tab 3: Accounting & CSV Export
  const [accountantEmail, setAccountantEmail] = useState('');
  const [savingAccountant, setSavingAccountant] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;
  const [exportFrom, setExportFrom] = useState(monthStartIso);
  const [exportTo, setExportTo] = useState(todayIso);

  const { data: sysData } = useQuery({
    queryKey: ['settings-backups'],
    queryFn: () =>
      apiFetch<{
        settings: Record<string, unknown>;
        backups: Array<{ fileName: string; sizeBytes: number; createdAt: string }>;
      }>('/api/settings'),
  });

  // Hydrate forms from saved app_settings + primary business profile fallback
  useEffect(() => {
    const primaryBp = businessProfiles[0];
    const savedCompany = (sysData?.settings?.company_settings || {}) as Partial<CompanySettingsData>;
    const savedBranding = (sysData?.settings?.branding_settings || {}) as Partial<BrandingSettingsData>;
    const savedAccounting = (sysData?.settings?.accounting_settings || {}) as Partial<AccountingSettingsData>;

    setCompanyForm({
      companyName: savedCompany.companyName ?? primaryBp?.nom_commercial ?? '',
      siret: savedCompany.siret ?? primaryBp?.siret ?? '',
      address: savedCompany.address ?? primaryBp?.adresse_pro ?? '',
      postalCode: savedCompany.postalCode ?? '',
      city: savedCompany.city ?? '',
      country: savedCompany.country || 'France',
      phone: savedCompany.phone ?? primaryBp?.telephone ?? user?.phone ?? '',
      email: savedCompany.email ?? primaryBp?.email ?? user?.email ?? '',
      vatNumber: savedCompany.vatNumber ?? primaryBp?.tva_intracom ?? '',
      iban: savedCompany.iban ?? primaryBp?.iban ?? '',
    });

    setBrandingForm({
      logoDataUrl: savedBranding.logoDataUrl ?? primaryBp?.logo_url ?? '',
      primaryColor: HEX_COLOR_RE.test(savedBranding.primaryColor || '')
        ? String(savedBranding.primaryColor)
        : '#2563EB',
      secondaryColor: HEX_COLOR_RE.test(savedBranding.secondaryColor || '')
        ? String(savedBranding.secondaryColor)
        : '#151922',
      signatureDataUrl: savedBranding.signatureDataUrl ?? '',
    });

    setAccountantEmail(savedAccounting.accountantEmail ?? '');
  }, [sysData, businessProfiles, user]);

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      setPhone(user.phone || '');
      setAddress(user.address || '');
    }
  }, [user]);

  const markSaved = (section: typeof savedSection) => {
    setSavedSection(section);
    window.setTimeout(() => {
      setSavedSection((prev) => (prev === section ? null : prev));
    }, 3000);
  };

  // ==================== TAB 1 HANDLERS ====================
  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm.companyName.trim()) {
      toast(t('set.companyNameRequired'), 'error');
      return;
    }
    setSavingCompany(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            company_settings: companyForm,
          },
        }),
      });
      await Promise.all([refreshMe(), qc.invalidateQueries({ queryKey: ['settings-backups'] })]);
      markSaved('company');
      toast(t('set.companySavedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSavingCompany(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone,
          address,
          language: lang,
          theme,
        }),
      });
      await refreshMe();
      toast(t('set.profileUpdatedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      toast(t('set.passUpdatedToast'), 'success');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const openBpModal = (bp?: BusinessProfile) => {
    setEditingBp(bp || null);
    setNomCommercial(bp?.nom_commercial || '');
    setRaisonSociale(bp?.raison_sociale || '');
    setSiren(bp?.siren || '');
    setSiret(bp?.siret || '');
    setAdressePro(bp?.adresse_pro || '');
    setBpEmail(bp?.email || user?.email || '');
    setBpTel(bp?.telephone || user?.phone || '');
    setFormeJuridique(bp?.forme_juridique || 'Entrepreneur individuel (Micro-entreprise)');
    setRegimeFiscal(bp?.regime_fiscal || 'micro_bic');
    setRegimeTva(bp?.regime_tva || 'franchise_en_base');
    setTvaIntracom(bp?.tva_intracom || '');
    setBpModalOpen(true);
  };

  const handleSaveBusinessProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      nom_commercial: nomCommercial,
      raison_sociale: raisonSociale,
      siren,
      siret,
      adresse_pro: adressePro,
      email: bpEmail,
      telephone: bpTel,
      forme_juridique: formeJuridique,
      regime_fiscal: regimeFiscal,
      regime_tva: regimeTva,
      tva_intracom: tvaIntracom,
    };
    try {
      if (editingBp) {
        await apiFetch(`/api/auth/business-profiles/${editingBp.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast(t('set.bpUpdatedToast'), 'success');
      } else {
        await apiFetch('/api/auth/business-profiles', {
          method: 'POST',
          body: JSON.stringify({ ...payload, is_default: businessProfiles.length === 0 }),
        });
        toast(t('set.bpCreatedToast'), 'success');
      }
      setBpModalOpen(false);
      await refreshMe();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  // ==================== TAB 2 HANDLERS ====================
  const persistBrandingSettings = async (nextBranding: BrandingSettingsData) => {
    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        settings: {
          branding_settings: nextBranding,
        },
      }),
    });
    await Promise.all([refreshMe(), qc.invalidateQueries({ queryKey: ['settings-backups'] })]);
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const pngDataUrl = await fileToSafePngDataUrl(file);
      const next = { ...brandingForm, logoDataUrl: pngDataUrl };
      setBrandingForm(next);
      await persistBrandingSettings(next);
      markSaved('branding');
      toast(t('set.brandingSavedToast'), 'success');
    } catch {
      toast(t('set.logoInvalidFile'), 'error');
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    const next = { ...brandingForm, logoDataUrl: '' };
    setBrandingForm(next);
    try {
      await persistBrandingSettings(next);
      toast(t('set.brandingSavedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const handleSaveBrandingColors = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!HEX_COLOR_RE.test(brandingForm.primaryColor) || !HEX_COLOR_RE.test(brandingForm.secondaryColor)) {
      toast(t('set.invalidHexColor'), 'error');
      return;
    }
    setSavingBranding(true);
    try {
      await persistBrandingSettings(brandingForm);
      markSaved('branding');
      toast(t('set.brandingSavedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSavingBranding(false);
    }
  };

  // Signature Canvas Pointer Drawing
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getCanvasPoint(e);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
    hasDrawnStrokeRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
  };

  const handleClearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnStrokeRef.current = false;
  };

  const handleSaveSignature = async () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !hasDrawnStrokeRef.current) {
      toast(t('set.signatureEmptyError'), 'error');
      return;
    }
    setSavingSignature(true);
    try {
      const pngDataUrl = canvas.toDataURL('image/png');
      const next = { ...brandingForm, signatureDataUrl: pngDataUrl };
      setBrandingForm(next);
      await persistBrandingSettings(next);
      markSaved('signature');
      toast(t('set.signatureSavedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSavingSignature(false);
    }
  };

  const handleRemoveSavedSignature = async () => {
    const next = { ...brandingForm, signatureDataUrl: '' };
    setBrandingForm(next);
    handleClearSignature();
    try {
      await persistBrandingSettings(next);
      toast(t('set.brandingSavedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  // ==================== TAB 3 HANDLERS ====================
  const handleSaveAccountant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccountant(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: {
            accounting_settings: { accountantEmail: accountantEmail.trim() },
          },
        }),
      });
      await qc.invalidateQueries({ queryKey: ['settings-backups'] });
      markSaved('accountant');
      toast(t('set.accountantSavedToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setSavingAccountant(false);
    }
  };

  const applyExportPreset = (preset: 'month' | 'quarter' | 'year' | 'all') => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (preset === 'all') {
      setExportFrom('');
      setExportTo('');
      return;
    }
    if (preset === 'month') {
      setExportFrom(`${to.slice(0, 7)}-01`);
      setExportTo(to);
      return;
    }
    if (preset === 'quarter') {
      const qMonth = Math.floor(now.getMonth() / 3) * 3 + 1;
      setExportFrom(`${now.getFullYear()}-${String(qMonth).padStart(2, '0')}-01`);
      setExportTo(to);
      return;
    }
    setExportFrom(`${now.getFullYear()}-01-01`);
    setExportTo(to);
  };

  const buildCsvQuery = () => {
    const p = new URLSearchParams();
    if (exportFrom) p.set('from', exportFrom);
    if (exportTo) p.set('to', exportTo);
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  };

  const handleDownloadCsv = async (type: 'sales' | 'expenses') => {
    try {
      const endpoint = type === 'sales' ? '/api/export/sales.csv' : '/api/export/expenses.csv';
      const fallback = type === 'sales' ? 'journal-ventes.csv' : 'depenses.csv';
      await downloadProtectedFile(`${endpoint}${buildCsvQuery()}`, fallback);
      toast(t('set.csvReadyToast'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const mailtoHref = useMemo(() => {
    if (!accountantEmail.trim()) return undefined;
    const company = companyForm.companyName || 'HexaVO';
    const periodText =
      exportFrom || exportTo ? `${exportFrom || '...'} -> ${exportTo || '...'}` : t('set.periodAll');
    const subject = encodeURIComponent(`[${company}] ${t('set.csvExportTitle')} (${periodText})`);
    const body = encodeURIComponent(
      `${company}\n${t('set.csvExportTitle')} : ${periodText}\n\n${t('set.accountingDisclaimer')}`
    );
    return `mailto:${encodeURIComponent(accountantEmail.trim())}?subject=${subject}&body=${body}`;
  }, [accountantEmail, companyForm.companyName, exportFrom, exportTo, t]);

  const handleCreateBackup = async () => {
    try {
      await apiFetch('/api/backups', { method: 'POST' });
      toast(t('set.backupCreatedToast'), 'success');
      qc.invalidateQueries({ queryKey: ['settings-backups'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'company', label: t('set.tabCompany'), icon: <Building2 className="w-4 h-4" /> },
    { id: 'branding', label: t('set.tabBranding'), icon: <Palette className="w-4 h-4" /> },
    { id: 'accounting', label: t('set.tabAccounting'), icon: <FileSpreadsheet className="w-4 h-4" /> },
  ];

  const previewPrimary = HEX_COLOR_RE.test(brandingForm.primaryColor) ? brandingForm.primaryColor : '#2563EB';
  const previewSecondary = HEX_COLOR_RE.test(brandingForm.secondaryColor) ? brandingForm.secondaryColor : '#151922';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.settings')}</h1>
        <p className="text-sm text-[#7A8290] mt-0.5">{t('set.subtitle')}</p>
      </div>

      {/* Focused 3-Tab Navigation */}
      <div className="border-b border-[#E7EAF0] dark:border-gray-800">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('nav.settings')}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-[#2563EB] text-[#2563EB] dark:text-blue-400 bg-white dark:bg-[#111827]'
                    : 'border-transparent text-[#7A8290] hover:text-[#151922] dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-[#111827]/60'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ==================== TAB 1: COMPANY DETAILS & BANKING ==================== */}
      {activeTab === 'company' && (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-base font-semibold font-display flex items-center gap-2 text-[#151922] dark:text-white">
                  <Building2 className="w-4 h-4 text-[#2563EB]" />
                  {t('set.companyTitle')}
                </h2>
                <p className="text-xs text-[#7A8290] mt-1">{t('set.companyDesc')}</p>
              </div>
              {savedSection === 'company' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A36A] bg-[#16A36A]/10 px-2.5 py-1 rounded-md">
                  <Check className="w-3.5 h-3.5" />
                  {t('set.savedBadge')}
                </span>
              )}
            </div>

            <form onSubmit={handleSaveCompany} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>{t('set.companyNameLabel')}</FieldLabel>
                  <Input
                    required
                    value={companyForm.companyName}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, companyName: e.target.value }))}
                    placeholder="Ex: Garage HexaVO Auto"
                  />
                </div>
                <div>
                  <FieldLabel>{t('set.siretLabel')}</FieldLabel>
                  <Input
                    className="font-mono-num"
                    value={companyForm.siret}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, siret: e.target.value }))}
                    placeholder="123 456 789 00012"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-5">
                  <FieldLabel>{t('set.addressLabel')}</FieldLabel>
                  <Input
                    value={companyForm.address}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="12 Rue de la République"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>{t('set.postalCodeLabel')}</FieldLabel>
                  <Input
                    className="font-mono-num"
                    value={companyForm.postalCode}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, postalCode: e.target.value }))}
                    placeholder="75002"
                  />
                </div>
                <div className="md:col-span-3">
                  <FieldLabel>{t('set.cityLabel')}</FieldLabel>
                  <Input
                    value={companyForm.city}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Paris"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>{t('set.countryLabel')}</FieldLabel>
                  <Input
                    value={companyForm.country}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, country: e.target.value }))}
                    placeholder="France"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>{t('set.phoneLabel')}</FieldLabel>
                  <Input
                    className="font-mono-num"
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+33 6 12 34 56 78"
                  />
                </div>
                <div>
                  <FieldLabel>{t('set.emailLabel')}</FieldLabel>
                  <Input
                    type="email"
                    value={companyForm.email}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="contact@garage.fr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>{t('set.vatOptionalLabel')}</FieldLabel>
                  <Input
                    className="font-mono-num"
                    value={companyForm.vatNumber}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, vatNumber: e.target.value }))}
                    placeholder="FR12345678901"
                  />
                </div>
                <div>
                  <FieldLabel>{t('set.ibanLabel')}</FieldLabel>
                  <Input
                    className="font-mono-num"
                    value={companyForm.iban}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, iban: e.target.value }))}
                    placeholder="FR76 3000 6000 0112 3456 7890 189"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={savingCompany}>
                  <Check className="w-4 h-4" />
                  {savingCompany ? t('set.saving') : t('set.saveBtn')}
                </Button>
              </div>
            </form>
          </Card>

          {/* Secondary Section: Personal Profile, Security & Multi-Entity Legal Regimes */}
          <div className="pt-2 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#7A8290]">
              {t('set.accountPreferencesTitle')}
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5">
                <h2 className="text-sm font-semibold font-display flex items-center gap-2 mb-4">
                  <User className="w-4 h-4 text-[#2563EB]" />
                  {t('set.personalTitle')}
                </h2>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel required>{t('auth.firstName')}</FieldLabel>
                      <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel required>{t('auth.lastName')}</FieldLabel>
                      <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t('auth.phone')}</FieldLabel>
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>{t('set.language')}</FieldLabel>
                      <Select value={lang} onChange={(e) => setLang(e.target.value as Language)}>
                        <option value="fr">Français</option>
                        <option value="ru">Русский</option>
                        <option value="en">English</option>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t('set.personalAddress')}</FieldLabel>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel>{t('set.theme')}</FieldLabel>
                      <Select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}>
                        <option value="light">{t('set.themeLight')}</option>
                        <option value="dark">{t('set.themeDark')}</option>
                      </Select>
                    </div>
                  </div>
                  <Button type="submit" variant="secondary" disabled={savingProfile}>
                    {savingProfile ? t('set.saving') : t('set.saveProfile')}
                  </Button>
                </form>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-semibold font-display flex items-center gap-2 mb-4">
                  <KeyRound className="w-4 h-4 text-[#2563EB]" />
                  {t('set.securityTitle')}
                </h2>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div>
                    <FieldLabel required>{t('set.currentPass')}</FieldLabel>
                    <Input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel required>{t('set.newPassMin8')}</FieldLabel>
                    <Input
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    {t('set.updatePassBtn')}
                  </Button>
                </form>
              </Card>
            </div>

            <Card className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold font-display flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#2563EB]" />
                    {t('set.proProfilesTitle')}
                  </h2>
                  <p className="text-xs text-[#7A8290] mt-0.5">{t('set.proProfilesDesc')}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => openBpModal()}>
                  <Plus className="w-4 h-4" />
                  {t('set.addProBtn')}
                </Button>
              </div>
              {businessProfiles.length === 0 ? (
                <div className="text-xs text-[#7A8290] p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#16A36A]" />
                  {t('set.personalOnlyHint')}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {businessProfiles.map((bp) => (
                    <div
                      key={bp.id}
                      className="p-3.5 rounded-lg border border-[#E7EAF0] dark:border-gray-800 flex items-start justify-between gap-3"
                    >
                      <div className="text-xs space-y-1">
                        <div className="font-semibold text-sm text-[#151922] dark:text-white">{bp.nom_commercial}</div>
                        <div className="text-[#7A8290]">
                          {bp.raison_sociale} · {bp.forme_juridique}
                        </div>
                        <div className="font-mono-num text-[#7A8290]">
                          SIRET : {bp.siret || t('set.notProvided')}
                        </div>
                        <div className="text-[#7A8290]">
                          {t('set.regimeSummary', {
                            fiscal: translateValue(t, 'fiscal', bp.regime_fiscal),
                            vat: translateValue(t, 'vat', bp.regime_tva),
                          })}
                        </div>
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => openBpModal(bp)}>
                        {t('common.edit')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: VISUAL IDENTITY & SIGNATURE ==================== */}
      {activeTab === 'branding' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Logo Upload Card */}
            <Card className="p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold font-display flex items-center gap-2 text-[#151922] dark:text-white">
                  <Upload className="w-4 h-4 text-[#2563EB]" />
                  {t('set.logoTitle')}
                </h2>
                <p className="text-xs text-[#7A8290] mt-1">{t('set.logoDesc')}</p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="w-40 h-24 rounded-lg border border-dashed border-[#E7EAF0] dark:border-gray-700 bg-[#F6F7F9] dark:bg-[#0B0F17] flex items-center justify-center overflow-hidden p-2 shrink-0">
                  {brandingForm.logoDataUrl ? (
                    <img
                      src={brandingForm.logoDataUrl}
                      alt={t('set.logoTitle')}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-[#7A8290] text-center">{t('set.logoEmptyHint')}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoFileChange}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => logoInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" />
                    {brandingForm.logoDataUrl ? t('set.replaceLogoBtn') : t('set.uploadLogoBtn')}
                  </Button>
                  {brandingForm.logoDataUrl && (
                    <Button type="button" variant="ghost" onClick={handleRemoveLogo}>
                      <Trash2 className="w-4 h-4 text-[#DC2626]" />
                      {t('set.removeLogoBtn')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* Brand Colors & Live Preview Card */}
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold font-display flex items-center gap-2 text-[#151922] dark:text-white">
                    <Palette className="w-4 h-4 text-[#2563EB]" />
                    {t('set.colorsTitle')}
                  </h2>
                  <p className="text-xs text-[#7A8290] mt-1">{t('set.colorsDesc')}</p>
                </div>
                {savedSection === 'branding' && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A36A] bg-[#16A36A]/10 px-2.5 py-1 rounded-md">
                    <Check className="w-3.5 h-3.5" />
                    {t('set.savedBadge')}
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveBrandingColors} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>{t('set.primaryColorLabel')}</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={t('set.primaryColorLabel')}
                        value={previewPrimary}
                        onChange={(e) =>
                          setBrandingForm((b) => ({ ...b, primaryColor: e.target.value.toUpperCase() }))
                        }
                        className="w-10 h-9 rounded-md border border-[#E7EAF0] dark:border-gray-700 bg-transparent cursor-pointer p-0.5 shrink-0"
                      />
                      <Input
                        className="font-mono-num uppercase"
                        maxLength={7}
                        value={brandingForm.primaryColor}
                        onChange={(e) => setBrandingForm((b) => ({ ...b, primaryColor: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t('set.secondaryColorLabel')}</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={t('set.secondaryColorLabel')}
                        value={previewSecondary}
                        onChange={(e) =>
                          setBrandingForm((b) => ({ ...b, secondaryColor: e.target.value.toUpperCase() }))
                        }
                        className="w-10 h-9 rounded-md border border-[#E7EAF0] dark:border-gray-700 bg-transparent cursor-pointer p-0.5 shrink-0"
                      />
                      <Input
                        className="font-mono-num uppercase"
                        maxLength={7}
                        value={brandingForm.secondaryColor}
                        onChange={(e) => setBrandingForm((b) => ({ ...b, secondaryColor: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Live PDF Header Swatch Preview */}
                <div>
                  <div className="text-[11px] font-medium text-[#7A8290] mb-1.5">{t('set.livePreviewLabel')}</div>
                  <div className="rounded-lg bg-white p-3.5 border border-[#E7EAF0] shadow-xs text-[#151922]">
                    <div
                      className="flex items-center justify-between pb-2 mb-2 border-b-2"
                      style={{ borderColor: previewPrimary }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {brandingForm.logoDataUrl ? (
                          <img
                            src={brandingForm.logoDataUrl}
                            alt=""
                            className="h-6 w-auto max-w-[72px] object-contain"
                          />
                        ) : (
                          <span
                            className="w-5 h-5 rounded-sm shrink-0"
                            style={{ backgroundColor: previewPrimary }}
                          />
                        )}
                        <span
                          className="font-bold text-sm truncate"
                          style={{ color: previewSecondary }}
                        >
                          {companyForm.companyName || 'HexaVO'}
                        </span>
                      </div>
                      <span
                        className="text-xs font-mono font-semibold shrink-0"
                        style={{ color: previewPrimary }}
                      >
                        FAC-2026-0042
                      </span>
                    </div>
                    <div className="text-[11px] font-bold tracking-wide" style={{ color: previewSecondary }}>
                      {t('set.sampleDocTitle')}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={savingBranding}>
                    <Check className="w-4 h-4" />
                    {savingBranding ? t('set.saving') : t('set.saveBrandingBtn')}
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {/* Owner Digital Signature Pad */}
          <Card className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold font-display flex items-center gap-2 text-[#151922] dark:text-white">
                  <PenTool className="w-4 h-4 text-[#2563EB]" />
                  {t('set.signatureTitle')}
                </h2>
                <p className="text-xs text-[#7A8290] mt-1">{t('set.signatureDesc')}</p>
              </div>
              {brandingForm.signatureDataUrl && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A36A] bg-[#16A36A]/10 px-2.5 py-1 rounded-md self-start sm:self-auto">
                  <Check className="w-3.5 h-3.5" />
                  {t('set.signatureActiveBadge')}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 space-y-3">
                <canvas
                  ref={signatureCanvasRef}
                  width={720}
                  height={220}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="w-full h-44 rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white cursor-crosshair touch-none shadow-inner"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={handleClearSignature}>
                    <Eraser className="w-4 h-4" />
                    {t('set.clearSignatureBtn')}
                  </Button>
                  <div className="flex items-center gap-3">
                    {savedSection === 'signature' && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16A36A]">
                        <Check className="w-3.5 h-3.5" />
                        {t('set.savedBadge')}
                      </span>
                    )}
                    <Button type="button" onClick={handleSaveSignature} disabled={savingSignature}>
                      <Check className="w-4 h-4" />
                      {savingSignature ? t('set.saving') : t('set.saveSignatureBtn')}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[#E7EAF0] dark:border-gray-800 bg-[#F6F7F9] dark:bg-[#0B0F17] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#7A8290]">{t('set.signatureSavedPreview')}</span>
                  {brandingForm.signatureDataUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveSavedSignature}
                      className="text-xs text-[#DC2626] hover:underline inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('set.removeLogoBtn')}
                    </button>
                  )}
                </div>
                <div className="h-24 rounded-md bg-white border border-[#E7EAF0] flex items-center justify-center p-2 overflow-hidden">
                  {brandingForm.signatureDataUrl ? (
                    <img
                      src={brandingForm.signatureDataUrl}
                      alt={t('set.signatureTitle')}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-[#7A8290] text-center">—</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ==================== TAB 3: ACCOUNTING & EXPORT ==================== */}
      {activeTab === 'accounting' && (
        <div className="space-y-6">
          {/* Accountant Email Card */}
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="text-base font-semibold font-display flex items-center gap-2 text-[#151922] dark:text-white">
                <Mail className="w-4 h-4 text-[#2563EB]" />
                {t('set.accountantTitle')}
              </h2>
              {savedSection === 'accountant' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A36A] bg-[#16A36A]/10 px-2.5 py-1 rounded-md">
                  <Check className="w-3.5 h-3.5" />
                  {t('set.savedBadge')}
                </span>
              )}
            </div>
            <form onSubmit={handleSaveAccountant} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1 max-w-md">
                <FieldLabel>{t('set.accountantEmailLabel')}</FieldLabel>
                <Input
                  type="email"
                  value={accountantEmail}
                  onChange={(e) => setAccountantEmail(e.target.value)}
                  placeholder="cabinet@expert-comptable.fr"
                />
              </div>
              <Button type="submit" disabled={savingAccountant}>
                <Check className="w-4 h-4" />
                {savingAccountant ? t('set.saving') : t('set.saveBtn')}
              </Button>
            </form>
          </Card>

          {/* Period CSV Export Card */}
          <Card className="p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold font-display flex items-center gap-2 text-[#151922] dark:text-white">
                <FileSpreadsheet className="w-4 h-4 text-[#2563EB]" />
                {t('set.csvExportTitle')}
              </h2>
              <p className="text-xs text-[#7A8290] mt-1">{t('set.csvExportDesc')}</p>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <FieldLabel>{t('set.periodFrom')}</FieldLabel>
                <Input
                  type="date"
                  className="font-mono-num"
                  value={exportFrom}
                  onChange={(e) => setExportFrom(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>{t('set.periodTo')}</FieldLabel>
                <Input
                  type="date"
                  className="font-mono-num"
                  value={exportTo}
                  onChange={(e) => setExportTo(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 pb-0.5">
                <Button type="button" variant="secondary" size="sm" onClick={() => applyExportPreset('month')}>
                  {t('set.periodMonth')}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => applyExportPreset('quarter')}>
                  {t('set.periodQuarter')}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => applyExportPreset('year')}>
                  {t('set.periodYear')}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => applyExportPreset('all')}>
                  {t('set.periodAll')}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button type="button" onClick={() => handleDownloadCsv('sales')}>
                <Download className="w-4 h-4" />
                {t('set.exportSalesCsvBtn')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => handleDownloadCsv('expenses')}>
                <Download className="w-4 h-4" />
                {t('set.exportExpensesCsvBtn')}
              </Button>
              {mailtoHref ? (
                <a
                  href={mailtoHref}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#111827] text-[#151922] dark:text-gray-100 hover:bg-[#F6F7F9] dark:hover:bg-gray-800 transition-colors"
                >
                  <Mail className="w-4 h-4 text-[#2563EB]" />
                  {t('set.sendCsvEmailBtn')}
                </a>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => toast(t('set.emailNeedAccountant'), 'info')}
                >
                  <Mail className="w-4 h-4" />
                  {t('set.sendCsvEmailBtn')}
                </Button>
              )}
            </div>

            {/* Informational Accounting Disclaimer */}
            <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5 leading-relaxed">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
              <span>{t('set.accountingDisclaimer')}</span>
            </div>
          </Card>

          {/* Secondary Data Portability & SQLite Backups */}
          <Card className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold font-display flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#2563EB]" />
                  {t('set.backupsTitle')}
                </h2>
                <p className="text-xs text-[#7A8290] mt-0.5">{t('set.backupsDesc')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadProtectedFile('/api/export/json', 'hexavo-export.json')}
                >
                  <Download className="w-4 h-4" />
                  {t('set.exportJson')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleCreateBackup}>
                  {t('set.createBackup')}
                </Button>
              </div>
            </div>

            {(sysData?.backups || []).length > 0 && (
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-xs">
                {sysData!.backups.slice(0, 5).map((b) => (
                  <div key={b.fileName} className="py-2 flex justify-between font-mono-num">
                    <span>{b.fileName}</span>
                    <span className="text-[#7A8290]">
                      {Math.round(b.sizeBytes / 1024)} {t('set.kbUnit')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Multi-Entity Business Profile Modal */}
      <Modal
        open={bpModalOpen}
        onClose={() => setBpModalOpen(false)}
        title={editingBp ? t('set.bpEditTitle') : t('set.bpAddTitle')}
      >
        <form onSubmit={handleSaveBusinessProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>{t('set.nomCommercial')}</FieldLabel>
              <Input required value={nomCommercial} onChange={(e) => setNomCommercial(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>{t('set.raisonSociale')}</FieldLabel>
              <Input required value={raisonSociale} onChange={(e) => setRaisonSociale(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>SIREN</FieldLabel>
              <Input value={siren} onChange={(e) => setSiren(e.target.value)} />
            </div>
            <div>
              <FieldLabel>SIRET</FieldLabel>
              <Input value={siret} onChange={(e) => setSiret(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('set.tvaIntracom')}</FieldLabel>
              <Input value={tvaIntracom} onChange={(e) => setTvaIntracom(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>{t('set.formeJuridique')}</FieldLabel>
              <Input value={formeJuridique} onChange={(e) => setFormeJuridique(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('fin.fiscalRegime')}</FieldLabel>
              <Select
                value={regimeFiscal}
                onChange={(e) => setRegimeFiscal(e.target.value as BusinessProfile['regime_fiscal'])}
              >
                <option value="micro_bic">{t('fiscal.micro_bic')}</option>
                <option value="micro_bnc">{t('fiscal.micro_bnc')}</option>
                <option value="reel_simplifie">{t('fiscal.reel_simplifie')}</option>
                <option value="reel_normal">{t('fiscal.reel_normal')}</option>
                <option value="is">{t('fiscal.is')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel>{t('set.defaultVatRegime')}</FieldLabel>
              <Select value={regimeTva} onChange={(e) => setRegimeTva(e.target.value as BusinessProfile['regime_tva'])}>
                <option value="franchise_en_base">{t('vat.franchise_en_base')}</option>
                <option value="tva_sur_marge">{t('vat.tva_sur_marge')}</option>
                <option value="tva_sur_prix_total">{t('vat.tva_sur_prix_total')}</option>
                <option value="autre_regime">{t('vat.autre_regime')}</option>
              </Select>
            </div>
          </div>
          <div>
            <FieldLabel>{t('set.adressePro')}</FieldLabel>
            <Input value={adressePro} onChange={(e) => setAdressePro(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('set.emailPro')}</FieldLabel>
              <Input value={bpEmail} onChange={(e) => setBpEmail(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('set.telPro')}</FieldLabel>
              <Input value={bpTel} onChange={(e) => setBpTel(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setBpModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('set.saveProBtn')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
