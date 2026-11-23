import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Car, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useToast } from '../context/ToastContext';
import type { Contact, LegalContext, Vehicle, VehicleStatus } from '../types';
import { Button, Card, FieldLabel, Input, Select } from '../components/ui/Primitives';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  INTAKE_STATUS_OPTIONS,
  MAX_PHOTO_SIZE_BYTES,
  SUPPLIER_PRESET_OPTIONS,
  calculateIntakeMarginPreview,
  resolveSupplierSource,
  validateVehicleIntake,
  validateVehiclePhotoFile,
  type VehicleIntakeInput,
} from '../utils/vehicleIntake';

interface QueuedPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

async function compressPhotoIfNeeded(file: File): Promise<File> {
  if (file.size <= MAX_PHOTO_SIZE_BYTES) return file;
  if (!ALLOWED_PHOTO_MIME_TYPES.has(file.type)) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read_error'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode_error'));
    image.src = dataUrl;
  });

  const maxDim = 1440;
  let targetWidth = img.naturalWidth || 1200;
  let targetHeight = img.naturalHeight || 900;
  if (targetWidth > maxDim || targetHeight > maxDim) {
    const scale = Math.min(maxDim / targetWidth, maxDim / targetHeight);
    targetWidth = Math.round(targetWidth * scale);
    targetHeight = Math.round(targetHeight * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  for (const quality of [0.82, 0.68, 0.52]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    );
    if (blob && blob.size <= MAX_PHOTO_SIZE_BYTES) {
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'vehicle-photo';
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
    }
  }

  return file;
}

