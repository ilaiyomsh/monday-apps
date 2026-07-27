// Tests for src/services/manifest-signature.js — the V6 signed-manifest pure
// module (spec §3 "Signature spec"). Written against the stub's JSDoc contract
// and the product spec ONLY; no implementation was consulted.
//
//   slot     = date (YYYYMMDD) of the scheduled send, Asia/Jerusalem
//   manifest = "<itemId>:<btnId>[,<btnId>…][;<itemId>:…]"  canonical
//   payload  = accountId | personId | slot | manifest
//   sig      = base64url( HMAC-SHA256(link_secret, payload) )

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildManifest,
  parseManifest,
  signManifest,
  verifyManifest,
  currentSlot,
  MAX_MANIFEST_ITEMS,
  MANIFEST_TIMEZONE,
} from '../src/services/manifest-signature.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SECRET = 'test-link-secret-a';
const OTHER_SECRET = 'test-link-secret-b';
const ACCOUNT = '123456';
const PERSON = '987654';
const SLOT = '20260727';
const NEXT_SLOT = '20260728';

const ITEM_ID_20 = '12345678901234567890'; // exactly 20 digits — max valid
const ITEM_ID_21 = '123456789012345678901'; // 21 digits — over the edge
const BTN_ID_64 = 'a'.repeat(64); // exactly 64 chars — max valid
const BTN_ID_65 = 'a'.repeat(65); // 65 chars — over the edge

/** Canonical manifest of n items "1:b;2:b;…;n:b" (ascending numeric). */
function manifestOfNItems(n) {
  return Array.from({ length: n }, (_, i) => `${i + 1}:b`).join(';');
}

/** Pairs for n distinct item ids 1..n, each with button "b". */
function pairsOfNItems(n) {
  return Array.from({ length: n }, (_, i) => ({ itemId: String(i + 1), btnId: 'b' }));
}

/** Rebuild a manifest string from parseManifest entries via buildManifest. */
function rebuildFromEntries(entries) {
  const pairs = [];
  for (const [itemId, btnSet] of entries) {
    for (const btnId of btnSet) pairs.push({ itemId, btnId });
  }
  return buildManifest(pairs);
}

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

describe('module constants', () => {
  it('exports MAX_MANIFEST_ITEMS === 50', () => {
    expect(MAX_MANIFEST_ITEMS).toBe(50);
  });

  it("exports MANIFEST_TIMEZONE === 'Asia/Jerusalem'", () => {
    expect(MANIFEST_TIMEZONE).toBe('Asia/Jerusalem');
  });
});

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

/**
 * Assert fn throws a REAL validation error. The stub's blanket
 * `NOT_IMPLEMENTED` throw does not count — this keeps every throw-test red
 * until actual validation exists (test-guard: a test never seen failing
 * does not count).
 */
function expectValidationThrow(fn) {
  let thrown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown.message).not.toBe('NOT_IMPLEMENTED');
}

