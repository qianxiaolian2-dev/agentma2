import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let baseUrl = process.env.AGENTMA_SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const envFile = process.env.AGENTMA_SMOKE_ENV || path.resolve(process.cwd(), '../spike-sdk/.env');

function readEnvFile(file) {
  const values = {};
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

async function startManagedServer() {
  const port = Number(process.env.AGENTMA_SMOKE_PORT || await getFreePort());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-smoke-data-'));
  const child = spawn('npm', ['run', 'server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), AGENTMA_DATA_DIR: dataDir, AGENTMA_SKIP_RECOVER: '1' },
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

async function requireOk(label, request) {
  const result = await request;
  if (!result.response.ok) {
    throw new Error(`${label} failed ${result.response.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function handleStream(response) {
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let resultSubtype = '';
  let sdkSessionId = '';
  let sdkCwd = '';
  let errorMessage = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      let data;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (data.sdkSessionId) sdkSessionId = data.sdkSessionId;
      if (data.sdkCwd) sdkCwd = data.sdkCwd;
      if (data.type === 'delta') finalText += data.text || '';
      if (data.type === 'error') errorMessage = data.message || 'unknown stream error';
      if (data.type === 'result') {
        resultSubtype = data.subtype || '';
        finalText = data.text || finalText;
      }
    }
  }

  return { finalText, resultSubtype, sdkSessionId, sdkCwd, errorMessage };
}

async function chat(token, provider, body) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, ...body }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`chat failed ${response.status}: ${text}`);
  }
  return handleStream(response);
}

async function main() {
  let managedServer = null;
  try {
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer();
    }

    const env = readEnvFile(envFile);
    const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey) throw new Error(`missing ANTHROPIC_API_KEY in ${envFile}`);

    await waitForHealth(baseUrl);

    const stamp = Date.now();
    const register = await requireOk('register', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resume Smoke',
        email: `agentma-resume-${stamp}@example.test`,
        password: 'test-password-123',
      }),
    }));
    const token = register.token;
    const provider = {
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL: env.SPIKE_MODEL || env.ANTHROPIC_MODEL || 'deepseek-chat',
    };

    const first = await chat(token, provider, {
      messages: [{ role: 'user', content: `Remember this exact marker for a resume smoke test: RESUME_MARKER_${stamp}. Reply ACK only.` }],
      systemPrompt: 'You are running a smoke test. Keep answers short.',
      tools: [],
    });
    const second = await chat(token, provider, {
      sdkSessionId: first.sdkSessionId,
      sdkCwd: first.sdkCwd,
      messages: [
        { role: 'user', content: `Remember this exact marker for a resume smoke test: RESUME_MARKER_${stamp}. Reply ACK only.` },
        { role: 'assistant', content: first.finalText || 'ACK' },
        { role: 'user', content: 'Using the resumed conversation, reply with the marker only.' },
      ],
      systemPrompt: 'You are running a smoke test. Keep answers short.',
      tools: [],
    });

    const quotaUsage = await requireOk('quota usage', fetchJson(`${baseUrl}/api/quota/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const audit = await requireOk('audit', fetchJson(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    }));

    const checks = {
      firstSuccess: first.resultSubtype === 'success' && !first.errorMessage,
      firstSdkSession: typeof first.sdkSessionId === 'string' && first.sdkSessionId.length > 0,
      firstSdkCwd: typeof first.sdkCwd === 'string' && first.sdkCwd.length > 0,
      secondSuccess: second.resultSubtype === 'success' && !second.errorMessage,
      secondSdkSession: typeof second.sdkSessionId === 'string' && second.sdkSessionId.length > 0,
      resumedSameSession: second.sdkSessionId === first.sdkSessionId,
      twoRunsRecorded: Number(quotaUsage.usage?.weeklyRunCount?.used || 0) >= 2,
      auditRecorded: Array.isArray(audit) && audit.filter((row) => row?.action === 'agent_run').length >= 2,
    };

    console.log(`first ${JSON.stringify({ sdkSessionId: first.sdkSessionId, sdkCwd: first.sdkCwd, subtype: first.resultSubtype, final: first.finalText.slice(0, 120) })}`);
    console.log(`second ${JSON.stringify({ sdkSessionId: second.sdkSessionId, sdkCwd: second.sdkCwd, subtype: second.resultSubtype, final: second.finalText.slice(0, 120) })}`);
    console.log(`checks ${JSON.stringify(checks)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (failed.length) throw new Error(`chat resume smoke failed: ${failed.join(', ')}`);
  } finally {
    await stopManagedServer(managedServer);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
