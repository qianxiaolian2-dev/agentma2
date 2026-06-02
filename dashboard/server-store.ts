import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

export type Role = 'tenant_admin' | 'team_admin' | 'member';

export type AuthIdentity = {
  sub: string;
  tenantId: string;
  role: Role | null;
  authType: 'jwt' | 'api_key';
  apiKeyId?: string;
};

export type UserRow = {
  email: string;
  name: string;
  tenantId: string;
  role: Role;
  createdAt: number;
};

export type TenantRow = {
  id: string;
  name: string;
  region: string;
  plan: string;
  status: string;
  createdAt: number;
};

export type QuotaRow = {
  tenantId: string;
  monthlyActiveSecondsLimit: number;
  monthlyActiveSecondsUsed: number;
  weeklyRunCountLimit: number;
  weeklyRunCountUsed: number;
  maxConcurrentRuns: number;
  perRunMaxActiveHours: number;
  perRunMaxWallClockHours: number;
  perRunMaxLlmTokens: number;
  perRunMaxToolCalls: number;
};

export type QuotaUsageRun = {
  id: string;
  actor: string;
  model: string;
  status: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  createdAt: number;
};

export type QuotaUsageSummary = {
  quota: QuotaRow;
  usage: {
    monthlyActiveSeconds: { used: number; limit: number; percent: number };
    weeklyRunCount: { used: number; limit: number; percent: number };
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    totalDurationMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    lastRunAt: number | null;
  };
  recentRuns: QuotaUsageRun[];
};

export type ApiKeyRow = {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: string | null;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
};

export type TeamRow = {
  id: string;
  tenantId: string;
  name: string;
  createdAt: number;
};

export type MemberRow = {
  teamId: string;
  userId: string;
  email: string;
  name: string;
  role: string;
};

export type AuditRow = {
  id: string;
  tenantId: string;
  action: string;
  actor: string;
  actorType: string;
  resource: string;
  diff: unknown;
  createdAt: number;
};

export type PermissionRuleBehavior = 'allow' | 'deny';