describe('buildManifest', () => {
  it("returns '5:b_a' for a single pair", () => {
    expect(buildManifest([{ itemId: '5', btnId: 'b_a' }])).toBe('5:b_a');
  });

  it('sorts items ascending NUMERICALLY — 99 comes before 100', () => {
    const pairs = [
      { itemId: '100', btnId: 'b_a' },
      { itemId: '99', btnId: 'b_a' },
    ];
    expect(buildManifest(pairs)).toBe('99:b_a;100:b_a');
  });

  it('sorts equal-length item ids ascending — 12 comes before 13', () => {
    const pairs = [
      { itemId: '13', btnId: 'b_a' },
      { itemId: '12', btnId: 'b_a' },
    ];
    expect(buildManifest(pairs)).toBe('12:b_a;13:b_a');
  });

  it('sorts buttons within an item ascending lexicographically (byte order)', () => {
    const pairs = [
      { itemId: '5', btnId: 'b_b' },
      { itemId: '5', btnId: 'b_a' },
    ];
    expect(buildManifest(pairs)).toBe('5:b_a,b_b');
  });

  it('sorts uppercase button ids before lowercase (byte order, not locale)', () => {
    const pairs = [
      { itemId: '7', btnId: 'x-1' },
      { itemId: '7', btnId: 'X_0' },
    ];
    // 'X' (0x58) < 'x' (0x78) in byte order
    expect(buildManifest(pairs)).toBe('7:X_0,x-1');
  });

  it('produces the exact canonical string for a nontrivial multi-item, multi-button set', () => {
    const pairs = [
      { itemId: '100', btnId: 'zz' },
      { itemId: '99', btnId: 'b_b' },
      { itemId: '99', btnId: 'b_a' },
      { itemId: '7', btnId: 'done' },
      { itemId: '7', btnId: 'ack' },
    ];
    expect(buildManifest(pairs)).toBe('7:ack,done;99:b_a,b_b;100:zz');
  });

  it('collapses duplicate (itemId, btnId) pairs silently', () => {
    const pairs = [
      { itemId: '5', btnId: 'b_a' },
      { itemId: '5', btnId: 'b_a' },
      { itemId: '5', btnId: 'b_a' },
    ];
    expect(buildManifest(pairs)).toBe('5:b_a');
  });

  it('throws for an empty array', () => {
    expectValidationThrow(() => buildManifest([]));
  });

  it('throws for a non-digit itemId', () => {
    expectValidationThrow(() => buildManifest([{ itemId: '5a', btnId: 'b_a' }]));
  });

  it('throws for an empty itemId', () => {
    expectValidationThrow(() => buildManifest([{ itemId: '', btnId: 'b_a' }]));
  });

  it('accepts an itemId of exactly 20 digits', () => {
    expect(buildManifest([{ itemId: ITEM_ID_20, btnId: 'b_a' }])).toBe(`${ITEM_ID_20}:b_a`);
  });

  it('throws for an itemId of 21 digits', () => {
    expectValidationThrow(() => buildManifest([{ itemId: ITEM_ID_21, btnId: 'b_a' }]));
  });

  it('throws for a btnId containing a disallowed character (space)', () => {
    expectValidationThrow(() => buildManifest([{ itemId: '5', btnId: 'b a' }]));
  });

  it('throws for a btnId containing a disallowed character (dot)', () => {
    expectValidationThrow(() => buildManifest([{ itemId: '5', btnId: 'b.a' }]));
  });

  it('throws for an empty btnId', () => {
    expectValidationThrow(() => buildManifest([{ itemId: '5', btnId: '' }]));
  });

  it('accepts a btnId of exactly 64 characters', () => {
    expect(buildManifest([{ itemId: '5', btnId: BTN_ID_64 }])).toBe(`5:${BTN_ID_64}`);
  });

  it('throws for a btnId of 65 characters', () => {
    expectValidationThrow(() => buildManifest([{ itemId: '5', btnId: BTN_ID_65 }]));
  });

  it('accepts exactly 50 distinct item ids', () => {
    expect(buildManifest(pairsOfNItems(50))).toBe(manifestOfNItems(50));
  });

  it('throws for 51 distinct item ids', () => {
    expectValidationThrow(() => buildManifest(pairsOfNItems(51)));
  });

  it('accepts 51 pairs when duplicates collapse them to 50 distinct item ids', () => {
    const pairs = [...pairsOfNItems(50), { itemId: '50', btnId: 'b' }]; // 51 pairs, 50 items
    expect(buildManifest(pairs)).toBe(manifestOfNItems(50));
  });
});

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

describe('parseManifest — acceptance', () => {
  it('returns ok:true with a Map of item id → Set of button ids for a canonical manifest', () => {
    const result = parseManifest('7:ack,done;99:b_a');
    expect(result.ok).toBe(true);
    expect(result.entries).toBeInstanceOf(Map);
    expect([...result.entries.keys()]).toEqual(['7', '99']);
    expect(result.entries.get('7')).toBeInstanceOf(Set);
    expect([...result.entries.get('7')]).toEqual(['ack', 'done']);
    expect([...result.entries.get('99')]).toEqual(['b_a']);
  });

  it("accepts '99:b_a;100:b_a' (ascending numeric item order)", () => {
    expect(parseManifest('99:b_a;100:b_a').ok).toBe(true);
  });

  it("accepts '12:b_a;13:b_a' (ascending equal-length item order)", () => {
    expect(parseManifest('12:b_a;13:b_a').ok).toBe(true);
  });

  it("accepts '5:b_a,b_b' (ascending button order)", () => {
    expect(parseManifest('5:b_a,b_b').ok).toBe(true);
  });

  it('accepts an itemId of exactly 20 digits', () => {
    expect(parseManifest(`${ITEM_ID_20}:b_a`).ok).toBe(true);
  });

  it('accepts a btnId of exactly 64 characters', () => {
    expect(parseManifest(`5:${BTN_ID_64}`).ok).toBe(true);
  });

  it('accepts a manifest of exactly 50 items', () => {
    expect(parseManifest(manifestOfNItems(50)).ok).toBe(true);
  });
});

