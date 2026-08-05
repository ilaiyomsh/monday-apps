/**
 * sdk-log-filter — silence the @mondaycom/apps-sdk 0.1.4 per-read chatter.
 *
 * SecureStorage.get and Storage.get each `console.log` a two-line INFO record on
 * EVERY read (`[SecureStorage] Got data for key…\nkey: <key>`), with
 * `mondayInternal: false` so there is NO env/option to turn it off (verified in
 * the SDK source, dist/esm/{secure-storage,storage}). A single settings-screen
 * load does 5–8 reads, so this noise (15–40 lines) buries the guard's own log
 * lines in `mapps code:logs` — and it leaks SecureStorage KEYS (account/user ids).
 *
 * This wraps `console.log` once at boot and drops ONLY those specific SDK read
 * records. Everything else — the guard's own JSON lines (tags guard/oauth/boot/…),
 * SDK warn/error (which go through console.error), and any non-JSON log — passes
 * through untouched. Errors and warnings are never suppressed.
 */

/**
 * Is this a single-string SDK "Got data for key" read record? The SDK emits its
 * record as ONE `JSON.stringify(...)` line, so its stable markers are matched as
 * substrings — deliberately NOT via `JSON.parse`, whose failure on a non-JSON
 * line would be a swallowed catch (error-guard); this is classification, not
 * error handling. The guard's own lines carry different tags (guard/oauth/boot/…)
 * and never the "Got data for key" phrase, so they are never matched.
 * @param {unknown} arg
 * @returns {boolean}
 */
export function isSdkReadNoise(arg) {
  if (typeof arg !== 'string') return false;
  if (!arg.includes('Got data for key')) return false;
  const fromStorageSdk =
    arg.includes('"tag":"SecureStorage"') || arg.includes('"tag":"Storage"');
  return fromStorageSdk && arg.includes('"mondayInternal":false');
}

/**
 * Install the filter on a console-like object (defaults to the global console).
 * Only `console.log` is wrapped — `console.error`/`console.warn` are untouched,
 * so SDK errors and the guard's own error/warn lines always survive.
 * @param {{ log: Function }} [consoleObj]
 * @returns {() => void} restore the original console.log
 */
export function installSdkLogFilter(consoleObj = console) {
  const original = consoleObj.log;
  consoleObj.log = (...args) => {
    if (args.length === 1 && isSdkReadNoise(args[0])) return;
    // Preserve `this` (real console.log needs it) while keeping `original` the
    // exact reference restore() puts back.
    return original.apply(consoleObj, args);
  };
  return () => {
    consoleObj.log = original;
  };
}
