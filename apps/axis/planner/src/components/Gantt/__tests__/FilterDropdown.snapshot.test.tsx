import { describe, it, expect } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectHebrewInventory } from '../../../test-utils/hebrewSnapshot';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '..', 'FilterDropdown.tsx');
const BUNDLE = resolve(__dirname, '../../../i18n/locales/he/translation.json');

describe('FilterDropdown — Hebrew baseline', () => {
  it('Hebrew inventory is unchanged from baseline (source ∪ he bundle)', () => {
    const inventory = collectHebrewInventory(SOURCE, BUNDLE);
    // As strings move from source to bundle during extraction the union stays the
    // same — only an actual Hebrew change should flip this snapshot. Update with
    // explicit reviewer approval if a Hebrew label is intentionally retitled.
    expect(inventory).toMatchSnapshot();
  });
});
