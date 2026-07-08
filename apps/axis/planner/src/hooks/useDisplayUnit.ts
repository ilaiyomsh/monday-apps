import { useCallback, useEffect, useRef, useState } from 'react';
import mondaySdk from 'monday-sdk-js';
import { logger } from '../utils/Logger';

const monday = mondaySdk();
const STORAGE_KEY = 'planner-display-unit';
const SAVE_DEBOUNCE_MS = 200;

export type DisplayUnit = 'hours' | 'percent';

const parseStored = (raw: string | undefined | null): DisplayUnit => {
  if (raw === 'percent') return 'percent';
  return 'hours';
};

export interface UseDisplayUnitResult {
  unit: DisplayUnit;
  setUnit: (unit: DisplayUnit) => void;
  toggleUnit: () => void;
}

export const useDisplayUnit = (): UseDisplayUnitResult => {
  const [unit, setUnitState] = useState<DisplayUnit>('hours');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef<DisplayUnit>('hours');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await (monday.storage.instance as any).getItem(STORAGE_KEY);
        if (cancelled) return;
        const next = parseStored(res?.data?.value);
        currentRef.current = next;
        setUnitState(next);
      } catch (err) {
        logger.warn('[useDisplayUnit] load failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persist = useCallback((next: DisplayUnit) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await (monday.storage.instance as any).setItem(STORAGE_KEY, next);
      } catch (err) {
        logger.warn('[useDisplayUnit] save failed:', err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const setUnit = useCallback((next: DisplayUnit) => {
    currentRef.current = next;
    setUnitState(next);
    persist(next);
  }, [persist]);

  const toggleUnit = useCallback(() => {
    setUnit(currentRef.current === 'hours' ? 'percent' : 'hours');
  }, [setUnit]);

  return { unit, setUnit, toggleUnit };
};
