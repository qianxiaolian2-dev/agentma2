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
  return { child, dataDir };
}

async function stopManagedServer(managed) {
  if (!managed) return;
  if (!childExited(managed.child)) {
    signalManagedServer(managed, 'SIGINT');
    await waitForChildExit(managed.child, 2500);
  }
  if (!childExited(managed.child)) {
    signalManagedServer(managed, 'SIGKILL');
    await waitForChildExit(managed.child, 1500);
  }
  fs.rmSync(managed.dataDir, { recursive: true, force: true });
}

async function main() {
  let managedServer = null;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-claude-md-'));
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
        name: 'ClaudeMd Smoke',
        email: `agentma-claude-md-${stamp}@example.test`,
        password: 'test-password-123',
      }),
    }));
    const token = register.token;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const agentId = `agent-claude-md-${stamp}`;
    const idleAgentId = `agent-no-session-${stamp}`;
    const templates = [
      {
        id: agentId,
        name: 'ClaudeMd Preview Agent',
        description: 'smoke',
        systemPrompt: 'runtime system prompt is separate from CLAUDE.md',
        model: 'smoke-model',
        tools: ['Read'],
        mcpServers: [],
        eventSources: [],
        skills: [],
        effort: 'medium',
        maxTurns: 10,
        permissionMode: 'default',
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: idleAgentId,
        name: 'No Session Agent',
        description: 'smoke',
        systemPrompt: '',
        model: 'smoke-model',
        tools: ['Read'],
        mcpServers: [],
        eventSources: [],
        skills: [],
        effort: 'medium',
        maxTurns: 10,
        permissionMode: 'default',
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    await requireOk('replace agents', fetchJson(`${baseUrl}/api/agents`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(templates),
    }));

    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), `root marker ${stamp}`);
    fs.writeFileSync(path.join(cwd, '.claude', 'CLAUDE.md'), `dot marker ${stamp}`);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.local.md'), `local marker ${stamp}`);

    const session = await requireOk('save session', fetchJson(`${baseUrl}/api/chat-sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: agentId,
        title: 'CLAUDE.md preview session',
        model: 'smoke-model',
        sdkSessionId: `sdk-${stamp}`,
        sdkCwd: cwd,
        messages: [{ role: 'user', content: 'hello', timestamp: stamp }],
      }),
    }));

    const preview = await requireOk('claude md preview', fetchJson(`${baseUrl}/api/agents/${agentId}/claude-md`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const idlePreview = await requireOk('idle claude md preview', fetchJson(`${baseUrl}/api/agents/${idleAgentId}/claude-md`, {
      headers: { Authorization: `Bearer ${token}` },
    }));

    const checks = {
      latestSessionCwd: preview.cwd === cwd && preview.cwdSource === 'latest_session',
      latestSessionLinked: preview.latestSession?.id === session.id,
      rootLoaded: preview.effectiveContent.includes(`root marker ${stamp}`),
      dotLoaded: preview.effectiveContent.includes(`dot marker ${stamp}`),
      localLoaded: preview.effectiveContent.includes(`local marker ${stamp}`),
      idleUsesNewSession: idlePreview.cwdSource === 'new_session',
      idleHasNote: idlePreview.notes.some((note) => String(note).includes('尚无带 sdkCwd 的会话')),
    };

    console.log(`preview ${JSON.stringify({ cwd: preview.cwd, cwdSource: preview.cwdSource, loadedFiles: preview.loadedFiles })}`);
    console.log(`idle ${JSON.stringify({ cwd: idlePreview.cwd, cwdSource: idlePreview.cwdSource })}`);
    console.log(`checks ${JSON.stringify(checks)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (failed.length) throw new Error(`agent claude.md smoke failed: ${failed.join(', ')}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    await stopManagedServer(managedServer);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