export const AddVehiclePage: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { businessProfiles } = useAuth();
  const { t, money } = useI18n();
  const { toast } = useToast();

  const [legalContext, setLegalContext] = useState<LegalContext>(
    businessProfiles.length > 0 ? 'professional' : 'personal'
  );
  const [businessProfileId, setBusinessProfileId] = useState<string>(
    businessProfiles[0] ? String(businessProfiles[0].id) : ''
  );

  useEffect(() => {
    if (legalContext === 'professional' && !businessProfileId && businessProfiles[0]) {
      setBusinessProfileId(String(businessProfiles[0].id));
    }
  }, [businessProfiles, businessProfileId, legalContext]);

  const [marque, setMarque] = useState('');
  const [modele, setModele] = useState('');
  const [annee, setAnnee] = useState('');
  const [immatriculation, setImmatriculation] = useState('');
  const [kilometrage, setKilometrage] = useState('');
  const [status, setStatus] = useState<VehicleStatus>('en_preparation');

  const [dateAchat, setDateAchat] = useState(() => new Date().toISOString().slice(0, 10));
  const [prixAchat, setPrixAchat] = useState('');
  const [prixVentePrevu, setPrixVentePrevu] = useState('');

  const [sourceSelect, setSourceSelect] = useState('none');
  const [customSupplier, setCustomSupplier] = useState('');

  const [queuedPhotos, setQueuedPhotos] = useState<QueuedPhoto[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof VehicleIntakeInput, string>>>({});
  const [saving, setSaving] = useState(false);

  const { data: contactsData } = useQuery({
    queryKey: ['contacts-suppliers'],
    queryFn: () => apiFetch<{ contacts: Contact[] }>('/api/contacts'),
  });

  const contacts = contactsData?.contacts || [];

  useEffect(() => {
    return () => {
      queuedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, [queuedPhotos]);

  const presetLabels = useMemo(() => {
    const map: Record<string, string> = {};
    SUPPLIER_PRESET_OPTIONS.forEach((opt) => {
      map[opt.code] = t(opt.labelKey);
    });
    return map;
  }, [t]);

  const contactLabels = useMemo(() => {
    const map: Record<string, string> = {};
    contacts.forEach((c) => {
      const display = c.company_name || `${c.first_name} ${c.last_name}`.trim();
      if (display) map[String(c.id)] = display;
    });
    return map;
  }, [contacts]);

  const marginPreview = useMemo(
    () => calculateIntakeMarginPreview(prixAchat, prixVentePrevu),
    [prixAchat, prixVentePrevu]
  );

  const handlePhotoFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const incoming = Array.from(fileList).slice(0, Math.max(0, 6 - queuedPhotos.length));
    const nextPhotos: QueuedPhoto[] = [];

    for (const rawFile of incoming) {
      if (!ALLOWED_PHOTO_MIME_TYPES.has(rawFile.type)) {
        toast(t('vehNew.photoInvalidType'), 'error');
        continue;
      }

      let processed = rawFile;
      try {
        processed = await compressPhotoIfNeeded(rawFile);
      } catch {
        processed = rawFile;
      }

      const check = validateVehiclePhotoFile({ type: processed.type, size: processed.size });
      if (!check.valid) {
        toast(
          check.reason === 'invalid_type' ? t('vehNew.photoInvalidType') : t('vehNew.photoTooLarge'),
          'error'
        );
        continue;
      }

      nextPhotos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: processed,
        previewUrl: URL.createObjectURL(processed),
      });
    }

    if (nextPhotos.length > 0) {
      setQueuedPhotos((prev) => [...prev, ...nextPhotos]);
    }
  };

  const removePhoto = (photoId: string) => {
    setQueuedPhotos((prev) => {
      const target = prev.find((p) => p.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== photoId);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateVehicleIntake({
      marque,
      modele,
      annee,
      immatriculation,
      prixAchat,
      prixVentePrevu,
      dateAchat,
      kilometrage,
      legalContext,
      businessProfileId,
    });

    if (!validation.valid) {
      setErrors(validation.errors);
      toast(
        validation.errors.businessProfileId
          ? t(validation.errors.businessProfileId)
          : t('vehNew.formErrorToast'),
        'error'
      );
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      const resolvedSupplier = resolveSupplierSource({
        sourceSelect,
        presetLabels,
        contactLabels,
        customSupplier,
      });

      let supplierPhone = '';
      if (sourceSelect.startsWith('contact:')) {
        const cid = Number(sourceSelect.slice('contact:'.length));
        const matched = contacts.find((c) => c.id === cid);
        if (matched?.phone) supplierPhone = matched.phone;
      }

      const payload = {
        legal_context: legalContext,
        business_profile_id: legalContext === 'professional' ? Number(businessProfileId) : null,
        status,
        marque: marque.trim(),
        modele: modele.trim(),
        annee: Number(annee.trim()),
        immatriculation: immatriculation.trim().toUpperCase(),
        kilometrage: kilometrage.trim() ? Number(kilometrage.trim()) : null,
        date_achat: dateAchat,
        prix_achat_cents: marginPreview.purchaseCents,
        prix_vente_prevu_cents: marginPreview.targetCents,
        fournisseur_nom: resolvedSupplier,
        fournisseur_tel: supplierPhone,
      };

      const res = await apiFetch<{ vehicle: Vehicle }>('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (queuedPhotos.length > 0) {
        const fd = new FormData();
        queuedPhotos.forEach((p) => fd.append('photos', p.file));
        try {
          await apiFetch(`/api/vehicles/${res.vehicle.id}/photos`, {
            method: 'POST',
            body: fd,
          });
        } catch {
          toast(t('vehNew.photoUploadPartial'), 'info');
        }
      }

      toast(t('vehForm.createdToast'), 'success');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['vehicles'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      navigate('/vehicles');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('vehForm.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearError = (field: keyof VehicleIntakeInput) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <Link
            to="/vehicles"
            className="w-fit mt-0.5 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#111827] text-xs font-medium text-[#151922] dark:text-gray-100 hover:bg-[#F6F7F9] dark:hover:bg-gray-800 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('common.back')}
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">
              {t('vehNew.title')}
            </h1>
            <p className="text-sm text-[#7A8290] mt-0.5">{t('vehNew.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={() => navigate('/vehicles')} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="add-vehicle-form" disabled={saving}>
            <Plus className="w-4 h-4" />
            {saving ? t('common.loading') : t('vehNew.submitBtn')}
          </Button>
        </div>
      </div>

      <form id="add-vehicle-form" onSubmit={handleSubmit} noValidate className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Core Intake Fields */}
        <div className="lg:col-span-8 space-y-6">
          {/* Section 1: Vehicle Identification */}
          <Card className="p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E7EAF0] dark:border-gray-800">
              <h2 className="text-sm font-semibold font-display text-[#151922] dark:text-white">
                {t('vehNew.sectionVehicle')}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center p-1 rounded-lg bg-[#F6F7F9] dark:bg-[#0B0F17] border border-[#E7EAF0] dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setLegalContext('professional')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      legalContext === 'professional'
                        ? 'bg-white dark:bg-[#111827] text-[#2563EB] shadow-sm'
                        : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
                    }`}
                  >
                    {t('common.professional')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLegalContext('personal')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      legalContext === 'personal'
                        ? 'bg-white dark:bg-[#111827] text-[#2563EB] shadow-sm'
                        : 'text-[#7A8290] hover:text-[#151922] dark:hover:text-white'
                    }`}
                  >
                    {t('common.personal')}
                  </button>
                </div>

                {legalContext === 'professional' && businessProfiles.length > 0 && (
                  <Select
                    aria-label={t('veh.businessProfile')}
                    value={businessProfileId}
                    onChange={(e) => {
                      setBusinessProfileId(e.target.value);
                      clearError('businessProfileId');
                    }}
                    className="w-auto min-w-[180px] min-h-[34px] py-1 text-xs"
                  >
                    {businessProfiles.map((bp) => (
                      <option key={bp.id} value={bp.id}>
                        {bp.nom_commercial}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </div>

            {legalContext === 'professional' && businessProfiles.length === 0 && (
              <div className="text-xs text-[#D97706] border border-[#E7EAF0] dark:border-gray-800 rounded-lg p-3">
                {t('vehForm.noProProfile')}{' '}
                <Link to="/parametres" className="underline font-medium text-[#2563EB]">
                  {t('vehForm.createInSettings')}
                </Link>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="new-v-marque" required>
                  {t('veh.marque')}
                </FieldLabel>
                <Input
                  id="new-v-marque"
                  required
                  value={marque}
                  onChange={(e) => {
                    setMarque(e.target.value);
                    clearError('marque');
                  }}
                  placeholder="Peugeot"
                  aria-invalid={Boolean(errors.marque)}
                />
                {errors.marque && <p className="mt-1 text-xs text-[#DC4545]">{t(errors.marque)}</p>}
              </div>

              <div>
                <FieldLabel htmlFor="new-v-modele" required>
                  {t('veh.modele')}
                </FieldLabel>
                <Input
                  id="new-v-modele"
                  required
                  value={modele}
                  onChange={(e) => {
                    setModele(e.target.value);
                    clearError('modele');
                  }}
                  placeholder="3008"
                  aria-invalid={Boolean(errors.modele)}
                />
                {errors.modele && <p className="mt-1 text-xs text-[#DC4545]">{t(errors.modele)}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <FieldLabel htmlFor="new-v-annee" required>
                  {t('veh.annee')}
                </FieldLabel>
                <Input
                  id="new-v-annee"
                  type="number"
                  min={1900}
                  max={2035}
                  required
                  value={annee}
                  onChange={(e) => {
                    setAnnee(e.target.value);
                    clearError('annee');
                  }}
                  placeholder="2022"
                  className="font-mono-num"
                  aria-invalid={Boolean(errors.annee)}
                />
                {errors.annee && <p className="mt-1 text-xs text-[#DC4545]">{t(errors.annee)}</p>}
              </div>

              <div>
                <FieldLabel htmlFor="new-v-immat" required>
                  {t('veh.immat')}
                </FieldLabel>
                <Input
                  id="new-v-immat"
                  required
                  value={immatriculation}
                  onChange={(e) => {
                    setImmatriculation(e.target.value.toUpperCase());
                    clearError('immatriculation');
                  }}
                  placeholder="AA-123-BB"
                  className="font-mono-num uppercase"
                  aria-invalid={Boolean(errors.immatriculation)}
                />
                {errors.immatriculation && (
                  <p className="mt-1 text-xs text-[#DC4545]">{t(errors.immatriculation)}</p>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="new-v-km">{t('veh.km')}</FieldLabel>
                <Input
                  id="new-v-km"
                  type="number"
                  min={0}
                  value={kilometrage}
                  onChange={(e) => {
                    setKilometrage(e.target.value);
                    clearError('kilometrage');
                  }}
                  placeholder="48000"
                  className="font-mono-num"
                  aria-invalid={Boolean(errors.kilometrage)}
                />
                {errors.kilometrage && (
                  <p className="mt-1 text-xs text-[#DC4545]">{t(errors.kilometrage)}</p>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="new-v-status">{t('common.status')}</FieldLabel>
                <Select
                  id="new-v-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as VehicleStatus)}
                >
                  {INTAKE_STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {t(`status.${st}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>

          {/* Section 2: Purchase & Supplier */}
          <Card className="p-6 space-y-5">
            <h2 className="text-sm font-semibold font-display text-[#151922] dark:text-white pb-4 border-b border-[#E7EAF0] dark:border-gray-800">
              {t('vehNew.sectionPurchase')}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <FieldLabel htmlFor="new-v-prix-achat" required>
                  {t('veh.purchasePrice')}
                </FieldLabel>
                <Input
                  id="new-v-prix-achat"
                  type="number"
                  step="0.01"
                  min={0}
                  required
                  value={prixAchat}
                  onChange={(e) => {
                    setPrixAchat(e.target.value);
                    clearError('prixAchat');
                  }}
                  placeholder="14500"
                  className="font-mono-num"
                  aria-invalid={Boolean(errors.prixAchat)}
                />
                {errors.prixAchat && (
                  <p className="mt-1 text-xs text-[#DC4545]">{t(errors.prixAchat)}</p>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="new-v-prix-prevu">{t('veh.plannedPrice')}</FieldLabel>
                <Input
                  id="new-v-prix-prevu"
                  type="number"
                  step="0.01"
                  min={0}
                  value={prixVentePrevu}
                  onChange={(e) => {
                    setPrixVentePrevu(e.target.value);
                    clearError('prixVentePrevu');
                  }}
                  placeholder="17900"
                  className="font-mono-num"
                  aria-invalid={Boolean(errors.prixVentePrevu)}
                />
                {errors.prixVentePrevu && (
                  <p className="mt-1 text-xs text-[#DC4545]">{t(errors.prixVentePrevu)}</p>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="new-v-date">{t('veh.purchaseDate')}</FieldLabel>
                <Input
                  id="new-v-date"
                  type="date"
                  value={dateAchat}
                  onChange={(e) => {
                    setDateAchat(e.target.value);
                    clearError('dateAchat');
                  }}
                  className="font-mono-num"
                  aria-invalid={Boolean(errors.dateAchat)}
                />
                {errors.dateAchat && (
                  <p className="mt-1 text-xs text-[#DC4545]">{t(errors.dateAchat)}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel htmlFor="new-v-supplier-select">{t('vehNew.supplierSelect')}</FieldLabel>
                <Select
                  id="new-v-supplier-select"
                  value={sourceSelect}
                  onChange={(e) => setSourceSelect(e.target.value)}
                >
                  <option value="none">{t('vehNew.supplierNone')}</option>
                  {SUPPLIER_PRESET_OPTIONS.map((opt) => (
                    <option key={opt.code} value={`preset:${opt.code}`}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                  {contacts.map((c) => {
                    const label = c.company_name || `${c.first_name} ${c.last_name}`.trim();
                    if (!label) return null;
                    return (
                      <option key={c.id} value={`contact:${c.id}`}>
                        {label}
                      </option>
                    );
                  })}
                  <option value="custom">{t('vehNew.supplierCustomOption')}</option>
                </Select>
              </div>

              {sourceSelect === 'custom' && (
                <div>
                  <FieldLabel htmlFor="new-v-supplier-custom">
                    {t('vehNew.supplierCustomLabel')}
                  </FieldLabel>
                  <Input
                    id="new-v-supplier-custom"
                    value={customSupplier}
                    onChange={(e) => setCustomSupplier(e.target.value)}
                    placeholder={t('vehNew.supplierCustomPlaceholder')}
                  />
                </div>
              )}
            </div>

            <p className="text-xs text-[#7A8290] pt-1">{t('vehNew.detailEditHint')}</p>
          </Card>
        </div>

        {/* Right Column: Compact Photo Upload & Live Margin Preview */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold font-display text-[#151922] dark:text-white">
                {t('vehNew.sectionPhoto')}
              </h2>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E7EAF0] dark:border-gray-700 bg-white dark:bg-[#0B0F17] text-xs font-medium text-[#151922] dark:text-gray-100 hover:bg-[#F6F7F9] dark:hover:bg-gray-800 cursor-pointer whitespace-nowrap">
                <ImagePlus className="w-3.5 h-3.5" />
                {queuedPhotos.length > 0 ? t('vehNew.photoChange') : t('vehNew.photoDrop')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    void handlePhotoFiles(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>

            {queuedPhotos.length === 0 ? (
              <label className="flex flex-col items-center justify-center aspect-[4/3] rounded-lg border border-dashed border-[#E7EAF0] dark:border-gray-700 bg-[#F6F7F9]/60 dark:bg-[#0B0F17]/60 p-4 text-center cursor-pointer hover:border-[#2563EB] transition-colors">
                <Car className="w-7 h-7 text-[#7A8290] mb-2" />
                <span className="text-xs font-medium text-[#151922] dark:text-gray-200">
                  {t('vehNew.photoDrop')}
                </span>
                <span className="mt-1 text-[11px] text-[#7A8290]">{t('vehNew.photoHint')}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    void handlePhotoFiles(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  {queuedPhotos.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`relative rounded-lg border border-[#E7EAF0] dark:border-gray-800 overflow-hidden bg-[#F0F2F6] dark:bg-gray-800 ${
                        idx === 0 ? 'col-span-2 aspect-[16/10]' : 'aspect-[4/3]'
                      }`}
                    >
                      <img
                        src={p.previewUrl}
                        alt={p.file.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-black/60 text-white text-[11px] flex items-center justify-between">
                        <span className="font-mono-num">
                          {Math.max(1, Math.round(p.file.size / 1024))} {t('set.kbUnit')}
                        </span>
                        <button
                          type="button"
                          aria-label={`${t('common.delete')} ${p.file.name}`}
                          onClick={() => removePhoto(p.id)}
                          className="p-0.5 text-white/90 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-[#7A8290]">{t('vehNew.photoHint')}</p>
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-3">
            <h2 className="text-sm font-semibold font-display text-[#151922] dark:text-white">
              {t('vehNew.marginPreviewTitle')}
            </h2>
            <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
              <div className="py-2 flex items-center justify-between">
                <span className="text-xs text-[#7A8290]">{t('vehDetail.purchasePrice')}</span>
                <span className="font-mono-num font-medium">
                  {prixAchat.trim() ? money(marginPreview.purchaseCents) : '—'}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-xs text-[#7A8290]">{t('vehDetail.plannedPrice')}</span>
                <span className="font-mono-num font-medium text-[#2563EB]">
                  {marginPreview.targetCents !== null ? money(marginPreview.targetCents) : '—'}
                </span>
              </div>
              <div className="pt-2.5 flex items-center justify-between">
                <span className="text-xs font-medium text-[#151922] dark:text-gray-200">
                  {t('vehNew.marginEstimated')}
                </span>
                {marginPreview.marginCents !== null ? (
                  <span
                    className={`font-mono-num font-semibold ${
                      marginPreview.marginCents >= 0 ? 'text-[#16A36A]' : 'text-[#DC4545]'
                    }`}
                  >
                    {marginPreview.marginCents >= 0 ? '+' : ''}
                    {money(marginPreview.marginCents)}
                    {marginPreview.marginPct !== null ? ` (${marginPreview.marginPct}%)` : ''}
                  </span>
                ) : (
                  <span className="font-mono-num text-xs text-[#7A8290]">—</span>
                )}
              </div>
            </div>
            {marginPreview.marginCents === null && (
              <p className="text-xs text-[#7A8290]">{t('vehNew.marginEmptyHint')}</p>
            )}
          </Card>

          <div className="sm:hidden flex items-center gap-3">
            <Button variant="secondary" onClick={() => navigate('/vehicles')} disabled={saving} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? t('common.loading') : t('vehNew.submitBtn')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};