export type PermissionRuleRow = {
  id: string;
  tenantId: string;
  toolName: string;
  ruleContent: string;
  behavior: PermissionRuleBehavior;
  enabled: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type PermissionRuleDecision = {
  behavior: PermissionRuleBehavior;
  rule: PermissionRuleRow;
  reason: string;
};

export type HookRuleEvent = 'PreToolUse' | 'PostToolUse' | 'Notification';
export type HookRuleAction = 'allow' | 'block' | 'context' | 'log';

export type HookRuleRow = {
  id: string;
  tenantId: string;
  eventName: HookRuleEvent;
  matcher: string;
  ruleContent: string;
  action: HookRuleAction;
  message: string;
  enabled: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type HookRuleDecision = {
  action: HookRuleAction;
  rule: HookRuleRow;
  reason: string;
  output: Record<string, unknown>;
};

export type ChatHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatHistoryAttachment[];
  timestamp: number;
};

export type ChatHistoryAttachment = {
  id: string;
  type: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
  name?: string;
  size: number;
};

export type ChatHistorySession = {
  id: string;
  templateId: string;
  title: string;
  messages: ChatHistoryMessage[];
  model: string;
  sdkSessionId?: string;
  sdkCwd?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeSourceRow = {
  id: string;
  tenantId: string;
  name: string;
  path: string;
  readOnly: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeSourceTestResult = {
  ok: boolean;
  reason?: string;
  fileCount?: number;
  sampleFiles?: string[];
};

export type KnowledgeSourceCandidate = {
  name: string;
  path: string;
  fileCount: number;
  sampleFiles: string[];
};

const LEGACY_PREFIX = 'legacy_sha256$';
const DEFAULT_QUOTA = {
  monthlyActiveSecondsLimit: 36000,
  monthlyActiveSecondsUsed: 0,
  weeklyRunCountLimit: 50,
  weeklyRunCountUsed: 0,
  maxConcurrentRuns: 3,
  perRunMaxActiveHours: 4,
  perRunMaxWallClockHours: 6,
  perRunMaxLlmTokens: 5000000,
  perRunMaxToolCalls: 10000,
};

const DATA_DIR = process.env.AGENTMA_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'agentma2');
const DB_PATH = path.join(DATA_DIR, 'dashboard.sqlite');
const JWT_SECRET_PATH = path.join(DATA_DIR, 'jwt-secret');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

initSchema();
migrateLegacyJson();

const JWT_SECRET = process.env.JWT_SECRET || readOrCreateSecret();

function ensureColumn(tableName: string, columnName: string, definition: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(columnName)) return;
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      created_by TEXT REFERENCES users(email) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys (tenant_id);

    CREATE TABLE IF NOT EXISTS quotas (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      monthly_active_seconds_limit INTEGER NOT NULL,
      monthly_active_seconds_used INTEGER NOT NULL,
      weekly_run_count_limit INTEGER NOT NULL,
      weekly_run_count_used INTEGER NOT NULL,
      max_concurrent_runs INTEGER NOT NULL,
      per_run_max_active_hours INTEGER NOT NULL,
      per_run_max_wall_clock_hours INTEGER NOT NULL,
      per_run_max_llm_tokens INTEGER NOT NULL,
      per_run_max_tool_calls INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teams_tenant_id ON teams (tenant_id);

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      role TEXT NOT NULL,
      PRIMARY KEY (team_id, user_email)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      resource TEXT NOT NULL,
      diff_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id_created_at ON audit_logs (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      owner_sub TEXT NOT NULL,
      template_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      sdk_session_id TEXT,
      sdk_cwd TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_updated_at ON chat_sessions (tenant_id, owner_sub, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq ON chat_messages (session_id, seq);

    CREATE TABLE IF NOT EXISTS permission_rules (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      rule_content TEXT NOT NULL DEFAULT '',
      behavior TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_permission_rules_tenant_position ON permission_rules (tenant_id, position ASC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS hook_rules (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      matcher TEXT NOT NULL DEFAULT '',
      rule_content TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_hook_rules_tenant_position ON hook_rules (tenant_id, position ASC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_sources_tenant ON knowledge_sources (tenant_id);
  `);
  ensureColumn('chat_sessions', 'sdk_session_id', 'TEXT');
  ensureColumn('chat_sessions', 'sdk_cwd', 'TEXT');
  ensureColumn('chat_messages', 'attachments_json', 'TEXT');
}

function readOrCreateSecret() {
  try {
    const secret = fs.readFileSync(JWT_SECRET_PATH, 'utf-8').trim();
    if (secret) return secret;
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(JWT_SECRET_PATH, secret);
  return secret;
}

function hasImportedLegacyJson() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('legacy_json_imported_v1') as { value: string } | undefined;
  return row?.value === '1';
}

function setImportedLegacyJson() {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('legacy_json_imported_v1', '1');
}

function migrateLegacyJson() {
  if (hasImportedLegacyJson()) return;

  const legacyUsers = readLegacy<Record<string, {
    email: string;
    name: string;
    passwordHash: string;
    tenantId: string;
    role: Role;
    createdAt: number;
  }>>('/tmp/agentma_users.json', {});
  const legacyTenants = readLegacy<Record<string, TenantRow>>('/tmp/agentma_tenants.json', {});
  const legacyQuotas = readLegacy<Record<string, QuotaRow>>('/tmp/agentma_quotas.json', {});
  const legacyKeys = readLegacy<Array<{
    id: string;
    tenantId: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    createdBy: string;
    createdAt: number;
    revokedAt: number | null;
  }>>('/tmp/agentma_apikeys.json', []);
  const legacyTeams = readLegacy<TeamRow[]>('/tmp/agentma_teams.json', []);
  const legacyMembers = readLegacy<Array<{ teamId: string; userId: string; role: string }>>('/tmp/agentma_members.json', []);
  const legacyAuditLogs = readLegacy<AuditRow[]>('/tmp/agentma_audit.json', []);

  db.exec('BEGIN');
  try {
    for (const tenant of Object.values(legacyTenants)) {
      db.prepare(`
        INSERT OR IGNORE INTO tenants (id, name, region, plan, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(tenant.id, tenant.name, tenant.region, tenant.plan, tenant.status, tenant.createdAt);
    }

    for (const user of Object.values(legacyUsers)) {
      const passwordHash = user.passwordHash.startsWith(LEGACY_PREFIX)
        ? user.passwordHash
        : `${LEGACY_PREFIX}${user.passwordHash}`;
      db.prepare(`
        INSERT OR IGNORE INTO users (email, name, password_hash, tenant_id, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(user.email, user.name, passwordHash, user.tenantId, user.role, user.createdAt);
    }

    for (const quota of Object.values(legacyQuotas)) {
      db.prepare(`
        INSERT OR IGNORE INTO quotas (
          tenant_id, monthly_active_seconds_limit, monthly_active_seconds_used,
          weekly_run_count_limit, weekly_run_count_used, max_concurrent_runs,
          per_run_max_active_hours, per_run_max_wall_clock_hours,
          per_run_max_llm_tokens, per_run_max_tool_calls
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        quota.tenantId,
        quota.monthlyActiveSecondsLimit,
        quota.monthlyActiveSecondsUsed,
        quota.weeklyRunCountLimit,
        quota.weeklyRunCountUsed,
        quota.maxConcurrentRuns,
        quota.perRunMaxActiveHours,
        quota.perRunMaxWallClockHours,
        quota.perRunMaxLlmTokens,
        quota.perRunMaxToolCalls,
      );
    }

    for (const key of legacyKeys) {
      db.prepare(`
        INSERT OR IGNORE INTO api_keys (
          id, tenant_id, name, key_hash, key_prefix, scopes_json,
          created_by, created_at, revoked_at, last_used_at, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        key.id,
        key.tenantId,
        key.name,
        key.keyHash,
        key.keyPrefix,
        JSON.stringify(key.scopes || []),
        key.createdBy || null,
        key.createdAt,
        key.revokedAt,
      );
    }

    for (const team of legacyTeams) {
      db.prepare(`
        INSERT OR IGNORE INTO teams (id, tenant_id, name, created_at)
        VALUES (?, ?, ?, ?)
      `).run(team.id, team.tenantId, team.name, team.createdAt);
    }

    for (const member of legacyMembers) {
      db.prepare(`
        INSERT OR IGNORE INTO team_members (team_id, user_email, role)
        VALUES (?, ?, ?)
      `).run(member.teamId, member.userId, member.role || 'member');
    }

    for (const log of legacyAuditLogs) {
      db.prepare(`
        INSERT OR IGNORE INTO audit_logs (
          id, tenant_id, action, actor, actor_type, resource, diff_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        log.id,
        log.tenantId,
        log.action,
        log.actor,
        log.actorType,
        log.resource,
        log.diff === undefined ? null : JSON.stringify(log.diff),
        log.createdAt,
      );
    }

    setImportedLegacyJson();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readLegacy<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function hashLegacyPw(password: string) {
  return crypto.createHash('sha256').update(password + 'agentma').digest('hex');
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function now() {
  return Date.now();
}

function expandHome(value: string) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value.replace(/\$HOME\b/g, os.homedir());
}

function defaultKnowledgeAllowlist() {
  return [
    '$HOME/Documents',
    '$HOME/Obsidian',
    '$HOME/Notes',
    '$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents',
  ];
}

function knowledgeAllowlistRoots() {
  const raw = process.env.AGENTMA_KNOWLEDGE_ROOT_ALLOWLIST;
  const entries = (raw && raw.trim() ? raw.split(path.delimiter) : defaultKnowledgeAllowlist())
    .map((item) => expandHome(item.trim()))
    .filter(Boolean);

  return entries.flatMap((entry) => {
    try {
      return [fs.realpathSync.native(path.resolve(entry))];
    } catch {
      return [];
    }
  });
}

function isPathWithinRoot(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function findAllowedKnowledgeRoot(resolvedPath: string) {
  return knowledgeAllowlistRoots().find((root) => isPathWithinRoot(resolvedPath, root));
}

function resolveKnowledgeDirectory(inputPath: string): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = inputPath.trim();
  if (!trimmed) return { ok: false, reason: '路径不能为空' };

  const absolute = path.resolve(expandHome(trimmed));
  let stat: fs.Stats;
  let realPath: string;
  try {
    stat = fs.statSync(absolute);
    realPath = fs.realpathSync.native(absolute);
  } catch {
    return { ok: false, reason: '目录不存在' };
  }
  if (!stat.isDirectory()) return { ok: false, reason: '路径不是目录' };
  try {
    fs.accessSync(realPath, fs.constants.R_OK);
  } catch {
    return { ok: false, reason: '无读取权限' };
  }
  if (!findAllowedKnowledgeRoot(realPath)) {
    return { ok: false, reason: '路径不在允许范围,请联系管理员加白名单' };
  }
  return { ok: true, path: realPath };
}

function collectMarkdownFiles(root: string) {
  const sampleFiles: string[] = [];
  let fileCount = 0;
  const stack = [root];

  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        fileCount += 1;
        if (sampleFiles.length < 20) {
          sampleFiles.push(path.relative(root, fullPath).split(path.sep).join('/'));
        }
      }
    }
  }

  return { fileCount, sampleFiles };
}

function collectMarkdownFilesBounded(root: string) {
  const sampleFiles: string[] = [];
  let fileCount = 0;
  let scannedEntries = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const maxDepth = 6;
  const maxEntries = 12000;

  while (stack.length && scannedEntries < maxEntries) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries >= maxEntries) break;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ dir: fullPath, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        fileCount += 1;
        if (sampleFiles.length < 8) {
          sampleFiles.push(path.relative(root, fullPath).split(path.sep).join('/'));
        }
      }
    }
  }

  return { fileCount, sampleFiles };
}

function hasDirectMarkdownFile(dir: string) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
  } catch {
    return false;
  }
}

function knowledgeCandidateForDirectory(dir: string, opts: { allowRecursiveOnly?: boolean } = {}): KnowledgeSourceCandidate | null {
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(dir);
  } catch {
    return null;
  }
  if (!findAllowedKnowledgeRoot(resolved)) return null;
  const hasObsidian = fs.existsSync(path.join(resolved, '.obsidian'));
  const hasDirectMarkdown = hasDirectMarkdownFile(resolved);
  const result = collectMarkdownFilesBounded(resolved);
  if (!hasObsidian && !hasDirectMarkdown && (!opts.allowRecursiveOnly || result.fileCount === 0)) return null;
  return {
    name: path.basename(resolved) || '知识库',
    path: resolved,
    fileCount: result.fileCount,
    sampleFiles: result.sampleFiles,
  };
}

function scanKnowledgeCandidateDirs(root: string, maxDepth: number) {
  const candidates: KnowledgeSourceCandidate[] = [];
  const seen = new Set<string>();
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const maxCandidates = 100;

  while (stack.length && candidates.length < maxCandidates) {
    const current = stack.pop()!;
    let resolved: string;
    try {
      resolved = fs.realpathSync.native(current.dir);
    } catch {
      continue;
    }
    if (seen.has(resolved) || !findAllowedKnowledgeRoot(resolved)) continue;
    seen.add(resolved);

    const candidate = knowledgeCandidateForDirectory(resolved);
    if (candidate) {
      candidates.push(candidate);
      if (fs.existsSync(path.join(resolved, '.obsidian'))) continue;
    }
    if (current.depth >= maxDepth) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) continue;
      stack.push({ dir: path.join(resolved, entry.name), depth: current.depth + 1 });
    }
  }

  return candidates;
}

function parseJsonArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapTenant(row: any): TenantRow {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    plan: row.plan,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapUser(row: any): UserRow {
  return {
    email: row.email,
    name: row.name,
    tenantId: row.tenant_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

function mapQuota(row: any): QuotaRow {
  return {
    tenantId: row.tenant_id,
    monthlyActiveSecondsLimit: row.monthly_active_seconds_limit,
    monthlyActiveSecondsUsed: row.monthly_active_seconds_used,
    weeklyRunCountLimit: row.weekly_run_count_limit,
    weeklyRunCountUsed: row.weekly_run_count_used,
    maxConcurrentRuns: row.max_concurrent_runs,
    perRunMaxActiveHours: row.per_run_max_active_hours,
    perRunMaxWallClockHours: row.per_run_max_wall_clock_hours,
    perRunMaxLlmTokens: row.per_run_max_llm_tokens,
    perRunMaxToolCalls: row.per_run_max_tool_calls,
  };
}

function clampPercent(used: number, limit: number) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 1000) / 10));
}

function asAgentRunDiff(diff: unknown): Record<string, unknown> {
  return diff && typeof diff === 'object' && !Array.isArray(diff) ? diff as Record<string, unknown> : {};
}

function toFiniteNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapQuotaUsageRun(row: any): QuotaUsageRun {
  const diff = asAgentRunDiff(row.diff_json ? JSON.parse(row.diff_json) : {});
  const inputTokens = toFiniteNumber(diff.inputTokens);
  const outputTokens = toFiniteNumber(diff.outputTokens);
  return {
    id: row.id,
    actor: row.actor,
    model: String(diff.model || row.resource || '').replace(/^run:/, ''),
    status: String(diff.status || 'unknown'),
    durationMs: toFiniteNumber(diff.durationMs),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: toFiniteNumber(diff.costUsd),
    createdAt: row.created_at,
  };
}

function mapApiKey(row: any): ApiKeyRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: parseJsonArray(row.scopes_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

function mapAudit(row: any): AuditRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    action: row.action,
    actor: row.actor,
    actorType: row.actor_type,
    resource: row.resource,
    diff: row.diff_json ? JSON.parse(row.diff_json) : undefined,
    createdAt: row.created_at,
  };
}

function mapPermissionRule(row: any): PermissionRuleRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    toolName: row.tool_name,
    ruleContent: row.rule_content || '',
    behavior: row.behavior,
    enabled: Boolean(row.enabled),
    position: Number(row.position || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHookRule(row: any): HookRuleRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventName: row.event_name,
    matcher: row.matcher || '',
    ruleContent: row.rule_content || '',
    action: row.action,
    message: row.message || '',
    enabled: Boolean(row.enabled),
    position: Number(row.position || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeSource(row: any): KnowledgeSourceRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    path: row.path,
    readOnly: Boolean(row.read_only),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const IMAGE_ATTACHMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function normalizeChatAttachments(value: unknown): ChatHistoryAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    if (raw.type !== 'image') return [];
    const mediaType = String(raw.mediaType || '');
    const data = String(raw.data || '');
    if (!IMAGE_ATTACHMENT_MIME_TYPES.has(mediaType) || !data) return [];
    return [{
      id: String(raw.id || crypto.randomUUID()),
      type: 'image' as const,
      mediaType: mediaType as ChatHistoryAttachment['mediaType'],
      data,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      size: Number(raw.size) || 0,
    }];
  });
}

function parseChatAttachments(value: unknown): ChatHistoryAttachment[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    return normalizeChatAttachments(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeChatMessages(messages: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message, index) => {
    if (!message || typeof message !== 'object') return [];
    const role = (message as { role?: unknown }).role;
    const content = (message as { content?: unknown }).content;
    const attachments = normalizeChatAttachments((message as { attachments?: unknown }).attachments);
    const timestamp = Number((message as { timestamp?: unknown }).timestamp);
    if (!['user', 'assistant', 'system'].includes(String(role))) return [];
    if (typeof content !== 'string') return [];
    return [{
      role: role as ChatHistoryMessage['role'],
      content,
      ...(attachments.length ? { attachments } : {}),
      timestamp: Number.isFinite(timestamp) ? timestamp : now() + index,
    }];
  });
}

