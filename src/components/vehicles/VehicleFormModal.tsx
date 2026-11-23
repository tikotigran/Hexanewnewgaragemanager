import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../context/I18nContext';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { centsToEurosInput, eurosToCents } from '../../lib/utils';
import type { LegalContext, Vehicle, VehicleStatus } from '../../types';
import { Button, FieldLabel, Input, Modal, Select, Textarea } from '../ui/Primitives';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (vehicle: Vehicle) => void;
  initialVehicle?: Vehicle | null;
}

export const VehicleFormModal: React.FC<Props> = ({ open, onClose, onSaved, initialVehicle }) => {
  const { businessProfiles } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();

  const [legalContext, setLegalContext] = useState<LegalContext>('personal');
  const [businessProfileId, setBusinessProfileId] = useState<string>('');
  const [status, setStatus] = useState<VehicleStatus>('en_preparation');
  const [marque, setMarque] = useState('');
  const [modele, setModele] = useState('');
  const [version, setVersion] = useState('');
  const [immatriculation, setImmatriculation] = useState('');
  const [vin, setVin] = useState('');
  const [annee, setAnnee] = useState('');
  const [kilometrage, setKilometrage] = useState('');
  const [energie, setEnergie] = useState('Essence');
  const [boiteVitesses, setBoiteVitesses] = useState('Manuelle');
  const [couleur, setCouleur] = useState('');
  const [portes, setPortes] = useState('5');
  const [puissanceFiscale, setPuissanceFiscale] = useState('');
  const [co2, setCo2] = useState('');
  const [dateAchat, setDateAchat] = useState(new Date().toISOString().slice(0, 10));
  const [prixAchat, setPrixAchat] = useState('');
  const [prixVentePrevu, setPrixVentePrevu] = useState('');
  const [fournisseurNom, setFournisseurNom] = useState('');
  const [fournisseurTel, setFournisseurTel] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialVehicle) {
      setLegalContext(initialVehicle.legal_context);
      setBusinessProfileId(initialVehicle.business_profile_id ? String(initialVehicle.business_profile_id) : '');
      setStatus(initialVehicle.status);
      setMarque(initialVehicle.marque);
      setModele(initialVehicle.modele);
      setVersion(initialVehicle.version || '');
      setImmatriculation(initialVehicle.immatriculation || '');
      setVin(initialVehicle.vin || '');
      setAnnee(initialVehicle.annee ? String(initialVehicle.annee) : '');
      setKilometrage(initialVehicle.kilometrage ? String(initialVehicle.kilometrage) : '');
      setEnergie(initialVehicle.energie || 'Essence');
      setBoiteVitesses(initialVehicle.boite_vitesses || 'Manuelle');
      setCouleur(initialVehicle.couleur || '');
      setPortes(initialVehicle.portes ? String(initialVehicle.portes) : '5');
      setPuissanceFiscale(initialVehicle.puissance_fiscale ? String(initialVehicle.puissance_fiscale) : '');
      setCo2(initialVehicle.co2 ? String(initialVehicle.co2) : '');
      setDateAchat(initialVehicle.date_achat);
      setPrixAchat(centsToEurosInput(initialVehicle.prix_achat_cents));
      setPrixVentePrevu(centsToEurosInput(initialVehicle.prix_vente_prevu_cents));
      setFournisseurNom(initialVehicle.fournisseur_nom || '');
      setFournisseurTel(initialVehicle.fournisseur_tel || '');
      setNotes(initialVehicle.notes || '');
    } else {
      setLegalContext(businessProfiles.length > 0 ? 'professional' : 'personal');
      setBusinessProfileId(businessProfiles[0] ? String(businessProfiles[0].id) : '');
      setStatus('en_preparation');
      setMarque('');
      setModele('');
      setVersion('');
      setImmatriculation('');
      setVin('');
      setAnnee('');
      setKilometrage('');
      setEnergie('Essence');
      setBoiteVitesses('Manuelle');
      setCouleur('');
      setPortes('5');
      setPuissanceFiscale('');
      setCo2('');
      setDateAchat(new Date().toISOString().slice(0, 10));
      setPrixAchat('');
      setPrixVentePrevu('');
      setFournisseurNom('');
      setFournisseurTel('');
      setNotes('');
    }
  }, [initialVehicle, open, businessProfiles]);

  const submit = async (targetStatus: VehicleStatus) => {
    if (!marque.trim() || !modele.trim() || !dateAchat || !prixAchat) {
      toast(t('vehForm.requiredToast'), 'error');
      return;
    }
    if (legalContext === 'professional' && !businessProfileId) {
      toast(t('vehForm.proRequiredToast'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        legal_context: legalContext,
        business_profile_id: legalContext === 'professional' ? Number(businessProfileId) : null,
        status: targetStatus,
        marque: marque.trim(),
        modele: modele.trim(),
        version: version.trim(),
        immatriculation: immatriculation.trim(),
        vin: vin.trim(),
        annee: annee ? Number(annee) : null,
        kilometrage: kilometrage ? Number(kilometrage) : null,
        energie,
        boite_vitesses: boiteVitesses,
        couleur: couleur.trim(),
        portes: portes ? Number(portes) : null,
        puissance_fiscale: puissanceFiscale ? Number(puissanceFiscale) : null,
        co2: co2 ? Number(co2) : null,
        date_achat: dateAchat,
        prix_achat_cents: eurosToCents(prixAchat),
        prix_vente_prevu_cents: prixVentePrevu ? eurosToCents(prixVentePrevu) : null,
        fournisseur_nom: fournisseurNom.trim(),
        fournisseur_tel: fournisseurTel.trim(),
        notes: notes.trim(),
      };

      const res = initialVehicle
        ? await apiFetch<{ vehicle: Vehicle }>(`/api/vehicles/${initialVehicle.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ vehicle: Vehicle }>('/api/vehicles', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      toast(initialVehicle ? t('vehForm.updatedToast') : t('vehForm.createdToast'), 'success');
      onSaved(res.vehicle);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('vehForm.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initialVehicle ? `${t('common.edit')} — ${initialVehicle.marque} ${initialVehicle.modele}` : t('veh.addVehicle')}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-5">
        {/* Legal Context Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel required>{t('veh.context')}</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLegalContext('personal')}
                className={`px-3 py-2.5 rounded-lg border text-xs font-medium text-left transition-colors ${
                  legalContext === 'personal'
                    ? 'border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB]'
                    : 'border-[#E7EAF0] dark:border-gray-700 text-[#7A8290]'
                }`}
              >
                {t('common.personal')}
              </button>
              <button
                type="button"
                onClick={() => setLegalContext('professional')}
                className={`px-3 py-2.5 rounded-lg border text-xs font-medium text-left transition-colors ${
                  legalContext === 'professional'
                    ? 'border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB]'
                    : 'border-[#E7EAF0] dark:border-gray-700 text-[#7A8290]'
                }`}
              >
                {t('common.professional')}
              </button>
            </div>
          </div>

          {legalContext === 'professional' && (
            <div>
              <FieldLabel required>{t('veh.businessProfile')}</FieldLabel>
              {businessProfiles.length === 0 ? (
                <div className="text-xs text-[#D97706] border border-[#E7EAF0] dark:border-gray-700 rounded-lg p-2.5">
                  {t('vehForm.noProProfile')}{' '}
                  <Link to="/parametres" onClick={onClose} className="underline font-medium text-[#2563EB]">
                    {t('vehForm.createInSettings')}
                  </Link>
                </div>
              ) : (
                <Select
                  value={businessProfileId}
                  onChange={(e) => setBusinessProfileId(e.target.value)}
                >
                  {businessProfiles.map((bp) => (
                    <option key={bp.id} value={bp.id}>
                      {bp.nom_commercial} ({bp.siret || bp.forme_juridique})
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Required Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <FieldLabel htmlFor="v-marque" required>{t('veh.marque')}</FieldLabel>
            <Input id="v-marque" value={marque} onChange={(e) => setMarque(e.target.value)} placeholder="Peugeot" />
          </div>
          <div>
            <FieldLabel htmlFor="v-modele" required>{t('veh.modele')}</FieldLabel>
            <Input id="v-modele" value={modele} onChange={(e) => setModele(e.target.value)} placeholder="3008" />
          </div>
          <div>
            <FieldLabel htmlFor="v-date" required>{t('veh.purchaseDate')}</FieldLabel>
            <Input id="v-date" type="date" value={dateAchat} onChange={(e) => setDateAchat(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="v-prix-achat" required>{t('veh.purchasePrice')}</FieldLabel>
            <Input
              id="v-prix-achat"
              type="number"
              step="0.01"
              value={prixAchat}
              onChange={(e) => setPrixAchat(e.target.value)}
              placeholder="15000"
            />
          </div>
        </div>

        {/* Identification & Technical */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel htmlFor="v-version">{t('vehForm.version')}</FieldLabel>
            <Input id="v-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Allure Pack" />
          </div>
          <div>
            <FieldLabel htmlFor="v-immat">{t('veh.immat')}</FieldLabel>
            <Input id="v-immat" value={immatriculation} onChange={(e) => setImmatriculation(e.target.value)} placeholder="AA-123-BB" />
          </div>
          <div>
            <FieldLabel htmlFor="v-vin">{t('veh.vin')}</FieldLabel>
            <Input id="v-vin" value={vin} onChange={(e) => setVin(e.target.value)} placeholder="VF3..." />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <FieldLabel htmlFor="v-annee">{t('veh.annee')}</FieldLabel>
            <Input id="v-annee" type="number" value={annee} onChange={(e) => setAnnee(e.target.value)} placeholder="2022" />
          </div>
          <div>
            <FieldLabel htmlFor="v-km">{t('veh.km')}</FieldLabel>
            <Input id="v-km" type="number" value={kilometrage} onChange={(e) => setKilometrage(e.target.value)} placeholder="48000" />
          </div>
          <div>
            <FieldLabel htmlFor="v-energie">{t('vehForm.energie')}</FieldLabel>
            <Select id="v-energie" value={energie} onChange={(e) => setEnergie(e.target.value)}>
              <option value="Essence">{t('fuel.Essence')}</option>
              <option value="Diesel">{t('fuel.Diesel')}</option>
              <option value="Hybride">{t('fuel.Hybride')}</option>
              <option value="Hybride essence">{t('fuel.Hybride essence')}</option>
              <option value="Électrique">{t('fuel.Électrique')}</option>
              <option value="GPL">{t('fuel.GPL')}</option>
            </Select>
          </div>
          <div>
            <FieldLabel htmlFor="v-boite">{t('vehForm.boite')}</FieldLabel>
            <Select id="v-boite" value={boiteVitesses} onChange={(e) => setBoiteVitesses(e.target.value)}>
              <option value="Manuelle">{t('gear.Manuelle')}</option>
              <option value="Automatique">{t('gear.Automatique')}</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <FieldLabel htmlFor="v-couleur">{t('vehForm.couleur')}</FieldLabel>
            <Input id="v-couleur" value={couleur} onChange={(e) => setCouleur(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="v-portes">{t('vehForm.portes')}</FieldLabel>
            <Input id="v-portes" type="number" value={portes} onChange={(e) => setPortes(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="v-cv">{t('vehForm.puissanceFiscale')}</FieldLabel>
            <Input id="v-cv" type="number" value={puissanceFiscale} onChange={(e) => setPuissanceFiscale(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="v-co2">{t('vehForm.co2')}</FieldLabel>
            <Input id="v-co2" type="number" value={co2} onChange={(e) => setCo2(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <FieldLabel htmlFor="v-status">{t('common.status')}</FieldLabel>
            <Select id="v-status" value={status} onChange={(e) => setStatus(e.target.value as VehicleStatus)}>
              <option value="brouillon">{t('status.brouillon')}</option>
              <option value="en_preparation">{t('status.en_preparation')}</option>
              <option value="en_reparation">{t('status.en_reparation')}</option>
              <option value="en_vente">{t('status.en_vente')}</option>
              <option value="reserve">{t('status.reserve')}</option>
              <option value="archive">{t('status.archive')}</option>
            </Select>
          </div>
          <div>
            <FieldLabel htmlFor="v-prix-prevu">{t('veh.plannedPrice')}</FieldLabel>
            <Input
              id="v-prix-prevu"
              type="number"
              step="0.01"
              value={prixVentePrevu}
              onChange={(e) => setPrixVentePrevu(e.target.value)}
              placeholder="18900"
            />
          </div>
          <div>
            <FieldLabel htmlFor="v-fournisseur">{t('vehForm.supplier')}</FieldLabel>
            <Input id="v-fournisseur" value={fournisseurNom} onChange={(e) => setFournisseurNom(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="v-fourn-tel">{t('vehForm.supplierPhone')}</FieldLabel>
            <Input id="v-fourn-tel" value={fournisseurTel} onChange={(e) => setFournisseurTel(e.target.value)} />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="v-notes">{t('vehForm.internalNotes')}</FieldLabel>
          <Textarea id="v-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-[#E7EAF0] dark:border-gray-800">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          {!initialVehicle && (
            <Button variant="secondary" onClick={() => submit('brouillon')} disabled={saving}>
              {t('vehForm.saveDraft')}
            </Button>
          )}
          <Button onClick={() => submit(status)} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
