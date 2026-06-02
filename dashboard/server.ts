import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AgentDefinition, EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import {
  addTeamMember,
  audit,
  authenticateToken,
  createApiKey,
  createTeam,
  deleteUser,
  deleteChatSession,
  forkChatSession,
  getDataLocation,
  getMe,
  getQuota,
  getQuotaUsageSummary,
  getChatSession,
  getTenantById,
  evaluateHookRules,
  evaluatePermissionRules,
  listAgentTemplates,
  listApiKeys,
  listAuditLogs,
  listChatSessions,
  listHookRules,
  listKnowledgeSources,
  listPermissionRules,
  listTeamMembers,
  listTeams,
  listUsers,
  loginUser,
  registerUser,
  removeTeamMember,
  replaceHookRules,
  replaceKnowledgeSources,
  replacePermissionRules,
  replaceAgentTemplates,
  revokeApiKey,
  saveChatSession,
  scanKnowledgeSources,
  signJWT,
  testKnowledgeSource,
  updateChatSession,
  updateQuota,
  updateTenant,
  updateUserRole,
} from './server-store.ts';
import {
  runAgent,
  createPermissionRequester,
  createAskUserQuestionRequester,
  resolvePermissionRequest,
  resolveAskUserQuestion,
} from './server-agent.ts';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '25mb' }));
app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: '上传内容超过限制，单次最多上传 20MB 文本文件' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: '请求 JSON 格式无效' });
    return;
  }
  next(error);
});
// 生产模式：serve 前端静态文件
app.use(express.static(path.join(import.meta.dirname, 'dist')));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ═══ EventSource ═══
const eventSources = new Map<string, { name: string; type: string; url: string; enabled: boolean }>();
const deployStatus = new Map<string, { status: string; message: string; started: number }>();
const sessionSubs = new Map<string, Set<string>>();
const sessionSSE = new Map<string, Set<express.Response>>();

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
}

const MAX_SKILL_MD_BYTES = 512 * 1024;
const MAX_LOCAL_SKILL_SCAN_RESULTS = 200;

function makeHttpError(message: string, status: number) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function expandLocalPath(input: string) {
  const value = input.trim();
  if (value.startsWith('file://')) {
    return new URL(value).pathname;
  }
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveLocalSkillPath(input: string) {
  const expanded = expandLocalPath(input);
  if (!expanded) throw makeHttpError('need path', 400);
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) throw makeHttpError('路径不存在', 404);

  const stat = fs.statSync(resolved);
  const skillFile = stat.isDirectory() ? path.join(resolved, 'SKILL.md') : resolved;
  const skillDir = stat.isDirectory() ? resolved : path.dirname(resolved);
  if (path.basename(skillFile) !== 'SKILL.md') {
    throw makeHttpError('请选择 SKILL.md 文件或包含 SKILL.md 的技能目录', 400);
  }
  if (!fs.existsSync(skillFile)) throw makeHttpError('目录下没有 SKILL.md', 404);

  const fileStat = fs.statSync(skillFile);
  if (!fileStat.isFile()) throw makeHttpError('SKILL.md 不是文件', 400);
  if (fileStat.size > MAX_SKILL_MD_BYTES) throw makeHttpError('SKILL.md 不能超过 512KB', 400);

  return { skillFile, skillDir };
}

function createLocalSkillInfo(skillFile: string, skillDir: string) {
  if (path.basename(skillFile) !== 'SKILL.md') {
    throw makeHttpError('请选择 SKILL.md 文件或包含 SKILL.md 的技能目录', 400);
  }
  const fileStat = fs.statSync(skillFile);
  if (!fileStat.isFile()) throw makeHttpError('SKILL.md 不是文件', 400);
  if (fileStat.size > MAX_SKILL_MD_BYTES) throw makeHttpError('SKILL.md 不能超过 512KB', 400);

  const content = fs.readFileSync(skillFile, 'utf-8');
  const frontmatterName = readFrontmatterValue(content, 'name');
  const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || '';
  const description = readFrontmatterValue(content, 'description') || title || `本地技能: ${skillDir}`;

  return {
    name: normalizeSkillName(frontmatterName || path.basename(skillDir)),
    description,
    location: 'user' as const,
    path: `${skillDir}${path.sep}`,
    enabled: true,
  };
}

