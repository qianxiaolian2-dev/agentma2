import type { ProviderConfig, ProviderProfile } from '../simulator/types';
import { getAuthHeaders } from './client-runtime';
import { getDefaultProviderConfig } from '../simulator/mock-data';

export const LS_PROVIDER = 'agentma_provider_config';
export const LS_PROVIDER_PROFILES = 'agentma_provider_profiles';

const PROVIDER_KEYS: Array<keyof ProviderConfig> = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
];
const PROFILE_CONFIG_KEYS: Array<'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_BASE_URL'> = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
];

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeProviderConfig(value?: Partial<ProviderConfig>): ProviderConfig {
  const defaults = getDefaultProviderConfig();
  const source = value || {};
  return PROVIDER_KEYS.reduce((next, key) => {
    next[key] = trimString(source[key]) || defaults[key];
    return next;
  }, {} as ProviderConfig);
}

function legacyProviderConfig(): ProviderConfig {
  try {
    const raw = localStorage.getItem(LS_PROVIDER);
    if (raw) return normalizeProviderConfig(JSON.parse(raw));
  } catch {}
  return getDefaultProviderConfig();
}

export function splitAvailableModels(value: string) {
  return value
    .split(/[\s,，]+/)
    .map(model => model.trim())
    .filter(model => model && !model.includes('*'));
}

function normalizeProfileConfig(seed?: Partial<ProviderProfile>) {
  const defaults = getDefaultProviderConfig();
  const source = seed || {};
  return PROFILE_CONFIG_KEYS.reduce((next, key) => {
    next[key] = trimString(source[key]) || defaults[key];
    return next;
  }, {} as Pick<ProviderProfile, 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_BASE_URL'>);
}

function normalizeAvailableModels(seed?: Partial<ProviderProfile>) {
  const values: string[] = [];
  const addModel = (value: unknown) => {
    const model = trimString(value);
    if (model && !model.includes('*')) values.push(model);
  };
  if (Array.isArray(seed?.availableModels)) {
    for (const model of seed.availableModels) addModel(model);
  }
  if (typeof seed?.modelPatterns === 'string') {
    values.push(...splitAvailableModels(seed.modelPatterns));
  }
  addModel(seed?.ANTHROPIC_MODEL);
  return Array.from(new Set(values));
}

function normalizeBaseUrl(value: unknown) {
  const raw = trimString(value).replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function mergeModels(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right]
    .map(model => model.trim())
    .filter(model => model && !model.includes('*'))));
}

function sameProviderIdentity(left: ProviderProfile, right: ProviderProfile) {
  if (left.id && right.id && left.id === right.id) return true;
  const leftUrl = normalizeBaseUrl(left.ANTHROPIC_BASE_URL);
  const rightUrl = normalizeBaseUrl(right.ANTHROPIC_BASE_URL);
  if (!leftUrl || leftUrl !== rightUrl) return false;
  return true;
}

function mergeProviderProfile(left: ProviderProfile, right: ProviderProfile) {
  return createProviderProfile({
    ...left,
    ...right,
    ANTHROPIC_AUTH_TOKEN: trimString(right.ANTHROPIC_AUTH_TOKEN) || trimString(left.ANTHROPIC_AUTH_TOKEN),
    ANTHROPIC_BASE_URL: trimString(right.ANTHROPIC_BASE_URL) || trimString(left.ANTHROPIC_BASE_URL),
    availableModels: mergeModels(left.availableModels, right.availableModels),
    enabled: right.enabled !== false,
    isDefault: right.isDefault === true,
    createdAt: Math.min(Number(left.createdAt || Date.now()), Number(right.createdAt || Date.now())),
    updatedAt: Math.max(Number(left.updatedAt || 0), Number(right.updatedAt || 0), Date.now()),
  });
}

export function providerToEnv(profile: ProviderProfile, model?: string): ProviderConfig {
  const profileConfig = normalizeProfileConfig(profile);
  return {
    ...profileConfig,
    ANTHROPIC_MODEL: trimString(model),
  };
}

