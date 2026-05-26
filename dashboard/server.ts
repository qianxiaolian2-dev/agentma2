import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

  const baseUrl = (provider?.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic').replace(/\/$/, '');
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

    const apiRes = await fetch(`${baseUrl}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (!apiRes.ok) { const e = await apiRes.text(); send({ type: 'error', message: `API ${apiRes.status}: ${e.slice(0, 500)}` }); res.end(); return; }

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

const PORT = 3001;
// SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/dist')) return next();
  const indexPath = path.join(import.meta.dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else next();
});

// ═══ Account System ═══
import crypto from 'node:crypto';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function hashPw(pw: string) { return crypto.createHash('sha256').update(pw + 'agentma').digest('hex'); }

function loadStore<T>(file: string, def: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return def; }
}
function saveStore(file: string, data: any) { fs.writeFileSync(file, JSON.stringify(data)); }

function signJWT(obj: object): string {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(Date.now()/1000) + 7*86400 })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url')}`;
}
function verifyJWT(t: string): any {
  const [h, b, s] = t.split('.'); if (!h || !b || !s) return null;
  if (crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  return p.exp > Math.floor(Date.now()/1000) ? p : null;
}
function authMiddleware(req: any, res: any, next: any) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const p = verifyJWT(t);
  if (!p) { res.status(401).json({ error: '未登录' }); return; }
  req.auth = p;
  next();
}
function requireAdmin(req: any, res: any, next: any) {
  const users = loadStore<Record<string, any>>('/tmp/agentma_users.json', {});
  const u = users[req.auth.sub];
  if (!u || u.role !== 'tenant_admin') { res.status(403).json({ error: '需要管理员权限' }); return; }
  next();
}

// Data stores
type UserRow = { email: string; name: string; passwordHash: string; tenantId: string; role: string; createdAt: number };
type TenantRow = { id: string; name: string; region: string; plan: string; status: string; createdAt: number };
type QuotaRow = { tenantId: string; monthlyActiveSecondsLimit: number; monthlyActiveSecondsUsed: number; weeklyRunCountLimit: number; weeklyRunCountUsed: number; maxConcurrentRuns: number; perRunMaxActiveHours: number; perRunMaxWallClockHours: number; perRunMaxLlmTokens: number; perRunMaxToolCalls: number };
type ApiKeyRow = { id: string; tenantId: string; name: string; keyHash: string; keyPrefix: string; scopes: string[]; createdBy: string; createdAt: number; revokedAt: number | null };
type TeamRow = { id: string; tenantId: string; name: string; createdAt: number };
type MemberRow = { teamId: string; userId: string; role: string };
type AuditRow = { id: string; tenantId: string; action: string; actor: string; actorType: string; resource: string; diff: any; createdAt: number };

function audit(tenantId: string, action: string, actor: string, actorType: string, resource: string, diff?: any) {
  const logs = loadStore<AuditRow[]>('/tmp/agentma_audit.json', []);
  logs.unshift({ id: crypto.randomUUID(), tenantId, action, actor, actorType, resource, diff, createdAt: Date.now() });
  if (logs.length > 1000) logs.length = 1000;
  saveStore('/tmp/agentma_audit.json', logs);
}

// ═══ Auth Routes ═══
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password || password.length < 6) { res.status(400).json({ error: '邮箱和密码至少 6 位' }); return; }
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  if (Object.values(users).find((u: any) => u.email === email)) { res.status(409).json({ error: '邮箱已注册' }); return; }
  const tenantId = crypto.randomUUID();
  users[email] = { email, name: name || email.split('@')[0], passwordHash: hashPw(password), tenantId, role: 'tenant_admin', createdAt: Date.now() };
  saveStore('/tmp/agentma_users.json', users);
  // Create tenant
  const tenants = loadStore<Record<string, TenantRow>>('/tmp/agentma_tenants.json', {});
  tenants[tenantId] = { id: tenantId, name: `${name || email}'s Workspace`, region: 'us', plan: 'free', status: 'active', createdAt: Date.now() };
  saveStore('/tmp/agentma_tenants.json', tenants);
  // Create quotas
  const quotas = loadStore<Record<string, QuotaRow>>('/tmp/agentma_quotas.json', {});
  quotas[tenantId] = { tenantId, monthlyActiveSecondsLimit: 36000, monthlyActiveSecondsUsed: 0, weeklyRunCountLimit: 50, weeklyRunCountUsed: 0, maxConcurrentRuns: 3, perRunMaxActiveHours: 4, perRunMaxWallClockHours: 6, perRunMaxLlmTokens: 5000000, perRunMaxToolCalls: 10000 };
  saveStore('/tmp/agentma_quotas.json', quotas);
  const token = signJWT({ sub: email, tenantId });
  audit(tenantId, 'register', email, 'user', `tenant:${tenantId}`);
  res.json({ token, email, name: name || email.split('@')[0], tenantId });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  const u = users[email];
  if (!u || u.passwordHash !== hashPw(password)) { res.status(401).json({ error: '邮箱或密码错误' }); return; }
  audit(u.tenantId, 'login', email, 'user', `user:${email}`);
  res.json({ token: signJWT({ sub: email, tenantId: u.tenantId }), email: u.email, name: u.name, tenantId: u.tenantId });
});

