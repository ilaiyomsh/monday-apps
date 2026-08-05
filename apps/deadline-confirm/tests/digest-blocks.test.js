// TDD red phase (0.14.0) — src/services/digest-blocks.js, the block model behind
// the summary email. The digest body is now an ORDERED list of blocks (text or
// cluster) authored by the operator; the renderers carry no content text of
// their own (owner decision 2026-08-05).
//
// Two things this module must get right, because everything else depends on
// them:
//   1. A config saved before this feature has no `blocks` at all. Reading one
//      must produce the blocks that reproduce the email that config was already
//      sending — greeting, lead, note hint (only when a cluster maps a note
//      column), the clusters in order, footer. Nothing about that tenant's mail
//      may change until the operator edits it.
//   2. `sections` stays the projection the digest pipeline consumes, derived
//      from the cluster blocks IN BLOCK ORDER — which is what makes block order
//      the section priority without a second ordering field.

import { describe, it, expect } from 'vitest';
import {
  NAME_TOKEN,
  applyTokens,
  clusterBlocks,
  isTextBlock,
  normalizeDigestBlocks,
  sectionsFromBlocks,
} from '../src/services/digest-blocks.js';

const LEGACY_DIGEST = {
  usersBoardId: '111',
  usersPeopleColumnId: 'people',
  usersEmailColumnId: 'email',
  subject: 'המשימות שלך',
  sendHour: 8,
  sections: [
    {
      id: 's_start001',
      title: 'משימות שנדרש להתחיל:',
      dateColumnId: 'date_start',
      dateColumnTitle: 'תאריך התחלה',
      buttonId: 'b_start001',
      buttonIds: ['b_start001'],
      includeStatusLabelIds: [0, 1],
    },
    {
      id: 's_done0001',
      title: 'משימות שנדרש לסיים:',
      dateColumnId: 'date_end',
      dateColumnTitle: 'תאריך סיום',
      buttonId: 'b_done0001',
      buttonIds: ['b_done0001'],
      includeStatusLabelIds: [1],
    },
  ],
};

const textOf = (blocks) => blocks.filter(isTextBlock).map((b) => b.text);