describe('parseManifest — rejection', () => {
  const rejects = (input) => {
    const result = parseManifest(input);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  };

  it('rejects non-string input (number) with a non-empty reason', () => {
    rejects(42);
  });

  it('rejects non-string input (null) with a non-empty reason', () => {
    rejects(null);
  });

  it('rejects non-string input (undefined) with a non-empty reason', () => {
    rejects(undefined);
  });

  it('rejects non-string input (array) with a non-empty reason', () => {
    rejects(['5:b_a']);
  });

  it('rejects the empty string', () => {
    rejects('');
  });

  it('rejects a manifest containing a space after the colon', () => {
    rejects('5: b_a');
  });

  it('rejects a manifest containing a space after the item separator', () => {
    rejects('5:b_a; 6:b_b');
  });

  it('rejects a leading item separator', () => {
    rejects(';5:b_a');
  });

  it('rejects a trailing item separator', () => {
    rejects('5:b_a;');
  });

  it('rejects a trailing button separator', () => {
    rejects('5:b_a,');
  });

  it('rejects a leading button separator', () => {
    rejects('5:,b_a');
  });

  it('rejects an item entry with no buttons', () => {
    rejects('5:');
  });

  it('rejects an item entry with no item id', () => {
    rejects(':b_a');
  });

  it('rejects an item entry with no colon', () => {
    rejects('5;6:b_a');
  });

  it("rejects '100:b_a;99:b_a' (descending numeric item order)", () => {
    rejects('100:b_a;99:b_a');
  });

  it("rejects '13:b_a;12:b_a' (descending equal-length item order)", () => {
    rejects('13:b_a;12:b_a');
  });

  it("rejects '5:b_b,b_a' (descending button order)", () => {
    rejects('5:b_b,b_a');
  });

  it('rejects duplicate item ids', () => {
    rejects('5:b_a;5:b_b');
  });

  it('rejects duplicate buttons within an item', () => {
    rejects('5:b_a,b_a');
  });

  it('rejects a non-digit itemId', () => {
    rejects('5a:b_a');
  });

  it('rejects an itemId of 21 digits', () => {
    rejects(`${ITEM_ID_21}:b_a`);
  });

  it('rejects a btnId with a disallowed character', () => {
    rejects('5:b.a');
  });

  it('rejects a btnId of 65 characters', () => {
    rejects(`5:${BTN_ID_65}`);
  });

  it('rejects a manifest of 51 items', () => {
    rejects(manifestOfNItems(51));
  });
});

describe('parseManifest ↔ buildManifest round-trip', () => {
  it('rebuilding a parsed nontrivial canonical manifest reproduces it byte-for-byte', () => {
    const manifest = '7:ack,done;99:b_a,b_b,b_c;100:zz;20000000001:b_a,b_z';
    const result = parseManifest(manifest);
    expect(result.ok).toBe(true);
    expect(rebuildFromEntries(result.entries)).toBe(manifest);
  });

  it('parseManifest(buildManifest(pairs)) is ok for an unsorted, duplicated pair set', () => {
    const pairs = [
      { itemId: '100', btnId: 'b_b' },
      { itemId: '100', btnId: 'b_a' },
      { itemId: '99', btnId: 'done' },
      { itemId: '99', btnId: 'done' }, // duplicate — collapses
      { itemId: '3', btnId: 'x' },
    ];
    const built = buildManifest(pairs);
    const parsed = parseManifest(built);
    expect(parsed.ok).toBe(true);
    expect(rebuildFromEntries(parsed.entries)).toBe(built);
  });

  it('rebuilding a 50-item boundary manifest reproduces it byte-for-byte', () => {
    const manifest = manifestOfNItems(50);
    const result = parseManifest(manifest);
    expect(result.ok).toBe(true);
    expect(rebuildFromEntries(result.entries)).toBe(manifest);
  });
});

