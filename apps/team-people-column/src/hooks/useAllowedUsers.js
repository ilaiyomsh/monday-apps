import { useState, useEffect, useCallback, useRef } from 'react';

import { fetchAllowedUsers } from '../services/allowedUsersService.js';
import logger from '../utils/logger.js';
import { cacheGet, cacheSet } from '../utils/swrCache.js';

// The resolved allowed-set changes when teams/links change — keep the TTL
// short-ish; the background revalidation corrects a stale paint within one open.
const RESULT_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

const resultCacheKey = (itemId, columnId) => `allowed:${itemId}:${columnId}`;

// The cached result is only valid for the same settings it was resolved with.
const settingsSignature = (settings) => JSON.stringify(settings ?? null);

/**
 * Resolve the allowed-user set for a team-people column instance, reactively.
 *
 * Wraps the q1..q4 chain in `fetchAllowedUsers` and exposes it as a small state
 * machine. The effect is keyed on [context.itemId, context.columnId, settings]
 * so it re-resolves when the item, the column, or the persisted settings change.
 *
 * @param {{ itemId:string, columnId:string }} context - monday SDK context.
 * @param {object|null} settings - migrated v1 settings (see settingsSchema).
 * @param {{ enabled?: boolean }} [opts] - when `enabled` is false the hook does
 *   not fetch and stays `idle` (e.g. while settings are still loading).
 * @returns {{ status:'idle'|'loading'|'ready'|'error', step:'relation'|'linkedPeople'|'teams'|'ready', result: object|null, error: Error|null, retry: () => void }}
 */
export default function useAllowedUsers(context, settings, { enabled = true } = {}) {
  const itemId = context?.itemId;
  const columnId = context?.columnId;

  // Stale-while-revalidate: the dialog iframe is recreated on every cell click,
  // so the 2-4 sequential API round-trips of the chain otherwise gate EVERY
  // open. A cached result (same item+column+settings) paints the picker
  // immediately; the fresh chain below still runs and corrects it.
  const cachedResult = enabled && itemId && columnId
    ? cacheGet(resultCacheKey(itemId, columnId), {
        maxAgeMs: RESULT_CACHE_MAX_AGE_MS,
        signature: settingsSignature(settings),
      })
    : null;

  const [status, setStatus] = useState(cachedResult ? 'ready' : 'idle');
  const [step, setStep] = useState(cachedResult ? 'ready' : 'relation');
  const [result, setResult] = useState(cachedResult);
  const [error, setError] = useState(null);

  // Guards against a superseded run (settings/item change or a retry in flight)
  // clobbering the state of the current one, and against a double log.
  const runIdRef = useRef(0);
  const hadCacheRef = useRef(cachedResult != null);

  const run = useCallback(async () => {
    const myRun = ++runIdRef.current;

    if (!enabled) {
      setStatus('idle');
      setError(null);
      return;
    }

    // With a cached paint, revalidate silently — no loading flash.
    if (!hadCacheRef.current) {
      setStatus('loading');
      setStep('relation');
    }
    setError(null);

    try {
      const res = await fetchAllowedUsers({
        itemId,
        columnId,
        settings,
        // Reflect chain progress into the step-labeled loading state. Guarded by
        // runIdRef so a superseded run can't move the live run's label.
        onStep: (phase) => {
          if (myRun === runIdRef.current && !hadCacheRef.current) setStep(phase);
        },
      });
      if (myRun !== runIdRef.current) return; // superseded — drop the result
      setResult(res);
      setStep('ready');
      setStatus('ready');
      cacheSet(resultCacheKey(itemId, columnId), res, {
        signature: settingsSignature(settings),
      });
    } catch (err) {
      if (myRun !== runIdRef.current) return; // superseded — the live run owns the state
      // Exactly one logged error per failure (never swallowed).
      logger.error('useAllowedUsers', 'Failed to resolve the allowed-user set', err);
      // A failed background revalidation must not blank an already-painted
      // cached picker — keep showing the cached result.
      if (!hadCacheRef.current) {
        setError(err);
        setStatus('error');
      }
    }
  }, [enabled, itemId, columnId, settings]);

  useEffect(() => {
    run();
  }, [run]);

  const retry = useCallback(() => {
    run();
  }, [run]);

  return { status, step, result, error, retry };
}
