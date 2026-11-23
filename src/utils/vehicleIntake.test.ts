import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTO_SIZE_BYTES,
  calculateIntakeMarginPreview,
  resolveSupplierSource,
  validateVehicleIntake,
  validateVehiclePhotoFile,
} from './vehicleIntake';

test('validateVehicleIntake enforces required Brand, Model, Year, Plate, Purchase Price, Date', () => {
  const empty = validateVehicleIntake({
    marque: '',
    modele: '',
    annee: '',
    immatriculation: '',
    prixAchat: '',
    prixVentePrevu: '',
    dateAchat: '2026-11-21',
    kilometrage: '',
    legalContext: 'personal',
    businessProfileId: '',
  });
  assert.equal(empty.valid, false);
  assert.equal(empty.errors.marque, 'vehNew.errRequired');
  assert.equal(empty.errors.modele, 'vehNew.errRequired');
  assert.equal(empty.errors.annee, 'vehNew.errRequired');
  assert.equal(empty.errors.immatriculation, 'vehNew.errRequired');
  assert.equal(empty.errors.prixAchat, 'vehNew.errRequired');

  const invalidYearAndKm = validateVehicleIntake({
    marque: 'Renault',
    modele: 'Clio',
    annee: '1850',
    immatriculation: 'AA-123-BB',
    prixAchat: '8500',
    prixVentePrevu: '10500',
    dateAchat: '2026-11-21',
    kilometrage: '-10',
    legalContext: 'personal',
    businessProfileId: '',
  });
  assert.equal(invalidYearAndKm.valid, false);
  assert.equal(invalidYearAndKm.errors.annee, 'vehNew.errYear');
  assert.equal(invalidYearAndKm.errors.kilometrage, 'vehNew.errMileage');

  const valid = validateVehicleIntake({
    marque: 'Peugeot',
    modele: '3008',
    annee: '2022',
    immatriculation: 'AB-456-CD',
    prixAchat: '14500',
    prixVentePrevu: '17900',
    dateAchat: '2026-11-21',
    kilometrage: '48000',
    legalContext: 'professional',
    businessProfileId: '1',
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, {});
});

test('calculateIntakeMarginPreview computes gross margin in cents and percentage', () => {
  const noTarget = calculateIntakeMarginPreview('15000', '');
  assert.equal(noTarget.purchaseCents, 1500000);
  assert.equal(noTarget.targetCents, null);
  assert.equal(noTarget.marginCents, null);

  const positive = calculateIntakeMarginPreview('12000', '15000');
  assert.equal(positive.purchaseCents, 1200000);
  assert.equal(positive.targetCents, 1500000);
  assert.equal(positive.marginCents, 300000);
  assert.equal(positive.marginPct, 25);

  const negative = calculateIntakeMarginPreview('10000', '9000');
  assert.equal(negative.marginCents, -100000);
  assert.equal(negative.marginPct, -10);
});

test('validateVehiclePhotoFile enforces image type and 1 MB limit', () => {
  assert.equal(
    validateVehiclePhotoFile({ type: 'image/jpeg', size: 512_000 }).valid,
    true
  );
  assert.deepEqual(
    validateVehiclePhotoFile({ type: 'image/gif', size: 100_000 }),
    { valid: false, reason: 'invalid_type' }
  );
  assert.deepEqual(
    validateVehiclePhotoFile({ type: 'image/png', size: MAX_PHOTO_SIZE_BYTES + 1 }),
    { valid: false, reason: 'too_large' }
  );
});

test('resolveSupplierSource resolves presets, CRM contacts, and custom text', () => {
  const presetLabels = { encheres: 'Аукцион' };
  const contactLabels = { '5': 'Garage Lyon' };

  assert.equal(
    resolveSupplierSource({
      sourceSelect: 'none',
      presetLabels,
      contactLabels,
      customSupplier: 'Ignored',
    }),
    ''
  );
  assert.equal(
    resolveSupplierSource({
      sourceSelect: 'preset:encheres',
      presetLabels,
      contactLabels,
      customSupplier: '',
    }),
    'Аукцион'
  );
  assert.equal(
    resolveSupplierSource({
      sourceSelect: 'contact:5',
      presetLabels,
      contactLabels,
      customSupplier: '',
    }),
    'Garage Lyon'
  );
  assert.equal(
    resolveSupplierSource({
      sourceSelect: 'custom',
      presetLabels,
      contactLabels,
      customSupplier: '  Auto Import Berlin  ',
    }),
    'Auto Import Berlin'
  );
});