function collectLocalSkillDirs(root: string, depth: number, found: Array<{ skillFile: string; skillDir: string }>) {
  if (depth > 3 || found.length >= MAX_LOCAL_SKILL_SCAN_RESULTS) return;
  const ownSkillFile = path.join(root, 'SKILL.md');
  if (fs.existsSync(ownSkillFile) && fs.statSync(ownSkillFile).isFile()) {
    found.push({ skillFile: ownSkillFile, skillDir: root });
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (found.length >= MAX_LOCAL_SKILL_SCAN_RESULTS) return;
    if (!entry.isDirectory()) continue;
    if (['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.cache'].includes(entry.name)) continue;
    collectLocalSkillDirs(path.join(root, entry.name), depth + 1, found);
  }
}

function scanLocalSkills(input: string) {
  const expanded = expandLocalPath(input);
  if (!expanded) throw makeHttpError('need path', 400);
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) throw makeHttpError('路径不存在', 404);

  const stat = fs.statSync(resolved);
  const found: Array<{ skillFile: string; skillDir: string }> = [];
  if (stat.isFile()) {
    const { skillFile, skillDir } = resolveLocalSkillPath(resolved);
    found.push({ skillFile, skillDir });
  } else if (stat.isDirectory()) {
    collectLocalSkillDirs(resolved, 0, found);
  } else {
    throw makeHttpError('路径不是文件或目录', 400);
  }

  const deduped = Array.from(new Map(found.map(item => [path.resolve(item.skillFile), item])).values());
  if (!deduped.length) throw makeHttpError('没有找到 SKILL.md', 404);
  return deduped.map(({ skillFile, skillDir }) => createLocalSkillInfo(skillFile, skillDir));
}

function readFrontmatterValue(content: string, key: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const line = match[1].split('\n').find((item) => item.trim().startsWith(`${key}:`));
  if (!line) return '';
  return line.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeSkillName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'local-skill';
}

