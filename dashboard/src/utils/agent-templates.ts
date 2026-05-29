import type { AgentTemplate, EffortLevel, PermissionMode, ProviderConfig } from '../simulator/types';
import { getAuthHeaders } from './client-runtime';

const LEGACY_CACHE_KEY = 'agentma_templates';
const CACHE_KEY_PREFIX = 'agentma_templates:';
const DEFAULT_MODEL = 'deepseek-v4-pro[1m]';
const DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];

function getCacheKey(tenantId?: string) {
  return tenantId ? `${CACHE_KEY_PREFIX}${tenantId}` : LEGACY_CACHE_KEY;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeProviderOverrides(value: unknown): Partial<ProviderConfig> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string' && item.trim().length > 0),
  ) as Partial<ProviderConfig>;
}

function normalizeAgentTemplate(value: unknown): AgentTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;

  const createdAt = Number(raw.createdAt);
  const updatedAt = Number(raw.updatedAt);
  const effort = typeof raw.effort === 'string' ? raw.effort as EffortLevel : 'high';
  const permissionMode = typeof raw.permissionMode === 'string' ? raw.permissionMode as PermissionMode : 'default';
  const maxTurns = Number(raw.maxTurns);
  const tools = normalizeStringArray(raw.tools);

  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model : DEFAULT_MODEL,
    tools: Array.isArray(raw.tools) ? tools : DEFAULT_TOOLS,
    mcpServers: normalizeStringArray(raw.mcpServers),
    eventSources: normalizeStringArray(raw.eventSources),
    skills: normalizeStringArray(raw.skills),
    effort,
    maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 50,
    permissionMode,
    providerOverrides: normalizeProviderOverrides(raw.providerOverrides),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function normalizeAgentTemplates(list: unknown): AgentTemplate[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const template = normalizeAgentTemplate(item);
    return template ? [template] : [];
  });
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) as T : null;
  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>))
      ? String((data as Record<string, unknown>).error || '请求失败')
      : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

function writeTenantCache(tenantId: string, templates: AgentTemplate[]) {
  try {
    localStorage.setItem(getCacheKey(tenantId), JSON.stringify(templates));
  } catch {}
}

function clearLegacyCache() {
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {}
}

function loadLegacyCachedTemplates() {
  try {
    const raw = localStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return [];
    return normalizeAgentTemplates(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function loadCachedAgentTemplates(tenantId?: string): AgentTemplate[] {
  if (!tenantId) return [];
  try {
    const raw = localStorage.getItem(getCacheKey(tenantId));
    if (!raw) return [];
    return normalizeAgentTemplates(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function fetchAgentTemplates(tenantId: string): Promise<AgentTemplate[]> {
  const res = await fetch('/api/agents', { headers: getAuthHeaders() });
  const data = await readJson<unknown[]>(res);
  const templates = normalizeAgentTemplates(data);
  writeTenantCache(tenantId, templates);
  return templates;
}

export async function replaceAgentTemplates(tenantId: string, templates: AgentTemplate[]): Promise<AgentTemplate[]> {
  const normalized = normalizeAgentTemplates(templates);
  const res = await fetch('/api/agents', {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(normalized),
  });
  const data = await readJson<unknown[]>(res);
  const saved = normalizeAgentTemplates(data);
  writeTenantCache(tenantId, saved);
  clearLegacyCache();
  return saved;
}

export async function bootstrapAgentTemplates(tenantId: string, allowLegacyImport = false): Promise<AgentTemplate[]> {
  const remoteTemplates = await fetchAgentTemplates(tenantId);
  if (remoteTemplates.length > 0) return remoteTemplates;

  if (!allowLegacyImport) return remoteTemplates;

  const localCandidate = loadCachedAgentTemplates(tenantId);
  const legacyCandidate = localCandidate.length > 0 ? localCandidate : loadLegacyCachedTemplates();
  if (legacyCandidate.length === 0) return remoteTemplates;

  return replaceAgentTemplates(tenantId, legacyCandidate);
}

export function getCachedAgentTemplateById(tenantId: string | undefined, templateId: string) {
  return loadCachedAgentTemplates(tenantId).find((template) => template.id === templateId) || null;
}
