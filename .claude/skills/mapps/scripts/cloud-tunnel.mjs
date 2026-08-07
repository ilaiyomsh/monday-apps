// Cloud-session tunnel wrapper for mapps.
//
// Why this exists — two separate sandbox obstacles:
//
//  1. The egress gateway transparently re-terminates TLS on port 443. The ngrok
//     component inside @mondaycom/apps-cli is the Rust ngrok-rs library, which pins
//     its own root CA and ignores NODE_EXTRA_CA_CERTS, so a direct connection dies
//     with "failed to connect session: tls handshake error".
//  2. Trusting the gateway CA (SessionBuilder.caCert) gets past the handshake but
//     then fails with "failed to deserialize rpc response": the gateway is an L7
//     HTTP proxy, and ngrok's session protocol is not HTTP.
//
// The explicit CONNECT proxy at $HTTPS_PROXY, by contrast, passes raw TCP straight
// through to the real ngrok endpoint. So this script starts a small local forwarder
// that CONNECTs through that proxy, and points ngrok at it via serverAddr. A hosts
// entry maps connect.ngrok-agent.com to 127.0.0.1 so SNI and certificate validation
// still see the real hostname and ngrok's pinned CA applies unchanged.
//
// The monday auth token is fetched by the CLI's own tunnel-service module and stays
// inside this process — it is never printed.

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Resolve the installed apps-cli package root rather than hardcoding a path — the
// node prefix differs per machine and per image. Override with MAPPS_CLI_ROOT if the
// CLI is installed somewhere this cannot find.
const resolveCliRoot = () => {
  if (process.env.MAPPS_CLI_ROOT) return process.env.MAPPS_CLI_ROOT;
  const binPath = execFileSync('readlink', ['-f', execFileSync('which', ['mapps']).toString().trim()])
    .toString()
    .trim();
  // .../@mondaycom/apps-cli/bin/run.js -> .../@mondaycom/apps-cli
  return path.resolve(path.dirname(binPath), '..');
};

const CLI = resolveCliRoot();
const MAPPS_CONFIG_DIR = path.join(os.homedir(), '.config', 'mapps');

const NGROK_HOST = 'connect.ngrok-agent.com';
const NGROK_PORT = 443;
const LOCAL_FORWARD_PORT = Number(process.env.TUNNEL_FORWARD_PORT || 8443);

const appId = Number(process.env.TUNNEL_APP_ID);
const port = Number(process.env.TUNNEL_PORT);
if (!Number.isSafeInteger(appId) || !Number.isSafeInteger(port)) {
  console.error('TUNNEL_APP_ID and TUNNEL_PORT must both be set to integers');
  process.exit(2);
}

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (!proxyUrl) {
  console.error('HTTPS_PROXY is not set — nothing to forward through');
  process.exit(2);
}
const proxyHost = new URL(proxyUrl).hostname;
let proxyPort = Number(new URL(proxyUrl).port);

// The agent proxy can restart on a DIFFERENT port mid-session (observed live:
// 45035 -> 33375), which kills every forwarded connection with ECONNREFUSED. A
// long-running process cannot see the updated HTTPS_PROXY, so rediscover the port
// by scanning listening localhost sockets for the proxy's own status endpoint.
const listeningPorts = () => {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // tcp6 may not exist; not fatal
    }
    for (const line of raw.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4 || cols[3] !== '0A') continue; // 0A = LISTEN
      const port = Number.parseInt(cols[1].split(':')[1], 16);
      if (Number.isInteger(port)) ports.add(port);
    }
  }
  return [...ports];
};

