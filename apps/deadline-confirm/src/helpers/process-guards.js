// process-guards.js — the LAST-resort catch mechanisms for the server entry, plus
// the two boot-time guards (version read, dependency init). Extracted from index.js
// so every branch is unit-testable without booting a real server (index.js stays
// pure wiring: env read + DI + listen).
//
// Policy (error-guard references/server-patterns.md): an uncaughtException, or a
// listen-time server error (e.g. EADDRINUSE), means the process is in an unknown
// state — log once (so it SHIPS to Axiom before the process dies), race the remote
// flush against a hard 2s ceiling so a hung sink can never wedge a dying process,
// then EXIT non-zero (the platform restarts the container). Never limp on.
//
// The functions take `flush`/`exit`/`setTimeoutFn` as injectable seams so the
// exit path is observable in tests and never actually kills the test runner.

const EXIT_DELAY_MS = 2000; // hard ceiling on flush time — never hang a dying process

/**
 * Race the remote-sink flush against a hard timeout, then exit exactly once.
 *
 * Returns a promise that settles once the exit call has been made (or the ceiling
 * elapsed). In production `exit` is `process.exit`, which never returns — so the
 * promise never settles and the process dies with the flush already done. Callers
 * that must not continue running (safeBootInit) await it; the fire-and-forget
 * handlers ignore it. It never rejects.
 * @param {number} code - process exit code
 * @param {{ flush?: () => Promise<unknown>, exit?: (code:number)=>void,
 *           timeoutMs?: number, setTimeoutFn?: typeof setTimeout }} [opts]
 * @returns {Promise<void>}
 */
export function flushAndExit(code, opts = {}) {
  const {
    flush,
    exit = process.exit,
    timeoutMs = EXIT_DELAY_MS,
    setTimeoutFn = setTimeout,
  } = opts;
  let done = false;
  return new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      try {
        exit(code);
      } catch (exitError) {
        // Never an empty catch, and never a rejection: an exit hook that throws must
        // still leave a trace and must not wedge a caller awaiting this promise.
        try {
          console.error('[boot] exit handler threw:', exitError?.message ?? exitError);
        } catch {
          // breadcrumb best-effort
        }
      }
      resolve();
    };
    // Belt and suspenders: exit even if flush hangs past the ceiling.
    const timer = setTimeoutFn(finish, timeoutMs);
    timer?.unref?.();
    // `.then(finish, finish)` IS the "a flush failure must not block the exit path" rule:
    // both settlement paths land on finish. An earlier `.catch(() => {})` here made the
    // onRejected handler dead code (the rejection was already absorbed), so a regression
    // that dropped it was undetectable. One handler pair, both paths live, mutation-visible.
    Promise.resolve()
      .then(() => (typeof flush === 'function' ? flush() : undefined))
      .then(finish, finish);
  });
}

/**
 * Build the process 'uncaughtException' handler: log (ships) → flush-race → exit(1).
 * @param {{ logError: Function }} logger
 * @param {object} [opts] - forwarded to flushAndExit (flush/exit/timeoutMs/setTimeoutFn)
 * @returns {(err: unknown) => void}
 */
export function makeCrashHandler(logger, opts = {}) {
  return (err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    try {
      logger.logError('server', 'uncaught exception', { error: e });
    } catch {
      // logging must never block the exit path
    }
    void flushAndExit(1, opts); // fire-and-forget: never rejects, and the process is going down
  };
}

/**
 * Build the http.Server 'error' handler (listen-time failures like EADDRINUSE):
 * log (ships) → flush-race → exit(1). Without this listener Node rethrows the
 * 'error' event as an uncaught exception and only Node's default stderr dump
 * survives — it never reaches Axiom.
 * @param {{ logError: Function }} logger
 * @param {object} [opts]
 * @returns {(err: unknown) => void}
 */
export function makeServerErrorHandler(logger, opts = {}) {
  return (err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    try {
      logger.logError('server', 'server listen error', { error: e, code: e.code });
    } catch {
      // logging must never block the exit path
    }
    void flushAndExit(1, opts); // fire-and-forget: never rejects, and the process is going down
  };
}

/**
 * Read a version string from a package.json URL/path, never throwing. On any
 * read/parse failure it records a console breadcrumb (the logger's remote sink
 * may not be attached this early) and returns the fallback.
 * @param {{ readFileSync: Function, url: string|URL, fallback?: string, onError?: (e:unknown)=>void }} opts
 * @returns {string}
 */
export function readPackageVersion({ readFileSync, url, fallback = '0.0.0', onError } = {}) {
  try {
    const version = JSON.parse(readFileSync(url, 'utf8')).version;
    return typeof version === 'string' && version.length > 0 ? version : fallback;
  } catch (err) {
    if (typeof onError === 'function') {
      onError(err);
    } else {
      // Never an empty catch: a corrupt/unreadable package.json must leave a trace.
      console.error('[boot] could not read package.json version:', err?.message ?? err);
    }
    return fallback;
  }
}

/**
 * Run a boot-time initializer that must succeed for the server to be viable
 * (e.g. `new SecureStorage()`). On throw: ship an ERROR, leave a console
 * breadcrumb, AWAIT the flush-and-exit, then re-throw so no further wiring runs
 * with a half-built dependency.
 *
 * ASYNC ON PURPOSE (audit finding 3). This guard runs before installProcessGuards,
 * so a synchronous re-throw here is an uncaught top-level exception: Node dumps to
 * stderr and exits immediately, and a flush merely *scheduled* beforehand never
 * runs — losing exactly the boot failure this guard exists to capture. Awaiting
 * flushAndExit means the ERROR has reached Axiom before anything can kill us. In
 * production `process.exit` fires inside that await and the re-throw is never
 * reached; under an injected `exit` seam (tests) it is, preserving the contract.
 *
 * Callers must `await` it — `const backend = await safeBootInit(...)` at ESM
 * top level keeps the "no half-built wiring" guarantee, since a rejected
 * top-level await aborts module evaluation.
 * @param {() => T} fn
 * @param {string} label - short description for the log message
 * @param {{ logError: Function }} logger
 * @param {object} [opts] - forwarded to flushAndExit
 * @returns {Promise<T>}
 * @template T
 */
export async function safeBootInit(fn, label, logger, opts = {}) {
  try {
    return fn();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    try {
      logger.logError('server', `boot failed: ${label}`, { error: e });
    } catch {
      // fall through to the breadcrumb + exit
    }
    try {
      console.error(`[boot] ${label} failed — cannot start:`, e.message);
    } catch {
      // breadcrumb best-effort
    }
    await flushAndExit(1, opts); // never rejects; in prod it never resolves either
    throw e;
  }
}

/**
 * Convenience installer used by index.js: registers the uncaughtException net.
 * (unhandledRejection + SIGTERM/SIGINT remain wired inline in index.js.)
 * @param {{ logError: Function }} logger
 * @param {{ flush?: () => Promise<unknown> }} [opts]
 */
export function installProcessGuards(logger, opts = {}) {
  process.on('uncaughtException', makeCrashHandler(logger, opts));
}
