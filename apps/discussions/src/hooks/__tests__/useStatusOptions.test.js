import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSettingsStr } from '../useStatusOptions';
import logger from '../../utils/logger.js';

// parseSettingsStr is the legacy status-column settings_str parser. This suite locks its
// mapping and, per error-guard, that a MALFORMED settings_str is LOGGED (not silently
// swallowed) while still degrading to an empty option list.

afterEach(() => vi.restoreAllMocks());

describe('parseSettingsStr — happy path mapping', () => {
  it('maps labels/colors/positions into sorted option objects', () => {
    const str = JSON.stringify({
      labels: { 1: 'Done', 2: 'Working' },
      labels_colors: { 1: { color: 'green' }, 2: { color: 'orange' } },
      labels_positions_v2: { 1: 5, 2: 0 },
    });
    const out = parseSettingsStr(str);
    // sorted by index: pos 0 (Working) before pos 5 (Done)
    expect(out.map((o) => o.label)).toEqual(['Working', 'Done']);
    expect(out[0]).toEqual({ id: 2, index: 0, label: 'Working', color: 'orange', isDone: false });
    expect(out[1].color).toBe('green');
  });

  it('drops empty/blank labels', () => {
    const str = JSON.stringify({ labels: { 1: 'Keep', 2: '   ', 3: '' } });
    expect(parseSettingsStr(str).map((o) => o.label)).toEqual(['Keep']);
  });
});

describe('parseSettingsStr — malformed settings_str is logged, not swallowed', () => {
  it('returns [] AND logs a WARN tagged useStatusOptions on invalid JSON', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const out = parseSettingsStr('{not valid json');
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('useStatusOptions');
  });

  it('does not log for a valid (empty) settings_str', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(parseSettingsStr('{}')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
