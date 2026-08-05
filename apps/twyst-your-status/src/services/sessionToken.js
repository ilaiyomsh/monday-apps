/**
 * The one default session-token provider the guard services share.
 *
 * @returns {Promise<string|undefined>} monday's short-lived sessionToken JWT
 */
export async function getSessionTokenViaSdk() {
  // Dynamic import keeps this module inert for suites that stub the SDK — the
  // dev-harness alias (VITE_MONDAY_MOCK) resolves here exactly as it does in
  // mondayService.
  const { default: mondaySdk } = await import('monday-sdk-js');
  const response = await mondaySdk().get('sessionToken');
  return response?.data;
}
