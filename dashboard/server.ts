import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  addTeamMember,
  audit,
  authenticateToken,
  createApiKey,
  createTeam,
  deleteUser,
  deleteChatSession,
  getMe,
  getQuota,
  getChatSession,
  getTenantById,
  listAgentTemplates,
  listApiKeys,
  listAuditLogs,
  listChatSessions,
  listTeamMembers,
  listTeams,
  listUsers,
  loginUser,
  registerUser,
  removeTeamMember,
  recordAgentRun,
  replaceAgentTemplates,
  revokeApiKey,
  saveChatSession,
  signJWT,
  updateChatSession,
  updateQuota,
  updateTenant,
  updateUserRole,
} from './server-store.ts';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
// 生产模式：serve 前端静态文件
app.use(express.static(path.join(import.meta.dirname, 'dist')));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ═══ EventSource ═══
const eventSources = new Map<string, { name: string; type: string; url: string; enabled: boolean }>();
const deployStatus = new Map<string, { status: string; message: string; started: number }>();
const sessionSubs = new Map<string, Set<string>>();
const sessionSSE = new Map<string, Set<express.Response>>();

app.get('/api/events/health', (_req, res) => res.json({ ok: true }));

app.get('/api/deploy/status/:server', (req, res) => {
  const s = deployStatus.get(req.params.server);
  res.json(s || { status: 'idle', message: '', started: 0 });
});

app.post('/api/events/sources', (req, res) => {
  const { action, source } = req.body as any;
  if (action === 'register' && source) { eventSources.set(source.name, { ...source, enabled: true }); res.json({ ok: true }); }
  else if (action === 'remove' && source) { eventSources.delete(source.name); res.json({ ok: true }); }
  else res.json(Array.from(eventSources.values()));
});

app.post('/api/sessions/:id/events/subscribe', (req, res) => {
  const { sourceName } = req.body as any;
  if (!eventSources.has(sourceName)) { res.status(404).json({ error: 'not found' }); return; }
  if (!sessionSubs.has(req.params.id)) sessionSubs.set(req.params.id, new Set());
  sessionSubs.get(req.params.id)!.add(sourceName);
  res.json({ ok: true });
});

