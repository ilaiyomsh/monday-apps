// D8 operator summary body — counts and addresses only. Never task content,
// never signatures, never secrets. Pure string formatter.

/**
 * @param {object} p
 * @param {string} p.slot - YYYYMMDD
 * @param {Array<object>} p.tenants - per-tenant run results
 * @returns {string}
 */
export function formatOperatorSummary({ slot, tenants }) {
  if (typeof slot !== 'string' || slot.length === 0) {
    throw new Error('formatOperatorSummary: slot is required');
  }
  const lines = [`deadline-confirm digest run`, `slot: ${slot}`, ''];
  for (const t of tenants ?? []) {
    if (t.skip) {
      lines.push(`account ${t.accountId}: skipped (${t.skip})`);
      continue;
    }
    lines.push(`account ${t.accountId}: sent=${t.sent ?? 0} failed=${t.failed ?? 0}`);
    if ((t.failedAddresses ?? []).length > 0) {
      lines.push(`  failed: ${t.failedAddresses.join(', ')}`);
    }
    const reasons = {};
    for (const s of t.skippedUsers ?? []) {
      reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    }
    const reasonParts = Object.entries(reasons).map(([k, n]) => `${k}=${n}`);
    if (reasonParts.length > 0) {
      lines.push(`  skippedUsers: ${reasonParts.join(' ')}`);
    }
  }
  return lines.join('\n');
}
