import type { ProviderProfile } from '../simulator/types';

export type ContextWindowSource = 'profile' | 'known-model' | 'unknown';

export type ModelContextWindowInfo = {
  model: string;
  contextWindowTokens?: number;
  source: ContextWindowSource;
  estimated: boolean;
};

function normalizeModelName(model: string) {
  return model.trim().toLowerCase();
}

function normalizeContextWindowMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([model, tokens]) => {
    const normalizedModel = normalizeModelName(model);
    const numericTokens = Number(tokens);
    if (!normalizedModel || !Number.isFinite(numericTokens) || numericTokens <= 0) return [];
    return [[normalizedModel, Math.floor(numericTokens)] as const];
  });
  return Object.fromEntries(entries);
}

export function normalizeProviderModelContextWindows(seed?: Partial<ProviderProfile>) {
  return normalizeContextWindowMap(seed?.modelContextWindows);
}

function profileContextWindow(model: string, profiles: ProviderProfile[]) {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) return undefined;

  for (const profile of profiles) {
    const windows = normalizeProviderModelContextWindows(profile);
    if (windows[normalizedModel]) return windows[normalizedModel];
  }
  return undefined;
}

function knownContextWindow(model: string) {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) return undefined;

  if (/^claude[-_].*(opus|sonnet|haiku|3|4)/.test(normalizedModel)) return 200_000;
  if (/^deepseek[-_](chat|reasoner)/.test(normalizedModel)) return 64_000;
  return undefined;
}

export function getModelContextWindowInfo(model: string, profiles: ProviderProfile[] = []): ModelContextWindowInfo {
  const normalizedModel = model.trim();
  if (!normalizedModel) return { model: '', source: 'unknown', estimated: true };

  const configured = profileContextWindow(normalizedModel, profiles);
  if (configured) {
    return { model: normalizedModel, contextWindowTokens: configured, source: 'profile', estimated: false };
  }

  const known = knownContextWindow(normalizedModel);
  if (known) {
    return { model: normalizedModel, contextWindowTokens: known, source: 'known-model', estimated: true };
  }

  return { model: normalizedModel, source: 'unknown', estimated: true };
}

export function formatContextTokens(tokens?: number) {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return '未知';
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(Math.round(tokens));
}
