import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDiscussionModel, __testHooks } from '../docxExport.js';
import {
  DEFAULT_EXPORT_TEMPLATE,
  PEOPLE_META_FIELDS,
  isPeopleMetaField,
  DEFAULT_PARTICIPANT_PARTS,
} from '../mondayApi/boards.config.js';

/*
 * round316 (owner request) — the line-per-person + profile-parts controls apply to
 * EVERY people row of "פרטי הדיון": משתתפים, מוביל דיון (which the owner also calls
 * מנהל), and מרכז דיון — the latter a NEW metadata row.
 */

// XML entities must be decoded, or a Hebrew title containing " (מנכ"לית) reads back
// as `מנכ&quot;לית` and the assertion fails for a reason that has nothing to do with
// the feature.
const decode = (s) => s
  .replace(/&quot;/g, '"')
  .replace(/&apos;|&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const linesOf = async (model, template) => {
  const { doc } = await __testHooks.buildExportDoc(model, template);
  const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml']);
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
    .map((p) => (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map((t) => decode(t.replace(/<[^>]+>/g, '')))
      .join(''))
    .map((s) => s.trim())
    .filter(Boolean);
};

const metaFields = (tpl) => tpl.sections.find((s) => s.key === 'meta').fields;
// A template with `patch` applied to ONE meta field.
const tplField = (fieldKey, patch) => ({
  ...DEFAULT_EXPORT_TEMPLATE,
  sections: DEFAULT_EXPORT_TEMPLATE.sections.map((s) => (
    s.key === 'meta'
      ? { ...s, fields: s.fields.map((f) => (f.key === fieldKey ? { ...f, ...patch } : f)) }
      : s
  )),
});

const DISC = {
  name: 'דיון בדיקה',
  participantsID: [{ id: '1', name: 'עידו פיוטרקובסקי' }],
  discussionLeadID: [{ id: '4', name: 'שירה לוי' }, { id: '6', name: 'אורי דגן' }],
  discussionCoordinatorID: [{ id: '5', name: 'נועה אביב' }],
};
const PROFILES = {
  1: { title: 'מנהל מחלקת מכירות', customFields: { 750658: 'מר' } },
  4: { title: 'מנכ"לית', customFields: { 750658: 'גב׳' } },
  5: { title: 'רכזת ישיבות', customFields: {} },
  6: { title: '', customFields: {} },
};
const modelOf = (extra = {}) => buildDiscussionModel({ discussion: { ...DISC, ...extra }, participantProfiles: PROFILES });

describe('which meta rows are people rows', () => {
  it('names the three of them, each pointing at its model list', () => {
    expect(PEOPLE_META_FIELDS).toEqual({
      participantsText: 'participants',
      leadText: 'lead',
      coordinatorText: 'coordinator',
    });
    expect(isPeopleMetaField('leadText')).toBe(true);
    expect(isPeopleMetaField('coordinatorText')).toBe(true);
    expect(isPeopleMetaField('dateText')).toBe(false);
    expect(isPeopleMetaField('typesText')).toBe(false);
  });

  it('ships all three with the neutral defaults (one row, name only)', () => {
    metaFields(DEFAULT_EXPORT_TEMPLATE)
      .filter((f) => isPeopleMetaField(f.key))
      .forEach((f) => {
        expect(f.perLine).toBe(false);
        expect(f.parts).toEqual(DEFAULT_PARTICIPANT_PARTS);
      });
  });

  it('adds מרכז דיון right after מוביל דיון, enabled', () => {
    const keys = metaFields(DEFAULT_EXPORT_TEMPLATE).map((f) => f.key);
    expect(keys.indexOf('coordinatorText')).toBe(keys.indexOf('leadText') + 1);
    const coordinator = metaFields(DEFAULT_EXPORT_TEMPLATE).find((f) => f.key === 'coordinatorText');
    expect(coordinator.enabled).toBe(true);
    expect(coordinator.label).toBe('מרכז דיון');
  });
});

describe('buildDiscussionModel — lead and coordinator as profiles', () => {
  it('exposes both as objects carrying Title and custom fields', () => {
    const model = modelOf();
    expect(model.lead).toEqual([
      { id: '4', name: 'שירה לוי', title: 'מנכ"לית', customFields: { 750658: 'גב׳' } },
      { id: '6', name: 'אורי דגן', title: '', customFields: {} },
    ]);
    expect(model.coordinator).toEqual([
      { id: '5', name: 'נועה אביב', title: 'רכזת ישיבות', customFields: {} },
    ]);
  });

  it('keeps the flat text rows as plain comma-joined names', () => {
    const model = modelOf();
    expect(model.leadText).toBe('שירה לוי, אורי דגן');
    expect(model.coordinatorText).toBe('נועה אביב');
  });

  it('is empty (not undefined) when the coordinator column is unmapped or blank', () => {
    const model = buildDiscussionModel({ discussion: { name: 'x', participantsID: [] } });
    expect(model.coordinator).toEqual([]);
    expect(model.coordinatorText).toBe('');
  });
});

describe('the lead and coordinator rows in the rendered document', () => {
  it('DEFAULT template — one row each, names comma-joined', async () => {
    const lines = await linesOf(modelOf(), DEFAULT_EXPORT_TEMPLATE);
    expect(lines).toContain('מוביל דיון: שירה לוי, אורי דגן');
    expect(lines).toContain('מרכז דיון: נועה אביב');
  });

  it('per-line on מוביל דיון — a label line then one line per person', async () => {
    const lines = await linesOf(modelOf(), tplField('leadText', { perLine: true }));
    const at = lines.indexOf('מוביל דיון:');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toBe('שירה לוי');
    expect(lines[at + 2]).toBe('אורי דגן');
    // …and the participants row is untouched by the lead's setting.
    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי');
  });

  it('parts on מוביל דיון — the chosen titles, in the chosen order', async () => {
    const tpl = tplField('leadText', {
      parts: [{ key: 'cf:750658', sep: ', ' }, { key: 'name', sep: ' ' }, { key: 'title', sep: ', ' }],
    });
    const lines = await linesOf(modelOf(), tpl);
    // The lead with no Title keeps a clean name, in the same row.
    expect(lines).toContain('מוביל דיון: גב׳ שירה לוי, מנכ"לית, אורי דגן');
  });

  it('parts on מרכז דיון work independently of the other rows', async () => {
    const tpl = tplField('coordinatorText', {
      parts: [{ key: 'name', sep: ', ' }, { key: 'title', sep: ' — ' }],
    });
    const lines = await linesOf(modelOf(), tpl);
    expect(lines).toContain('מרכז דיון: נועה אביב — רכזת ישיבות');
    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי');
    expect(lines).toContain('מוביל דיון: שירה לוי, אורי דגן');
  });

  it('honours a renamed label — the owner who says "מנהל דיון" writes that', async () => {
    const lines = await linesOf(modelOf(), tplField('leadText', { label: 'מנהל דיון', perLine: true }));
    expect(lines).toContain('מנהל דיון:');
    expect(lines).not.toContain('מוביל דיון:');
  });

  it('emits no מרכז דיון row when the discussion has none', async () => {
    const model = modelOf({ discussionCoordinatorID: [] });
    const lines = await linesOf(model, tplField('coordinatorText', { perLine: true }));
    expect(lines.some((l) => l.startsWith('מרכז דיון'))).toBe(false);
  });

  it('drops a row the owner disabled', async () => {
    const lines = await linesOf(modelOf(), tplField('coordinatorText', { enabled: false }));
    expect(lines.some((l) => l.startsWith('מרכז דיון'))).toBe(false);
    expect(lines).toContain('מוביל דיון: שירה לוי, אורי דגן');
  });

  it('a stored template with no perLine/parts on these rows renders exactly as before', async () => {
    const tpl = tplField('leadText', {});
    const lead = metaFields(tpl).find((f) => f.key === 'leadText');
    delete lead.perLine;
    delete lead.parts;
    const lines = await linesOf(modelOf(), tpl);
    expect(lines).toContain('מוביל דיון: שירה לוי, אורי דגן');
    expect(lines).not.toContain('מוביל דיון:');
  });

  it('a model built WITHOUT the lists still renders the flat text rows (legacy caller)', async () => {
    const legacy = { ...modelOf(), lead: undefined, coordinator: undefined };
    const lines = await linesOf(legacy, tplField('leadText', { perLine: true }));
    expect(lines).toContain('מוביל דיון:');
    expect(lines[lines.indexOf('מוביל דיון:') + 1]).toBe('שירה לוי, אורי דגן');
    expect(lines).toContain('מרכז דיון: נועה אביב');
  });

  it('the externals split stays a property of the PARTICIPANTS row only', async () => {
    const model = modelOf({ externalParticipantsID: 'רוני שגב' });
    const lines = await linesOf(model, DEFAULT_EXPORT_TEMPLATE);
    expect(lines).toContain('משתתפים פנימיים: עידו פיוטרקובסקי');
    // EXACTLY ONE externals block — it belongs to the participants row, and a row
    // that merely happens to hold people must not repeat it.
    expect(lines.filter((l) => l.startsWith('משתתפים חיצוניים'))).toEqual(['משתתפים חיצוניים: רוני שגב']);
    // The lead/coordinator labels are never re-qualified either.
    expect(lines).toContain('מוביל דיון: שירה לוי, אורי דגן');
    expect(lines).toContain('מרכז דיון: נועה אביב');
    expect(lines).not.toContain('מוביל דיון פנימיים: שירה לוי, אורי דגן');
  });
});
