import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// CI Gate (Increment 1): מבטיח שכל מפתח ב-he קיים ב-en ולהפך.
// אסור שטקסט יישאר בעברית "מתחבא" באנגלית או יחסר תרגום.

// הפרויקט הוא ESM ("type": "module") — __dirname לא קיים.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HE_DIR = path.resolve(__dirname, '../locales/he');
const EN_DIR = path.resolve(__dirname, '../locales/en');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function flattenKeys(obj, prefix = '') {
    const keys = [];
    for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            keys.push(...flattenKeys(v, full));
        } else {
            keys.push(full);
        }
    }
    return keys.sort();
}

describe('i18n key symmetry (CI gate)', () => {

    it('תיקיות locales/he ו-locales/en קיימות', () => {
        expect(fs.existsSync(HE_DIR)).toBe(true);
        expect(fs.existsSync(EN_DIR)).toBe(true);
    });

    it('יש לפחות namespace אחד בעברית', () => {
        const files = fs.readdirSync(HE_DIR).filter(f => f.endsWith('.json'));
        expect(files.length).toBeGreaterThan(0);
    });

    it('כל namespace ב-he קיים גם ב-en', () => {
        const heFiles = fs.readdirSync(HE_DIR).filter(f => f.endsWith('.json'));
        for (const file of heFiles) {
            const enFile = path.join(EN_DIR, file);
            expect(fs.existsSync(enFile), `missing en namespace: ${file}`).toBe(true);
        }
    });

    it('אין namespace ב-en שלא קיים ב-he', () => {
        const enFiles = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.json'));
        for (const file of enFiles) {
            const heFile = path.join(HE_DIR, file);
            expect(fs.existsSync(heFile), `unmatched en namespace: ${file}`).toBe(true);
        }
    });

    it('סט המפתחות ב-he ו-en זהה לכל namespace', () => {
        const heFiles = fs.readdirSync(HE_DIR).filter(f => f.endsWith('.json'));
        for (const file of heFiles) {
            const heKeys = flattenKeys(readJson(path.join(HE_DIR, file)));
            const enKeys = flattenKeys(readJson(path.join(EN_DIR, file)));
            expect(enKeys, `key drift in ${file}`).toEqual(heKeys);
        }
    });

    it('אין ערך ריק (כל מפתח חייב טקסט) — בשתי השפות', () => {
        // איחוד שמות הקבצים מבלי כפילויות, ובדיקה של כל קובץ בכל שפה שבה הוא קיים.
        // (גרסה קודמת בחרה רק את HE_DIR כשהקובץ קיים בשתיהן — דילגה על en.)
        const heFiles = fs.readdirSync(HE_DIR).filter(f => f.endsWith('.json'));
        const enFiles = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.json'));
        const namespaces = Array.from(new Set([...heFiles, ...enFiles]));

        for (const file of namespaces) {
            for (const dir of [HE_DIR, EN_DIR]) {
                const filePath = path.join(dir, file);
                if (!fs.existsSync(filePath)) continue;
                const lang = path.basename(dir);
                const tree = readJson(filePath);
                const keys = flattenKeys(tree);
                for (const k of keys) {
                    const value = k.split('.').reduce((acc, part) => acc?.[part], tree);
                    expect(value, `empty value at ${lang}/${file}:${k}`).toBeTruthy();
                }
            }
        }
    });
});
