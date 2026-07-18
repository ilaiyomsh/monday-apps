/**
 * Coarse latency buckets (D5) so repeated api_latency health signals dedup at the transport
 * instead of shipping a distinct message per call. Shared by the admin services.
 */
export function latencyBucket(ms: number): 'fast' | 'ok' | 'slow' | 'very_slow' {
  if (ms < 200) return 'fast';
  if (ms < 1000) return 'ok';
  if (ms < 3000) return 'slow';
  return 'very_slow';
}