// ---------------------------------------------------------------------------
// signManifest
// ---------------------------------------------------------------------------

describe('signManifest', () => {
  const MANIFEST = '5:b_a;6:b_b';

  it('equals an independently computed base64url HMAC-SHA256 of accountId|personId|slot|manifest', () => {
    const payload = `${ACCOUNT}|${PERSON}|${SLOT}|${MANIFEST}`;
    const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
    const actual = signManifest({
      secret: SECRET,
      accountId: ACCOUNT,
      personId: PERSON,
      slot: SLOT,
      manifest: MANIFEST,
    });
    expect(actual).toBe(expected);
  });

  it('is deterministic — two calls with identical inputs return the same signature', () => {
    const p = { secret: SECRET, accountId: ACCOUNT, personId: PERSON, slot: SLOT, manifest: MANIFEST };
    expect(signManifest(p)).toBe(signManifest(p));
  });

  it('returns unpadded base64url (only A-Za-z0-9_- characters, no =, +, /)', () => {
    const sig = signManifest({
      secret: SECRET,
      accountId: ACCOUNT,
      personId: PERSON,
      slot: SLOT,
      manifest: MANIFEST,
    });
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different signatures for two DIFFERENT secrets over the same payload (rotation kills outstanding signatures)', () => {
    const base = { accountId: ACCOUNT, personId: PERSON, slot: SLOT, manifest: MANIFEST };
    const sigA = signManifest({ ...base, secret: SECRET });
    const sigB = signManifest({ ...base, secret: OTHER_SECRET });
    expect(sigA).not.toBe(sigB);
  });

  it('produces different signatures for two different manifests under the same key, ids, and slot', () => {
    const base = { secret: SECRET, accountId: ACCOUNT, personId: PERSON, slot: SLOT };
    const sigA = signManifest({ ...base, manifest: '5:b_a' });
    const sigB = signManifest({ ...base, manifest: '5:b_b' });
    expect(sigA).not.toBe(sigB);
  });
});

// ---------------------------------------------------------------------------
// verifyManifest
// ---------------------------------------------------------------------------