function normalizeSubagents(value: unknown): Record<string, AgentDefinition> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([name, item]) => {
    const agentName = name.trim();
    if (!agentName || !item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';
    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
    if (!description || !prompt) return [];
    const maxTurns = Number(raw.maxTurns);
    const memory = String(raw.memory || '');
    const agent: AgentDefinition = {
      description,
      prompt,
      tools: normalizeStringArray(raw.tools),
      disallowedTools: normalizeStringArray(raw.disallowedTools),
      model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : undefined,
      skills: normalizeStringArray(raw.skills),
      initialPrompt: typeof raw.initialPrompt === 'string' && raw.initialPrompt.trim() ? raw.initialPrompt : undefined,
      maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : undefined,
      background: typeof raw.background === 'boolean' ? raw.background : undefined,
      memory: memory === 'user' || memory === 'project' || memory === 'local' ? memory : undefined,
      effort: typeof raw.effort === 'string' ? raw.effort as EffortLevel : undefined,
      permissionMode: typeof raw.permissionMode === 'string' ? raw.permissionMode as PermissionMode : undefined,
    };
    return [[agentName, agent] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

type ChatImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
type ChatImageInput = {
  mediaType: ChatImageMimeType;
  data: string;
  size: number;
};

const CHAT_IMAGE_MIME_TYPES = new Set<ChatImageMimeType>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_CHAT_IMAGES = 4;
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

function base64SizeBytes(data: string) {
  const clean = data.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function normalizeChatImages(value: unknown): { images: ChatImageInput[]; error?: string } {
  if (!Array.isArray(value)) return { images: [] };
  if (value.length > MAX_CHAT_IMAGES) return { images: [], error: `最多一次发送 ${MAX_CHAT_IMAGES} 张图片` };

  const images: ChatImageInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return { images: [], error: '图片附件格式无效' };
    const raw = item as Record<string, unknown>;
    const mediaType = String(raw.mediaType || '') as ChatImageMimeType;
    const data = String(raw.data || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (raw.type !== 'image' || !CHAT_IMAGE_MIME_TYPES.has(mediaType)) {
      return { images: [], error: '仅支持 PNG、JPEG、GIF、WebP 图片' };
    }
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return { images: [], error: '图片 base64 数据无效' };
    const size = Number(raw.size) || base64SizeBytes(data);
    if (size > MAX_CHAT_IMAGE_BYTES) return { images: [], error: '单张图片不能超过 5MB' };
    images.push({ mediaType, data, size });
  }
  return { images };
}

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

app.post('/api/chat', authMiddleware, async (req: any, res) => {
  const { prompt, messages: inputMessages, systemPrompt, provider, tools: requestTools } = req.body || {};
  const subagents = normalizeSubagents(req.body?.subagents);
  const resumeSdkSessionId = typeof req.body?.sdkSessionId === 'string' ? req.body.sdkSessionId.trim() : '';
  const sdkCwd = typeof req.body?.sdkCwd === 'string' ? req.body.sdkCwd.trim() : '';
  const enableFileCheckpointing = req.body?.enableFileCheckpointing === true;
  const useKnowledge = req.body?.useKnowledge === true;
  const knowledgeSourceIds = normalizeStringArray(req.body?.knowledgeSourceIds);
  const skills = normalizeStringArray(req.body?.skills);
  const outputSchema = req.body?.outputSchema && typeof req.body.outputSchema === 'object' && !Array.isArray(req.body.outputSchema)
    ? req.body.outputSchema as Record<string, unknown>
    : undefined;

  // Fold multi-turn history into systemPrompt so the model sees prior context.
  // When an SDK transcript id is available, resume that transcript and send
  // only the latest turn to avoid duplicating history.
  let runPrompt = '';
  let promptImages: ChatImageInput[] = [];
  let effectiveSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt : '';
  if (Array.isArray(inputMessages) && inputMessages.length) {
    const filtered: Array<{ role: string; content: string; images: ChatImageInput[] }> = [];
    for (const m of inputMessages) {
      const c = typeof m?.content === 'string' ? m.content : '';
      if (c.includes('"type":"tool_use"') || c.includes('"type":"tool_result"') || c.startsWith('[{')) continue;
      const normalizedImages = normalizeChatImages(m?.attachments);
      if (normalizedImages.error) { res.status(400).json({ error: normalizedImages.error }); return; }
      if (!c.trim() && normalizedImages.images.length === 0) continue;
      filtered.push({ role: String(m.role || 'user'), content: c, images: normalizedImages.images });
    }
    if (!filtered.length) { res.status(400).json({ error: 'no usable messages' }); return; }
    const latest = filtered[filtered.length - 1];
    runPrompt = latest.content.trim() || '请分析这些图片。';
    promptImages = latest.role === 'user' ? latest.images : [];
    if (!resumeSdkSessionId && filtered.length > 1) {
      const history = filtered.slice(0, -1).map(m => {
        const imageNote = m.images.length ? `\n[${m.role} sent ${m.images.length} image(s)]` : '';
        return `${m.role}: ${m.content}${imageNote}`;
      }).join('\n\n');
      effectiveSystemPrompt = [effectiveSystemPrompt, `[Conversation history]\n${history}`].filter(Boolean).join('\n\n');
    }
  } else if (typeof prompt === 'string' && prompt.trim()) {
    runPrompt = prompt;
  } else {
    res.status(400).json({ error: 'need prompt or messages' }); return;
  }

  const apiKey = provider?.ANTHROPIC_AUTH_TOKEN || '';
  if (!apiKey) { res.status(400).json({ error: 'no ANTHROPIC_AUTH_TOKEN' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const emit = (e: any) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch {} };

  const sessionAllow = new Set<string>();
  const requestPermission = createPermissionRequester({ emit, sessionAllow, tenantId: req.auth.tenantId });
  const requestUserQuestion = createAskUserQuestionRequester({ emit, tenantId: req.auth.tenantId });
  const toolsList = Array.isArray(requestTools) ? requestTools.map((t: any) => t?.name).filter(Boolean) : undefined;

  await runAgent({
    prompt: runPrompt,
    promptImages,
    systemPrompt: effectiveSystemPrompt || undefined,
    model: provider?.ANTHROPIC_MODEL || 'deepseek-chat',
    baseUrl: provider?.ANTHROPIC_BASE_URL,
    apiKey,
    tools: toolsList,
    requestTools: Array.isArray(requestTools) ? requestTools : undefined,
    subagents,
    skills,
    cwd: sdkCwd || undefined,
    resumeSdkSessionId: resumeSdkSessionId || undefined,
    enableFileCheckpointing: enableFileCheckpointing || undefined,
    useKnowledge: useKnowledge || knowledgeSourceIds.length > 0,
    knowledgeSourceIds,
    outputFormat: outputSchema ? { type: 'json_schema', schema: outputSchema } : undefined,
    tenantId: req.auth.tenantId,
    sub: req.auth.sub,
    emit,
    requestPermission,
    requestUserQuestion,
  });
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

app.get('/api/quota/usage', authMiddleware, (req: any, res) => {
  res.json(getQuotaUsageSummary(req.auth.tenantId));
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

// ═══ Hook Rules Routes (tenant-shared) ═══
app.get('/api/hook-rules', authMiddleware, (req: any, res) => {
  res.json(listHookRules(req.auth.tenantId));
});

app.put('/api/hook-rules', authMiddleware, requireAdmin, (req: any, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const saved = replaceHookRules(req.auth.tenantId, list);
  audit(req.auth.tenantId, 'replace_hook_rules', req.auth.sub, 'user', `hooks:${req.auth.tenantId}`, { count: saved.length });
  res.json(saved);
});

app.post('/api/hook-rules/evaluate', authMiddleware, (req: any, res) => {
  const eventName = String(req.body?.eventName || '').trim();
  if (!['PreToolUse', 'PostToolUse', 'Notification'].includes(eventName)) {
    res.status(400).json({ error: 'eventName must be PreToolUse, PostToolUse, or Notification' }); return;
  }
  const input = req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input)
    ? req.body.input
    : {};
  const decision = evaluateHookRules(req.auth.tenantId, eventName as any, input);
  res.json({
    action: decision?.action || 'none',
    reason: decision?.reason || 'no matching tenant hook rule',
    output: decision?.output || {},
    rule: decision?.rule || null,
  });
});

// ═══ Permission Rules Routes (tenant-shared) ═══
app.get('/api/permission-rules', authMiddleware, (req: any, res) => {
  res.json(listPermissionRules(req.auth.tenantId));
});

app.put('/api/permission-rules', authMiddleware, requireAdmin, (req: any, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const saved = replacePermissionRules(req.auth.tenantId, list);
  audit(req.auth.tenantId, 'replace_permission_rules', req.auth.sub, 'user', `permissions:${req.auth.tenantId}`, { count: saved.length });
  res.json(saved);
});

app.post('/api/permission-rules/evaluate', authMiddleware, (req: any, res) => {
  const toolName = String(req.body?.toolName || '').trim();
  if (!toolName) { res.status(400).json({ error: 'need toolName' }); return; }
  const input = req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input)
    ? req.body.input
    : {};
  const decision = evaluatePermissionRules(req.auth.tenantId, toolName, input);
  res.json({
    behavior: decision?.behavior || 'ask',
    reason: decision?.reason || 'no matching tenant rule',
    rule: decision?.rule || null,
  });
});

// ═══ Knowledge Sources Routes (tenant-shared) ═══
app.get('/api/knowledge/sources', authMiddleware, (req: any, res) => {
  res.json(listKnowledgeSources(req.auth.tenantId));
});

app.put('/api/knowledge/sources', authMiddleware, requireAdmin, (req: any, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  try {
    const saved = replaceKnowledgeSources(req.auth.tenantId, list);
    audit(req.auth.tenantId, 'replace_knowledge_sources', req.auth.sub, 'user', `knowledge:${req.auth.tenantId}`, { count: saved.length });
    res.json(saved);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || '保存知识库失败' });
  }
});

app.post('/api/knowledge/sources/test', authMiddleware, (req: any, res) => {
  const sourcePath = String(req.body?.path || '').trim();
  if (!sourcePath) { res.status(400).json({ error: 'need path' }); return; }
  res.json(testKnowledgeSource(sourcePath));
});

app.post('/api/knowledge/sources/scan', authMiddleware, requireAdmin, (req: any, res) => {
  try {
    const sourcePath = typeof req.body?.path === 'string' ? req.body.path : '';
    res.json(scanKnowledgeSources(sourcePath));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || '扫描知识库失败' });
  }
});

function safeUploadedKnowledgePath(input: string) {
  const normalized = input.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.').join('/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return '';
  return normalized;
}

app.post('/api/knowledge/sources/upload', authMiddleware, requireAdmin, (req: any, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!files.length) { res.status(400).json({ error: '请选择要上传的文件' }); return; }
    if (files.length > 500) { res.status(400).json({ error: '单次最多上传 500 个文件' }); return; }

    const timestamp = Date.now();
    const uploadId = crypto.randomUUID();
    const baseName = String(req.body?.name || '').trim() || `uploaded-${timestamp}`;
    const uploadRoot = path.join(getDataLocation().dataDir, 'knowledge-uploads', req.auth.tenantId, uploadId);
    let totalBytes = 0;
    fs.mkdirSync(uploadRoot, { recursive: true });

    for (const item of files) {
      const relativePath = safeUploadedKnowledgePath(String(item?.relativePath || item?.name || ''));
      const content = typeof item?.content === 'string' ? item.content : '';
      if (!relativePath) { res.status(400).json({ error: '上传文件路径无效' }); return; }
      totalBytes += Buffer.byteLength(content, 'utf8');
      if (totalBytes > 20 * 1024 * 1024) { res.status(400).json({ error: '单次上传总大小不能超过 20MB' }); return; }
      const target = path.join(uploadRoot, relativePath);
      const resolvedTarget = path.resolve(target);
      if (!resolvedTarget.startsWith(path.resolve(uploadRoot) + path.sep)) {
        res.status(400).json({ error: '上传文件路径越界' });
        return;
      }
      fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
      fs.writeFileSync(resolvedTarget, content, 'utf8');
    }

    const current = listKnowledgeSources(req.auth.tenantId);
    const saved = replaceKnowledgeSources(req.auth.tenantId, [
      ...current,
      { name: baseName.slice(0, 80), path: uploadRoot, enabled: true, readOnly: true },
    ]);
    audit(req.auth.tenantId, 'upload_knowledge_source', req.auth.sub, 'user', `knowledge:${req.auth.tenantId}`, { count: files.length, path: uploadRoot });
    res.json(saved);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || '上传知识库失败' });
  }
});

