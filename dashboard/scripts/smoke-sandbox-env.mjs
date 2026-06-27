import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(scriptDir, '..');
let baseUrl = process.env.AGENTMA_SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const envFile = process.env.AGENTMA_SMOKE_ENV || path.resolve(dashboardRoot, '../spike-sdk/.env');
const testSecret = process.env.AGENTMA_TEST_SECRET || 'topsecret';
const shouldStartServer = process.env.AGENTMA_SMOKE_START_SERVER === '1'
  || (!process.env.AGENTMA_SMOKE_BASE_URL && process.env.AGENTMA_SMOKE_START_SERVER !== '0');

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
    cwd: dashboardRoot,
    env: {
      ...process.env,
      PORT: String(port),
      AGENTMA_DATA_DIR: dataDir,
      AGENTMA_SKIP_RECOVER: '1',
      AGENTMA_TEST_SECRET: testSecret,
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

function cleanupRunDirectory(cwd) {
  if (!cwd) return;
  try {
    const resolved = fs.realpathSync.native(cwd);
    const allowedRoots = [os.tmpdir(), '/tmp', '/private/tmp']
      .flatMap((root) => {
        try { return [fs.realpathSync.native(root)]; } catch { return []; }
      });
    const parent = path.dirname(resolved);
    if (path.basename(resolved).startsWith('agentma-run-') && allowedRoots.includes(parent)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  } catch {}
}

function requestTools() {
  return [
    {
      name: 'Bash',
      description: 'Run a bash command',
      input_schema: { command: 'string', description: 'string?' },
    },
  ];
}

async function handleStream(response, token) {
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let cwd = '';
  let finalText = '';
  let allText = '';
  let sawPermission = false;
  let permissionAllowed = false;
  let resultSubtype = '';
  let errorMessage = '';

  async function handleEvent(data) {
    if (data.type === 'system' && data.subtype === 'init') {
      cwd = data.cwd || cwd;
      console.log(`init model=${data.model} tools=${data.tools} cwd=${cwd}`);
      return;
    }
    if (data.type === 'delta') {
      const text = data.text || '';
      allText += text;
      finalText += text;
      return;
    }
    if (data.type === 'permission_request') {
      sawPermission = true;
      console.log(`permission_request ${data.toolName} ${JSON.stringify(data.input || {})}`);
      const decision = await fetchJson(`${baseUrl}/api/agents/permissions/${encodeURIComponent(data.reqId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'allow', rememberForSession: false }),
      });
      if (!decision.response.ok) {
        throw new Error(`permission allow failed ${decision.response.status}: ${JSON.stringify(decision.body)}`);
      }
      permissionAllowed = true;
      return;
    }
    if (data.type === 'permission_resolved') {
      console.log(`permission_resolved ${data.toolName} ${data.decision}`);
      return;
    }
    if (data.type === 'error') {
      errorMessage = data.message || 'unknown stream error';
      console.log(`stream_error ${errorMessage}`);
      return;
    }
    if (data.type === 'result') {
      resultSubtype = data.subtype || '';
      finalText = data.text || finalText;
      allText += data.text || '';
      console.log(`result subtype=${resultSubtype}`);
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
      let data;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      await handleEvent(data);
    }
  }

  return { cwd, finalText, allText, sawPermission, permissionAllowed, resultSubtype, errorMessage };
}

function marker(text, name) {
  const matches = [...text.matchAll(new RegExp(`${name}=\\[([^\\]]*)\\]`, 'g'))];
  const last = matches[matches.length - 1];
  return last ? last[1] : '';
}

function realpathOrResolve(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function main() {
  let managedServer = null;
  let runCwd = '';

  try {
    if (shouldStartServer) {
      managedServer = await startManagedServer();
    } else {
      console.log('using existing server; make sure that server process has AGENTMA_TEST_SECRET set for a real env-leak check');
    }

    const env = readEnvFile(envFile);
    const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey) throw new Error(`missing ANTHROPIC_API_KEY in ${envFile}`);

    await waitForHealth(baseUrl);

    const stamp = Date.now();
    const email = `agentma-sandbox-smoke-${stamp}@example.test`;
    const password = 'test-password-123';
    const register = await fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sandbox Smoke', email, password }),
    });
    if (!register.response.ok) {
      throw new Error(`register failed ${register.response.status}: ${JSON.stringify(register.body)}`);
    }

    const token = register.body.token;
    const command = [
      'printf "SECRET=[%s]\\nHOME=[%s]\\n" "${AGENTMA_TEST_SECRET:-}" "$HOME"',
      'if [ -e "$HOME/.claude" ]; then echo "CLAUDE_DIR=[present]"; else echo "CLAUDE_DIR=[missing]"; fi',
      'if sh -c "printf x > /tmp/agentma_escape_sandbox_check.txt" 2>/dev/null; then echo "OUTSIDE_WRITE=[success]"; rm -f /tmp/agentma_escape_sandbox_check.txt; else echo "OUTSIDE_WRITE=[failed]"; fi',
      'if printf x > ./agentma_inside_sandbox_check.txt; then echo "INSIDE_WRITE=[success]"; rm -f ./agentma_inside_sandbox_check.txt; else echo "INSIDE_WRITE=[failed]"; fi',
    ].join('; ');
    const prompt = [
      'Run this exact Bash command once, then reply with only the raw command output:',
      command,
    ].join('\n\n');

    const chat = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'You are running a smoke test. Use Bash exactly once and do not add commentary.',
        provider: {
          ANTHROPIC_AUTH_TOKEN: apiKey,
          ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
          ANTHROPIC_MODEL: env.SPIKE_MODEL || env.ANTHROPIC_MODEL || 'deepseek-chat',
        },
        tools: requestTools(),
      }),
    });
    if (!chat.ok) {
      const text = await chat.text().catch(() => '');
      throw new Error(`chat failed ${chat.status}: ${text}`);
    }

    const stream = await handleStream(chat, token);
    runCwd = stream.cwd;
    const combinedText = `${stream.allText}\n${stream.finalText}`;
    const secret = marker(combinedText, 'SECRET');
    const home = marker(combinedText, 'HOME');
    const claudeDir = marker(combinedText, 'CLAUDE_DIR');
    const outsideWrite = marker(combinedText, 'OUTSIDE_WRITE');
    const insideWrite = marker(combinedText, 'INSIDE_WRITE');
    const expectedHome = stream.cwd ? path.join(stream.cwd, '.agent-home') : '';
    const homeResolved = home ? realpathOrResolve(home) : '';
    const expectedHomeResolved = expectedHome ? realpathOrResolve(expectedHome) : '';
    const hostHomeResolved = realpathOrResolve(os.homedir());

    const checks = {
      resultSuccess: stream.resultSubtype === 'success',
      sawPermission: stream.sawPermission,
      permissionAllowed: stream.permissionAllowed,
      secretBlocked: secret === '',
      homeIsIsolated: Boolean(home && expectedHome && homeResolved === expectedHomeResolved && homeResolved !== hostHomeResolved),
      hostClaudeHidden: claudeDir === 'missing',
      outsideWriteBlocked: outsideWrite === 'failed',
      insideWriteAllowed: insideWrite === 'success',
    };

    console.log(`markers ${JSON.stringify({ secret, home, claudeDir, outsideWrite, insideWrite })}`);
    console.log(`checks ${JSON.stringify(checks)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (stream.errorMessage) failed.push(`streamError:${stream.errorMessage}`);
    if (failed.length) {
      throw new Error(`sandbox/env smoke failed: ${failed.join(', ')}`);
    }
  } finally {
    cleanupRunDirectory(runCwd);
    await stopManagedServer(managedServer);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