describe('verifyManifest', () => {
  const MANIFEST = '5:b_a;6:b_b';
  const base = { secret: SECRET, accountId: ACCOUNT, personId: PERSON, slot: SLOT, manifest: MANIFEST };
  const validSig = () => signManifest(base);

  it('returns true for the exact inputs a signature was issued for', () => {
    expect(verifyManifest({ ...base, signature: validSig() })).toBe(true);
  });

  it('returns false when verifying a PREVIOUS-slot signature against the current slot (no grace window)', () => {
    const sigForSlotX = signManifest({ ...base, slot: SLOT });
    expect(verifyManifest({ ...base, slot: NEXT_SLOT, signature: sigForSlotX })).toBe(false);
  });

  it('returns false for a tampered manifest with an item APPENDED', () => {
    const sig = validSig();
    expect(verifyManifest({ ...base, manifest: '5:b_a;6:b_b;7:b_a', signature: sig })).toBe(false);
  });

  it('returns false for a tampered manifest with a button APPENDED to an existing item', () => {
    const sig = validSig();
    expect(verifyManifest({ ...base, manifest: '5:b_a,b_z;6:b_b', signature: sig })).toBe(false);
  });

  it('returns false for a tampered manifest with items REORDERED (same content, different string)', () => {
    const sig = validSig();
    expect(verifyManifest({ ...base, manifest: '6:b_b;5:b_a', signature: sig })).toBe(false);
  });

  it('returns false for a tampered personId', () => {
    const sig = validSig();
    expect(verifyManifest({ ...base, personId: '111111', signature: sig })).toBe(false);
  });

  it('returns false for a tampered accountId', () => {
    const sig = validSig();
    expect(verifyManifest({ ...base, accountId: '999999', signature: sig })).toBe(false);
  });

  it('returns false when the signature was made with a different secret', () => {
    const sig = signManifest({ ...base, secret: OTHER_SECRET });
    expect(verifyManifest({ ...base, signature: sig })).toBe(false);
  });

  it('returns false for a signature with one character altered', () => {
    const sig = validSig();
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(verifyManifest({ ...base, signature: flipped })).toBe(false);
  });

  it('returns false for a signature of the wrong length', () => {
    expect(verifyManifest({ ...base, signature: 'abc' })).toBe(false);
  });

  it('returns false (without throwing) when signature is missing', () => {
    expect(verifyManifest({ ...base })).toBe(false);
  });

  it('returns false (without throwing) when secret is missing', () => {
    const { secret: _secret, ...rest } = base;
    expect(verifyManifest({ ...rest, signature: validSig() })).toBe(false);
  });

  it('returns false (without throwing) when manifest is the empty string', () => {
    expect(verifyManifest({ ...base, manifest: '', signature: validSig() })).toBe(false);
  });

  it('returns false (without throwing) when secret is the empty string', () => {
    expect(verifyManifest({ ...base, secret: '', signature: validSig() })).toBe(false);
  });

  it('returns false (without throwing) when slot is not a string', () => {
    expect(verifyManifest({ ...base, slot: 20260727, signature: validSig() })).toBe(false);
  });

  it('returns false (without throwing) when signature is not a string', () => {
    expect(verifyManifest({ ...base, signature: 12345 })).toBe(false);
  });

  it('returns false (without throwing) when personId is null', () => {
    expect(verifyManifest({ ...base, personId: null, signature: validSig() })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// currentSlot
// ---------------------------------------------------------------------------

describe('currentSlot', () => {
  it("returns yesterday '20260727' when Jerusalem time 07:30 is before sendHour 8 (summer, UTC+3)", () => {
    // 2026-07-28T04:30:00Z = 07:30 Asia/Jerusalem (IDT)
    expect(currentSlot({ sendHour: 8, now: new Date('2026-07-28T04:30:00Z') })).toBe('20260727');
  });

  it("returns today '20260728' when Jerusalem time is exactly the sendHour (08:00, summer)", () => {
    // 2026-07-28T05:00:00Z = 08:00 Asia/Jerusalem (IDT)
    expect(currentSlot({ sendHour: 8, now: new Date('2026-07-28T05:00:00Z') })).toBe('20260728');
  });

  it("returns '20260727' when UTC is still July 27 but Jerusalem is already July 28, 01:30 (midnight crossing)", () => {
    // 2026-07-27T22:30:00Z = 2026-07-28 01:30 Asia/Jerusalem — before sendHour 8
    // → yesterday IN JERUSALEM, i.e. 2026-07-27
    expect(currentSlot({ sendHour: 8, now: new Date('2026-07-27T22:30:00Z') })).toBe('20260727');
  });

  it("returns yesterday '20260114' when Jerusalem time 07:30 is before sendHour 8 (winter, UTC+2)", () => {
    // 2026-01-15T05:30:00Z = 07:30 Asia/Jerusalem (IST)
    expect(currentSlot({ sendHour: 8, now: new Date('2026-01-15T05:30:00Z') })).toBe('20260114');
  });

  it("returns today '20260115' when Jerusalem time is exactly 08:00 (winter, UTC+2)", () => {
    // 2026-01-15T06:00:00Z = 08:00 Asia/Jerusalem (IST)
    expect(currentSlot({ sendHour: 8, now: new Date('2026-01-15T06:00:00Z') })).toBe('20260115');
  });

  it("returns today's Jerusalem date for sendHour 0 even just after local midnight", () => {
    // 2026-07-27T22:30:00Z = 2026-07-28 01:30 Asia/Jerusalem — 01:30 >= 00 → today
    expect(currentSlot({ sendHour: 0, now: new Date('2026-07-27T22:30:00Z') })).toBe('20260728');
  });

  it("returns today's Jerusalem date for sendHour 0 at midday", () => {
    // 2026-07-28T10:00:00Z = 13:00 Asia/Jerusalem
    expect(currentSlot({ sendHour: 0, now: new Date('2026-07-28T10:00:00Z') })).toBe('20260728');
  });

  it('honors an explicit timeZone — UTC at 07:59 with sendHour 8 gives yesterday', () => {
    expect(
      currentSlot({ sendHour: 8, now: new Date('2026-03-10T07:59:59Z'), timeZone: 'UTC' })
    ).toBe('20260309');
  });

  it('honors an explicit timeZone — UTC at 08:00 with sendHour 8 gives today', () => {
    expect(
      currentSlot({ sendHour: 8, now: new Date('2026-03-10T08:00:00Z'), timeZone: 'UTC' })
    ).toBe('20260310');
  });
});