app.get('/api/knowledge/sources/scan', authMiddleware, requireAdmin, (req: any, res) => {
  try {
    const sourcePath = typeof req.query?.path === 'string' ? req.query.path : '';
    res.json(scanKnowledgeSources(sourcePath));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || '扫描知识库失败' });
  }
});

// ═══ Skills Routes ═══
app.post('/api/skills/scan-local', authMiddleware, (req: any, res) => {
  try {
    const inputPath = typeof req.body?.path === 'string' ? req.body.path : '';
    res.json({ skills: scanLocalSkills(inputPath) });
  } catch (error) {
    const err = error as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || '扫描失败' });
  }
});

app.post('/api/skills/import-local', authMiddleware, (req: any, res) => {
  try {
    const inputPath = typeof req.body?.path === 'string' ? req.body.path : '';
    const { skillFile, skillDir } = resolveLocalSkillPath(inputPath);
    const skill = createLocalSkillInfo(skillFile, skillDir);
    audit(req.auth.tenantId, 'import_local_skill', req.auth.sub, 'skill', skill.path, { name: skill.name });
    res.json(skill);
  } catch (error) {
    const err = error as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || '导入失败' });
  }
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

app.post('/api/chat-sessions/:id/fork', authMiddleware, (req: any, res) => {
  const session = forkChatSession(req.auth.tenantId, getChatOwnerSub(req.auth), req.params.id);
  if (!session) { res.status(404).json({ error: 'not found' }); return; }
  audit(req.auth.tenantId, 'copy_chat_session', req.auth.sub, 'user', `chat_session:${req.params.id}`, { copiedId: session.id });
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
  const subagents = normalizeSubagents(tmpl?.subagents);
  const knowledgeSourceIds = normalizeStringArray(tmpl?.knowledgeSourceIds);
  const skills = normalizeStringArray(tmpl?.skills);
  const apiKey = provider?.ANTHROPIC_AUTH_TOKEN || tmpl?.providerOverrides?.ANTHROPIC_AUTH_TOKEN || '';
  if (!apiKey) { res.status(400).json({ error: 'no api key' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const emit = (e: any) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch {} };

  const sessionAllow = new Set<string>();
  const requestPermission = createPermissionRequester({ emit, sessionAllow, tenantId: req.auth.tenantId });
  const requestUserQuestion = createAskUserQuestionRequester({ emit, tenantId: req.auth.tenantId });

  await runAgent({
    prompt,
    systemPrompt: typeof tmpl?.systemPrompt === 'string' ? tmpl.systemPrompt : undefined,
    model: tmpl?.providerOverrides?.ANTHROPIC_MODEL || tmpl?.model || provider?.ANTHROPIC_MODEL || 'deepseek-chat',
    baseUrl: provider?.ANTHROPIC_BASE_URL || tmpl?.providerOverrides?.ANTHROPIC_BASE_URL,
    apiKey,
    tools: Array.isArray(tmpl?.tools) ? tmpl.tools : undefined,
    subagents,
    skills,
    outputFormat: tmpl?.outputSchema ? { type: 'json_schema', schema: tmpl.outputSchema } : undefined,
    enableFileCheckpointing: tmpl?.enableFileCheckpointing === true || undefined,
    useKnowledge: tmpl?.useKnowledge === true || knowledgeSourceIds.length > 0,
    knowledgeSourceIds,
    maxTurns: Number(tmpl?.maxTurns) || 20,
    tenantId: req.auth.tenantId,
    sub: req.auth.sub,
    emit,
    requestPermission,
    requestUserQuestion,
  });
  res.end();
});

// Permission decision endpoint — the frontend POSTs allow/deny here in
// response to a `permission_request` event from the SSE stream.
app.post('/api/agents/permissions/:reqId', authMiddleware, (req: any, res) => {
  const { decision, reason, updatedInput, rememberForSession } = req.body || {};
  if (decision !== 'allow' && decision !== 'deny') {
    res.status(400).json({ error: 'decision must be "allow" or "deny"' }); return;
  }
  const result = resolvePermissionRequest(req.params.reqId, req.auth.tenantId, {
    decision, reason, updatedInput, rememberForSession,
  });
  if (!result.ok) { res.status(404).json({ error: result.reason || 'not found' }); return; }
  res.json({ ok: true });
});

// AskUserQuestion answer endpoint — the frontend POSTs structured answers here
// in response to an `ask_user_question` event from the SSE stream.
app.post('/api/agents/questions/:reqId', authMiddleware, (req: any, res) => {
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    res.status(400).json({ error: 'answers must be an object' }); return;
  }
  const cleaned: Record<string, string> = {};
  for (const [question, answer] of Object.entries(answers)) {
    if (typeof answer !== 'string') continue;
    const q = question.trim();
    if (!q) continue;
    cleaned[q] = answer.trim();
  }
  if (!Object.keys(cleaned).length) {
    res.status(400).json({ error: 'answers must include at least one string answer' }); return;
  }
  const result = resolveAskUserQuestion(req.params.reqId, req.auth.tenantId, { answers: cleaned });
  if (!result.ok) { res.status(404).json({ error: result.reason || 'not found' }); return; }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[agentma] http://localhost:${PORT}`);
  if (process.env.AGENTMA_SKIP_RECOVER !== '1') recoverDeployedServers();
});
