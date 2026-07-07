// Spawn/stop the local app + mock-google subprocesses for Tier 2 tests.
// Neither helper writes to monday; both are concerned only with process
// lifecycle and readiness waits.

import { spawn } from 'child_process';
import path from 'path';
import { waitForHealth, waitForPort } from './http.js';

function forwardStreams(proc, label) {
  const pipe = (src) => src.on('data', (d) => {
    if (process.env.VERBOSE) process.stdout.write(`[${label}] ${d}`);
  });
  pipe(proc.stdout);
  proc.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
}

export async function startMockGoogle({ port = 9999 } = {}) {
  const proc = spawn('node', ['tests/mock-google/server.js'], {
    env: { ...process.env, MOCK_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwardStreams(proc, `mock:${port}`);
  const ready = await waitForHealth(`http://localhost:${port}/admin/health`, 5000);
  if (!ready) {
    proc.kill();
    throw new Error(`mock-google on :${port} did not become healthy`);
  }
  return { proc, baseUrl: `http://localhost:${port}`, port };
}

export async function startLocalApp({
  port = 8081,
  mockPort = 9999,
  storageFile,
  envOverrides = {},
} = {}) {
  const { loadTestConfig } = await import('./config.js');
  const cfg = loadTestConfig();
  const storage = storageFile || path.resolve(`.dev/local-${port}.json`);

  const proc = spawn('node', ['./src/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      LOCAL_SERVER_URL: `http://localhost:${port}`,
      APP_BASE_URL: `http://localhost:${port}`,
      GOOGLE_API_BASE_URL: `http://localhost:${mockPort}`,
      USE_LOCAL_STORAGE: 'true',
      LOCAL_STORAGE_FILE: storage,
      MONDAY_SIGNING_SECRET: cfg.signingSecret,
      MONDAY_APP_ID: String(cfg.appId),
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwardStreams(proc, `app:${port}`);
  // App has no /health; use a tcp connect to confirm the port is listening.
  const ready = await waitForPort(port, 'localhost', 8000);
  if (!ready) {
    proc.kill();
    throw new Error(`local app on :${port} did not come up`);
  }
  return { proc, baseUrl: `http://localhost:${port}`, port, storageFile: storage };
}

// Stop a child process and wait for it to actually exit (so the OS releases
// its port). Falls back to SIGKILL after 2 seconds. Returns a promise.
export function stopProcess(ref) {
  const proc = ref?.proc || ref;
  if (!proc || proc.killed || proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(killTimer);
      resolve();
    };
    proc.once('exit', onExit);
    proc.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
    }, 2000);
  });
}
