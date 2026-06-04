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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-collab-smoke-'));
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
  if (!closed) throw new Error(`managed server port ${managed.port} still accepts connections after stop`);
  fs.rmSync(managed.dataDir, { recursive: true, force: true });
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function requireOk(label, request) {
  const result = await request;
  if (!result.response.ok) {
    throw new Error(`${label} failed ${result.response.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function requireStatus(label, expectedStatus, request) {
  const result = await request;
  if (result.response.status !== expectedStatus) {
    throw new Error(`${label} expected ${expectedStatus}, got ${result.response.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function waitForSessionUpdated(token, sessionId, trigger) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}/events`, {
    headers: authHeaders(token),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`events connect failed ${response.status}`);
  }

  const eventPromise = (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((item) => item.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === 'session_updated') return event;
      }
    }
    throw new Error('event stream ended before session_updated');
  })();

  await delay(100);
  await trigger();
  try {
    return await Promise.race([
      eventPromise,
      delay(4000).then(() => { throw new Error('timed out waiting for session_updated'); }),
    ]);
  } finally {
    controller.abort();
  }
}

async function main() {
  let managedServer = null;
  try {
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer();
    }

    await waitForHealth(baseUrl);
    const stamp = Date.now();
    const password = 'test-password-123';
    const ownerEmail = `collab-owner-${stamp}@example.test`;
    const memberEmail = `collab-member-${stamp}@example.test`;

    const owner = await requireOk('register owner', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Collab Owner', email: ownerEmail, password }),
    }));

    await requireOk('create member', fetchJson(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: authHeaders(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'Collab Member', email: memberEmail, password, role: 'member' }),
    }));

    const member = await requireOk('login member', fetchJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password }),
    }));

    const sessionId = `collab-smoke-${stamp}`;
    const sessionBody = {
      id: sessionId,
      templateId: 'agent-collab-smoke',
      title: 'Collaboration smoke',
      messages: [{ role: 'user', content: 'owner message', timestamp: stamp }],
      model: 'smoke-model',
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp,
    };

    await requireOk('owner creates session', fetchJson(`${baseUrl}/api/chat-sessions`, {
      method: 'POST',
      headers: authHeaders(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(sessionBody),
    }));

    await requireStatus('member blocked before join', 404, fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
      headers: authHeaders(member.token),
    }));

    const enabled = await requireOk('owner enables collaboration', fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}/collaboration`, {
      method: 'PATCH',
      headers: authHeaders(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled: true }),
    }));
    if (!enabled.collaborationEnabled || enabled.collaborationRole !== 'owner') {
      throw new Error(`unexpected enabled session: ${JSON.stringify(enabled)}`);
    }

    const joined = await requireOk('member joins session', fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}/join`, {
      method: 'POST',
      headers: authHeaders(member.token, { 'Content-Type': 'application/json' }),
    }));
    if (joined.collaborationRole !== 'member') {
      throw new Error(`unexpected joined role: ${JSON.stringify(joined)}`);
    }

    const memberMessages = [
      ...joined.messages,
      { role: 'user', content: 'member message', timestamp: stamp + 1 },
    ];
    const updateEvent = await waitForSessionUpdated(owner.token, sessionId, async () => {
      await requireOk('member saves message', fetchJson(`${baseUrl}/api/chat-sessions`, {
        method: 'POST',
        headers: authHeaders(member.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...joined, messages: memberMessages, updatedAt: stamp + 1 }),
      }));
    });
    if (updateEvent.sessionId !== sessionId) {
      throw new Error(`unexpected update event: ${JSON.stringify(updateEvent)}`);
    }

    const ownerRead = await requireOk('owner reads member message', fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
      headers: authHeaders(owner.token),
    }));
    if (!ownerRead.messages.some((message) => message.content === 'member message')) {
      throw new Error(`owner did not see member message: ${JSON.stringify(ownerRead.messages)}`);
    }

    await requireStatus('member cannot delete shared original', 404, fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: authHeaders(member.token),
    }));

    await requireOk('owner disables collaboration', fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}/collaboration`, {
      method: 'PATCH',
      headers: authHeaders(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled: false }),
    }));

    await requireStatus('member blocked after disable', 404, fetchJson(`${baseUrl}/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
      headers: authHeaders(member.token),
    }));

    console.log('chat collaboration smoke passed');
  } finally {
    await stopManagedServer(managedServer);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
