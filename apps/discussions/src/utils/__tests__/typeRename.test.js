import { describe, it, expect } from 'vitest';
import {
  validateTypeRename,
  renameTypeTemplates,
  renameTypeInAssignments,
  renameTypeColors,
} from '../typeRename.js';

/*
 * round304 — renaming a discussion type IS renaming its template, and the name is
 * the KEY of every stored shape around it. These are the rules that keep the
 * rename from orphaning a template, a color, an assignment or the export assets.
 */

describe('validateTypeRename', () => {
  it('accepts a free name', () => {
    expect(validateTypeRename({ oldName: 'סבב', newName: 'סבב שבועי', existingNames: ['סבב', 'תכנון'] }))
      .toEqual({ ok: true, unchanged: false, name: 'סבב שבועי', error: null });
  });

  it('trims the typed name', () => {
    const res = validateTypeRename({ oldName: 'סבב', newName: '  סבב חודשי  ', existingNames: ['סבב'] });
    expect(res).toMatchObject({ ok: true, name: 'סבב חודשי' });
  });

  it('reports "unchanged" for the same name (so the caller writes nothing)', () => {
    expect(validateTypeRename({ oldName: 'סבב', newName: 'סבב', existingNames: ['סבב'] }))
      .toMatchObject({ ok: true, unchanged: true, name: 'סבב' });
    // trailing whitespace only is still the same name
    expect(validateTypeRename({ oldName: 'סבב', newName: 'סבב ', existingNames: ['סבב'] }))
      .toMatchObject({ ok: true, unchanged: true });
  });

  it('rejects an empty name', () => {
    const res = validateTypeRename({ oldName: 'סבב', newName: '   ', existingNames: ['סבב'] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ריק/);
  });

  it('rejects a name another type already holds (case-insensitively) — never merge two types', () => {
    const res = validateTypeRename({ oldName: 'סבב', newName: 'תכנון', existingNames: ['סבב', 'תכנון'] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/כבר קיים/);
    expect(validateTypeRename({ oldName: 'round', newName: 'PLAN', existingNames: ['round', 'plan'] }).ok).toBe(false);
  });

  it('allows changing only the CASE of the type\'s own name', () => {
    expect(validateTypeRename({ oldName: 'plan', newName: 'PLAN', existingNames: ['plan'] }))
      .toMatchObject({ ok: true, unchanged: false, name: 'PLAN' });
  });

  it('rejects when there is no source type', () => {
    expect(validateTypeRename({ oldName: '', newName: 'חדש', existingNames: [] }).ok).toBe(false);
    expect(validateTypeRename({}).ok).toBe(false);
  });
});

describe('renameTypeTemplates — re-key the per-type template', () => {
  const list = [
    { id: 'A', discussionType: 'סבב', topics: [{ name: 'נ', points: [] }] },
    { id: 'B', discussionType: 'תכנון', topics: [] },
  ];

  it('moves the template to the new type name', () => {
    const next = renameTypeTemplates(list, 'סבב', 'סבב שבועי');
    expect(next.map((t) => t.discussionType)).toEqual(['סבב שבועי', 'תכנון']);
    expect(next[0].topics).toEqual([{ name: 'נ', points: [] }]);
    expect(next[0].id).toBe('A');
  });

  it('keeps the ONE-template-per-type invariant: the renamed entry replaces a stale squatter', () => {
    const withSquatter = [...list, { id: 'C', discussionType: 'יעד', topics: [] }];
    const next = renameTypeTemplates(withSquatter, 'סבב', 'יעד');
    expect(next.filter((t) => t.discussionType === 'יעד')).toHaveLength(1);
    expect(next.find((t) => t.discussionType === 'יעד').id).toBe('A');
  });

  it('is a no-op when no template holds the old name, or the names match', () => {
    expect(renameTypeTemplates(list, 'לא-קיים', 'חדש').map((t) => t.discussionType)).toEqual(['סבב', 'תכנון']);
    expect(renameTypeTemplates(list, 'סבב', 'סבב')).toEqual(list);
    expect(renameTypeTemplates(null, 'סבב', 'חדש')).toEqual([]);
  });

  it('does not mutate the input list or its entries', () => {
    const snapshot = JSON.stringify(list);
    renameTypeTemplates(list, 'סבב', 'אחר');
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

describe('renameTypeInAssignments — topic/participant templates assigned to the type', () => {
  const list = [
    { id: 'T1', name: 'נושאים', discussionType: 'סבב' },
    { id: 'T2', name: 'ללא', discussionType: null },
    { id: 'T3', name: 'אחר', discussionType: 'תכנון' },
  ];

  it('re-points only the matching assignments and reports the change', () => {
    const { list: next, changed } = renameTypeInAssignments(list, 'סבב', 'סבב שבועי');
    expect(changed).toBe(true);
    expect(next.map((t) => t.discussionType)).toEqual(['סבב שבועי', null, 'תכנון']);
  });

  it('reports changed:false when nothing matches (so no storage write happens)', () => {
    expect(renameTypeInAssignments(list, 'לא-קיים', 'חדש').changed).toBe(false);
    expect(renameTypeInAssignments(list, 'סבב', 'סבב').changed).toBe(false);
    expect(renameTypeInAssignments(undefined, 'סבב', 'חדש')).toEqual({ list: [], changed: false });
  });
});

describe('renameTypeColors — move the type\'s display color', () => {
  it('moves the color to the new key and drops the old one', () => {
    expect(renameTypeColors({ 'סבב': 'done-green', 'תכנון': 'purple' }, 'סבב', 'סבב שבועי'))
      .toEqual({ 'סבב שבועי': 'done-green', 'תכנון': 'purple' });
  });

  it('leaves the map alone when the type has no stored color', () => {
    expect(renameTypeColors({ 'תכנון': 'purple' }, 'סבב', 'חדש')).toEqual({ 'תכנון': 'purple' });
  });

  it('tolerates a missing map and a same-name rename', () => {
    expect(renameTypeColors(null, 'סבב', 'חדש')).toEqual({});
    expect(renameTypeColors({ 'סבב': 'purple' }, 'סבב', 'סבב')).toEqual({ 'סבב': 'purple' });
  });
});