app.get('/api/sessions/:id/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  if (!sessionSSE.has(req.params.id)) sessionSSE.set(req.params.id, new Set());
  sessionSSE.get(req.params.id)!.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: req.params.id })}\n\n`);
  console.log(`[sse] session ${req.params.id.slice(0,8)} connected (${sessionSSE.get(req.params.id)!.size} clients)`);
  req.on('close', () => {
    sessionSSE.get(req.params.id)?.delete(res);
    console.log(`[sse] session ${req.params.id.slice(0,8)} disconnected`);
  });
});

function pushToSession(sid: string, data: object) {
  const cs = sessionSSE.get(sid); if (!cs) return;
  for (const c of cs) try { c.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
}

async function startBridge(name: string) {
  const es = eventSources.get(name); if (!es) return;
  try {
    const { default: WS } = await import('ws');
    const connect = () => {
      try {
        const ws = new WS(es.url);
        ws.on('open', () => console.log('[bridge]', name, 'connected'));
        ws.on('message', (raw: Buffer) => {
          try {
            const ev = JSON.parse(raw.toString());
            let count = 0;
            for (const [sid, subs] of sessionSubs) {
              if (subs.has(name)) { pushToSession(sid, { ...ev, source: name }); count++; }
            }
            if (count > 0) console.log(`[bridge] ${name} → ${count} sessions, ev=${ev.type}`);
          } catch {}
        });
        ws.on('close', () => setTimeout(connect, 5000));
        ws.on('error', () => {});
      } catch {}
    };
    connect();
  } catch (e) { console.log('[bridge] ws not available:', (e as Error).message); }
}

// ═══ Deploy ═══
app.post('/api/deploy', async (req, res) => {
  const { server, code, tools: deployTools } = req.body as any;
  if (!server || !code) { res.status(400).json({ error: 'need server and code' }); return; }

  const dir = `/tmp/agentma-mcp-${server}`;
  const file = path.join(dir, 'server.js');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, code);

  // 杀旧进程
  try { const pid = fs.readFileSync(path.join(dir, 'pid'), 'utf-8'); process.kill(Number(pid)); } catch {}

  if (deployTools) fs.writeFileSync('/tmp/agentma_custom_tools.json', JSON.stringify(deployTools));

  // 注册 EventSource
  const firstUrl = deployTools?.find((t: any) => t.endpoint)?.endpoint?.url;
  const wsPort = firstUrl ? Number(new URL(firstUrl).port) + 1 : 3006;
  eventSources.set(server, { name: server, type: 'ws', url: `ws://localhost:${wsPort}`, enabled: true });

  console.log(`[deploy] ${server} async start, ws=:${wsPort}`);
  deployStatus.set(server, { status: 'installing', message: '安装依赖中...', started: Date.now() });
  res.json({ ok: true, status: 'deploying', file });

  // 异步安装 + 启动
  (async () => {
    if (code.includes("require('mineflayer')")) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `mcp-${server}` , version: '1.0.0', private: true }));
      if (!fs.existsSync(path.join(dir, 'node_modules/ws')) || !fs.existsSync(path.join(dir, 'node_modules/mineflayer'))) {
        try {
          await new Promise<void>((resolve, reject) => {
            const c = spawn('npm', ['install', 'mineflayer', 'mineflayer-pathfinder', 'ws'], { cwd: dir, stdio: 'pipe' });
            let out = ''; c.stdout?.on('data', d => { out += d; const pct = (out.match(/added|receive|resolv/g) || []).length; deployStatus.set(server, { status: 'installing', message: `安装中 (${pct} 包)...`, started: Date.now() }); });
            c.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
            c.on('error', reject);
          });
        } catch (e) { deployStatus.set(server, { status: 'install_failed', message: String((e as Error).message), started: Date.now() }); return; }
      }
    }
    deployStatus.set(server, { status: 'starting', message: '启动中...', started: Date.now() });
    const proc = spawn('node', [file], { cwd: dir, detached: true, stdio: 'ignore' });
    proc.unref();
    fs.writeFileSync(path.join(dir, 'pid'), String(proc.pid));
    console.log(`[deploy] ${server} pid=${proc.pid}`);

    // 等进程稳定后标记在线
    setTimeout(() => {
      deployStatus.set(server, { status: 'online', message: '已启动', started: Date.now() });
      startBridge(server);
    }, 3000);
  })();
});

// ═══ Chat (agent loop) ═══
interface ProviderConfig { ANTHROPIC_AUTH_TOKEN: string; ANTHROPIC_BASE_URL: string; ANTHROPIC_MODEL: string; }
interface ToolDef { name: string; description: string; input_schema: Record<string, unknown>; }

function normalizeAnthropicBaseUrl(rawBaseUrl?: string) {
  const fallback = 'https://api.deepseek.com/anthropic';
  const input = (rawBaseUrl || fallback).trim();
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname.endsWith('/messages')) pathname = pathname.slice(0, -'/messages'.length) || '/';

    if (host === 'api.deepseek.com') {
      const lowerPath = pathname.toLowerCase();
      const openaiLike = lowerPath === '/'
        || lowerPath === '/v1'
        || lowerPath === '/chat/completions'
        || lowerPath === '/v1/chat/completions';
      if (openaiLike || !lowerPath.startsWith('/anthropic')) pathname = '/anthropic';
    }

    url.pathname = pathname;
    return url.toString().replace(/\/$/, '');
  } catch {
    return input.replace(/\/$/, '') || fallback;
  }
}

function resolveAnthropicMessagesUrl(rawBaseUrl?: string) {
  const baseUrl = normalizeAnthropicBaseUrl(rawBaseUrl);
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (host === 'api.minimax.io' || host === 'api.minimaxi.com') {
      if (!pathname.toLowerCase().startsWith('/anthropic')) pathname = '/anthropic';
      if (!pathname.toLowerCase().endsWith('/v1')) pathname = `${pathname}/v1`;
      url.pathname = `${pathname}/messages`;
      return { baseUrl, upstreamUrl: url.toString() };
    }

    if (host === 'api.anthropic.com') {
      if (!pathname.toLowerCase().endsWith('/v1')) pathname = `${pathname === '/' ? '' : pathname}/v1`;
      url.pathname = `${pathname}/messages`;
      return { baseUrl, upstreamUrl: url.toString() };
    }

    url.pathname = `${pathname}/messages`;
    return { baseUrl, upstreamUrl: url.toString() };
  } catch {
    return { baseUrl, upstreamUrl: `${baseUrl}/messages` };
  }
}