describe('normalizeDigestBlocks — legacy config (no blocks key)', () => {
  it('reproduces the pre-0.14.0 email: greeting, lead, clusters, footer', () => {
    const blocks = normalizeDigestBlocks(LEGACY_DIGEST);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'cluster', 'cluster', 'text']);
  });

  it('greets with the name token, not a baked-in name', () => {
    const [greeting] = normalizeDigestBlocks(LEGACY_DIGEST);
    expect(greeting.text).toContain(NAME_TOKEN);
    expect(greeting.bold).toBe(true);
  });

  it('keeps the clusters in their stored order, ids and settings intact', () => {
    const clusters = clusterBlocks(normalizeDigestBlocks(LEGACY_DIGEST));
    expect(clusters.map((c) => c.id)).toEqual(['s_start001', 's_done0001']);
    expect(clusters[0].dateColumnId).toBe('date_start');
    expect(clusters[1].includeStatusLabelIds).toEqual([1]);
  });

  it('omits the note hint when no cluster maps a note column', () => {
    const texts = textOf(normalizeDigestBlocks(LEGACY_DIGEST));
    expect(texts.some((t) => t.includes('שדה טקסט'))).toBe(false);
  });

  it('adds the note hint — after the lead — when a cluster does map one', () => {
    const digest = {
      ...LEGACY_DIGEST,
      sections: [{ ...LEGACY_DIGEST.sections[0], noteColumnId: 'text_note', noteColumnTitle: 'הערה' }],
    };
    const blocks = normalizeDigestBlocks(digest);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'text', 'cluster', 'text']);
    expect(blocks[2].text).toContain('שדה טקסט');
  });

  it('gives every generated block an id and complete styling', () => {
    for (const block of normalizeDigestBlocks(LEGACY_DIGEST).filter(isTextBlock)) {
      expect(block.id).toMatch(/^x_[A-Za-z0-9_-]{4,16}$/);
      expect(block.direction).toBe('rtl');
      expect(block.align).toBe('right');
      expect(typeof block.font).toBe('string');
      expect(block.fontSize).toBeGreaterThanOrEqual(10);
      expect(block.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('is deterministic — reading the same legacy config twice gives the same ids', () => {
    expect(normalizeDigestBlocks(LEGACY_DIGEST)).toEqual(normalizeDigestBlocks(LEGACY_DIGEST));
  });
});

describe('normalizeDigestBlocks — a config that already carries blocks', () => {
  const authored = {
    ...LEGACY_DIGEST,
    blocks: [
      {
        type: 'cluster',
        id: 's_done0001',
        title: 'משימות שנדרש לסיים:',
        dateColumnId: 'date_end',
        dateColumnTitle: 'תאריך סיום',
        buttonId: 'b_done0001',
        buttonIds: ['b_done0001'],
        includeStatusLabelIds: [1],
      },
      {
        type: 'text',
        id: 'x_bye00001',
        text: 'תודה!',
        direction: 'rtl',
        font: 'Arial',
        fontSize: 14,
        align: 'right',
        color: '#323338',
        bold: false,
      },
    ],
  };

  it('returns the authored blocks verbatim — no legacy text is injected', () => {
    const blocks = normalizeDigestBlocks(authored);
    expect(blocks.map((b) => b.type)).toEqual(['cluster', 'text']);
    expect(textOf(blocks)).toEqual(['תודה!']);
  });

  it('ignores the stale `sections` copy: block order is the only order', () => {
    expect(sectionsFromBlocks(normalizeDigestBlocks(authored)).map((s) => s.id)).toEqual([
      's_done0001',
    ]);
  });

  it('treats an empty blocks array as authored (an email with clusters only is legal)', () => {
    expect(normalizeDigestBlocks({ ...LEGACY_DIGEST, blocks: [] })).toEqual([]);
  });

  it('drops a block with an unknown type rather than rendering it', () => {
    const blocks = normalizeDigestBlocks({
      ...authored,
      blocks: [...authored.blocks, { type: 'image', url: 'x' }],
    });
    expect(blocks.map((b) => b.type)).toEqual(['cluster', 'text']);
  });
});

describe('sectionsFromBlocks', () => {
  it('strips the block discriminator so the projection matches the stored section shape', () => {
    const [section] = sectionsFromBlocks(normalizeDigestBlocks(LEGACY_DIGEST));
    expect(section.type).toBeUndefined();
    expect(section).toMatchObject({ id: 's_start001', dateColumnId: 'date_start' });
  });

  it('is empty for a digest with no clusters', () => {
    expect(sectionsFromBlocks([])).toEqual([]);
  });
});

describe('applyTokens', () => {
  it('substitutes the Hebrew name token', () => {
    expect(applyTokens('שלום {{שם}},', { name: 'דנה כהן' })).toBe('שלום דנה כהן,');
  });

  it('substitutes every occurrence, in any block', () => {
    expect(applyTokens('{{שם}} — {{שם}}', { name: 'דנה' })).toBe('דנה — דנה');
  });

  it('accepts the ASCII alias, so a hand-edited export still resolves', () => {
    expect(applyTokens('Hello {{name}}', { name: 'Dana' })).toBe('Hello Dana');
  });

  it('leaves an unknown token alone instead of blanking it', () => {
    expect(applyTokens('{{מחלקה}}', { name: 'דנה' })).toBe('{{מחלקה}}');
  });

  it('substitutes an empty string when the recipient has no name', () => {
    expect(applyTokens('שלום {{שם}}', { name: '' })).toBe('שלום ');
  });

  it('never lets a name introduce a new token round (no re-scan of the result)', () => {
    expect(applyTokens('{{שם}}', { name: '{{שם}}' })).toBe('{{שם}}');
  });

  it('strips CR/LF from the substituted value — subjects are header context', () => {
    expect(applyTokens('נושא {{שם}}', { name: 'דנה\r\nBcc: x@y.z' })).toBe('נושא דנה Bcc: x@y.z');
  });
});
