import type { ChatMessage, ChatRunStats } from '../simulator/types';

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeChatRunStats(value: unknown): ChatRunStats | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const stats: ChatRunStats = {
    costUsd: finiteNumber(raw.costUsd),
    durationMs: finiteNumber(raw.durationMs),
    inTok: finiteNumber(raw.inTok),
    outTok: finiteNumber(raw.outTok),
  };
  return Object.values(stats).some(v => v !== undefined) ? stats : undefined;
}

export function chatRunStatsFromResultEvent(event: Record<string, unknown>): ChatRunStats | undefined {
  const usage = event.usage && typeof event.usage === 'object'
    ? event.usage as Record<string, unknown>
    : {};
  return normalizeChatRunStats({
    costUsd: finiteNumber(event.cost_usd),
    durationMs: finiteNumber(event.duration_ms),
    inTok: finiteNumber(usage.input_tokens),
    outTok: finiteNumber(usage.output_tokens),
  });
}

export function latestAssistantRunStats(messages: ChatMessage[]): ChatRunStats | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const stats = normalizeChatRunStats(message.runStats);
    if (stats) return stats;
  }
  return null;
}
