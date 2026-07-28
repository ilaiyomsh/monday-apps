import { describe, it, expect } from 'vitest';
import { APP_COMPONENTS, isComponentVisible, DEFAULT_PREFERENCES } from '../boards.config.js';

// round205 — owner-selectable app components: default-ON semantics (only an
// EXPLICIT stored false hides), and the catalog the preferences tab renders.
describe('isComponentVisible', () => {
  it('is visible by default — unset prefs, empty map, unknown key', () => {
    expect(isComponentVisible(undefined, 'tasks')).toBe(true);
    expect(isComponentVisible({}, 'tasks')).toBe(true);
    expect(isComponentVisible({ visibleComponents: {} }, 'tasks')).toBe(true);
    expect(isComponentVisible(DEFAULT_PREFERENCES, 'dashboard')).toBe(true);
  });

  it('hides ONLY on an explicit false; explicit true stays visible', () => {
    const prefs = { visibleComponents: { tasks: false, decisions: true } };
    expect(isComponentVisible(prefs, 'tasks')).toBe(false);
    expect(isComponentVisible(prefs, 'decisions')).toBe(true);
    expect(isComponentVisible(prefs, 'summary')).toBe(true); // untouched
  });
});

describe('APP_COMPONENTS catalog', () => {
  it('carries the 12 owner-selectable surfaces with Hebrew labels', () => {
    const keys = APP_COMPONENTS.map((c) => c.key);
    expect(keys).toEqual([
      'previous', 'background', 'references', 'summary', 'topics', 'tasks',
      'decisions', 'effectiveness', 'personalArea', 'myTasks', 'myDecisions', 'dashboard',
    ]);
    expect(APP_COMPONENTS.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
  });
});
