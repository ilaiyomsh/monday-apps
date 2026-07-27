const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const currentLevel = LEVELS[String(process.env.LOG_LEVEL ?? '').toUpperCase()] ?? LEVELS.INFO;
const sinks = new Set();
let beforeSend = (record) => record;
let sequence = 0;

function format(record) {
  const context = record.context ?? {};
  const fields = Object.entries(context)
    .filter(([key, value]) => key !== 'error' && value != null)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  if (record.error) fields.push(`err=${record.error.name}: ${record.error.message}`);
  if (record.correlationId) fields.push(`corr=${record.correlationId}`);
  return [`[${record.tag}]`, record.message, ...fields].join(' | ');
}

function render(record) {
  if (!record.consoleEnabled) return;
  const line = format(record);
  if (record.level === 'ERROR') console.error(line);
  else if (record.level === 'WARN') console.warn(line);
  else console.log(line);
  if (record.level === 'ERROR' && record.error?.stack) console.error(record.error.stack);
}

function emit(record) {
  const timestamp = Date.now();
  record.timestamp = timestamp;
  record.timestampISO = new Date(timestamp).toISOString();
  if (record.context?.error instanceof Error) record.error = record.context.error;
  if (record.error) {
    if (record.error.__loggedId) {
      record.duplicate = true;
      record.correlationId = record.error.correlationId ?? record.error.__loggedId;
    } else {
      const id = record.error.correlationId ?? `log_${process.pid}_${++sequence}`;
      try {
        Object.defineProperty(record.error, '__loggedId', { value: id, configurable: true });
        if (!record.error.correlationId) {
          Object.defineProperty(record.error, 'correlationId', { value: id, configurable: true });
        }
      } catch { /* frozen errors are still logged */ }
      record.duplicate = false;
      record.correlationId = id;
    }
  }
  let outgoing = record;
  try {
    outgoing = beforeSend(record);
  } catch (error) {
    console.error('[logger] beforeSend failed', error);
  }
  if (!outgoing) return;
  render(outgoing);
  if (outgoing.duplicate) return;
  for (const sink of sinks) {
    try {
      sink(outgoing);
    } catch (error) {
      console.error('[logger] sink failed', error);
    }
  }
}

const makeLevel = (level) => (message, tag = 'app', context) => {
  const consoleEnabled = currentLevel >= LEVELS[level];
  if (!consoleEnabled && LEVELS[level] > LEVELS.WARN) return;
  emit({ level, message: String(message), tag: String(tag), context, consoleEnabled });
};

const logger = {
  error: makeLevel('ERROR'),
  warn: makeLevel('WARN'),
  info: makeLevel('INFO'),
  debug: makeLevel('DEBUG'),
  request(req) {
    logger.debug('request_received', 'http', { method: req.method, path: req.path });
  },
  response(req, status, durationMs) {
    const write = status >= 500 ? logger.error : status >= 400 ? logger.warn : logger.debug;
    write('request_completed', 'http', { method: req.method, path: req.path, status, durationMs });
  },
  addSink(fn) {
    if (typeof fn !== 'function') return () => {};
    sinks.add(fn);
    return () => sinks.delete(fn);
  },
  removeSink(fn) { sinks.delete(fn); },
  setBeforeSend(fn) { beforeSend = typeof fn === 'function' ? fn : (record) => record; },
  emit,
};

export default logger;
