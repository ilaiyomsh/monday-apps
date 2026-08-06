import { describe, it, expect } from 'vitest';
import { DEFAULT_EXPORT_TEMPLATE, EXPORT_TEXT_ALIGN } from '../mondayApi/boards.config.js';
import {
  TITLE_FIELD_OPTIONS,
  TITLE_SEPARATORS,
  resolveExportTitle,
  titleSeparatorText,
  composeExportTitle,
  titleAlign,
} from '../exportTitle.js';

/*
 * round365 (owner spec, approved mockup) — the export TITLE composition.
 * The shipped default must read exactly:
 *   סיכום דיון - <שם הדיון> <תאריך DD.MM.YYYY>
 * centered; every part/order/separator/alignment is owner-configurable.
 */

const MODEL = {
  title: 'ישיבת צוות שבועית',
  typesText: 'דיון כללי',
  dateText: '06.08.2026',
  leadText: 'עידו',
};

describe('round365 — shipped default title config', () => {
  it('is free "סיכום דיון" + dash + name + space + date, centered', () => {
    expect(DEFAULT_EXPORT_TEMPLATE.title).toEqual({
      free: 'סיכום דיון',
      field2: 'discussionName',
      field3: 'discussionDate',
      order: ['free', 'field2', 'field3'],
      sep12: 'dash',
      sep23: 'space',
      align: 'center',
    });
    expect(composeExportTitle(DEFAULT_EXPORT_TEMPLATE.title, MODEL))
      .toBe('סיכום דיון - ישיבת צוות שבועית 06.08.2026');
  });
});

describe('round365 — resolveExportTitle', () => {
  it('returns the shipped default for a template stored BEFORE the field existed', () => {
    expect(resolveExportTitle(undefined)).toEqual(DEFAULT_EXPORT_TEMPLATE.title);
    expect(resolveExportTitle(null)).toEqual(DEFAULT_EXPORT_TEMPLATE.title);
  });

  it('merges a partial stored config over the default', () => {
    const r = resolveExportTitle({ free: 'פרוטוקול', align: 'right' });
    expect(r.free).toBe('פרוטוקול');
    expect(r.align).toBe('right');
    expect(r.field2).toBe('discussionName');
    expect(r.sep12).toBe('dash');
  });

  it('repairs a corrupt order — every part appears exactly once, stored order honored where valid', () => {
    expect(resolveExportTitle({ order: ['field2', 'free', 'field3'] }).order)
      .toEqual(['field2', 'free', 'field3']);
    // missing part → appended; junk / duplicates → dropped
    expect(resolveExportTitle({ order: ['field3', 'free'] }).order).toEqual(['field3', 'free', 'field2']);
    expect(resolveExportTitle({ order: ['free', 'free', 'nope'] }).order).toEqual(['free', 'field2', 'field3']);
    expect(resolveExportTitle({ order: 'garbage' }).order).toEqual(['free', 'field2', 'field3']);
  });
});

describe('round365 — composeExportTitle', () => {
  it('honors a custom order and the positional separators', () => {
    const cfg = { free: 'פרוטוקול', field2: 'discussionType', field3: 'discussionName', order: ['field2', 'free', 'field3'], sep12: 'colon', sep23: 'dash', align: 'center' };
    expect(composeExportTitle(cfg, MODEL)).toBe('דיון כללי: פרוטוקול - ישיבת צוות שבועית');
  });

  it('drops an empty part together with its separator', () => {
    // no third field at all
    expect(composeExportTitle({ ...DEFAULT_EXPORT_TEMPLATE.title, field3: 'none' }, MODEL))
      .toBe('סיכום דיון - ישיבת צוות שבועית');
    // the discussion has no type → the part vanishes, no dangling separator
    expect(composeExportTitle({ ...DEFAULT_EXPORT_TEMPLATE.title, field2: 'discussionType' }, { ...MODEL, typesText: '' }))
      .toBe('סיכום דיון - 06.08.2026');
    // blank free text → starts straight at the name
    expect(composeExportTitle({ ...DEFAULT_EXPORT_TEMPLATE.title, free: '   ' }, MODEL))
      .toBe('ישיבת צוות שבועית 06.08.2026');
  });

  it('falls back to the discussion name when EVERYTHING is empty (a document must never lose its title)', () => {
    expect(composeExportTitle({ ...DEFAULT_EXPORT_TEMPLATE.title, free: '', field2: 'discussionType', field3: 'none' }, { ...MODEL, typesText: '' }))
      .toBe('ישיבת צוות שבועית');
  });

  it('resolves a legacy template with NO title config to the new default composition', () => {
    expect(composeExportTitle(resolveExportTitle(undefined), MODEL))
      .toBe('סיכום דיון - ישיבת צוות שבועית 06.08.2026');
  });
});

describe('round365 — separators and alignment', () => {
  it('maps separator values to their text (unknown → space)', () => {
    expect(titleSeparatorText('dash')).toBe(' - ');
    expect(titleSeparatorText('colon')).toBe(': ');
    expect(titleSeparatorText('space')).toBe(' ');
    expect(titleSeparatorText('nope')).toBe(' ');
    expect(TITLE_SEPARATORS.map((s) => s.value)).toEqual(['space', 'dash', 'colon']);
  });

  it('titleAlign defaults to center and passes valid values through', () => {
    expect(titleAlign(undefined)).toBe(EXPORT_TEXT_ALIGN.CENTER);
    expect(titleAlign({})).toBe(EXPORT_TEXT_ALIGN.CENTER);
    expect(titleAlign({ align: 'right' })).toBe('right');
    expect(titleAlign({ align: 'left' })).toBe('left');
    expect(titleAlign({ align: 'bogus' })).toBe(EXPORT_TEXT_ALIGN.CENTER);
  });

  it('every field option carries the model key docxExport actually exposes', () => {
    expect(TITLE_FIELD_OPTIONS.map((o) => [o.value, o.modelKey])).toEqual([
      ['discussionName', 'title'],
      ['discussionType', 'typesText'],
      ['discussionDate', 'dateText'],
      ['discussionLead', 'leadText'],
    ]);
  });
});
