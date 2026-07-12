import { useState, useEffect, useCallback, useRef } from 'react';

import { fetchAllowedUsers } from '../services/allowedUsersService.js';
import logger from '../utils/logger.js';

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
  const [status, setStatus] = useState('idle');
  const [step, setStep] = useState('relation');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const itemId = context?.itemId;
  const columnId = context?.columnId;

  // Guards against a superseded run (settings/item change or a retry in flight)
  // clobbering the state of the current one, and against a double log.
  const runIdRef = useRef(0);

  const run = useCallback(async () => {
    const myRun = ++runIdRef.current;

    if (!enabled) {
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('loading');
    setStep('relation');
    setError(null);

    try {
      const res = await fetchAllowedUsers({
        itemId,
        columnId,
        settings,
        // Reflect chain progress into the step-labeled loading state. Guarded by
        // runIdRef so a superseded run can't move the live run's label.
        onStep: (phase) => {
          if (myRun === runIdRef.current) setStep(phase);
        },
      });
      if (myRun !== runIdRef.current) return; // superseded — drop the result
      setResult(res);
      setStep('ready');
      setStatus('ready');
    } catch (err) {
      if (myRun !== runIdRef.current) return; // superseded — the live run owns the state
      // Exactly one logged error per failure (never swallowed).
      logger.error('useAllowedUsers', 'Failed to resolve the allowed-user set', err);
      setError(err);
      setStatus('error');
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