// Wrap any custom HTTP-endpoint tools (mineflayer-* etc.) as an SDK MCP server so they
// keep working under the real Agent SDK loop. Schemas come from the request body's
// `tools` array; endpoints come from /tmp/agentma_custom_tools.json.
function buildCustomToolsMcp(requestTools: any[]) {
  if (!Array.isArray(requestTools) || !requestTools.length) return null;
  let endpoints: any[] = [];
  try { endpoints = JSON.parse(fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8')); } catch {}
  const byName: Record<string, any> = {};
  for (const e of endpoints) if (e?.endpoint && e.name) byName[e.name] = e;

  const sdkTools: any[] = [];
  for (const t of requestTools) {
    if (!t?.name || !byName[t.name]) continue;
    const ct = byName[t.name];
    const schema: Record<string, any> = {};
    for (const [k, v] of Object.entries(t.input_schema || {})) {
      let tn = String(v); const opt = tn.endsWith('?'); if (opt) tn = tn.slice(0, -1);
      let zt: any = tn === 'number' ? z.number() : tn === 'boolean' ? z.boolean() : z.string();
      if (opt) zt = zt.optional();
      schema[k] = zt;
    }
    sdkTools.push(tool(t.name, t.description || `Custom tool: ${t.name}`, schema, async (args: any) => {
      let url = ct.endpoint.url;
      let body = ct.endpoint.bodyTemplate || '{}';
      for (const [k, v] of Object.entries(args || {})) {
        url = url.replace(`{{${k}}}`, encodeURIComponent(String(v)));
        body = body.replace(`{{${k}}}`, String(v));
      }
      try {
        const r = await fetch(url, {
          method: ct.endpoint.method,
          headers: { 'Content-Type': 'application/json', ...(ct.endpoint.headers || {}) },
          body: ct.endpoint.method !== 'GET' ? body : undefined,
        });
        return { content: [{ type: 'text', text: (await r.text()).slice(0, 4000) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `err: ${(e as Error).message}` }], isError: true };
      }
    }));
  }
  if (!sdkTools.length) return null;
  return createSdkMcpServer({ name: 'custom', version: '1.0.0', tools: sdkTools });
}

app.post('/api/chat', authMiddleware, async (req: any, res) => {
  const { prompt, messages: inputMessages, systemPrompt, provider, tools: requestTools } = req.body || {};

  // Build the run prompt + effective system prompt from messages (or single prompt).
  // Multi-turn history is folded into systemPrompt so the model sees prior context.
  let runPrompt = '';
  let effectiveSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt : '';
  if (Array.isArray(inputMessages) && inputMessages.length) {
    const filtered: Array<{ role: string; content: string }> = [];
    for (const m of inputMessages) {
      const c = typeof m?.content === 'string' ? m.content : '';
      if (!c) continue;
      if (c.includes('"type":"tool_use"') || c.includes('"type":"tool_result"') || c.startsWith('[{')) continue;
      filtered.push({ role: String(m.role || 'user'), content: c });
    }
    if (!filtered.length) { res.status(400).json({ error: 'no usable messages' }); return; }
    runPrompt = filtered[filtered.length - 1].content;
    if (filtered.length > 1) {
      const history = filtered.slice(0, -1).map(m => `${m.role}: ${m.content}`).join('\n\n');
      effectiveSystemPrompt = [effectiveSystemPrompt, `[Conversation history]\n${history}`].filter(Boolean).join('\n\n');
    }
  } else if (typeof prompt === 'string' && prompt.trim()) {
    runPrompt = prompt;
  } else {
    res.status(400).json({ error: 'need prompt or messages' }); return;
  }

  const baseUrl = provider?.ANTHROPIC_BASE_URL || '';
  const apiKey = provider?.ANTHROPIC_AUTH_TOKEN || '';
  const model = provider?.ANTHROPIC_MODEL || 'deepseek-chat';
  if (!apiKey) { res.status(400).json({ error: 'no ANTHROPIC_AUTH_TOKEN' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (d: unknown) => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const customMcp = buildCustomToolsMcp(Array.isArray(requestTools) ? requestTools : []);
  // Map allowedTools: built-in names pass through; names matching a custom endpoint get mcp__custom__ prefix.
  let allowedTools: string[];
  if (Array.isArray(requestTools) && requestTools.length) {
    const customNames = new Set<string>();
    if (customMcp) {
      let endpoints: any[] = [];
      try { endpoints = JSON.parse(fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8')); } catch {}
      for (const e of endpoints) if (e?.endpoint && e.name) customNames.add(e.name);
    }
    allowedTools = requestTools
      .map((t: any) => t?.name)
      .filter(Boolean)
      .map((n: string) => customNames.has(n) ? `mcp__custom__${n}` : n);
  } else {
    allowedTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
  }

  const cwd = path.join('/tmp', `agentma-chat-${req.auth.tenantId}-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = String(v);
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  env.ANTHROPIC_API_KEY = apiKey;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const startTime = Date.now();
  let inTok = 0, outTok = 0, finalText = '', status = 'success';

  try {
    for await (const msg of query({
      prompt: runPrompt,
      options: {
        model,
        allowedTools,
        permissionMode: 'bypassPermissions',
        maxTurns: 20,
        cwd,
        settingSources: [],
        env,
        ...(customMcp ? { mcpServers: { custom: customMcp } } : {}),
        ...(effectiveSystemPrompt && effectiveSystemPrompt.trim() ? { systemPrompt: effectiveSystemPrompt } : {}),
      },
    })) {
      const m = msg as any;
      if (m.type === 'system' && m.subtype === 'init') {
        send({ type: 'system', subtype: 'init', model: m.model, tools: (m.tools || []).length, cwd });
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text) { finalText += b.text; send({ type: 'delta', text: b.text }); }
          else if (b.type === 'tool_use') send({ type: 'delta', text: `\n🔧 ${b.name}(${JSON.stringify(b.input).slice(0, 150)})\n` });
        }
      } else if (m.type === 'user') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_result') {
            const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            send({ type: 'delta', text: `📤 ${t.slice(0, 300)}\n` });
          }
        }
      } else if (m.type === 'result') {
        status = m.subtype || 'success';
        if (m.result) finalText = m.result;
        const u = m.usage || {};
        inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        outTok = u.output_tokens || 0;
      }
    }
  } catch (e) {
    status = 'error';
    send({ type: 'error', message: (e as Error).message });
  }

  const durationMs = Date.now() - startTime;
  try { recordAgentRun(req.auth.tenantId, { sub: req.auth.sub, model, durationMs, inputTokens: inTok, outputTokens: outTok, status }); } catch {}
  send({ type: 'result', subtype: status, text: finalText, usage: { input_tokens: inTok, output_tokens: outTok }, duration_ms: durationMs, model });
  res.end();
});

// 启动时恢复已部署的 MCP 服务器
function recoverDeployedServers() {
  const dirs = fs.readdirSync('/tmp', { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('agentma-mcp-'));
  for (const d of dirs) {
    const name = d.name.replace('agentma-mcp-', '');
    const serverFile = path.join('/tmp', d.name, 'server.js');
    const pidFile = path.join('/tmp', d.name, 'pid');
    if (!fs.existsSync(serverFile)) continue;

    // 读取旧 pid 检查进程是否存活
    let isAlive = false;
    try {
      const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
      try { process.kill(pid, 0); isAlive = true; } catch {}
    } catch {}

    if (!isAlive) {
      // 重启进程
      const proc = spawn('node', [serverFile], { cwd: path.join('/tmp', d.name), detached: true, stdio: 'ignore' });
      proc.unref();
      fs.writeFileSync(pidFile, String(proc.pid));
      console.log(`[recover] ${name} restarted pid=${proc.pid}`);
    }

    // 注册 EventSource
    const code = fs.readFileSync(serverFile, 'utf-8');
    const portMatch = code.match(/\.listen\((\d+)/);
    const wsPort = portMatch ? Number(portMatch[1]) + 1 : 3006;
    eventSources.set(name, { name, type: 'ws', url: `ws://localhost:${wsPort}`, enabled: true });
    console.log(`[recover] ${name} events → ws://localhost:${wsPort}`);
    setTimeout(() => startBridge(name), 2000);
  }
}

const PORT = Number(process.env.PORT || 3001);
// SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/dist')) return next();
  const indexPath = path.join(import.meta.dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else next();
});

// ═══ Account System ═══
function authMiddleware(req: any, res: any, next: any) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const auth = authenticateToken(token);
  if (!auth) { res.status(401).json({ error: '未登录' }); return; }
  req.auth = auth;
  next();
}
function requireAdmin(req: any, res: any, next: any) {
  if (req.auth.role !== 'tenant_admin') { res.status(403).json({ error: '需要管理员权限' }); return; }
  next();
}

function getChatOwnerSub(auth: { sub: string; authType: 'jwt' | 'api_key'; apiKeyId?: string }) {
  if (auth.authType === 'api_key' && auth.apiKeyId) return `api_key:${auth.apiKeyId}`;
  return auth.sub;
}

// ═══ Auth Routes ═══
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password || password.length < 6) { res.status(400).json({ error: '邮箱和密码至少 6 位' }); return; }
  const result = registerUser(name || email.split('@')[0], email, password);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const token = signJWT({ sub: result.user.email, tenantId: result.tenantId });
  res.json({ token, email: result.user.email, name: result.user.name, tenantId: result.tenantId, role: result.user.role });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = loginUser(email, password);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json({
    token: signJWT({ sub: result.user.email, tenantId: result.user.tenantId }),
    email: result.user.email,
    name: result.user.name,
    tenantId: result.user.tenantId,
    role: result.user.role,
  });
});

app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const auth = authenticateToken(token);
  if (!auth) { res.status(401).json({ error: '未登录' }); return; }
  res.json(getMe(auth));
});

// ═══ Tenant Routes ═══
app.get('/api/tenant', authMiddleware, (req: any, res) => {
  const t = getTenantById(req.auth.tenantId);
  if (!t) { res.status(404).json({ error: 'not found' }); return; }
  res.json(t);
});

app.patch('/api/tenant', authMiddleware, requireAdmin, (req: any, res) => {
  const t = updateTenant(req.auth.tenantId, { name: req.body?.name, plan: req.body?.plan });
  if (!t) { res.status(404).json({ error: 'not found' }); return; }
  audit(req.auth.tenantId, 'update_tenant', req.auth.sub, 'user', `tenant:${req.auth.tenantId}`);
  res.json(t);
});

// ═══ Users Routes ═══
app.get('/api/users', authMiddleware, (req: any, res) => {
  res.json(listUsers(req.auth.tenantId));
});

app.patch('/api/users/:email', authMiddleware, requireAdmin, (req: any, res) => {
  const role = req.body?.role;
  if (!['tenant_admin', 'team_admin', 'member'].includes(role)) { res.status(400).json({ error: 'invalid role' }); return; }
  const user = updateUserRole(req.auth.tenantId, req.params.email, role);
  if (!user) { res.status(404).json({ error: 'not found' }); return; }
  audit(req.auth.tenantId, 'update_user_role', req.auth.sub, 'user', `user:${req.params.email}`, { role: user.role });
  res.json(user);
});

app.delete('/api/users/:email', authMiddleware, requireAdmin, (req: any, res) => {
  if (req.params.email === req.auth.sub) { res.status(400).json({ error: '不能删除自己' }); return; }
  const ok = deleteUser(req.auth.tenantId, req.params.email);
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  audit(req.auth.tenantId, 'delete_user', req.auth.sub, 'user', `user:${req.params.email}`);
  res.json({ ok: true });
});

// ═══ API Keys Routes ═══
app.get('/api/api-keys', authMiddleware, (req: any, res) => {
  res.json(listApiKeys(req.auth.tenantId));
});

app.post('/api/api-keys', authMiddleware, requireAdmin, (req: any, res) => {
  if (req.auth.authType === 'api_key') { res.status(403).json({ error: 'API Key 无法创建新密钥，请使用密码登录' }); return; }
  const key = createApiKey(req.auth.tenantId, req.auth.sub, req.body?.name || 'API Key', req.body?.scopes || []);
  res.json({ ...key, rawKey: key.rawKey });
});

app.delete('/api/api-keys/:id', authMiddleware, requireAdmin, (req: any, res) => {
  const ok = revokeApiKey(req.auth.tenantId, req.params.id);
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  audit(req.auth.tenantId, 'revoke_api_key', req.auth.sub, 'user', `apikey:${req.params.id}`);
  res.json({ ok: true });
});

// ═══ Quota Routes ═══
app.get('/api/quota', authMiddleware, (req: any, res) => {
  res.json(getQuota(req.auth.tenantId));
});

app.patch('/api/quota', authMiddleware, requireAdmin, (req: any, res) => {
  const q = updateQuota(req.auth.tenantId, req.body || {});
  audit(req.auth.tenantId, 'update_quota', req.auth.sub, 'user', `quota:${req.auth.tenantId}`, req.body);
  res.json(q);
});

// ═══ Teams Routes ═══
app.post('/api/teams', authMiddleware, (req: any, res) => {
  const team = createTeam(req.auth.tenantId, req.body?.name);
  audit(req.auth.tenantId, 'create_team', req.auth.sub, 'user', `team:${team.id}`);
  res.json(team);
});

app.get('/api/teams', authMiddleware, (req: any, res) => {
  res.json(listTeams(req.auth.tenantId));
});

app.get('/api/teams/:id/members', authMiddleware, (req: any, res) => {
  const members = listTeamMembers(req.auth.tenantId, req.params.id);
  if (!members) { res.status(404).json({ error: 'not found' }); return; }
  res.json(members);
});

app.post('/api/teams/:id/members', authMiddleware, (req: any, res) => {
  const result = addTeamMember(req.auth.tenantId, req.params.id, req.body?.userId, req.body?.role || 'member');
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  audit(req.auth.tenantId, 'add_member', req.auth.sub, 'user', `team:${req.params.id}`, { userId: req.body.userId });
  res.json(result.member);
});

app.delete('/api/teams/:id/members/:userId', authMiddleware, (req: any, res) => {
  const ok = removeTeamMember(req.auth.tenantId, req.params.id, req.params.userId);
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  audit(req.auth.tenantId, 'remove_member', req.auth.sub, 'user', `team:${req.params.id}`);
  res.json({ ok: true });
});

// ═══ Audit Logs Routes ═══
app.get('/api/audit-logs', authMiddleware, (req: any, res) => {
  res.json(listAuditLogs(req.auth.tenantId));
});

// ═══ Agent Templates Routes (tenant-shared) ═══
app.get('/api/agents', authMiddleware, (req: any, res) => {
  res.json(listAgentTemplates(req.auth.tenantId));
});

app.put('/api/agents', authMiddleware, (req: any, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const saved = replaceAgentTemplates(req.auth.tenantId, list);
  audit(req.auth.tenantId, 'replace_agents', req.auth.sub, 'user', `agents:${req.auth.tenantId}`, { count: saved.length });
  res.json(saved);
});

// ═══ Chat Sessions Routes ═══
app.get('/api/chat-sessions', authMiddleware, (req: any, res) => {
  res.json(listChatSessions(req.auth.tenantId, getChatOwnerSub(req.auth)));
});

app.get('/api/chat-sessions/:id', authMiddleware, (req: any, res) => {
  const session = getChatSession(req.auth.tenantId, getChatOwnerSub(req.auth), req.params.id);
  if (!session) { res.status(404).json({ error: 'not found' }); return; }
  res.json(session);
});

app.post('/api/chat-sessions', authMiddleware, (req: any, res) => {
  const result = saveChatSession(req.auth.tenantId, getChatOwnerSub(req.auth), req.body || {});
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.session);
});

