// Tiny structured logger. Format: `[tag] message | k=v | k=v`. Designed to be
// grep-friendly in `mapps code:logs` and noise-free in production.
//
// Levels (least → most verbose): ERROR, WARN, INFO, DEBUG. Default is INFO.
// Set LOG_LEVEL=DEBUG in env to surface per-API-call traces during a debug
// session; production should stay on INFO so a healthy minute is ~one line
// per webhook.
//
// Conventions enforced by callers:
//   ERROR — flow failed, requires operator attention
//   WARN  — flow recovered (e.g. token refresh failed → marked disconnected)
//   INFO  — one summary line per logical operation (sync, webhook, oauth, …)
//   DEBUG — per-request / per-event traces
//
// Transports (both fire-and-forget, both isolated by try/catch):
//   1. monday code SDK Logger — ensures `mapps code:logs` keeps proper labeling.
//   2. Axiom (long-term store) — only enabled when AXIOM_TOKEN + AXIOM_DATASET
//      are set in env. Local dev with neither configured is console-only.

import { Logger as MondayLogger } from '@mondaycom/apps-sdk';
import { Axiom } from '@axiomhq/js';

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

const APP_NAME = process.env.AXIOM_APP_NAME || 'calendar-sync';
const ENV_NAME = process.env.NODE_ENV || 'production';

// monday Logger expects an app-level tag. Per-call tags become part of the
// formatted message string (preserves the existing `[tag]` prefix in CLI logs).
const mondayLogger = new MondayLogger(APP_NAME);

// Axiom is opt-in. Without both env vars we skip the transport silently —
// the console transport (via mondayLogger) keeps working untouched.
const axiomDataset = process.env.AXIOM_DATASET || null;
const axiomClient = process.env.AXIOM_TOKEN && axiomDataset
  ? new Axiom({
      token: process.env.AXIOM_TOKEN,
      // Never let an Axiom transport error recurse through this logger.
      // Bare console.error so the failure is at least visible in mapps logs.
      onError: (err) => {
        try { console.error(`[axiom-transport] ${err?.message || err}`); } catch { /* */ }
      },
    })
  : null;

function formatMessage(_level, message, tag, context = {}) {
  const parts = [`[${tag}]`, message];
  for (const [key, val] of Object.entries(context)) {
    if (val === undefined || val === null) continue;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    parts.push(`${key}=${str}`);
  }
  return parts.join(' | ');
}

// Best-effort ship to Axiom. The SDK batches in the background; flush() at
// shutdown drains the buffer. We catch synchronously in case construction or
// argument validation throws — async failures land in `onError` above.
function emitToAxiom(level, message, tag, context) {
  if (!axiomClient) return;
  try {
    axiomClient.ingest(axiomDataset, [{
      _time: new Date().toISOString(),
      level,
      app: APP_NAME,
      env: ENV_NAME,
      tag,
      message,
      ...(context || {}),
    }]);
  } catch (err) {
    try { console.error(`[axiom-transport] ${err?.message || err}`); } catch { /* */ }
  }
}

// monday's SDK Logger (Pino under the hood) only emits `info` and `error`
// to stdout — `warn` and `debug` are silently dropped. To keep every log
// line visible in `mapps code:logs`, we route info/error through their
// Logger (proper labeling + CLI integration) and fall back to console.*
// for the levels it drops.
function emitToConsole(level, formatted) {
  try {
    if (level === 'info') {
      mondayLogger.info(formatted);
    } else if (level === 'error') {
      mondayLogger.error(formatted);
    } else if (level === 'warn') {
      // monday Logger drops warn → use console.warn directly to preserve visibility.
      console.warn(formatted);
    } else {
      // debug: same story.
      console.log(formatted);
    }
  } catch {
    try { console[level === 'debug' ? 'log' : level](formatted); } catch { /* */ }
  }
}

function error(message, tag, context = {}) {
  if (currentLogLevel < LOG_LEVELS.ERROR) return;
  emitToConsole('error', formatMessage('ERROR', message, tag, context));
  emitToAxiom('error', message, tag, context);
}

function warn(message, tag, context = {}) {
  if (currentLogLevel < LOG_LEVELS.WARN) return;
  emitToConsole('warn', formatMessage('WARN', message, tag, context));
  emitToAxiom('warn', message, tag, context);
}

function info(message, tag, context = {}) {
  if (currentLogLevel < LOG_LEVELS.INFO) return;
  emitToConsole('info', formatMessage('INFO', message, tag, context));
  emitToAxiom('info', message, tag, context);
}

function debug(message, tag, context = {}) {
  if (currentLogLevel < LOG_LEVELS.DEBUG) return;
  emitToConsole('debug', formatMessage('DEBUG', message, tag, context));
  emitToAxiom('debug', message, tag, context);
}

// Drain any in-flight Axiom batch. Caller (graceful shutdown in index.js)
// should race this against a short timeout — never block process teardown
// if Axiom is unreachable.
export async function flush() {
  if (!axiomClient) return;
  try {
    await axiomClient.flush();
  } catch (err) {
    try { console.error(`[axiom-transport] flush failed: ${err?.message || err}`); } catch { /* */ }
  }
}

// PII masking — keep first letter of local part, hide the rest, keep domain.
// "ilai@twyst.co.il" → "i***@twyst.co.il". Returns '' / null untouched.
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 1) return `${local}***${domain}`;
  return `${local[0]}***${domain}`;
}

// Trim a configId to its short suffix for log readability:
//   "config_c18e4d79-0e88-4ed4-9560-536ec583d349" → "c18e4d79"
export function shortId(id) {
  if (!id || typeof id !== 'string') return id;
  const parts = id.split('_');
  const tail = parts[parts.length - 1] || id;
  return tail.split('-')[0] || tail.slice(0, 8);
}

export default { error, warn, info, debug, flush };
