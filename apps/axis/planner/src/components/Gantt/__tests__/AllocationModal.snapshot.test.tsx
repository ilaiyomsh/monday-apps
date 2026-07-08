import { describe, it, expect } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectHebrewInventory } from '../../../test-utils/hebrewSnapshot';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(__dirname, '..', 'AllocationModal.tsx');
const BUNDLE = resolve(__dirname, '../../../i18n/locales/he/translation.json');

describe('AllocationModal — Hebrew baseline', () => {
  it('Hebrew inventory is unchanged from baseline (source ∪ he bundle)', () => {
    const inventory = collectHebrewInventory(SOURCE, BUNDLE);
    expect(inventory).toMatchSnapshot();
  });
});