app.patch('/api/chat-sessions/:id', authMiddleware, (req: any, res) => {
  const session = updateChatSession(req.auth.tenantId, getChatOwnerSub(req.auth), req.params.id, req.body || {});
  if (!session) { res.status(404).json({ error: 'not found' }); return; }
  res.json(session);
});

app.delete('/api/chat-sessions/:id', authMiddleware, (req: any, res) => {
  const ok = deleteChatSession(req.auth.tenantId, getChatOwnerSub(req.auth), req.params.id);
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

// ═══ Agent Run (real SDK execution; P1 first slice) ═══
app.post('/api/agents/run', authMiddleware, async (req: any, res) => {
  const { prompt, template, provider } = req.body || {};
  if (!prompt || typeof prompt !== 'string') { res.status(400).json({ error: 'need prompt' }); return; }
  const tmpl = template || {};
  const baseUrl = provider?.ANTHROPIC_BASE_URL || tmpl?.providerOverrides?.ANTHROPIC_BASE_URL || '';
  const apiKey = provider?.ANTHROPIC_AUTH_TOKEN || tmpl?.providerOverrides?.ANTHROPIC_AUTH_TOKEN || '';
  const model = tmpl?.providerOverrides?.ANTHROPIC_MODEL || tmpl?.model || provider?.ANTHROPIC_MODEL || 'deepseek-chat';
  if (!apiKey) { res.status(400).json({ error: 'no api key' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (d: unknown) => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  // P1: per-run scratch cwd. Real container isolation = P3.
  const cwd = path.join('/tmp', `agentma-run-${req.auth.tenantId}-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });

  // Per-call env (concurrency-safe; never mutate process.env)
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = String(v);
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  env.ANTHROPIC_API_KEY = apiKey;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const allowedTools: string[] = (Array.isArray(tmpl?.tools) && tmpl.tools.length) ? tmpl.tools : ['Read', 'Bash'];
  const startTime = Date.now();
  let inTok = 0, outTok = 0, finalText = '', status = 'success';

  try {
    for await (const msg of query({
      prompt,
      options: {
        model,
        allowedTools,
        permissionMode: 'bypassPermissions',  // P1: no interactive approver server-side. Real canUseTool = P2.
        maxTurns: Number(tmpl?.maxTurns) || 20,
        cwd,
        settingSources: [],   // isolate from host ~/.claude (multi-tenant safety)
        env,
        ...(typeof tmpl?.systemPrompt === 'string' && tmpl.systemPrompt.trim() ? { systemPrompt: tmpl.systemPrompt } : {}),
      },
    })) {
      const m = msg as any;
      if (m.type === 'system' && m.subtype === 'init') {
        send({ type: 'system', subtype: 'init', model: m.model, tools: (m.tools || []).length, cwd });
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text) { finalText += b.text; send({ type: 'delta', text: b.text }); }
          else if (b.type === 'tool_use') send({ type: 'delta', text: `\n🔧 ${b.name}(${JSON.stringify(b.input).slice(0, 150)})\n` });
        }
      } else if (m.type === 'user') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_result') {
            const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            send({ type: 'delta', text: `📤 ${t.slice(0, 300)}\n` });
          }
        }
      } else if (m.type === 'result') {
        status = m.subtype || 'success';
        if (m.result) finalText = m.result;
        const u = m.usage || {};
        inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        outTok = u.output_tokens || 0;
      }
    }
  } catch (e) {
    status = 'error';
    send({ type: 'error', message: (e as Error).message });
  }

  const durationMs = Date.now() - startTime;
  try { recordAgentRun(req.auth.tenantId, { sub: req.auth.sub, model, durationMs, inputTokens: inTok, outputTokens: outTok, status }); } catch {}
  send({ type: 'result', subtype: status, text: finalText, usage: { input_tokens: inTok, output_tokens: outTok }, duration_ms: durationMs, model });
  res.end();
});

app.listen(PORT, () => {
  console.log(`[agentma] http://localhost:${PORT}`);
  recoverDeployedServers();
});
