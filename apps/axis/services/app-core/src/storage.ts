/**
 * Storage helpers. Axis convention (#8, confirmed): GLOBAL `monday.storage`
 * namespaced by a per-instance key — NOT `monday.storage.instance`. Isolation is
 * by the key, derived from instanceId = context.instanceId || boardId || 'default'.
 */
import type { MondaySdk, MondaySdkContext, StorageResult } from './types';

export const ATTEMPT_TIMEOUT_MS = 5000;

export function resolveInstanceId(context: MondaySdkContext | null | undefined): string {
  return String(context?.instanceId ?? context?.boardId ?? 'default');
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timeout`)), ms),
  );
  return Promise.race([promise, timeout]);
}

/** Throws if the SDK returned success:false. */
export function assertStorageOk(result: StorageResult, operation: string, key: string): void {
  if (result?.data?.success === false) {
    const err = new Error(`Storage ${operation} failed for "${key}": ${result.data.error ?? 'unknown'}`);
    (err as { details?: unknown }).details = result.data;
    throw err;
  }
}

export function createGlobalStorage(monday: MondaySdk) {
  return {
    get: (key: string) =>
      withTimeout(monday.storage.getItem(key), ATTEMPT_TIMEOUT_MS, 'storage.getItem'),
    set: (key: string, value: string) =>
      withTimeout(monday.storage.setItem(key, value), ATTEMPT_TIMEOUT_MS, 'storage.setItem'),
  };
}
