import { describe, it, expect } from 'vitest';
import {
  BOARD_KEYS,
  BOARD_CLASS_TO_KEY,
  COLUMN_SCHEMA,
  ALIAS_MIGRATIONS,
  buildEmptyConfig,
} from '../boards.config.js';

/*
 * Schema-presence characterization for the "החלטות" (decisions) feature:
 * the 4th board key, its column aliases/types, the two-way discussion
 * relation, and the per-POINT (subitem) link columns on the topics schema.
 * The decisions board is mapped MANUALLY in Settings (not wizard-created) —
 * the schema is still the single source of truth for aliases/types.
 */

describe('decisions board schema', () => {
  it('decisions is a registered board key and the החלטות1Board SDK class maps to it', () => {
    expect(BOARD_KEYS).toContain('decisions');
    expect(BOARD_CLASS_TO_KEY['החלטות1Board']).toBe('decisions');
  });

  it('COLUMN_SCHEMA.decisions carries exactly the decision aliases with the right types', () => {
    expect(COLUMN_SCHEMA.decisions).toEqual({
      decisionCreatorID: { type: 'people', title: 'יוצר החלטה' },
      deciderID: { type: 'people', title: 'מחליט' },
      affectedID: { type: 'people', title: 'מושפעים' },
      decisionStatusID: { type: 'status', title: 'סטאטוס החלטה' },
      decisionPriorityID: { type: 'status', title: 'עדיפות' },
      decisionDateID: { type: 'date', title: 'תאריך' },
      discussionLinkID: { type: 'board_relation', title: 'דיון' },
    });
  });

  it('the discussions board carries the two-way pair relation (decisionsBoardLinkID)', () => {
    expect(COLUMN_SCHEMA.discussions.decisionsBoardLinkID).toEqual({
      type: 'board_relation',
      title: 'לוח החלטות',
    });
  });

  it('the topics schema carries the per-POINT (subitem) decision/task link columns', () => {
    expect(COLUMN_SCHEMA.topics.pointDecisionsLinkID).toEqual({
      type: 'board_relation',
      title: 'החלטות (נקודה)',
      subitems: true,
    });
    expect(COLUMN_SCHEMA.topics.pointTasksLinkID).toEqual({
      type: 'board_relation',
      title: 'משימות (נקודה)',
      subitems: true,
    });
  });

  it('decisions has an (empty) ALIAS_MIGRATIONS entry — new board, nothing to migrate', () => {
    expect(ALIAS_MIGRATIONS.decisions).toEqual({});
  });

  it('buildEmptyConfig seeds a blank decisions board + all its columns unverified', () => {
    const { boards, columns } = buildEmptyConfig();
    expect(boards.decisions).toEqual({ id: '' });
    expect(Object.keys(columns.decisions).sort()).toEqual(Object.keys(COLUMN_SCHEMA.decisions).sort());
    for (const col of Object.values(columns.decisions)) {
      expect(col.id).toBe('');
      expect(col.verified).toBe(false);
    }
  });
});
