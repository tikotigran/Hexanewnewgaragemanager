import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATIONS } from './translations';

test('FR, RU, and EN translation dictionaries have complete key parity and non-empty strings', () => {
  const frKeys = Object.keys(TRANSLATIONS.fr).sort();
  const ruKeys = Object.keys(TRANSLATIONS.ru).sort();
  const enKeys = Object.keys(TRANSLATIONS.en).sort();

  assert.deepEqual(ruKeys, frKeys, 'RU dictionary keys must match FR keys');
  assert.deepEqual(enKeys, frKeys, 'EN dictionary keys must match FR keys');

  for (const key of frKeys) {
    assert.ok(TRANSLATIONS.fr[key].trim().length > 0, `Empty FR value for ${key}`);
    assert.ok(TRANSLATIONS.ru[key].trim().length > 0, `Empty RU value for ${key}`);
    assert.ok(TRANSLATIONS.en[key].trim().length > 0, `Empty EN value for ${key}`);
  }
});
