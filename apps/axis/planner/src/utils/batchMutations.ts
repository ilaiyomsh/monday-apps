import { logger } from './Logger';

const BATCH_DELAY_MS = 100;

export interface BatchResult<T> {
  results: Array<T | undefined>;
  failedCount: number;
}

/**
 * Executes an array of async operations sequentially with a delay between each.
 * Continues on individual failures (logs errors but doesn't stop).
 * Returns structured result with results array and failure count.
 */
export async function batchMutations<T>(
  operations: Array<() => Promise<T>>
): Promise<BatchResult<T>> {
  const results: Array<T | undefined> = [];
  let failedCount = 0;

  for (let i = 0; i < operations.length; i++) {
    try {
      results.push(await operations[i]());
    } catch (err) {
      logger.error(`[batchMutations] Operation ${i + 1}/${operations.length} failed:`, err);
      results.push(undefined);
      failedCount++;
    }

    if (i < operations.length - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return { results, failedCount };
}
