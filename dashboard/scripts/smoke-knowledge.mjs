import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let baseUrl = process.env.AGENTMA_SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const envFile = process.env.AGENTMA_SMOKE_ENV || path.resolve(process.cwd(), '../spike-sdk/.env');

function readEnvFile(file) {
  const values = {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[match[1]] = value;
    }
  } catch {}
  return values;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function requireOk(label, request) {
  const result = await request;
  if (!result.response.ok) {
    throw new Error(`${label} failed ${result.response.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('failed to allocate a local port'));
      });
    });
  });
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(`${url}/api/health`);
      if (health.response.ok) return;
      lastError = `HTTP ${health.response.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await delay(250);
  }
  throw new Error(`server health failed: ${lastError || 'timeout'}`);
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function waitForPortClosed(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await canConnect(port)) return true;
    await delay(100);
  }
  return !await canConnect(port);
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return true;
  let done = false;
  await Promise.race([
    new Promise((resolve) => child.once('exit', () => {
      done = true;
      resolve();
    })),
    delay(timeoutMs),
  ]);
  return done || childExited(child);
}

function signalManagedServer(managed, signal) {
  if (!managed.child.pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-managed.child.pid, signal);
      return;
    } catch {}
  }
  if (!childExited(managed.child)) managed.child.kill(signal);
}

async function startManagedServer(allowRoot) {
  const port = Number(process.env.AGENTMA_SMOKE_PORT || await getFreePort());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-smoke-data-'));
  const child = spawn('npm', ['run', 'server'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      AGENTMA_DATA_DIR: dataDir,
      AGENTMA_SKIP_RECOVER: '1',
      AGENTMA_KNOWLEDGE_ROOT_ALLOWLIST: allowRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  return { child, dataDir, port };
}

async function stopManagedServer(managed) {
  if (!managed) return;
  if (!childExited(managed.child)) {
    signalManagedServer(managed, 'SIGINT');
    await waitForChildExit(managed.child, 2500);
  }
  let closed = await waitForPortClosed(managed.port, 1500);
  if (!closed) {
    signalManagedServer(managed, 'SIGKILL');
    await waitForChildExit(managed.child, 1500);
    closed = await waitForPortClosed(managed.port, 5000);
  }
  if (!closed) {
    throw new Error(`managed server port ${managed.port} still accepts connections after stop`);
  }
  fs.rmSync(managed.dataDir, { recursive: true, force: true });
}

function requestTools() {
  return [
    { name: 'Read', description: 'Read files', input_schema: { file_path: 'string' } },
    { name: 'Grep', description: 'Search files', input_schema: { pattern: 'string', path: 'string?' } },
    { name: 'Glob', description: 'Find files', input_schema: { pattern: 'string', path: 'string?' } },
  ];
}

async function handleStream(response) {
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let resultSubtype = '';
  let sawGrep = false;
  let sawRead = false;

  function handleEvent(data) {
    if (data.type === 'delta') {
      const delta = data.text || '';
      text += delta;
      if (delta.includes('🔧 Grep(')) sawGrep = true;
      if (delta.includes('🔧 Read(')) sawRead = true;
    } else if (data.type === 'result') {
      resultSubtype = data.subtype || '';
      text = data.text || text;
    } else if (data.type === 'error') {
      text += `\nERROR: ${data.message || 'unknown'}`;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      try {
        handleEvent(JSON.parse(line.slice(6)));
      } catch {}
    }
  }

  return { text, resultSubtype, sawGrep, sawRead };
}

async function main() {
  const stamp = Date.now();
  const allowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-knowledge-root-'));
  const vaultPath = path.join(allowRoot, `vault-${stamp}`);
  fs.mkdirSync(path.join(vaultPath, 'Projects'), { recursive: true });
  const secret = `SMOKE_SECRET_${stamp}_42`;
  fs.writeFileSync(path.join(vaultPath, 'Projects', 'retention.md'), [
    '# Retention',
    '',
    `The knowledge smoke value is ${secret}.`,
  ].join('\n'));
  fs.writeFileSync(path.join(vaultPath, 'index.md'), '# Index\n\nSee [[Retention]].\n');
  const expectedVaultPath = fs.realpathSync.native(vaultPath);

  let managedServer = null;
  try {
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer(allowRoot);
    }
    await waitForHealth(baseUrl);

    const register = await requireOk('register', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Knowledge Smoke',
        email: `agentma-knowledge-${stamp}@example.test`,
        password: 'test-password-123',
      }),
    }));
    const token = register.token;
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const testResult = await requireOk('test source', fetchJson(`${baseUrl}/api/knowledge/sources/test`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ path: vaultPath }),
    }));

    const scanResult = await requireOk('scan sources', fetchJson(`${baseUrl}/api/knowledge/sources/scan`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ path: allowRoot }),
    }));

    const savedSources = await requireOk('save sources', fetchJson(`${baseUrl}/api/knowledge/sources`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify([{ name: 'smoke', path: vaultPath, enabled: true }]),
    }));

    const env = readEnvFile(envFile);
    const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
    let stream = { resultSubtype: 'skipped', sawGrep: false, sawRead: false, text: '' };
    if (apiKey) {
      const chat = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Use Grep first to find ${secret}, then Read the matching markdown file and answer with the number at the end.`,
          }],
          systemPrompt: 'You are running a knowledge smoke test. Use the available file search tools.',
          provider: {
            ANTHROPIC_AUTH_TOKEN: apiKey,
            ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
            ANTHROPIC_MODEL: env.SPIKE_MODEL || env.ANTHROPIC_MODEL || 'deepseek-chat',
          },
          tools: requestTools(),
          useKnowledge: true,
        }),
      });
      if (!chat.ok) {
        const body = await chat.text().catch(() => '');
        throw new Error(`chat failed ${chat.status}: ${body}`);
      }
      stream = await handleStream(chat);
    } else {
      console.log(`chat skipped: missing ANTHROPIC_API_KEY in ${envFile}`);
    }

    const checks = {
      scanFindsVault: Array.isArray(scanResult.candidates) && scanResult.candidates.some((candidate) => candidate.path === expectedVaultPath),
      sourcesSaved: Array.isArray(savedSources) && savedSources.length === 1 && savedSources[0]?.enabled === true,
      testReturnsOk: testResult.ok === true && Number(testResult.fileCount || 0) >= 2,
      agentCalledGrep: !apiKey || stream.sawGrep,
      agentCalledRead: !apiKey || stream.sawRead,
      agentAnswerHasSecret: !apiKey || stream.text.includes('42'),
    };

    console.log(`source ${JSON.stringify(savedSources[0] || {})}`);
    console.log(`scan ${JSON.stringify(scanResult)}`);
    console.log(`test ${JSON.stringify(testResult)}`);
    console.log(`stream ${JSON.stringify({ resultSubtype: stream.resultSubtype, sawGrep: stream.sawGrep, sawRead: stream.sawRead, text: stream.text.slice(0, 500) })}`);
    console.log(`checks ${JSON.stringify(checks)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (failed.length) throw new Error(`knowledge smoke failed: ${failed.join(', ')}`);
  } finally {
    await stopManagedServer(managedServer);
    fs.rmSync(allowRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
