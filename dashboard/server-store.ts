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

export type ChatHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
};

export type ChatHistorySession = {
  id: string;
  templateId: string;
  title: string;
  messages: ChatHistoryMessage[];
  model: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
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
  `);
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

function normalizeChatMessages(messages: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message, index) => {
    if (!message || typeof message !== 'object') return [];
    const role = (message as { role?: unknown }).role;
    const content = (message as { content?: unknown }).content;
    const timestamp = Number((message as { timestamp?: unknown }).timestamp);
    if (!['user', 'assistant', 'system'].includes(String(role))) return [];
    if (typeof content !== 'string') return [];
    return [{
      role: role as ChatHistoryMessage['role'],
      content,
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
    SELECT id, tenant_id, owner_sub, template_id, title, model, pinned, created_at, updated_at
    FROM chat_sessions
    WHERE tenant_id = ? AND owner_sub = ? AND id = ?
  `).get(tenantId, ownerSub, sessionId) as {
    id: string;
    tenant_id: string;
    owner_sub: string;
    template_id: string;
    title: string;
    model: string;
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
    SELECT role, content, timestamp
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY seq ASC
  `).all(sessionId) as Array<{
    role: ChatHistoryMessage['role'];
    content: string;
    timestamp: number;
  }>;
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  }));
}

export function listChatSessions(tenantId: string, ownerSub: string) {
  const rows = db.prepare(`
    SELECT id, tenant_id, owner_sub, template_id, title, model, pinned, created_at, updated_at
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
  const pinned = typeof session.pinned === 'boolean' ? session.pinned : Boolean(existing?.pinned);
  const templateId = String(session.templateId || existing?.templateId);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO chat_sessions (
        id, tenant_id, owner_sub, template_id, title, model, pinned, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        template_id = excluded.template_id,
        title = excluded.title,
        model = excluded.model,
        pinned = excluded.pinned,
        updated_at = excluded.updated_at
    `).run(id, tenantId, ownerSub, templateId, title, model, pinned ? 1 : 0, createdAt, updatedAt);

    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
    if (messages.length > 0) {
      const insertMessage = db.prepare(`
        INSERT INTO chat_messages (session_id, seq, role, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      messages.forEach((message, index) => {
        insertMessage.run(id, index, message.role, message.content, Number(message.timestamp) || updatedAt + index);
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
  patch: Partial<Pick<ChatHistorySession, 'title' | 'pinned' | 'templateId' | 'model'>>,
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
    updatedAt: now(),
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
