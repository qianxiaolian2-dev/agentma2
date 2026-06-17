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

async function startManagedServer(userSkillsDir) {
  const port = Number(process.env.AGENTMA_SMOKE_PORT || await getFreePort());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-smoke-data-'));
  const child = spawn('npm', ['run', 'server'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      AGENTMA_DATA_DIR: dataDir,
      AGENTMA_USER_SKILLS_DIR: userSkillsDir,
      AGENTMA_SKIP_RECOVER: '1',
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

function writeSkill(skillDir, marker, description = 'Public skill smoke test', name = 'smoke-public-source') {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    '# Smoke Public Skill',
    '',
    `marker: ${marker}`,
  ].join('\n'));
}

async function main() {
  const stamp = Date.now();
  const userSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-smoke-skills-'));
  const externalSkillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-smoke-external-skills-'));
  const sourceSkillDir = path.join(userSkillsDir, 'smoke-public-source');
  const externalSkillDir = path.join(externalSkillRoot, 'smoke-external-source');
  const learnedName = 'smoke-public-learned';
  const learnedSkillDir = path.join(userSkillsDir, learnedName);
  let managedServer = null;

  try {
    writeSkill(sourceSkillDir, 'ORIGINAL');
    writeSkill(externalSkillDir, 'EXTERNAL', 'External backpack skill smoke test', 'smoke-external-source');
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer(userSkillsDir);
    }
    await waitForHealth(baseUrl);

    const register = await requireOk('register', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Skills Public Smoke',
        email: `agentma-skills-${stamp}@example.test`,
        password: 'test-password-123',
      }),
    }));
    const token = register.token;
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const published = await requireOk('publish public skill', fetchJson(`${baseUrl}/api/skills/public`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        path: sourceSkillDir,
        name: 'smoke-public-source',
        description: 'Public skill smoke test',
      }),
    }));

    const externalPublished = await requireOk('publish external backpack skill', fetchJson(`${baseUrl}/api/skills/public`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        path: externalSkillDir,
        name: 'smoke-external-source',
        description: 'External backpack skill smoke test',
      }),
    }));

    const list = await requireOk('list public skills', fetchJson(`${baseUrl}/api/skills/public`, {
      headers: { Authorization: `Bearer ${token}` },
    }));

    const duplicate = await fetchJson(`${baseUrl}/api/skills/public/${encodeURIComponent(published.id)}/learn`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });

    const learned = await requireOk('learn public skill with override', fetchJson(`${baseUrl}/api/skills/public/${encodeURIComponent(published.id)}/learn`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ nameOverride: learnedName }),
    }));
    const learnedBeforeUpdate = fs.readFileSync(path.join(learnedSkillDir, 'SKILL.md'), 'utf8');

    writeSkill(sourceSkillDir, 'UPDATED', 'Updated public skill smoke test');
    const updated = await requireOk('update public skill', fetchJson(`${baseUrl}/api/skills/public/${encodeURIComponent(published.id)}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        path: sourceSkillDir,
        description: 'Updated public skill smoke test',
      }),
    }));
    const detail = await requireOk('public skill detail', fetchJson(`${baseUrl}/api/skills/public/${encodeURIComponent(published.slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const learnedAfterUpdate = fs.readFileSync(path.join(learnedSkillDir, 'SKILL.md'), 'utf8');
    const audit = await requireOk('audit logs', fetchJson(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    }));

    const checks = {
      publishedRevisionOne: published.revision === 1,
      externalBackpackPathPublished: externalPublished.revision === 1 && externalPublished.slug === 'smoke-external-source',
      listIncludesPublicSkill: Array.isArray(list) && list.some((skill) => skill?.id === published.id),
      duplicateRejected: duplicate.response.status === 409,
      learnedIsUserSkill: learned.location === 'user' && learned.installed === true && learned.name === learnedName,
      learnedHasSourceMetadata: learned.learnedFromPublicSkillId === published.id && learned.learnedFromPublicRevision === 1,
      updatedRevisionTwo: updated.revision === 2 && detail.revision === 2,
      learnedCopyStayedOriginal: learnedBeforeUpdate.includes('ORIGINAL') && learnedAfterUpdate.includes('ORIGINAL') && !learnedAfterUpdate.includes('UPDATED'),
      auditRecorded: Array.isArray(audit) && ['publish_public_skill', 'learn_public_skill', 'update_public_skill'].every((action) => (
        audit.some((row) => row?.action === action)
      )),
    };

    console.log(`published ${JSON.stringify(published)}`);
    console.log(`learned ${JSON.stringify(learned)}`);
    console.log(`updated ${JSON.stringify(updated)}`);
    console.log(`checks ${JSON.stringify(checks)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (failed.length) throw new Error(`public skills smoke failed: ${failed.join(', ')}`);
  } finally {
    await stopManagedServer(managedServer);
    fs.rmSync(userSkillsDir, { recursive: true, force: true });
    fs.rmSync(externalSkillRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
