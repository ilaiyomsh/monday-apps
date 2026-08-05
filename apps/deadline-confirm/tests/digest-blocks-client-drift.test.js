// The client mirror of the block model must stay behaviorally identical to the
// server's — same pattern as packages/error-kit's drift test, and for the same
// reason: `src/client/admin/digest-blocks.ts` is a COPY (see its header for why
// it is not an import), so nothing but a test stops the two from drifting.
//
// What drift would actually cost:
//   * a font/limit the admin offers and the server rejects → the operator gets an
//     opaque 400 invalid_config on save;
//   * a token the admin substitutes in the preview but the server does not (or
//     vice versa) → the preview stops describing the mail that is sent;
//   * a different legacy reconstruction → importing a pre-0.14.0 settings export
//     silently produces a different email from the one that config was sending.

import { describe, it, expect } from 'vitest';
import * as server from '../src/services/digest-blocks.js';
import * as client from '../src/client/admin/digest-blocks.ts';
import { DIGEST_FONTS as CLIENT_FONTS } from '../src/client/admin/types.ts';

describe('digest block model — client/server drift', () => {
  it('agrees on the dynamic field', () => {
    expect(client.NAME_TOKEN).toBe(server.NAME_TOKEN);
  });

  it('agrees on the font allowlist, in the same order', () => {
    expect([...CLIENT_FONTS]).toEqual([...server.DIGEST_FONTS]);
    expect(client.DEFAULT_FONT).toBe(server.DEFAULT_FONT);
  });

  it('agrees on every limit the editor pre-enforces', () => {
    expect(client.FONT_SIZE_MIN).toBe(server.FONT_SIZE_MIN);
    expect(client.FONT_SIZE_MAX).toBe(server.FONT_SIZE_MAX);
    expect(client.MAX_DIGEST_BLOCKS).toBe(server.MAX_BLOCKS);
    expect(client.MAX_DIGEST_CLUSTERS).toBe(server.MAX_CLUSTER_BLOCKS);
    expect(client.MAX_DIGEST_TEXT_LENGTH).toBe(server.MAX_TEXT_LENGTH);
  });

  it('agrees on the legacy texts, character for character', () => {
    expect(client.LEGACY_TEXTS).toEqual({ ...server.LEGACY_TEXTS });
  });

  it.each([
    ['שלום {{שם}},', 'דנה כהן'],
    ['{{name}} — {{שם}}', 'Dana'],
    ['{{ שם }} עם רווחים', 'דנה'],
    ['בלי טוקן', 'דנה'],
    ['{{מחלקה}}', 'דנה'],
    ['{{שם}}', '{{שם}}'],
    ['נושא {{שם}}', 'דנה\r\nBcc: x@y.z'],
    ['{{שם}}', ''],
  ])('substitutes %j the same way', (text, name) => {
    expect(client.applyTokens(text, { name })).toBe(server.applyTokens(text, { name }));
  });

  it.each([
    ['no clusters', []],
    [
      'one cluster, no note column',
      [
        {
          id: 's_a0000001',
          title: 'לסיים:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          noteColumnId: null,
          noteColumnTitle: '',
          buttonId: 'b_done0001',
          buttonIds: ['b_done0001'],
          includeStatusLabelIds: [1],
        },
      ],
    ],
    [
      'a cluster mapping a note column (the conditional hint)',
      [
        {
          id: 's_a0000001',
          title: 'לסיים:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          noteColumnId: 'text_note',
          noteColumnTitle: 'הערה',
          buttonId: 'b_done0001',
          buttonIds: ['b_done0001'],
          includeStatusLabelIds: [1],
        },
      ],
    ],
  ])('reconstructs a legacy config identically — %s', (_label, sections) => {
    expect(client.legacyBlocksFromSections(sections)).toEqual(
      server.legacyBlocksFromSections(sections)
    );
  });
});
