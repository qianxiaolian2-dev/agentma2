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

function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function template(id, name, patch = {}) {
  const now = Date.now();
  return {
    id,
    name,
    description: `${name} description`,
    systemPrompt: `You are ${name}.`,
    model: 'claude-smoke-model',
    tools: ['Read'],
    subagents: {},
    mcpServers: [],
    eventSources: [],
    skills: [],
    effort: 'medium',
    maxTurns: 10,
    permissionMode: 'default',
    knowledgeSourceIds: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

async function main() {
  const stamp = Date.now();
  let managedServer = null;

  try {
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer();
    }
    await waitForHealth(baseUrl);

    const adminEmail = `agent-owner-${stamp}@example.test`;
    const memberEmail = `agent-viewer-${stamp}@example.test`;
    const admin = await requireOk('register owner', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Agent Owner', email: adminEmail, password: 'test-password-123' }),
    }));
    const adminHeaders = headers(admin.token);

    await requireOk('create member', fetchJson(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Agent Viewer', email: memberEmail, password: 'test-password-123', role: 'member' }),
    }));
    const member = await requireOk('login member', fetchJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: 'test-password-123' }),
    }));
    const memberHeaders = headers(member.token);

    const privateAgent = template('agent-private-smoke', 'private smoke agent');
    await requireOk('save private agent', fetchJson(`${baseUrl}/api/agents`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify([privateAgent]),
    }));

    const ownerPrivateList = await requireOk('owner private list', fetchJson(`${baseUrl}/api/agents`, { headers: adminHeaders }));
    const memberBeforePublish = await requireOk('member before publish', fetchJson(`${baseUrl}/api/agents`, { headers: memberHeaders }));
    const privatePreview = await fetchJson(`${baseUrl}/api/agents/${encodeURIComponent(privateAgent.id)}/claude-md`, { headers: memberHeaders });

    const savedOwnerAgent = ownerPrivateList.find((agent) => agent.id === privateAgent.id);
    const publishedAgent = { ...savedOwnerAgent, publishedAt: Date.now(), updatedAt: Date.now() };
    await requireOk('publish agent', fetchJson(`${baseUrl}/api/agents`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify([publishedAgent]),
    }));
    const memberAfterPublish = await requireOk('member after publish', fetchJson(`${baseUrl}/api/agents`, { headers: memberHeaders }));
    const publicPreview = await fetchJson(`${baseUrl}/api/agents/${encodeURIComponent(privateAgent.id)}/claude-md`, { headers: memberHeaders });

    const tamperedPublic = {
      ...memberAfterPublish.find((agent) => agent.id === privateAgent.id),
      name: 'member should not rename this',
      publishedAt: null,
      updatedAt: Date.now(),
    };
    await requireOk('member cannot mutate owner agent', fetchJson(`${baseUrl}/api/agents`, {
      method: 'PUT',
      headers: memberHeaders,
      body: JSON.stringify([tamperedPublic]),
    }));
    const ownerAfterTamper = await requireOk('owner after tamper', fetchJson(`${baseUrl}/api/agents`, { headers: adminHeaders }));
    const afterTamperAgent = ownerAfterTamper.find((agent) => agent.id === privateAgent.id);

    const memberAgent = template('agent-member-smoke', 'member private smoke agent');
    await requireOk('save member private agent', fetchJson(`${baseUrl}/api/agents`, {
      method: 'PUT',
      headers: memberHeaders,
      body: JSON.stringify([memberAgent]),
    }));
    const ownerAfterMemberPrivate = await requireOk('owner sees all as admin', fetchJson(`${baseUrl}/api/agents`, { headers: adminHeaders }));

    const unpublishedAgent = { ...afterTamperAgent, publishedAt: null, updatedAt: Date.now() };
    await requireOk('unpublish owner agent', fetchJson(`${baseUrl}/api/agents`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify([unpublishedAgent]),
    }));
    const memberAfterUnpublish = await requireOk('member after unpublish', fetchJson(`${baseUrl}/api/agents`, { headers: memberHeaders }));

    const checks = {
      ownerSeesPrivate: ownerPrivateList.some((agent) => agent.id === privateAgent.id),
      privateHiddenFromMember: Array.isArray(memberBeforePublish) && !memberBeforePublish.some((agent) => agent.id === privateAgent.id),
      privatePreviewHidden: privatePreview.response.status === 404,
      publishedVisibleToMember: memberAfterPublish.some((agent) => agent.id === privateAgent.id),
      publicPreviewAllowed: publicPreview.response.ok,
      nonOwnerMutationIgnored: afterTamperAgent?.name === savedOwnerAgent?.name && Boolean(afterTamperAgent?.publishedAt),
      memberPrivateHiddenFromMemberListOwnerView: ownerAfterMemberPrivate.some((agent) => agent.id === memberAgent.id),
      unpublishedHiddenAgain: !memberAfterUnpublish.some((agent) => agent.id === privateAgent.id),
    };

    console.log(`checks ${JSON.stringify(checks)}`);
    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (failed.length) throw new Error(`agent visibility smoke failed: ${failed.join(', ')}`);
  } finally {
    await stopManagedServer(managedServer);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
