// Retrofit characterization tests (test-guard) for the settings-parsing
// logic. The realistic input comes from the probe-captured fixture
// (tests/fixtures/board-columns-settings.probe.json) — never hand-built.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseStatusLabels, openOauthTab } from './monday';
import settingsFixture from '../../../../tests/fixtures/board-columns-settings.probe.json';

vi.mock('monday-sdk-js', () => ({
  default: () => ({ get: vi.fn(async () => ({ data: 'tok+abc/1=' })) }),
}));

const fixtureStatusSettings = settingsFixture.data.boards[0].columns.find(
  (c: { type: string }) => c.type === 'status'
)!.settings;

describe('parseStatusLabels', () => {
  it('parses the probe-captured settings into id/label/index tuples', () => {
    expect(parseStatusLabels(fixtureStatusSettings)).toStrictEqual([
      { id: 0, label: 'בעבודה', index: 0, isDeactivated: false },
      { id: 1, label: 'בוצע', index: 1, isDeactivated: false },
    ]);
  });

  it('sorts by display index, not array order', () => {
    const shuffled = {
      labels: [
        { id: 7, label: 'ג', index: 2 },
        { id: 0, label: 'א', index: 0 },
        { id: 3, label: 'ב', index: 1 },
      ],
    };
    expect(parseStatusLabels(shuffled).map((l) => l.id)).toStrictEqual([0, 3, 7]);
  });

  it('filters out deactivated labels', () => {
    const withDead = {
      labels: [
        { id: 0, label: 'חי', index: 0, is_deactivated: false },
        { id: 1, label: 'מת', index: 1, is_deactivated: true },
      ],
    };
    expect(parseStatusLabels(withDead)).toStrictEqual([
      { id: 0, label: 'חי', index: 0, isDeactivated: false },
    ]);
  });

  it('drops entries whose id is not a number', () => {
    const malformed = {
      labels: [
        { id: 0, label: 'תקין', index: 0 },
        { id: 'x', label: 'שבור', index: 1 },
        null,
      ],
    };
    expect(parseStatusLabels(malformed).map((l) => l.label)).toStrictEqual(['תקין']);
  });

  it.each([null, undefined, {}, { labels: 'not-array' }, 'junk'])(
    'returns [] for unusable settings: %j',
    (settings) => {
      expect(parseStatusLabels(settings)).toStrictEqual([]);
    }
  );
});

describe('openOauthTab (v3 — account context via sessionToken)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens /oauth/start?st=<URL-ENCODED sessionToken> in a new noopener tab', async () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    await openOauthTab();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/oauth/start?st=tok%2Babc%2F1%3D', '_blank', 'noopener');
  });

  it('opens NO tab and logs to console.error when the sessionToken is unavailable', async () => {
    vi.resetModules();
    vi.doMock('monday-sdk-js', () => ({
      default: () => ({ get: vi.fn(async () => ({ data: undefined })) }),
    }));
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = await import('./monday');
    await fresh.openOauthTab();
    expect(open).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
