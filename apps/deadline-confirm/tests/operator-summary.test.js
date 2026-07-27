// Contract tests for the D8 operator summary body — counts and addresses
// only; never task content, never signatures, never secrets.

import { describe, it, expect } from 'vitest';
import { formatOperatorSummary } from '../src/helpers/operator-summary.js';

describe('formatOperatorSummary (D8)', () => {
  it('reports slot, per-tenant message counts, failures with addresses, and skipped users', () => {
    const text = formatOperatorSummary({
      slot: '20260727',
      tenants: [
        {
          accountId: '111',
          sent: 2,
          failed: 1,
          failedAddresses: ['bad@example.com'],
          skippedUsers: [{ reason: 'multi_person' }, { reason: 'no_email' }],
        },
        {
          accountId: '222',
          skip: 'digest_not_configured',
        },
      ],
    });
    expect(text).toContain('slot: 20260727');
    expect(text).toContain('account 111: sent=2 failed=1');
    expect(text).toContain('failed: bad@example.com');
    expect(text).toContain('skippedUsers: multi_person=1 no_email=1');
    expect(text).toContain('account 222: skipped (digest_not_configured)');
    expect(text).not.toContain('sig=');
    expect(text).not.toContain('/confirm');
    expect(text).not.toContain('itemId');
  });

  it('counts messages (D16a), not distinct addresses — two same-email results both count as sent', () => {
    const text = formatOperatorSummary({
      slot: '20260727',
      tenants: [
        {
          accountId: '111',
          sent: 2,
          failed: 0,
          failedAddresses: [],
          skippedUsers: [],
        },
      ],
    });
    expect(text).toContain('sent=2');
  });

  it('throws when slot is missing', () => {
    expect(() => formatOperatorSummary({ slot: '', tenants: [] })).toThrow(/slot/);
  });
});
