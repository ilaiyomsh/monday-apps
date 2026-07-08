import type { MondaySdk } from './types';
import type { Logger } from './logger';

/**
 * Rate-limited API queue (from Planner): mutations run sequentially with a small
 * gap; reads run with bounded concurrency. Retries transient/complexity errors
 * with exponential backoff. Create one per app with its monday SDK + logger.
 */
const MUTATION_DELAY_MS = 200;
const MAX_READ_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isMutation = (q: string) => /\bmutation\b/.test(q);

interface QueueItem {
  query: string;
  variables?: Record<string, unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  retries: number;
}

export function createApiQueue(monday: MondaySdk, logger: Logger) {
  const mutationQueue: QueueItem[] = [];
  const readQueue: QueueItem[] = [];
  let mutationRunning = false;
  let activeReads = 0;

  const isRetryable = (err: unknown, res?: { errors?: unknown[] }): boolean => {
    if (err instanceof TypeError) return true;
    const msg = (err as Error)?.message ?? '';
    if (/network|fetch|timeout|failed to fetch|load failed|internal server error/i.test(msg)) return true;
    const errs = JSON.stringify(res?.errors ?? '');
    return /COMPLEXITY_BUDGET_EXHAUSTED|INTERNAL_SERVER_ERROR/.test(errs);
  };

  async function exec(item: QueueItem): Promise<void> {
    try {
      const res = await monday.api(item.query, { variables: item.variables });
      if (res.errors?.length && isRetryable(undefined, res) && item.retries < MAX_RETRIES) {
        await delay(INITIAL_BACKOFF_MS * 2 ** item.retries);
        item.retries++;
        return exec(item);
      }
      item.resolve(res);
    } catch (err) {
      if (isRetryable(err) && item.retries < MAX_RETRIES) {
        logger.warn('apiQueue', `retry ${item.retries + 1}`, err);
        await delay(INITIAL_BACKOFF_MS * 2 ** item.retries);
        item.retries++;
        return exec(item);
      }
      item.reject(err);
    }
  }

  async function pumpMutations() {
    if (mutationRunning) return;
    mutationRunning = true;
    while (mutationQueue.length) {
      const item = mutationQueue.shift()!;
      await exec(item);
      if (mutationQueue.length) await delay(MUTATION_DELAY_MS);
    }
    mutationRunning = false;
  }

  function pumpReads() {
    while (readQueue.length && activeReads < MAX_READ_CONCURRENCY) {
      const item = readQueue.shift()!;
      activeReads++;
      void exec(item).finally(() => { activeReads--; pumpReads(); });
    }
  }

  return {
    execute(query: string, variables?: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const item: QueueItem = { query, variables, resolve, reject, retries: 0 };
        if (isMutation(query)) { mutationQueue.push(item); void pumpMutations(); }
        else { readQueue.push(item); pumpReads(); }
      });
    },
  };
}
