import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let baseUrl = process.env.AGENTMA_SMOKE_BASE_URL || 'http://127.0.0.1:3001';

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

function sameMessages(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

async function main() {
  let managedServer = null;
  try {
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer();
    }
    await waitForHealth(baseUrl);

    const stamp = Date.now();
    const register = await requireOk('register', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Session Fork Smoke',
        email: `agentma-session-fork-${stamp}@example.test`,
        password: 'test-password-123',
      }),
    }));
    const token = register.token;
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const sourceSession = {
      id: `session-fork-source-${stamp}`,
      templateId: 'smoke-agent',
      title: 'Fork Smoke Source',
      model: 'deepseek-chat',
      pinned: true,
      createdAt: stamp,
      updatedAt: stamp,
      messages: [
        { role: 'user', content: `hello ${stamp}`, timestamp: stamp },
        { role: 'assistant', content: `world ${stamp}`, timestamp: stamp + 1 },
      ],
    };

    const saved = await requireOk('save source session', fetchJson(`${baseUrl}/api/chat-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(sourceSession),
    }));

    const forked = await requireOk('fork session', fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(saved.id)}/fork`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Fork Smoke Copy' }),
    }));

    const fetchedFork = await requireOk('fetch fork', fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(forked.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const listed = await requireOk('list sessions', fetchJson(`${baseUrl}/api/chat-sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const audit = await requireOk('audit', fetchJson(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    }));

    const checks = {
      sourceSaved: saved.id === sourceSession.id && saved.messages?.length === 2,
      forkCreated: forked.id && forked.id !== saved.id,
      forkTitle: forked.title === 'Fork Smoke Copy',
      forkNotPinned: forked.pinned === false,
      forkMessagesCopied: sameMessages(forked.messages, saved.messages) && sameMessages(fetchedFork.messages, saved.messages),
      listContainsBoth: Array.isArray(listed)
        && listed.some((session) => session.id === saved.id)
        && listed.some((session) => session.id === forked.id),
      auditRecorded: Array.isArray(audit) && audit.some((row) => row?.action === 'fork_chat_session'),
    };

    console.log(`source ${JSON.stringify({ id: saved.id, title: saved.title, pinned: saved.pinned, messages: saved.messages?.length })}`);
    console.log(`forked ${JSON.stringify({ id: forked.id, title: forked.title, pinned: forked.pinned, messages: forked.messages?.length })}`);
    console.log(`checks ${JSON.stringify(checks)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (failed.length) throw new Error(`chat session fork smoke failed: ${failed.join(', ')}`);
  } finally {
    await stopManagedServer(managedServer);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
