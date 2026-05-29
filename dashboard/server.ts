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
  replaceAgentTemplates,
  revokeApiKey,
  saveChatSession,
  signJWT,
  updateChatSession,
  updateQuota,
  updateTenant,
  updateUserRole,
} from './server-store.ts';

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

app.post('/api/chat', async (req, res) => {
  const { prompt, messages: inputMessages, systemPrompt, provider, tools } = req.body as any;

  type Msg = { role: string; content: unknown };
  const convMsgs: Msg[] = [];
  if (inputMessages?.length) {
    for (const m of inputMessages) {
      const c = typeof m.content === 'string' ? m.content : '';
      // 跳过包含工具调用痕迹的消息（这些是上次 agent loop 的中间产物）
      if (!c) continue;
      if (c.includes('"type":"tool_use"') || c.includes('"type":"tool_result"') || c.includes('[调用工具:') || c.includes('[工具 ') || c.startsWith('[{')) continue;
      convMsgs.push({ role: m.role, content: c });
    }
  } else if (prompt) {
    convMsgs.push({ role: 'user', content: prompt });
  } else { res.status(400).json({ error: 'need prompt or messages' }); return; }

  if (systemPrompt) {
    const idx = convMsgs.findIndex(m => m.role === 'user');
    if (idx >= 0) convMsgs[idx] = { role: 'user', content: `[System]\n${systemPrompt}\n\n${convMsgs[idx].content}` };
  }

  const { baseUrl, upstreamUrl } = resolveAnthropicMessagesUrl(provider?.ANTHROPIC_BASE_URL);
  const model = provider?.ANTHROPIC_MODEL || 'deepseek-v4-pro[1m]';
  const apiKey = provider?.ANTHROPIC_AUTH_TOKEN || '';
  if (!apiKey) { res.status(400).json({ error: 'no ANTHROPIC_AUTH_TOKEN' }); return; }

  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'system', subtype: 'init', model, tools: (tools || []).map((t: any) => t.name) });

  const startTime = Date.now();
  let totalText = '', totalIn = 0, totalOut = 0;
  const MAX = 10;

  // 加载自定义工具 endpoint
  let customTools: any[] = [];
  try { customTools = JSON.parse(fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8')); } catch {}

  for (let loop = 0; loop < MAX; loop++) {
    const body: any = { model, max_tokens: 4096, stream: true, messages: convMsgs };
    if (tools?.length) {
      body.tools = tools.map((t: any) => {
        const raw = t.input_schema || {};
        const props: any = {}; const req: string[] = [];
        for (const [k, v] of Object.entries(raw)) {
          let tn = String(v); if (tn.endsWith('?')) { tn = tn.slice(0, -1); } else req.push(k);
          props[k] = { type: tn === 'number' ? 'number' : tn === 'boolean' ? 'boolean' : 'string' };
        }
        return { name: t.name, description: t.description, input_schema: { type: 'object', properties: props, required: req } };
      });
    }

    const apiRes = await fetch(upstreamUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (!apiRes.ok) {
      const e = await apiRes.text();
      const hint = apiRes.status === 404 ? `；上游地址=${upstreamUrl}` : '';
      send({ type: 'error', message: `API ${apiRes.status}: ${e.slice(0, 500)}${hint}` });
      res.end();
      return;
    }

    const reader = apiRes.body?.getReader(); if (!reader) { send({ type: 'error', message: 'no body' }); res.end(); return; }
    const dec = new TextDecoder(); let buf = '';
    const blocks: any[] = [];
    let cur: any = null, streamText = '';

    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue; const j = line.slice(6).trim(); if (!j || j === '[DONE]') continue;
        try {
          const ev = JSON.parse(j);
          if (ev.type === 'content_block_start') {
            const cb = ev.content_block || {};
            cur = { type: cb.type || 'text', id: cb.id, name: cb.name };
          }
          else if (ev.type === 'content_block_delta') {
            const d = ev.delta;
            if (d?.type === 'text_delta' && cur) { cur.text = (cur.text || '') + (d.text || ''); streamText += d.text || ''; send({ type: 'delta', text: d.text || '' }); }
            else if (d?.type === 'thinking_delta') send({ type: 'delta', text: d.thinking || '', thinking: true });
            else if (d?.type === 'input_json_delta' && cur) cur.input = (cur.input || '') + (d.partial_json || '');
          } else if (ev.type === 'content_block_stop' && cur) {
            const saved: any = { type: cur.type, text: cur.text, id: cur.id, name: cur.name, input: cur.input };
            if (cur.type === 'tool_use' && cur.input) { try { saved.input = JSON.parse(cur.input as string); } catch { saved.input = {}; } }
            blocks.push(saved); cur = null;
          } else if (ev.type === 'message_start') totalIn += ev.message?.usage?.input_tokens || 0;
          else if (ev.type === 'message_delta') totalOut += ev.usage?.output_tokens || 0;
        } catch {}
      }
    }

    totalText += streamText;
    const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use');
    if (toolBlocks.length === 0) break;

    // assistant msg（保留 thinking 块，DeepSeek 要求回传）
    const ac = blocks.map((b: any) => {
      if (b.type === 'text') return { type: 'text', text: b.text || '' };
      if (b.type === 'thinking') return { type: 'thinking', thinking: b.text || '' };
      if (!b.name) return { type: 'text', text: `[unknown tool]` };
      return { type: 'tool_use', id: b.id || `toolu_${Date.now()}`, name: b.name, input: b.input || {} };
    });
    convMsgs.push({ role: 'assistant', content: ac });

    const toolResults: any[] = [];
    for (const tb of toolBlocks) {
      send({ type: 'delta', text: `\n🔧 ${tb.name}(${JSON.stringify(tb.input).slice(0, 120)})\n` });
      const ct = customTools.find((c: any) => c.name === tb.name);
      let result = '';
      if (ct?.endpoint) {
        try {
          let url = ct.endpoint.url; let rbody = ct.endpoint.bodyTemplate || '{}';
          for (const [k, v] of Object.entries(tb.input || {})) { url = url.replace(`{{${k}}}` , encodeURIComponent(String(v))); rbody = rbody.replace(`{{${k}}}`, String(v)); }
          const r = await fetch(url, { method: ct.endpoint.method, headers: { 'Content-Type': 'application/json', ...(ct.endpoint.headers || {}) }, body: ct.endpoint.method !== 'GET' ? rbody : undefined });
          result = await r.text();
        } catch (e) { result = `err: ${(e as Error).message}`; }
      } else { result = `[builtin] ${tb.name} called: ${JSON.stringify(tb.input)}`; }
      send({ type: 'delta', text: `📤 ${result.slice(0, 200)}\n` });
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result.slice(0, 1000) });
    }
    // 所有 tool_result 放入同一个 user 消息（Anthropic 协议要求）
    convMsgs.push({ role: 'user', content: toolResults });
  }

  const dur = Date.now() - startTime;
  send({ type: 'result', subtype: 'success', text: totalText, duration_ms: dur, stop_reason: 'end_turn', usage: { input_tokens: totalIn, output_tokens: totalOut }, model });
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

