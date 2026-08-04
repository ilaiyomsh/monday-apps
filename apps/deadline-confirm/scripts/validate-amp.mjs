#!/usr/bin/env node
// Validate the digest's amp4email documents against the OFFICIAL AMP validator.
//
// Why this exists: Gmail's only diagnostic for a dynamic part it refuses is
// `INTERNAL_ERROR` — a documented catch-all with no content. An invalid document
// and a rejected envelope look identical from the inbox. The validator tells us
// which one we have, by line and rule, before anything is sent.
//
// Run: node scripts/validate-amp.mjs   (or: npm run validate:amp)
//
// EXIT CODES are the contract — CI distinguishes them on purpose:
//   0  every sample is a valid AMP4EMAIL document
//   1  at least one sample is INVALID  → a real defect, fail the build
//   3  the validator could not be fetched (it loads from cdn.ampproject.org)
//      → infrastructure, NOT a verdict on the documents. Never fail a build on
//        this: it would couple every PR in the monorepo to an external CDN.
//
// The samples come from the REAL renderer, not hand-written HTML — the point is
// to validate what the app actually sends, including the amp-bind bindings the
// note column and the status dropdown generate.

import amphtmlValidator from 'amphtml-validator';
import { renderDigestAmp } from '../src/helpers/digest-amp.js';

const RENDER_ARGS = {
  baseUrl: 'https://deadline.example',
  secret: 'SECRET43',
  accountId: '777',
  sendHour: 8,
  now: new Date('2026-08-03T10:00:00+03:00'),
};

const BTN_DONE = {
  id: 'b_done0001',
  name: 'סיימתי',
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};
const BTN_HOLD = {
  id: 'b_hold0001',
  name: 'ממתין',
  targetLabel: 'ממתין לספק',
  style: { color: '#fdab3d', icon: '⏰', size: 'sm' },
};

const task = (itemId, name, date = '2026-08-01') => ({
  itemId,
  name,
  date,
  statusText: 'לא התחיל',
});

/** One cluster as the renderer expects it (post-decorateRecipientSections). */
const cluster = (over = {}) => ({
  sectionId: 's_a0000001',
  title: 'לסיים:',
  dateColumnTitle: 'תאריך יעד',
  noteColumnId: null,
  noteColumnTitle: '',
  buttonId: BTN_DONE.id,
  buttonIds: [BTN_DONE.id],
  button: BTN_DONE,
  buttons: [BTN_DONE],
  tasks: [task('9001', 'גיבוש תכנית עבודה')],
  ...over,
});

const recipient = (sections) => ({ name: 'דנה כהן', personId: '501', sections });

/**
 * Every shape the renderer can produce that differs STRUCTURALLY. Each one
 * exercises markup the others do not, so a rule broken by one binding cannot
 * hide behind a simpler sample.
 */
const SAMPLES = [
  {
    name: 'single cluster, no note column (the pre-0.12.0 shape)',
    recipient: recipient([cluster()]),
  },
  {
    name: 'note column mapped — text input, bound [class], bound submit [disabled]',
    recipient: recipient([
      cluster({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' }),
    ]),
  },
  {
    name: 'multi-button dropdown + note column (two bound option buttons per row)',
    recipient: recipient([
      cluster({
        noteColumnId: 'text_note',
        noteColumnTitle: 'סיכום ביצוע',
        buttonIds: [BTN_DONE.id, BTN_HOLD.id],
        buttons: [BTN_DONE, BTN_HOLD],
        tasks: [task('9001', 'גיבוש תכנית'), task('9002', 'תיאום ספק', '2026-07-28')],
      }),
    ]),
  },
  {
    name: 'two clusters, one mapped one not (mixed table widths, partial gate)',
    recipient: recipient([
      cluster({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' }),
      cluster({
        sectionId: 's_b0000002',
        title: 'להתחיל:',
        dateColumnTitle: 'תאריך התחלה',
        tasks: [task('9003', 'הגשת דוח')],
      }),
    ]),
  },
  {
    name: 'same task in TWO mapped clusters (one hidden note field, deduped state)',
    recipient: recipient([
      cluster({ noteColumnId: 'text_note', noteColumnTitle: 'הערה א' }),
      cluster({
        sectionId: 's_b0000002',
        title: 'גם כאן:',
        noteColumnId: 'text_other',
        noteColumnTitle: 'הערה ב',
      }),
    ]),
  },
];

function reportErrors(sampleName, html, errors) {
  const lines = html.split('\n');
  console.error(`\n✗ INVALID — ${sampleName}`);
  for (const e of errors) {
    const severity = e.severity === 'ERROR' ? 'ERROR' : e.severity;
    console.error(`  ${severity} ${e.line}:${e.col}  ${e.message}`);
    if (e.specUrl) console.error(`        spec: ${e.specUrl}`);
    const source = lines[e.line - 1];
    if (source !== undefined) console.error(`        source: ${source.trim().slice(0, 160)}`);
  }
}

async function main() {
  let validator;
  try {
    validator = await amphtmlValidator.getInstance();
  } catch (err) {
    // Infrastructure, not a verdict. Say so loudly and exit with the dedicated
    // code so CI can skip instead of reporting a document problem that was
    // never actually assessed.
    console.error('⚠ could not load the AMP validator (it is fetched from cdn.ampproject.org):');
    console.error(`  ${String(err?.message ?? err)}`);
    console.error('  This is NOT a validation failure — nothing was checked.');
    process.exit(3);
  }

  let invalid = 0;
  for (const sample of SAMPLES) {
    const html = renderDigestAmp({ ...RENDER_ARGS, recipient: sample.recipient });
    const result = validator.validateString(html, 'AMP4EMAIL');
    const errors = result.errors.filter((e) => e.severity === 'ERROR');
    const warnings = result.errors.filter((e) => e.severity !== 'ERROR');

    if (result.status === 'PASS' && errors.length === 0) {
      const size = `${Buffer.byteLength(html, 'utf8').toLocaleString('en-US')} bytes`;
      const warn = warnings.length > 0 ? ` (${warnings.length} warning(s))` : '';
      console.log(`✓ ${sample.name} — ${size}${warn}`);
      for (const w of warnings) console.log(`    WARNING ${w.line}:${w.col}  ${w.message}`);
      continue;
    }
    invalid += 1;
    reportErrors(sample.name, html, errors.length > 0 ? errors : result.errors);
  }

  if (invalid > 0) {
    console.error(`\n${invalid}/${SAMPLES.length} sample(s) are not valid AMP4EMAIL.`);
    process.exit(1);
  }
  console.log(`\nAll ${SAMPLES.length} samples are valid AMP4EMAIL.`);
}

// Top-level failures must not exit 0 — a silent pass here would be worse than
// no check at all. Exit 1 (a real problem) rather than 3 (validator missing).
main().catch((err) => {
  console.error('validate-amp: unexpected failure');
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
