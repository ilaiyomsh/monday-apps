import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDiscussionModel, __testHooks } from '../docxExport.js';
import { resolvePeopleFormat } from '../participantFormat.js';
import {
  DEFAULT_EXPORT_TEMPLATE,
  DEFAULT_PEOPLE_FORMAT,
  DEFAULT_PARTICIPANT_PARTS,
} from '../mondayApi/boards.config.js';

/*
 * round319 (owner request) — ONE "אנשים" setting for every person in the export,
 * instead of a box per role.
 *
 * Until now משתתפים, מוביל דיון and מרכז דיון each carried their own `perLine` and
 * `parts` (round316), so writing "מר/גברת + שם" everywhere meant configuring it
 * three times and keeping the three in sync by hand. The format now lives once on
 * `template.people` and every people row reads it.
 *
 * The second half of the request: the EXTERNAL participants (free text, no monday
 * profile) can join the participants list instead of getting their own labelled
 * row. It is a choice, not a rewrite of the output — `includeExternal:false` keeps
 * round211's split exactly as it was, which is what every stored template gets.
 */

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

/** The template with a patch applied to the ONE shared people format. */
const tplPeople = (patch) => ({
  ...DEFAULT_EXPORT_TEMPLATE,
  people: { ...DEFAULT_EXPORT_TEMPLATE.people, ...patch },
});

const DISC = {
  name: 'דיון בדיקה',
  participantsID: [{ id: '1', name: 'עידו פיוטרקובסקי' }],
  discussionLeadID: [{ id: '4', name: 'שירה לוי' }],
  discussionCoordinatorID: [{ id: '5', name: 'נועה אביב' }],
};
const PROFILES = {
  1: { title: 'מנהל מחלקת מכירות', customFields: { 750658: 'מר' } },
  4: { title: 'מנכ"לית', customFields: { 750658: 'גב׳' } },
  5: { title: 'רכזת ישיבות', customFields: { 750658: 'גב׳' } },
};
const modelOf = (extra = {}) => buildDiscussionModel({ discussion: { ...DISC, ...extra }, participantProfiles: PROFILES });

const TITLE_THEN_NAME = [
  { key: 'cf:750658', sep: ', ' },
  { key: 'name', sep: ' ' },
];

describe('the shipped shared people format', () => {
  it('is one neutral setting on the template — one row, name only, externals apart', () => {
    expect(DEFAULT_PEOPLE_FORMAT).toEqual({
      perLine: false,
      parts: DEFAULT_PARTICIPANT_PARTS,
      includeExternal: false,
    });
    expect(DEFAULT_EXPORT_TEMPLATE.people).toEqual(DEFAULT_PEOPLE_FORMAT);
  });

  it('is no longer carried per meta field — the three people rows keep only label and enabled', () => {
    const fields = DEFAULT_EXPORT_TEMPLATE.sections.find((s) => s.key === 'meta').fields;
    ['participantsText', 'leadText', 'coordinatorText'].forEach((key) => {
      const field = fields.find((f) => f.key === key);
      expect(field.perLine).toBeUndefined();
      expect(field.parts).toBeUndefined();
      expect(field.enabled).toBe(true);
    });
  });
});

describe('resolvePeopleFormat', () => {
  it('reads the template’s setting', () => {
    expect(resolvePeopleFormat(tplPeople({ perLine: true, includeExternal: true })))
      .toEqual({ perLine: true, parts: DEFAULT_PARTICIPANT_PARTS, includeExternal: true });
  });

  it('falls back to the neutral default for a template that has none', () => {
    expect(resolvePeopleFormat({})).toEqual(DEFAULT_PEOPLE_FORMAT);
    expect(resolvePeopleFormat(null)).toEqual(DEFAULT_PEOPLE_FORMAT);
  });

  it('drops unknown part keys rather than rendering them as themselves', () => {
    const out = resolvePeopleFormat(tplPeople({ parts: [{ key: 'salary', sep: ', ' }] }));
    expect(out.parts).toEqual(DEFAULT_PARTICIPANT_PARTS);
  });

  it('coerces a non-boolean includeExternal, so a stray stored value cannot merge the lists', () => {
    expect(resolvePeopleFormat(tplPeople({ includeExternal: 'yes' })).includeExternal).toBe(false);
  });
});