const isAgentProxy = port =>
  new Promise(resolve => {
    const req = http.get(
      { host: proxyHost, port, path: '/__agentproxy/status', timeout: 800 },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve(body.includes('caBundlePath')));
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

const rediscoverProxyPort = async () => {
  for (const port of listeningPorts()) {
    if (port === proxyPort) continue;
    if (await isAgentProxy(port)) {
      console.log(`[forwarder] agent proxy moved: ${proxyPort} -> ${port}`);
      proxyPort = port;
      return true;
    }
  }
  console.error('[forwarder] agent proxy not found on any listening port');
  return false;
};

// ---------------------------------------------------------------------------
// Local raw-TCP forwarder: 127.0.0.1:LOCAL_FORWARD_PORT -> CONNECT -> ngrok:443
// ---------------------------------------------------------------------------
const startForwarder = () =>
  new Promise((resolve, reject) => {
    const target = `${NGROK_HOST}:${NGROK_PORT}`;

    let connCount = 0;
    const bridge = (client, allowRediscovery) => {
      const n = ++connCount;
      console.log(`[forwarder] conn#${n} accepted -> CONNECT via 127.0.0.1:${proxyPort}`);
      const upstream = net.connect(proxyPort, proxyHost, () => {
        upstream.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      });

      let header = Buffer.alloc(0);
      let established = false;

      upstream.on('data', chunk => {
        if (established) return; // pipe() owns the stream from here on
        header = Buffer.concat([header, chunk]);
        const end = header.indexOf('\r\n\r\n');
        if (end === -1) return;

        const status = header.subarray(0, end).toString().split('\r\n')[0];
        if (!/^HTTP\/1\.[01] 200/.test(status)) {
          console.error(`[forwarder] proxy refused CONNECT: ${status}`);
          client.destroy();
          upstream.destroy();
          return;
        }

        established = true;
        const leftover = header.subarray(end + 4);
        if (leftover.length > 0) client.write(leftover);
        upstream.pipe(client);
        client.pipe(upstream);
      });

      upstream.on('error', err => {
        // A moved proxy shows up here as ECONNREFUSED. Rediscover once, then retry
        // this same client connection before giving up on it.
        if (err.code === 'ECONNREFUSED' && allowRediscovery && !established) {
          upstream.destroy();
          rediscoverProxyPort().then(found => {
            if (found) return bridge(client, false);
            console.error(`[forwarder] upstream error: ${err.message}`);
            client.destroy();
          });
          return;
        }
        console.error(`[forwarder] upstream error: ${err.message}`);
        client.destroy();
        upstream.destroy();
      });

      client.on('error', err => {
        console.error(`[forwarder] client error: ${err.message}`);
        client.destroy();
        upstream.destroy();
      });
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => {
        // Always tear the pair down. Leaving the client open on a pre-handshake
        // upstream close makes ngrok wait forever on a socket that can never talk.
        client.destroy();
      });
    };

    const server = net.createServer(client => bridge(client, true));

    server.on('error', reject);
    server.listen(LOCAL_FORWARD_PORT, '127.0.0.1', () => {
      console.log(`[forwarder] 127.0.0.1:${LOCAL_FORWARD_PORT} -> ${proxyHost}:${proxyPort} CONNECT ${target}`);
      resolve(server);
    });
  });

await startForwarder();

// The hosts entry that points connect.ngrok-agent.com at the forwarder is not
// durable: the container regenerated /etc/hosts mid-session and wiped it, after
// which ngrok resolved the real address, dialled the forwarder's port there, and
// hung with no error. Re-assert it at startup instead of assuming it survived.
const HOSTS_FILE = '/etc/hosts';
const HOSTS_LINE = `127.0.0.1 ${NGROK_HOST}`;
const ensureHostsEntry = async () => {
  const current = fs.readFileSync(HOSTS_FILE, 'utf8');
  if (current.split('\n').some(l => l.trim() === HOSTS_LINE)) {
    console.log('[wrapper] hosts entry present');
    return;
  }
  fs.appendFileSync(HOSTS_FILE, `${HOSTS_LINE}\n`);
  console.log(`[wrapper] hosts entry re-added: ${HOSTS_LINE}`);
};
await ensureHostsEntry();

// Fail loudly rather than hang: if the name does not resolve to the forwarder,
// ngrok will dial the real ngrok edge on the forwarder's port and block forever.
const { promises: dnsp } = await import('node:dns');
const resolved = await dnsp.lookup(NGROK_HOST, { all: true });
if (!resolved.some(r => r.address === '127.0.0.1')) {
  console.error(
    `[wrapper] ${NGROK_HOST} does not resolve to 127.0.0.1 (got ${resolved
      .map(r => r.address)
      .join(', ')}) — the forwarder would be bypassed; aborting instead of hanging`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// mapps CLI internals: auth token + tunnel domain
// ---------------------------------------------------------------------------
const require = createRequire(`${CLI}/`);
const ngrok = require(`${CLI}/node_modules/@ngrok/ngrok`);
const { generateTunnelingAuthToken } = await import(`file://${CLI}/dist/services/tunnel-service.js`);

// Reproduce the CLI's oclif init hook: load .mappsrc into this process's env so
// api-service can authenticate. The value lands in process.env only.
const { ConfigService } = await import(`file://${CLI}/dist/services/config-service.js`);
const { initCurrentWorkingDirectory } = await import(`file://${CLI}/dist/services/env-service.js`);
initCurrentWorkingDirectory();
ConfigService.loadConfigToProcessEnv(MAPPS_CONFIG_DIR);

const ctx = { appId, tunnelPort: port };
await generateTunnelingAuthToken(ctx);
if (!ctx.authToken || !ctx.tunnelDomain) {
  console.error('token/domain fetch returned nothing');
  process.exit(1);
}
console.log(`[wrapper] auth token acquired (not logged); domain=${ctx.tunnelDomain}`);

// ---------------------------------------------------------------------------
// ngrok session through the forwarder
// ---------------------------------------------------------------------------
const forwardingAddress = `http://localhost:${port}`;
const builder = new ngrok.SessionBuilder()
  .authtoken(String(ctx.authToken))
  .serverAddr(`${NGROK_HOST}:${LOCAL_FORWARD_PORT}`);

const session = await builder.connect();
console.log('[wrapper] session connected');

const tunnel = await session
  .httpEndpoint()
  .domain(String(ctx.tunnelDomain))
  .forwardsTo(forwardingAddress)
  .listen();

console.log(`TUNNEL_URL=${tunnel.url()}`);
console.log(`[wrapper] forwarding -> ${forwardingAddress}`);

await tunnel.forward(forwardingAddress); // hangs open until the process is terminated
