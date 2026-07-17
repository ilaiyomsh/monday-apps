import mondaySdk from 'monday-sdk-js';
import { logger } from '../utils/Logger';

const monday = mondaySdk();

const MUTATION_DELAY_MS = 200;
const MAX_READ_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

interface QueueItem {
  query: string;
  options?: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  retries: number;
}

let mutationQueue: QueueItem[] = [];
let isMutationProcessing = false;
let activeReads = 0;
const readQueue: QueueItem[] = [];

function isMutation(query: string): boolean {
  return query.trimStart().startsWith('mutation');
}

function extractRetrySeconds(error: any): number | null {
  // Monday.com returns retry_in_seconds in the error extensions
  if (error?.extensions?.retry_in_seconds) {
    return error.extensions.retry_in_seconds;
  }
  // Check in error message for hints
  const msg = typeof error === 'string' ? error : error?.message || '';
  const match = msg.match(/retry.+?(\d+)\s*second/i);
  return match ? parseInt(match[1]) : null;
}

function isComplexityExhausted(response: any): boolean {
  if (!response?.errors) return false;
  return response.errors.some((e: any) =>
    e.message?.includes('COMPLEXITY_BUDGET_EXHAUSTED') ||
    e.extensions?.code === 'COMPLEXITY_BUDGET_EXHAUSTED' ||
    e.message?.includes('complexity budget')
  );
}

// Transient server-side failures from monday's GraphQL API — 5xx responses or
// the channel-level rephrasing of them ("Internal Server Error"). Worth retrying
// because the request is well-formed and a fresh round-trip often succeeds.
function isTransientServerError(response: any): boolean {
  if (!response?.errors) return false;
  return response.errors.some((e: any) => {
    const status = e.extensions?.status_code;
    if (typeof status === 'number' && status >= 500 && status < 600) return true;
    if (e.extensions?.error_code === 'INTERNAL_SERVER_ERROR') return true;
    if (e.extensions?.code === 'INTERNAL_SERVER_ERROR') return true;
    if (typeof e.message === 'string' && /internal server error/i.test(e.message)) return true;
    return false;
  });
}

// Thrown errors that indicate a network/transport problem rather than a
// request validity problem. The SDK throws plain Errors with these shapes
// when fetch fails, the channel times out, etc.
function isThrownNetworkError(err: any): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true; // fetch failures surface as TypeError
  const msg = err instanceof Error ? err.message : String(err);
  return /network|fetch|timeout|failed to fetch|load failed/i.test(msg);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Coarse latency buckets (D5) so repeated api_latency health signals dedup at the transport
// instead of shipping a distinct message per call (this is a hot path). Measured over the whole
// retry sequence, so retried calls land in the slower buckets.
function latencyBucket(ms: number): string {
  if (ms < 200) return 'fast';
  if (ms < 1000) return 'ok';
  if (ms < 3000) return 'slow';
  return 'very_slow';
}

// API-latency health (D5): wraps the retry funnel so exactly ONE bucketed health signal is
// emitted per top-level API call, on the terminal outcome only (retries are folded into the
// measured round-trip, never emitted individually). Inert until the Axiom sink is active.
async function runWithTelemetry(item: QueueItem): Promise<any> {
  const t0 = Date.now();
  try {
    const result = await executeWithRetry(item);
    logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: true });
    return result;
  } catch (err) {
    logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: false });
    throw err;
  }
}

async function executeWithRetry(item: QueueItem): Promise<any> {
  let response: any;
  try {
    response = await monday.api(item.query, item.options) as any;
  } catch (err) {
    // Transport-level failure (fetch error, channel timeout). Treat like a
    // transient server error so the same retry/backoff applies.
    if (isThrownNetworkError(err) && item.retries < MAX_RETRIES) {
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, item.retries);
      logger.warn(`[apiQueue] Transport error, retrying in ${backoffMs}ms (attempt ${item.retries + 1}/${MAX_RETRIES}): ${err instanceof Error ? err.message : String(err)}`);
      await delay(backoffMs);
      item.retries++;
      return executeWithRetry(item);
    }
    if (isThrownNetworkError(err)) {
      logger.error('[apiQueue] Max retries reached for transport error');
      throw new Error(`TRANSIENT_SERVER_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  }

  if (isComplexityExhausted(response)) {
    if (item.retries >= MAX_RETRIES) {
      logger.error('[apiQueue] Max retries reached for complexity budget exhaustion');
      throw new Error('COMPLEXITY_BUDGET_EXHAUSTED: max retries reached');
    }

    const retrySeconds = extractRetrySeconds(response.errors?.[0]);
    const backoffMs = retrySeconds
      ? retrySeconds * 1000
      : INITIAL_BACKOFF_MS * Math.pow(2, item.retries);

    logger.warn(`[apiQueue] Complexity budget exhausted, retrying in ${backoffMs}ms (attempt ${item.retries + 1}/${MAX_RETRIES})`);
    await delay(backoffMs);
    item.retries++;
    return executeWithRetry(item);
  }

  if (isTransientServerError(response)) {
    // Log the full error payload — monday's SDK wraps real validation
    // errors as INTERNAL_SERVER_ERROR, and retrying them just hides the
    // bug. Surfacing extensions + message lets us spot validation in logs.
    logger.error('[apiQueue] Server error from monday, full payload:', {
      errors: response.errors,
      query: item.query.slice(0, 500),
    });
    if (item.retries >= MAX_RETRIES) {
      logger.error('[apiQueue] Max retries reached for transient server error');
      const firstMsg = response.errors?.[0]?.message ?? 'Internal Server Error';
      throw new Error(`TRANSIENT_SERVER_ERROR: ${firstMsg}`);
    }
    const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, item.retries);
    logger.warn(`[apiQueue] Transient server error, retrying in ${backoffMs}ms (attempt ${item.retries + 1}/${MAX_RETRIES})`);
    await delay(backoffMs);
    item.retries++;
    return executeWithRetry(item);
  }

  return response;
}

async function processMutationQueue() {
  if (isMutationProcessing) return;
  isMutationProcessing = true;

  while (mutationQueue.length > 0) {
    const item = mutationQueue.shift()!;
    try {
      const result = await runWithTelemetry(item);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }
    if (mutationQueue.length > 0) {
      await delay(MUTATION_DELAY_MS);
    }
  }

  isMutationProcessing = false;
}

function processReadQueue() {
  while (readQueue.length > 0 && activeReads < MAX_READ_CONCURRENCY) {
    const item = readQueue.shift()!;
    activeReads++;
    runWithTelemetry(item)
      .then(result => {
        item.resolve(result);
      })
      .catch(err => {
        item.reject(err);
      })
      .finally(() => {
        activeReads--;
        processReadQueue();
      });
  }
}

export const apiQueue = {
  execute(query: string, options?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const item: QueueItem = { query, options, resolve, reject, retries: 0 };

      if (isMutation(query)) {
        mutationQueue.push(item);
        processMutationQueue();
      } else {
        readQueue.push(item);
        processReadQueue();
      }
    });
  },
};