export function createProviderProfile(seed?: Partial<ProviderProfile>): ProviderProfile {
  const now = Date.now();
  return {
    ...normalizeProfileConfig(seed),
    id: trimString(seed?.id) || `provider-${now}`,
    name: trimString(seed?.name) || '默认供应商',
    availableModels: normalizeAvailableModels(seed),
    enabled: seed?.enabled !== false,
    isDefault: seed?.isDefault === true,
    createdAt: Number(seed?.createdAt || now),
    updatedAt: Number(seed?.updatedAt || now),
  };
}

function defaultProfileFromLegacy(): ProviderProfile {
  const legacy = legacyProviderConfig();
  return createProviderProfile({
    ANTHROPIC_AUTH_TOKEN: legacy.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL: legacy.ANTHROPIC_BASE_URL,
    availableModels: legacy.ANTHROPIC_MODEL ? [legacy.ANTHROPIC_MODEL] : [],
    id: 'provider-default',
    name: '默认供应商',
    enabled: true,
    isDefault: true,
  });
}

function normalizeProviderProfiles(value: unknown): ProviderProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    return [createProviderProfile(item as Partial<ProviderProfile>)];
  });
}

export function loadProviderProfiles(): ProviderProfile[] {
  try {
    const raw = localStorage.getItem(LS_PROVIDER_PROFILES);
    if (raw) {
      const profiles = normalizeProviderProfiles(JSON.parse(raw));
      if (profiles.length) return profiles;
    }
  } catch {}
  return [defaultProfileFromLegacy()];
}

export function saveProviderProfiles(profiles: ProviderProfile[]): ProviderProfile[] {
  const normalized = normalizeProviderProfiles(profiles);
  const defaultId = normalized.find(profile => profile.isDefault)?.id || normalized[0]?.id || '';
  const next = normalized.length
    ? normalized.map(profile => ({
      ...profile,
      isDefault: profile.id === defaultId,
      updatedAt: Date.now(),
    }))
    : [defaultProfileFromLegacy()];
  localStorage.setItem(LS_PROVIDER_PROFILES, JSON.stringify(next));
  localStorage.setItem(LS_PROVIDER, JSON.stringify(providerToEnv(next.find(profile => profile.enabled) || next[0])));
  return next;
}

export function mergeProviderProfiles(existing: ProviderProfile[], incoming: ProviderProfile[]): ProviderProfile[] {
  const merged = normalizeProviderProfiles(existing);
  for (const profile of normalizeProviderProfiles(incoming)) {
    const index = merged.findIndex(current => sameProviderIdentity(current, profile));
    if (index >= 0) {
      merged[index] = mergeProviderProfile(merged[index], profile);
    } else {
      merged.push(profile);
    }
  }

  const defaultId = merged.find(profile => profile.isDefault)?.id || merged[0]?.id || '';
  return merged.map(profile => ({
    ...profile,
    isDefault: profile.id === defaultId,
  }));
}

function modelNameMatches(candidate: string, model: string) {
  return candidate === model;
}

function providerMatchesModel(profile: ProviderProfile, model: string) {
  if (!model.trim()) return profile.isDefault === true;
  const normalizedModel = model.trim().toLowerCase();
  const candidates = profile.availableModels
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return candidates.some(candidate => modelNameMatches(candidate, normalizedModel));
}

export function resolveProviderForModel(model?: string): { profile: ProviderProfile; provider: ProviderConfig } {
  const profiles = loadProviderProfiles();
  const enabled = profiles.filter(profile => profile.enabled);
  const usable = enabled.length ? enabled : profiles;
  const selected = usable.find(profile => providerMatchesModel(profile, model || ''))
    || usable.find(profile => profile.isDefault)
    || usable[0]
    || defaultProfileFromLegacy();
  return { profile: selected, provider: providerToEnv(selected, model) };
}

export function listProviderModels() {
  const values = new Set<string>();
  const profiles = loadProviderProfiles();
  const enabled = profiles.filter(profile => profile.enabled);
  for (const profile of enabled.length ? enabled : profiles) {
    for (const value of profile.availableModels) {
      if (value.trim()) values.add(value.trim());
    }
  }
  return Array.from(values);
}

export async function fetchProviderModels(): Promise<string[]> {
  const response = await fetch('/api/provider-models', { headers: getAuthHeaders() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json().catch(() => []);
  if (!Array.isArray(data)) return [];
  return Array.from(new Set(data.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const model = item.trim();
    return model && !model.includes('*') ? [model] : [];
  })));
}
