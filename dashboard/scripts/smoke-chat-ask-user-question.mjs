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

async function requireOk(label, request) {
  const result = await request;
  if (!result.response.ok) {
    throw new Error(`${label} failed ${result.response.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

function askUserQuestionToolDefinition() {
  return {
    name: 'AskUserQuestion',
    description: 'Ask the user a structured clarification question',
    input_schema: { questions: 'array' },
  };
}

async function handleStream(response, token) {
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let cwd = '';
  let finalText = '';
  let resultSubtype = '';
  let errorMessage = '';
  let sdkSessionId = '';
  let sdkCwd = '';
  let sawAskToolUse = false;
  let sawQuestion = false;
  let answeredQuestion = false;
  let sawQuestionResolved = false;
  let sawToolResultAnswer = false;
  let questionText = '';

  async function handleEvent(data) {
    if (data.type === 'system' && data.subtype === 'init') {
      cwd = data.cwd || '';
      sdkCwd = data.cwd || sdkCwd;
      if (data.sdkSessionId) sdkSessionId = data.sdkSessionId;
      console.log(`init model=${data.model} tools=${data.tools} cwd=${cwd} sdkSessionId=${sdkSessionId || '-'}`);
      return;
    }
    if (data.type === 'delta') {
      const text = data.text || '';
      finalText += text;
      if (text.includes('AskUserQuestion(')) sawAskToolUse = true;
      if (text.includes('Detailed')) sawToolResultAnswer = true;
      return;
    }
    if (data.type === 'ask_user_question') {
      sawQuestion = true;
      const firstQuestion = Array.isArray(data.questions) ? data.questions[0] : null;
      questionText = firstQuestion?.question || '';
      console.log(`ask_user_question ${data.reqId} ${questionText}`);
      const answers = questionText ? { [questionText]: 'Detailed' } : {};
      const answer = await fetchJson(`${baseUrl}/api/agents/questions/${encodeURIComponent(data.reqId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!answer.response.ok) {
        throw new Error(`question answer failed ${answer.response.status}: ${JSON.stringify(answer.body)}`);
      }
      answeredQuestion = true;
      return;
    }
    if (data.type === 'ask_user_question_resolved') {
      sawQuestionResolved = true;
      console.log(`ask_user_question_resolved ${data.reqId} ${JSON.stringify(data.answers || {})}`);
      return;
    }
    if (data.type === 'error') {
      errorMessage = data.message || 'unknown stream error';
      console.log(`stream_error ${errorMessage}`);
      return;
    }
    if (data.type === 'result') {
      resultSubtype = data.subtype || '';
      if (data.sdkSessionId) sdkSessionId = data.sdkSessionId;
      if (data.sdkCwd) sdkCwd = data.sdkCwd;
      finalText = data.text || finalText;
      console.log(`result subtype=${resultSubtype} usage=${JSON.stringify(data.usage || {})} cost=${data.cost_usd} sdkSessionId=${sdkSessionId || '-'}`);
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

  return {
    cwd,
    finalText,
    resultSubtype,
    errorMessage,
    sdkSessionId,
    sdkCwd,
    sawAskToolUse,
    sawQuestion,
    answeredQuestion,
    sawQuestionResolved,
    sawToolResultAnswer,
    questionText,
  };
}

async function main() {
  let managedServer = null;
  let runCwd = '';

  try {
    if (process.env.AGENTMA_SMOKE_START_SERVER === '1') {
      managedServer = await startManagedServer();
    }

    const env = readEnvFile(envFile);
    const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey) throw new Error(`missing ANTHROPIC_API_KEY in ${envFile}`);

    await waitForHealth(baseUrl);

    const stamp = Date.now();
    const marker = `AGENTMA_ASK_OK_${stamp}`;
    const register = await requireOk('register', fetchJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ask Smoke',
        email: `agentma-ask-${stamp}@example.test`,
        password: 'test-password-123',
      }),
    }));
    const token = register.token;
    const model = env.SPIKE_MODEL || env.ANTHROPIC_MODEL || 'deepseek-chat';
    const provider = {
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL: model,
    };

    const chat = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            'Call AskUserQuestion exactly once before your final reply.',
            'Ask "Which output mode should I use?" with exactly two options: Brief and Detailed.',
            `After the user answers, reply exactly ${marker}:<selected label>.`,
          ].join(' '),
        }],
        systemPrompt: 'You are running a smoke test. You must use AskUserQuestion and then report the selected label exactly.',
        provider,
        tools: [askUserQuestionToolDefinition()],
      }),
    });
    if (!chat.ok) {
      const text = await chat.text().catch(() => '');
      throw new Error(`chat failed ${chat.status}: ${text}`);
    }

    const stream = await handleStream(chat, token);
    runCwd = stream.cwd;
    const audit = await fetchJson(`${baseUrl}/api/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const hasAgentRunAudit = Array.isArray(audit.body) && audit.body.some((row) => row?.action === 'agent_run');

    const checks = {
      resultSuccess: stream.resultSubtype === 'success',
      sawAskToolUse: stream.sawAskToolUse,
      sawQuestion: stream.sawQuestion,
      answeredQuestion: stream.answeredQuestion,
      sawQuestionResolved: stream.sawQuestionResolved,
      sawToolResultAnswer: stream.sawToolResultAnswer,
      finalHasMarker: stream.finalText.includes(marker),
      finalHasAnswer: stream.finalText.includes('Detailed'),
      sdkSessionRecorded: typeof stream.sdkSessionId === 'string' && stream.sdkSessionId.length > 0,
      sdkCwdRecorded: typeof stream.sdkCwd === 'string' && stream.sdkCwd.length > 0,
      auditRecorded: hasAgentRunAudit,
    };

    console.log(`checks ${JSON.stringify(checks)}`);
    console.log(`question ${stream.questionText || '-'}`);
    console.log(`final ${stream.finalText.slice(0, 300)}`);

    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    if (stream.errorMessage) failed.push(`streamError:${stream.errorMessage}`);
    if (failed.length) {
      throw new Error(`ask-user-question smoke failed: ${failed.join(', ')}`);
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