// ═══ Auth Routes ═══
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password || password.length < 6) { res.status(400).json({ error: '邮箱和密码至少 6 位' }); return; }
  const result = registerUser(name || email.split('@')[0], email, password);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const token = signJWT({ sub: result.user.email, tenantId: result.tenantId });
  res.json({ token, email: result.user.email, name: result.user.name, tenantId: result.tenantId });
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
  res.json(listChatSessions(req.auth.tenantId, req.auth.sub));
});

app.get('/api/chat-sessions/:id', authMiddleware, (req: any, res) => {
  const session = getChatSession(req.auth.tenantId, req.auth.sub, req.params.id);
  if (!session) { res.status(404).json({ error: 'not found' }); return; }
  res.json(session);
});

app.post('/api/chat-sessions', authMiddleware, (req: any, res) => {
  const result = saveChatSession(req.auth.tenantId, req.auth.sub, req.body || {});
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result.session);
});

app.patch('/api/chat-sessions/:id', authMiddleware, (req: any, res) => {
  const session = updateChatSession(req.auth.tenantId, req.auth.sub, req.params.id, req.body || {});
  if (!session) { res.status(404).json({ error: 'not found' }); return; }
  res.json(session);
});

app.delete('/api/chat-sessions/:id', authMiddleware, (req: any, res) => {
  const ok = deleteChatSession(req.auth.tenantId, req.auth.sub, req.params.id);
  if (!ok) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[agentma] http://localhost:${PORT}`);
  recoverDeployedServers();
});