function mapChatSession(row: any, messages: ChatHistoryMessage[]): ChatHistorySession {
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.title,
    messages,
    model: row.model,
    sdkSessionId: row.sdk_session_id || undefined,
    sdkCwd: row.sdk_cwd || undefined,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getUserWithPassword(email: string) {
  return db.prepare(`
    SELECT email, name, password_hash, tenant_id, role, created_at
    FROM users
    WHERE email = ?
  `).get(email) as {
    email: string;
    name: string;
    password_hash: string;
    tenant_id: string;
    role: Role;
    created_at: number;
  } | undefined;
}

function getUser(email: string) {
  const row = db.prepare(`
    SELECT email, name, tenant_id, role, created_at
    FROM users
    WHERE email = ?
  `).get(email);
  return row ? mapUser(row) : null;
}

function getTenant(tenantId: string) {
  const row = db.prepare(`
    SELECT id, name, region, plan, status, created_at
    FROM tenants
    WHERE id = ?
  `).get(tenantId);
  return row ? mapTenant(row) : null;
}

function ensureQuotaForTenant(tenantId: string) {
  db.prepare(`
    INSERT OR IGNORE INTO quotas (
      tenant_id, monthly_active_seconds_limit, monthly_active_seconds_used,
      weekly_run_count_limit, weekly_run_count_used, max_concurrent_runs,
      per_run_max_active_hours, per_run_max_wall_clock_hours,
      per_run_max_llm_tokens, per_run_max_tool_calls
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId,
    DEFAULT_QUOTA.monthlyActiveSecondsLimit,
    DEFAULT_QUOTA.monthlyActiveSecondsUsed,
    DEFAULT_QUOTA.weeklyRunCountLimit,
    DEFAULT_QUOTA.weeklyRunCountUsed,
    DEFAULT_QUOTA.maxConcurrentRuns,
    DEFAULT_QUOTA.perRunMaxActiveHours,
    DEFAULT_QUOTA.perRunMaxWallClockHours,
    DEFAULT_QUOTA.perRunMaxLlmTokens,
    DEFAULT_QUOTA.perRunMaxToolCalls,
  );
}

export function signJWT(obj: object) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(now() / 1000) + 7 * 86400 })).toString('base64url');
  return `${h}.${b}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url')}`;
}

function verifyJwtOnly(token: string) {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  if (crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as { sub: string; tenantId: string; exp: number };
  return payload.exp > Math.floor(now() / 1000) ? payload : null;
}

export function authenticateToken(token: string | undefined | null): AuthIdentity | null {
  if (!token) return null;

  const jwtPayload = verifyJwtOnly(token);
  if (jwtPayload) {
    const user = getUser(jwtPayload.sub);
    if (!user) return null;
    return {
      sub: user.email,
      tenantId: jwtPayload.tenantId,
      role: user.role,
      authType: 'jwt',
    };
  }

  const keyHash = sha256(token);
  const row = db.prepare(`
    SELECT id, tenant_id, created_by, expires_at
    FROM api_keys
    WHERE key_hash = ? AND revoked_at IS NULL
    LIMIT 1
  `).get(keyHash) as {
    id: string;
    tenant_id: string;
    created_by: string | null;
    expires_at: number | null;
  } | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at <= now()) return null;

  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now(), row.id);
  const user = row.created_by ? getUser(row.created_by) : null;
  return {
    sub: row.created_by || `api_key:${row.id}`,
    tenantId: row.tenant_id,
    role: user?.role || null,
    authType: 'api_key',
    apiKeyId: row.id,
  };
}

export function registerUser(name: string, email: string, password: string) {
  if (getUser(email)) return { ok: false as const, status: 409, error: '邮箱已注册' };

  const tenantId = crypto.randomUUID();
  const createdAt = now();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO tenants (id, name, region, plan, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tenantId, `${name || email}'s Workspace`, 'us', 'free', 'active', createdAt);

    db.prepare(`
      INSERT INTO users (email, name, password_hash, tenant_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email, name || email.split('@')[0], passwordHash, tenantId, 'tenant_admin', createdAt);

    ensureQuotaForTenant(tenantId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  audit(tenantId, 'register', email, 'user', `tenant:${tenantId}`);
  const user = getUser(email)!;
  return { ok: true as const, user, tenantId };
}

export function loginUser(email: string, password: string) {
  const user = getUserWithPassword(email);
  if (!user) return { ok: false as const, status: 401, error: '该邮箱未注册' };

  const storedHash = user.password_hash;
  let valid = false;
  if (storedHash.startsWith(LEGACY_PREFIX)) {
    valid = hashLegacyPw(password) === storedHash.slice(LEGACY_PREFIX.length);
    if (valid) {
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(bcrypt.hashSync(password, 10), email);
    }
  } else {
    valid = bcrypt.compareSync(password, storedHash);
  }

  if (!valid) return { ok: false as const, status: 401, error: '密码错误' };

  audit(user.tenant_id, 'login', email, 'user', `user:${email}`);
  return {
    ok: true as const,
    user: {
      email: user.email,
      name: user.name,
      tenantId: user.tenant_id,
      role: user.role,
      createdAt: user.created_at,
    },
  };
}

export function getMe(identity: AuthIdentity) {
  const user = identity.sub.startsWith('api_key:') ? null : getUser(identity.sub);
  const tenant = getTenant(identity.tenantId);
  return {
    email: user?.email || undefined,
    tenantId: identity.tenantId,
    name: user?.name,
    role: user?.role || identity.role || undefined,
    plan: tenant?.plan,
    region: tenant?.region,
  };
}

export function updateTenant(tenantId: string, patch: { name?: string; plan?: string }) {
  const tenant = getTenant(tenantId);
  if (!tenant) return null;
  const nextName = patch.name || tenant.name;
  const nextPlan = patch.plan && ['free', 'pro', 'enterprise'].includes(patch.plan) ? patch.plan : tenant.plan;
  db.prepare('UPDATE tenants SET name = ?, plan = ? WHERE id = ?').run(nextName, nextPlan, tenantId);
  return getTenant(tenantId);
}

export function listUsers(tenantId: string) {
  const rows = db.prepare(`
    SELECT email, name, tenant_id, role, created_at
    FROM users
    WHERE tenant_id = ?
    ORDER BY created_at ASC
  `).all(tenantId);
  return rows.map(mapUser);
}

export function updateUserRole(tenantId: string, email: string, role: Role) {
  const user = getUser(email);
  if (!user || user.tenantId !== tenantId) return null;
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email);
  return getUser(email);
}

export function deleteUser(tenantId: string, email: string) {
  const user = getUser(email);
  if (!user || user.tenantId !== tenantId) return false;
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
  return true;
}

export function listApiKeys(tenantId: string) {
  const rows = db.prepare(`
    SELECT id, tenant_id, name, key_prefix, scopes_json, created_by, created_at, revoked_at, last_used_at, expires_at
    FROM api_keys
    WHERE tenant_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(tenantId);
  return rows.map(mapApiKey);
}

export function createApiKey(tenantId: string, createdBy: string | null, name: string, scopes: string[]) {
  const rawKey = `sk-tenant_${crypto.randomBytes(24).toString('hex')}`;
  const row: ApiKeyRow = {
    id: crypto.randomUUID(),
    tenantId,
    name,
    keyPrefix: `${rawKey.slice(0, 18)}...`,
    scopes,
    createdBy,
    createdAt: now(),
    revokedAt: null,
    lastUsedAt: null,
    expiresAt: null,
  };
  db.prepare(`
    INSERT INTO api_keys (
      id, tenant_id, name, key_hash, key_prefix, scopes_json,
      created_by, created_at, revoked_at, last_used_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.tenantId,
    row.name,
    sha256(rawKey),
    row.keyPrefix,
    JSON.stringify(scopes),
    row.createdBy,
    row.createdAt,
    null,
    null,
    null,
  );
  audit(tenantId, 'create_api_key', createdBy || 'api_key', 'user', `apikey:${row.id}`);
  return { ...row, rawKey };
}

export function revokeApiKey(tenantId: string, id: string) {
  const result = db.prepare(`
    UPDATE api_keys
    SET revoked_at = ?
    WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL
  `).run(now(), id, tenantId);
  return result.changes > 0;
}

export function getQuota(tenantId: string) {
  ensureQuotaForTenant(tenantId);
  const row = db.prepare(`
    SELECT tenant_id, monthly_active_seconds_limit, monthly_active_seconds_used,
           weekly_run_count_limit, weekly_run_count_used, max_concurrent_runs,
           per_run_max_active_hours, per_run_max_wall_clock_hours,
           per_run_max_llm_tokens, per_run_max_tool_calls
    FROM quotas
    WHERE tenant_id = ?
  `).get(tenantId);
  return row ? mapQuota(row) : { tenantId, ...DEFAULT_QUOTA };
}

export function getQuotaUsageSummary(tenantId: string): QuotaUsageSummary {
  const quota = getQuota(tenantId);
  const rows = db.prepare(`
    SELECT id, actor, resource, diff_json, created_at
    FROM audit_logs
    WHERE tenant_id = ? AND action = 'agent_run'
    ORDER BY created_at DESC
    LIMIT 100
  `).all(tenantId);
  const runs = rows.map(mapQuotaUsageRun);
  const totalInputTokens = runs.reduce((sum, run) => sum + run.inputTokens, 0);
  const totalOutputTokens = runs.reduce((sum, run) => sum + run.outputTokens, 0);
  const totalDurationMs = runs.reduce((sum, run) => sum + run.durationMs, 0);
  const totalCostUsd = runs.reduce((sum, run) => sum + run.costUsd, 0);

  return {
    quota,
    usage: {
      monthlyActiveSeconds: {
        used: quota.monthlyActiveSecondsUsed,
        limit: quota.monthlyActiveSecondsLimit,
        percent: clampPercent(quota.monthlyActiveSecondsUsed, quota.monthlyActiveSecondsLimit),
      },
      weeklyRunCount: {
        used: quota.weeklyRunCountUsed,
        limit: quota.weeklyRunCountLimit,
        percent: clampPercent(quota.weeklyRunCountUsed, quota.weeklyRunCountLimit),
      },
      totalRuns: runs.length,
      successfulRuns: runs.filter((run) => run.status === 'success').length,
      failedRuns: runs.filter((run) => run.status !== 'success').length,
      totalDurationMs,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd,
      lastRunAt: runs[0]?.createdAt ?? null,
    },
    recentRuns: runs.slice(0, 10),
  };
}

export function updateQuota(tenantId: string, body: Record<string, unknown>) {
  ensureQuotaForTenant(tenantId);
  const current = getQuota(tenantId);
  const next = {
    ...current,
    monthlyActiveSecondsLimit: body.monthlyActiveSecondsLimit !== undefined ? Number(body.monthlyActiveSecondsLimit) : current.monthlyActiveSecondsLimit,
    weeklyRunCountLimit: body.weeklyRunCountLimit !== undefined ? Number(body.weeklyRunCountLimit) : current.weeklyRunCountLimit,
    maxConcurrentRuns: body.maxConcurrentRuns !== undefined ? Number(body.maxConcurrentRuns) : current.maxConcurrentRuns,
    perRunMaxActiveHours: body.perRunMaxActiveHours !== undefined ? Number(body.perRunMaxActiveHours) : current.perRunMaxActiveHours,
    perRunMaxWallClockHours: body.perRunMaxWallClockHours !== undefined ? Number(body.perRunMaxWallClockHours) : current.perRunMaxWallClockHours,
    perRunMaxLlmTokens: body.perRunMaxLlmTokens !== undefined ? Number(body.perRunMaxLlmTokens) : current.perRunMaxLlmTokens,
    perRunMaxToolCalls: body.perRunMaxToolCalls !== undefined ? Number(body.perRunMaxToolCalls) : current.perRunMaxToolCalls,
  };
  db.prepare(`
    UPDATE quotas
    SET monthly_active_seconds_limit = ?,
        weekly_run_count_limit = ?,
        max_concurrent_runs = ?,
        per_run_max_active_hours = ?,
        per_run_max_wall_clock_hours = ?,
        per_run_max_llm_tokens = ?,
        per_run_max_tool_calls = ?
    WHERE tenant_id = ?
  `).run(
    next.monthlyActiveSecondsLimit,
    next.weeklyRunCountLimit,
    next.maxConcurrentRuns,
    next.perRunMaxActiveHours,
    next.perRunMaxWallClockHours,
    next.perRunMaxLlmTokens,
    next.perRunMaxToolCalls,
    tenantId,
  );
  return getQuota(tenantId);
}

export function createTeam(tenantId: string, name: string) {
  const team: TeamRow = { id: crypto.randomUUID(), tenantId, name, createdAt: now() };
  db.prepare(`
    INSERT INTO teams (id, tenant_id, name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(team.id, team.tenantId, team.name, team.createdAt);
  return team;
}

export function listTeams(tenantId: string) {
  const rows = db.prepare(`
    SELECT t.id, t.tenant_id, t.name, t.created_at, COUNT(tm.user_email) AS member_count
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id
    WHERE t.tenant_id = ?
    GROUP BY t.id, t.tenant_id, t.name, t.created_at
    ORDER BY t.created_at ASC
  `).all(tenantId) as Array<{
    id: string;
    tenant_id: string;
    name: string;
    created_at: number;
    member_count: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    memberCount: Number(row.member_count || 0),
  }));
}

export function listTeamMembers(tenantId: string, teamId: string) {
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND tenant_id = ?').get(teamId, tenantId);
  if (!team) return null;
  const rows = db.prepare(`
    SELECT tm.team_id, tm.user_email, tm.role, u.name
    FROM team_members tm
    JOIN users u ON u.email = tm.user_email
    WHERE tm.team_id = ?
    ORDER BY u.created_at ASC
  `).all(teamId) as Array<{
    team_id: string;
    user_email: string;
    role: string;
    name: string;
  }>;
  return rows.map((row) => ({
    teamId: row.team_id,
    userId: row.user_email,
    email: row.user_email,
    name: row.name,
    role: row.role,
  }));
}

export function addTeamMember(tenantId: string, teamId: string, userEmail: string, role: string) {
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND tenant_id = ?').get(teamId, tenantId);
  if (!team) return { ok: false as const, status: 404, error: 'not found' };
  const user = getUser(userEmail);
  if (!user || user.tenantId !== tenantId) return { ok: false as const, status: 404, error: '用户不存在' };
  const existing = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_email = ?').get(teamId, userEmail);
  if (existing) return { ok: false as const, status: 409, error: '已存在' };
  db.prepare(`
    INSERT INTO team_members (team_id, user_email, role)
    VALUES (?, ?, ?)
  `).run(teamId, userEmail, role || 'member');
  return {
    ok: true as const,
    member: {
      teamId,
      userId: userEmail,
      email: userEmail,
      name: user.name,
      role: role || 'member',
    },
  };
}

export function removeTeamMember(tenantId: string, teamId: string, userEmail: string) {
  const team = db.prepare('SELECT id FROM teams WHERE id = ? AND tenant_id = ?').get(teamId, tenantId);
  if (!team) return false;
  const result = db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_email = ?').run(teamId, userEmail);
  return result.changes > 0;
}

export function listAuditLogs(tenantId: string) {
  const rows = db.prepare(`
    SELECT id, tenant_id, action, actor, actor_type, resource, diff_json, created_at
    FROM audit_logs
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(tenantId);
  return rows.map(mapAudit);
}

export function listPermissionRules(tenantId: string) {
  const rows = db.prepare(`
    SELECT tenant_id, id, tool_name, rule_content, behavior, enabled, position, created_at, updated_at
    FROM permission_rules
    WHERE tenant_id = ?
    ORDER BY position ASC, updated_at DESC
  `).all(tenantId);
  return rows.map(mapPermissionRule);
}

export function replacePermissionRules(tenantId: string, rules: Array<Record<string, unknown>>) {
  const timestamp = now();
  const normalized = rules.flatMap((rule, index): PermissionRuleRow[] => {
    const toolName = String(rule?.toolName || '').trim();
    const behavior = String(rule?.behavior || '').trim();
    if (!toolName || (behavior !== 'allow' && behavior !== 'deny')) return [];
    return [{
      id: String(rule?.id || crypto.randomUUID()),
      tenantId,
      toolName,
      ruleContent: String(rule?.ruleContent || '').slice(0, 1000),
      behavior,
      enabled: rule?.enabled !== false,
      position: Number.isFinite(Number(rule?.position)) ? Number(rule.position) : index,
      createdAt: Number(rule?.createdAt) || timestamp,
      updatedAt: timestamp,
    }];
  });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM permission_rules WHERE tenant_id = ?').run(tenantId);
    const insert = db.prepare(`
      INSERT INTO permission_rules (
        tenant_id, id, tool_name, rule_content, behavior, enabled, position, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((rule, index) => {
      insert.run(
        tenantId,
        rule.id,
        rule.toolName,
        rule.ruleContent,
        rule.behavior,
        rule.enabled ? 1 : 0,
        index,
        rule.createdAt,
        rule.updatedAt,
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return listPermissionRules(tenantId);
}

function getBareToolName(toolName: string) {
  return toolName.startsWith('mcp__') ? (toolName.split('__').pop() || toolName) : toolName;
}

function permissionRuleMatches(rule: PermissionRuleRow, toolName: string, input: Record<string, unknown>) {
  const ruleTool = rule.toolName.trim();
  const bareName = getBareToolName(toolName);
  if (ruleTool !== '*' && ruleTool !== toolName && ruleTool !== bareName) return false;

  const ruleContent = rule.ruleContent.trim().toLowerCase();
  if (!ruleContent) return true;
  const inputText = JSON.stringify(input || {}).toLowerCase();
  return inputText.includes(ruleContent);
}

export function evaluatePermissionRules(tenantId: string, toolName: string, input: Record<string, unknown>): PermissionRuleDecision | null {
  const rule = listPermissionRules(tenantId).find((candidate) => (
    candidate.enabled && permissionRuleMatches(candidate, toolName, input)
  ));
  if (!rule) return null;
  const reason = rule.ruleContent
    ? `${rule.behavior} rule matched ${rule.toolName}:${rule.ruleContent}`
    : `${rule.behavior} rule matched ${rule.toolName}`;
  return { behavior: rule.behavior, rule, reason };
}

const HOOK_RULE_EVENTS = new Set<HookRuleEvent>(['PreToolUse', 'PostToolUse', 'Notification']);
const HOOK_RULE_ACTIONS = new Set<HookRuleAction>(['allow', 'block', 'context', 'log']);

export function listHookRules(tenantId: string) {
  const rows = db.prepare(`
    SELECT tenant_id, id, event_name, matcher, rule_content, action, message, enabled, position, created_at, updated_at
    FROM hook_rules
    WHERE tenant_id = ?
    ORDER BY position ASC, updated_at DESC
  `).all(tenantId);
  return rows.map(mapHookRule);
}

export function replaceHookRules(tenantId: string, rules: Array<Record<string, unknown>>) {
  const timestamp = now();
  const normalized = rules.flatMap((rule, index): HookRuleRow[] => {
    const eventName = String(rule?.eventName || '').trim() as HookRuleEvent;
    const action = String(rule?.action || '').trim() as HookRuleAction;
    if (!HOOK_RULE_EVENTS.has(eventName) || !HOOK_RULE_ACTIONS.has(action)) return [];
    return [{
      id: String(rule?.id || crypto.randomUUID()),
      tenantId,
      eventName,
      matcher: String(rule?.matcher || '').slice(0, 300),
      ruleContent: String(rule?.ruleContent || '').slice(0, 1000),
      action,
      message: String(rule?.message || '').slice(0, 1000),
      enabled: rule?.enabled !== false,
      position: Number.isFinite(Number(rule?.position)) ? Number(rule.position) : index,
      createdAt: Number(rule?.createdAt) || timestamp,
      updatedAt: timestamp,
    }];
  });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM hook_rules WHERE tenant_id = ?').run(tenantId);
    const insert = db.prepare(`
      INSERT INTO hook_rules (
        tenant_id, id, event_name, matcher, rule_content, action, message, enabled, position, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((rule, index) => {
      insert.run(
        tenantId,
        rule.id,
        rule.eventName,
        rule.matcher,
        rule.ruleContent,
        rule.action,
        rule.message,
        rule.enabled ? 1 : 0,
        index,
        rule.createdAt,
        rule.updatedAt,
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return listHookRules(tenantId);
}

function getHookMatcherValue(input: Record<string, unknown>) {
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
  const notificationType = typeof input.notification_type === 'string' ? input.notification_type : '';
  return toolName || notificationType;
}

function hookRuleMatches(rule: HookRuleRow, eventName: HookRuleEvent, input: Record<string, unknown>) {
  if (rule.eventName !== eventName) return false;

  const matcher = rule.matcher.trim().toLowerCase();
  if (matcher) {
    const matcherValue = getHookMatcherValue(input).toLowerCase();
    if (!matcherValue.includes(matcher)) return false;
  }

  const ruleContent = rule.ruleContent.trim().toLowerCase();
  if (!ruleContent) return true;
  return JSON.stringify(input || {}).toLowerCase().includes(ruleContent);
}

function buildHookRuleOutput(rule: HookRuleRow, reason: string): Record<string, unknown> {
  const additionalContext = rule.message || reason;
  if (rule.eventName === 'PreToolUse') {
    const hookSpecificOutput: Record<string, unknown> = { hookEventName: 'PreToolUse' };
    if (rule.action === 'allow') {
      hookSpecificOutput.permissionDecision = 'allow';
      hookSpecificOutput.permissionDecisionReason = reason;
    } else if (rule.action === 'block') {
      hookSpecificOutput.permissionDecision = 'deny';
      hookSpecificOutput.permissionDecisionReason = reason;
    } else if (rule.action === 'context') {
      hookSpecificOutput.additionalContext = additionalContext;
    }
    return {
      ...(rule.action === 'block' ? { decision: 'block', reason } : {}),
      hookSpecificOutput,
    };
  }

  if (rule.eventName === 'PostToolUse') {
    return {
      ...(rule.action === 'block' ? { decision: 'block', reason } : {}),
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext },
    };
  }

  return {
    ...(rule.action === 'block' ? { decision: 'block', reason } : {}),
    hookSpecificOutput: { hookEventName: 'Notification', additionalContext },
  };
}

export function evaluateHookRules(tenantId: string, eventName: HookRuleEvent, input: Record<string, unknown>): HookRuleDecision | null {
  const rule = listHookRules(tenantId).find((candidate) => (
    candidate.enabled && hookRuleMatches(candidate, eventName, input)
  ));
  if (!rule) return null;
  const detail = [rule.eventName, rule.matcher, rule.ruleContent].filter(Boolean).join(':');
  const reason = `${rule.action} hook rule matched ${detail}`;
  return {
    action: rule.action,
    rule,
    reason,
    output: buildHookRuleOutput(rule, reason),
  };
}

export function listKnowledgeSources(tenantId: string): KnowledgeSourceRow[] {
  const rows = db.prepare(`
    SELECT id, tenant_id, name, path, read_only, enabled, created_at, updated_at
    FROM knowledge_sources
    WHERE tenant_id = ?
    ORDER BY updated_at DESC, name ASC
  `).all(tenantId);
  return rows.map(mapKnowledgeSource);
}

export function replaceKnowledgeSources(tenantId: string, sources: Array<Partial<KnowledgeSourceRow> & Record<string, unknown>>): KnowledgeSourceRow[] {
  const timestamp = now();
  const normalized = sources.flatMap((source): KnowledgeSourceRow[] => {
    const sourcePath = String(source?.path || '').trim();
    const resolved = resolveKnowledgeDirectory(sourcePath);
    if (!resolved.ok) {
      throw new Error(`知识库路径无效: ${resolved.reason}`);
    }

    const rawName = String(source?.name || '').trim();
    const name = (rawName || path.basename(resolved.path) || '知识库').slice(0, 80);
    return [{
      id: String(source?.id || crypto.randomUUID()),
      tenantId,
      name,
      path: resolved.path,
      readOnly: true,
      enabled: source?.enabled !== false,
      createdAt: Number(source?.createdAt) || timestamp,
      updatedAt: timestamp,
    }];
  });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM knowledge_sources WHERE tenant_id = ?').run(tenantId);
    const insert = db.prepare(`
      INSERT INTO knowledge_sources (
        id, tenant_id, name, path, read_only, enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of normalized) {
      insert.run(
        source.id,
        tenantId,
        source.name,
        source.path,
        source.readOnly ? 1 : 0,
        source.enabled ? 1 : 0,
        source.createdAt,
        source.updatedAt,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return listKnowledgeSources(tenantId);
}

export function testKnowledgeSource(sourcePath: string): KnowledgeSourceTestResult {
  const resolved = resolveKnowledgeDirectory(sourcePath);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const result = collectMarkdownFiles(resolved.path);
  return { ok: true, fileCount: result.fileCount, sampleFiles: result.sampleFiles };
}

export function scanKnowledgeSources(sourcePath?: string): { roots: string[]; candidates: KnowledgeSourceCandidate[] } {
  const roots = knowledgeAllowlistRoots();
  const inputPath = String(sourcePath || '').trim();
  if (!inputPath) {
    const candidates = roots.flatMap((root) => scanKnowledgeCandidateDirs(root, 5));
    const deduped = Array.from(new Map(candidates.map((candidate) => [candidate.path, candidate])).values());
    return { roots, candidates: deduped };
  }

  const resolved = resolveKnowledgeDirectory(inputPath);
  if (!resolved.ok) throw new Error(`本地导入路径无效: ${resolved.reason}`);
  const candidates = scanKnowledgeCandidateDirs(resolved.path, 6);
  const exact = knowledgeCandidateForDirectory(resolved.path, { allowRecursiveOnly: true });
  const withExact = exact ? [exact, ...candidates] : candidates;
  const deduped = Array.from(new Map(withExact.map((candidate) => [candidate.path, candidate])).values());
  return { roots, candidates: deduped };
}

export function audit(tenantId: string, action: string, actor: string, actorType: string, resource: string, diff?: unknown) {
  db.prepare(`
    INSERT INTO audit_logs (id, tenant_id, action, actor, actor_type, resource, diff_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    tenantId,
    action,
    actor,
    actorType,
    resource,
    diff === undefined ? null : JSON.stringify(diff),
    now(),
  );
  db.prepare(`
    DELETE FROM audit_logs
    WHERE id IN (
      SELECT id FROM audit_logs
      ORDER BY created_at DESC
      LIMIT -1 OFFSET 1000
    )
  `).run();
}

function getChatSessionRow(tenantId: string, ownerSub: string, sessionId: string) {
  return db.prepare(`
    SELECT id, tenant_id, owner_sub, template_id, title, model, sdk_session_id, sdk_cwd, pinned, created_at, updated_at
    FROM chat_sessions
    WHERE tenant_id = ? AND owner_sub = ? AND id = ?
  `).get(tenantId, ownerSub, sessionId) as {
    id: string;
    tenant_id: string;
    owner_sub: string;
    template_id: string;
    title: string;
    model: string;
    sdk_session_id?: string | null;
    sdk_cwd?: string | null;
    pinned: number;
    created_at: number;
    updated_at: number;
  } | undefined;
}

function getAnyChatSessionRow(sessionId: string) {
  return db.prepare(`
    SELECT id, tenant_id, owner_sub
    FROM chat_sessions
    WHERE id = ?
  `).get(sessionId) as {
    id: string;
    tenant_id: string;
    owner_sub: string;
  } | undefined;
}

function listMessagesForSession(sessionId: string) {
  const rows = db.prepare(`
    SELECT role, content, attachments_json, timestamp
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY seq ASC
  `).all(sessionId) as Array<{
    role: ChatHistoryMessage['role'];
    content: string;
    attachments_json?: string | null;
    timestamp: number;
  }>;
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    ...(parseChatAttachments(row.attachments_json).length ? { attachments: parseChatAttachments(row.attachments_json) } : {}),
    timestamp: row.timestamp,
  }));
}

export function listChatSessions(tenantId: string, ownerSub: string) {
  const rows = db.prepare(`
    SELECT id, tenant_id, owner_sub, template_id, title, model, sdk_session_id, sdk_cwd, pinned, created_at, updated_at
    FROM chat_sessions
    WHERE tenant_id = ? AND owner_sub = ?
    ORDER BY pinned DESC, updated_at DESC
  `).all(tenantId, ownerSub);
  return rows.map((row: any) => mapChatSession(row, listMessagesForSession(row.id)));
}

export function getChatSession(tenantId: string, ownerSub: string, sessionId: string) {
  const row = getChatSessionRow(tenantId, ownerSub, sessionId);
  if (!row) return null;
  return mapChatSession(row, listMessagesForSession(sessionId));
}

export function listProtectedSdkCwds() {
  const rows = db.prepare(`
    SELECT DISTINCT sdk_cwd
    FROM chat_sessions
    WHERE sdk_session_id IS NOT NULL
      AND sdk_session_id != ''
      AND sdk_cwd IS NOT NULL
      AND sdk_cwd != ''
  `).all() as Array<{ sdk_cwd: string }>;
  return rows.map((row) => row.sdk_cwd);
}

export function saveChatSession(
  tenantId: string,
  ownerSub: string,
  session: Partial<ChatHistorySession> & { id?: string; templateId?: string; messages?: unknown[] },
) {
  const existing = session.id ? getChatSession(tenantId, ownerSub, session.id) : null;
  if (session.id && !existing && getAnyChatSessionRow(session.id)) {
    return { ok: false as const, status: 404, error: 'not found' };
  }
  const id = String(session.id || crypto.randomUUID());
  const messages = normalizeChatMessages(session.messages ?? existing?.messages ?? []);
  if (!session.templateId && !existing?.templateId) {
    return { ok: false as const, status: 400, error: '缺少 templateId' };
  }

  const firstContent = messages[0]?.content?.trim();
  const createdAt = Number(session.createdAt)
    || existing?.createdAt
    || now();
  const updatedAt = Number(session.updatedAt) || now();
  const title = String(session.title || existing?.title || firstContent?.slice(0, 40) || '新对话');
  const model = String(session.model || existing?.model || '');
  const sdkSessionId = String(session.sdkSessionId || existing?.sdkSessionId || '').trim();
  const sdkCwd = String(session.sdkCwd || existing?.sdkCwd || '').trim();
  const pinned = typeof session.pinned === 'boolean' ? session.pinned : Boolean(existing?.pinned);
  const templateId = String(session.templateId || existing?.templateId);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO chat_sessions (
        id, tenant_id, owner_sub, template_id, title, model, sdk_session_id, sdk_cwd, pinned, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        template_id = excluded.template_id,
        title = excluded.title,
        model = excluded.model,
        sdk_session_id = excluded.sdk_session_id,
        sdk_cwd = excluded.sdk_cwd,
        pinned = excluded.pinned,
        updated_at = excluded.updated_at
    `).run(id, tenantId, ownerSub, templateId, title, model, sdkSessionId || null, sdkCwd || null, pinned ? 1 : 0, createdAt, updatedAt);

    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
    if (messages.length > 0) {
      const insertMessage = db.prepare(`
        INSERT INTO chat_messages (session_id, seq, role, content, attachments_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      messages.forEach((message, index) => {
        const attachmentsJson = message.attachments?.length ? JSON.stringify(message.attachments) : null;
        insertMessage.run(id, index, message.role, message.content, attachmentsJson, Number(message.timestamp) || updatedAt + index);
      });
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { ok: true as const, session: getChatSession(tenantId, ownerSub, id)! };
}

export function updateChatSession(
  tenantId: string,
  ownerSub: string,
  sessionId: string,
  patch: Partial<Pick<ChatHistorySession, 'title' | 'pinned' | 'templateId' | 'model' | 'sdkSessionId' | 'sdkCwd'>>,
) {
  const current = getChatSession(tenantId, ownerSub, sessionId);
  if (!current) return null;
  const next = saveChatSession(tenantId, ownerSub, {
    ...current,
    id: sessionId,
    title: patch.title ?? current.title,
    pinned: typeof patch.pinned === 'boolean' ? patch.pinned : current.pinned,
    templateId: patch.templateId ?? current.templateId,
    model: patch.model ?? current.model,
    sdkSessionId: patch.sdkSessionId ?? current.sdkSessionId,
    sdkCwd: patch.sdkCwd ?? current.sdkCwd,
    updatedAt: now(),
  });
  return next.ok ? next.session : null;
}

export function forkChatSession(
  tenantId: string,
  ownerSub: string,
  sessionId: string,
  patch: Partial<Pick<ChatHistorySession, 'title' | 'templateId' | 'model'>>,
) {
  const current = getChatSession(tenantId, ownerSub, sessionId);
  if (!current) return null;
  const timestamp = now();
  const next = saveChatSession(tenantId, ownerSub, {
    id: crypto.randomUUID(),
    title: String(patch.title || `${current.title || '新对话'} · fork`),
    templateId: patch.templateId || current.templateId,
    model: patch.model || current.model,
    sdkSessionId: undefined,
    sdkCwd: undefined,
    pinned: false,
    messages: current.messages,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return next.ok ? next.session : null;
}

export function deleteChatSession(tenantId: string, ownerSub: string, sessionId: string) {
  const row = getChatSessionRow(tenantId, ownerSub, sessionId);
  if (!row) return false;
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
}

export function getTenantById(tenantId: string) {
  return getTenant(tenantId);
}

export function getDataLocation() {
  return { dataDir: DATA_DIR, dbPath: DB_PATH };
}

// ═══ Agent Templates (tenant-shared) ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_templates (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_templates_tenant ON agent_templates (tenant_id, updated_at DESC);
`);

export function listAgentTemplates(tenantId: string) {
  const rows = db.prepare(`
    SELECT data_json FROM agent_templates WHERE tenant_id = ? ORDER BY updated_at DESC
  `).all(tenantId) as Array<{ data_json: string }>;
  return rows
    .map((r) => { try { return JSON.parse(r.data_json); } catch { return null; } })
    .filter((t): t is Record<string, unknown> => t !== null);
}

export function replaceAgentTemplates(tenantId: string, templates: Array<Record<string, unknown>>) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM agent_templates WHERE tenant_id = ?').run(tenantId);
    const insert = db.prepare('INSERT INTO agent_templates (tenant_id, id, data_json, updated_at) VALUES (?, ?, ?, ?)');
    for (const t of templates) {
      const id = String((t as any)?.id || crypto.randomUUID());
      const updatedAt = Number((t as any)?.updatedAt) || now();
      insert.run(tenantId, id, JSON.stringify({ ...t, id }), updatedAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return listAgentTemplates(tenantId);
}

// ═══ Agent Runs (real SDK execution metering) ═══
export function recordAgentRun(tenantId: string, info: { sub: string; model: string; durationMs: number; inputTokens: number; outputTokens: number; costUsd?: number; status: string }) {
  ensureQuotaForTenant(tenantId);
  const seconds = Math.max(0, Math.round(info.durationMs / 1000));
  db.prepare('UPDATE quotas SET weekly_run_count_used = weekly_run_count_used + 1, monthly_active_seconds_used = monthly_active_seconds_used + ? WHERE tenant_id = ?').run(seconds, tenantId);
  audit(tenantId, 'agent_run', info.sub, 'user', `run:${info.model}`, {
    model: info.model,
    durationMs: info.durationMs,
    inputTokens: info.inputTokens,
    outputTokens: info.outputTokens,
    costUsd: info.costUsd,
    status: info.status,
  });
}
