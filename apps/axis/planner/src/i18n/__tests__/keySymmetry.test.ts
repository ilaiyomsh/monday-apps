import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, '../locales');

const flatten = (obj: unknown, prefix = ''): string[] => {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
};

const readBundle = (lang: 'he' | 'en') => {
  const file = resolve(localesDir, lang, 'translation.json');
  return JSON.parse(readFileSync(file, 'utf-8')) as unknown;
};

describe('i18n key symmetry', () => {
  it('he and en have identical key sets', () => {
    const he = readBundle('he');
    const en = readBundle('en');

    const heKeys = flatten(he).sort();
    const enKeys = flatten(en).sort();

    expect(heKeys).toEqual(enKeys);
  });
});