app.get('/api/auth/me', (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const p = verifyJWT(t);
  if (!p) { res.status(401).json({ error: '未登录' }); return; }
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  const u = users[p.sub];
  const tenants = loadStore<Record<string, TenantRow>>('/tmp/agentma_tenants.json', {});
  const tnt = tenants[p.tenantId];
  res.json({ email: p.sub, tenantId: p.tenantId, name: u?.name, role: u?.role, plan: tnt?.plan, region: tnt?.region });
});

// ═══ Tenant Routes ═══
app.get('/api/tenant', authMiddleware, (req: any, res) => {
  const tenants = loadStore<Record<string, TenantRow>>('/tmp/agentma_tenants.json', {});
  const t = tenants[req.auth.tenantId];
  if (!t) { res.status(404).json({ error: 'not found' }); return; }
  res.json(t);
});

app.patch('/api/tenant', authMiddleware, requireAdmin, (req: any, res) => {
  const tenants = loadStore<Record<string, TenantRow>>('/tmp/agentma_tenants.json', {});
  const t = tenants[req.auth.tenantId];
  if (!t) { res.status(404).json({ error: 'not found' }); return; }
  const { name, plan } = req.body || {};
  if (name) t.name = name;
  if (plan && ['free', 'pro', 'enterprise'].includes(plan)) t.plan = plan;
  saveStore('/tmp/agentma_tenants.json', tenants);
  audit(req.auth.tenantId, 'update_tenant', req.auth.sub, 'user', `tenant:${req.auth.tenantId}`);
  res.json(t);
});

// ═══ Users Routes ═══
app.get('/api/users', authMiddleware, (req: any, res) => {
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  const list = Object.values(users).filter((u: any) => u.tenantId === req.auth.tenantId).map(({ passwordHash, ...u }) => u);
  res.json(list);
});