describe('one setting, every people row', () => {
  it('per-line applies to all three rows at once', async () => {
    const lines = await linesOf(modelOf(), tplPeople({ perLine: true }));

    ['משתתפים:', 'מוביל דיון:', 'מרכז דיון:'].forEach((label) => {
      const at = lines.indexOf(label);
      expect(at).toBeGreaterThanOrEqual(0);
    });
    expect(lines[lines.indexOf('משתתפים:') + 1]).toBe('עידו פיוטרקובסקי');
    expect(lines[lines.indexOf('מוביל דיון:') + 1]).toBe('שירה לוי');
    expect(lines[lines.indexOf('מרכז דיון:') + 1]).toBe('נועה אביב');
  });

  it('the chosen parts compose every person, whatever row they are in', async () => {
    const lines = await linesOf(modelOf(), tplPeople({ parts: TITLE_THEN_NAME }));

    expect(lines).toContain('משתתפים: מר עידו פיוטרקובסקי');
    expect(lines).toContain('מוביל דיון: גב׳ שירה לוי');
    expect(lines).toContain('מרכז דיון: גב׳ נועה אביב');
  });

  it('the default template still writes one comma-joined row of names per role', async () => {
    const lines = await linesOf(modelOf(), DEFAULT_EXPORT_TEMPLATE);

    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי');
    expect(lines).toContain('מוביל דיון: שירה לוי');
    expect(lines).toContain('מרכז דיון: נועה אביב');
  });
});

describe('external participants joining the list', () => {
  const withExternals = { externalParticipantsID: 'רוני שגב\nדנה כהן' };

  it('keeps them in their own row by default — a stored template must not change output', async () => {
    const lines = await linesOf(modelOf(withExternals), DEFAULT_EXPORT_TEMPLATE);

    expect(lines).toContain('משתתפים פנימיים: עידו פיוטרקובסקי');
    expect(lines).toContain('משתתפים חיצוניים: רוני שגב, דנה כהן');
  });

  it('merges them into the participants row when asked, with no separate block', async () => {
    const lines = await linesOf(modelOf(withExternals), tplPeople({ includeExternal: true }));

    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי, רוני שגב, דנה כהן');
    expect(lines.filter((l) => l.startsWith('משתתפים חיצוניים'))).toEqual([]);
    // …and the row is not re-labelled "פנימיים" either: with the externals inside
    // it, there is no second group to tell it apart from.
    expect(lines.filter((l) => l.startsWith('משתתפים פנימיים'))).toEqual([]);
  });

  it('gives a merged external a line of their own under per-line', async () => {
    const lines = await linesOf(modelOf(withExternals), tplPeople({ perLine: true, includeExternal: true }));
    const at = lines.indexOf('משתתפים:');

    expect(lines.slice(at + 1, at + 4)).toEqual(['עידו פיוטרקובסקי', 'רוני שגב', 'דנה כהן']);
  });

  it('writes the externals as their plain names even when parts are configured', async () => {
    // They are free text — there is no profile to take a Title or a מר/גברת from,
    // and inventing one would put a title on the wrong person.
    const lines = await linesOf(
      modelOf(withExternals),
      tplPeople({ includeExternal: true, parts: TITLE_THEN_NAME }),
    );

    expect(lines).toContain('משתתפים: מר עידו פיוטרקובסקי, רוני שגב, דנה כהן');
  });

  it('leaves the row alone when the discussion has no externals', async () => {
    const lines = await linesOf(modelOf(), tplPeople({ includeExternal: true }));

    expect(lines).toContain('משתתפים: עידו פיוטרקובסקי');
    expect(lines.filter((l) => l.startsWith('משתתפים חיצוניים'))).toEqual([]);
  });

  it('never merges externals into the lead or coordinator rows', async () => {
    const lines = await linesOf(modelOf(withExternals), tplPeople({ includeExternal: true }));

    expect(lines).toContain('מוביל דיון: שירה לוי');
    expect(lines).toContain('מרכז דיון: נועה אביב');
  });
});