app.patch('/api/users/:email', authMiddleware, requireAdmin, (req: any, res) => {
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  const u = users[req.params.email];
  if (!u || u.tenantId !== req.auth.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  if (req.body.role) u.role = req.body.role;
  saveStore('/tmp/agentma_users.json', users);
  audit(req.auth.tenantId, 'update_user_role', req.auth.sub, 'user', `user:${req.params.email}`, { role: u.role });
  const { passwordHash, ...rest } = u;
  res.json(rest);
});

app.delete('/api/users/:email', authMiddleware, requireAdmin, (req: any, res) => {
  if (req.params.email === req.auth.sub) { res.status(400).json({ error: '不能删除自己' }); return; }
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  const u = users[req.params.email];
  if (!u || u.tenantId !== req.auth.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  delete users[req.params.email];
  saveStore('/tmp/agentma_users.json', users);
  audit(req.auth.tenantId, 'delete_user', req.auth.sub, 'user', `user:${req.params.email}`);
  res.json({ ok: true });
});

// ═══ API Keys Routes ═══
app.get('/api/api-keys', authMiddleware, (req: any, res) => {
  const keys = loadStore<ApiKeyRow[]>('/tmp/agentma_apikeys.json', []);
  res.json(keys.filter(k => k.tenantId === req.auth.tenantId && !k.revokedAt).map(({ keyHash, ...k }) => k));
});

app.post('/api/api-keys', authMiddleware, requireAdmin, (req: any, res) => {
  const raw = `sk-tenant_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const key: ApiKeyRow = {
    id: crypto.randomUUID(), tenantId: req.auth.tenantId, name: req.body.name || 'API Key',
    keyHash: hash, keyPrefix: raw.slice(0, 18) + '...', scopes: req.body.scopes || [],
    createdBy: req.auth.sub, createdAt: Date.now(), revokedAt: null,
  };
  const keys = loadStore<ApiKeyRow[]>('/tmp/agentma_apikeys.json', []);
  keys.push(key);
  saveStore('/tmp/agentma_apikeys.json', keys);
  audit(req.auth.tenantId, 'create_api_key', req.auth.sub, 'user', `apikey:${key.id}`);
  res.json({ ...key, rawKey: raw });
});

app.delete('/api/api-keys/:id', authMiddleware, requireAdmin, (req: any, res) => {
  const keys = loadStore<ApiKeyRow[]>('/tmp/agentma_apikeys.json', []);
  const k = keys.find(k => k.id === req.params.id && k.tenantId === req.auth.tenantId);
  if (!k) { res.status(404).json({ error: 'not found' }); return; }
  k.revokedAt = Date.now();
  saveStore('/tmp/agentma_apikeys.json', keys);
  audit(req.auth.tenantId, 'revoke_api_key', req.auth.sub, 'user', `apikey:${k.id}`);
  res.json({ ok: true });
});

// ═══ Quota Routes ═══
app.get('/api/quota', authMiddleware, (req: any, res) => {
  const quotas = loadStore<Record<string, QuotaRow>>('/tmp/agentma_quotas.json', {});
  const q = quotas[req.auth.tenantId] || { tenantId: req.auth.tenantId, monthlyActiveSecondsLimit: 36000, monthlyActiveSecondsUsed: 0, weeklyRunCountLimit: 50, weeklyRunCountUsed: 0, maxConcurrentRuns: 3, perRunMaxActiveHours: 4, perRunMaxWallClockHours: 6 };
  res.json(q);
});

app.patch('/api/quota', authMiddleware, requireAdmin, (req: any, res) => {
  const quotas = loadStore<Record<string, QuotaRow>>('/tmp/agentma_quotas.json', {});
  const q = quotas[req.auth.tenantId];
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  const fields = ['monthlyActiveSecondsLimit', 'weeklyRunCountLimit', 'maxConcurrentRuns', 'perRunMaxActiveHours', 'perRunMaxWallClockHours', 'perRunMaxLlmTokens', 'perRunMaxToolCalls'];
  for (const f of fields) if (req.body[f] !== undefined) (q as any)[f] = Number(req.body[f]);
  saveStore('/tmp/agentma_quotas.json', quotas);
  audit(req.auth.tenantId, 'update_quota', req.auth.sub, 'user', `quota:${req.auth.tenantId}`, req.body);
  res.json(q);
});

// ═══ Teams Routes ═══
app.post('/api/teams', authMiddleware, (req: any, res) => {
  const teams = loadStore<TeamRow[]>('/tmp/agentma_teams.json', []);
  const team: TeamRow = { id: crypto.randomUUID(), tenantId: req.auth.tenantId, name: req.body.name, createdAt: Date.now() };
  teams.push(team);
  saveStore('/tmp/agentma_teams.json', teams);
  audit(req.auth.tenantId, 'create_team', req.auth.sub, 'user', `team:${team.id}`);
  res.json(team);
});

app.get('/api/teams', authMiddleware, (req: any, res) => {
  const teams = loadStore<TeamRow[]>('/tmp/agentma_teams.json', []);
  const members = loadStore<MemberRow[]>('/tmp/agentma_members.json', []);
  res.json(teams.filter(t => t.tenantId === req.auth.tenantId).map(t => ({ ...t, memberCount: members.filter(m => m.teamId === t.id).length })));
});

app.get('/api/teams/:id/members', authMiddleware, (req: any, res) => {
  const members = loadStore<MemberRow[]>('/tmp/agentma_members.json', []);
  const users = loadStore<Record<string, UserRow>>('/tmp/agentma_users.json', {});
  res.json(members.filter(m => m.teamId === req.params.id).map(m => ({ ...m, email: m.userId, name: users[m.userId]?.name || m.userId })));
});

app.post('/api/teams/:id/members', authMiddleware, (req: any, res) => {
  const members = loadStore<MemberRow[]>('/tmp/agentma_members.json', []);
  if (members.find(m => m.teamId === req.params.id && m.userId === req.body.userId)) { res.status(409).json({ error: '已存在' }); return; }
  const m: MemberRow = { teamId: req.params.id, userId: req.body.userId, role: req.body.role || 'member' };
  members.push(m);
  saveStore('/tmp/agentma_members.json', members);
  audit(req.auth.tenantId, 'add_member', req.auth.sub, 'user', `team:${req.params.id}`, { userId: req.body.userId });
  res.json(m);
});

app.delete('/api/teams/:id/members/:userId', authMiddleware, (req: any, res) => {
  let members = loadStore<MemberRow[]>('/tmp/agentma_members.json', []);
  members = members.filter(m => !(m.teamId === req.params.id && m.userId === req.params.userId));
  saveStore('/tmp/agentma_members.json', members);
  audit(req.auth.tenantId, 'remove_member', req.auth.sub, 'user', `team:${req.params.id}`);
  res.json({ ok: true });
});

// ═══ Audit Logs Routes ═══
app.get('/api/audit-logs', authMiddleware, (req: any, res) => {
  const logs = loadStore<AuditRow[]>('/tmp/agentma_audit.json', []);
  const filtered = logs.filter(l => l.tenantId === req.auth.tenantId).slice(0, 50);
  res.json(filtered);
});

app.listen(PORT, () => {
  console.log(`[agentma] http://localhost:${PORT}`);
  recoverDeployedServers();
});
