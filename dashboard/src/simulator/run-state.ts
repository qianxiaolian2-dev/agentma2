export type RunPhase =
  | 'idle'
  | 'initializing'
  | 'thinking'
  | 'streaming'
  | 'tool_executing'
  | 'awaiting_permission'
  | 'awaiting_input'
  | 'finalizing';

export type RunOutcome =
  | 'completed'
  | 'stopped'
  | 'max_turns'
  | 'exec_error'
  | 'provider_error'
  | 'disconnected'
  | 'rejected';

export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

const RUN_OUTCOMES = new Set<RunOutcome>([
  'completed',
  'stopped',
  'max_turns',
  'exec_error',
  'provider_error',
  'disconnected',
  'rejected',
]);

const CHAT_MESSAGE_STATUSES = new Set<ChatMessageStatus>([
  'pending',
  'streaming',
  'complete',
  'error',
]);

export function isRunOutcome(value: unknown): value is RunOutcome {
  return typeof value === 'string' && RUN_OUTCOMES.has(value as RunOutcome);
}

export function isChatMessageStatus(value: unknown): value is ChatMessageStatus {
  return typeof value === 'string' && CHAT_MESSAGE_STATUSES.has(value as ChatMessageStatus);
}

export function normalizeChatMessageStatus(value: unknown): ChatMessageStatus | undefined {
  return isChatMessageStatus(value) ? value : undefined;
}

export function mapResultSubtypeToOutcome(subtype: unknown): RunOutcome {
  const value = typeof subtype === 'string' ? subtype : '';
  if (!value || value === 'success') return 'completed';
  if (value === 'aborted') return 'stopped';
  if (value === 'error') return 'provider_error';
  if (value === 'error_max_turns') return 'max_turns';
  if (value === 'error_during_execution') return 'exec_error';
  if (value.startsWith('error_')) return 'exec_error';
  return 'completed';
}

export function normalizeRunOutcome(value: unknown, fallback: RunOutcome = 'provider_error'): RunOutcome {
  if (isRunOutcome(value)) return value;
  if (value === 'success') return 'completed';
  if (value === 'aborted') return 'stopped';
  if (value === 'error') return 'provider_error';
  if (typeof value === 'string' && (value === '' || value.startsWith('error_'))) {
    return mapResultSubtypeToOutcome(value);
  }
  return fallback;
}

export function outcomeFromMessageStatus(status: unknown): RunOutcome | undefined {
  if (status === 'complete') return 'completed';
  if (status === 'error') return 'provider_error';
  return undefined;
}

export function normalizeMessageOutcome(outcome: unknown, status?: unknown): RunOutcome | undefined {
  if (isRunOutcome(outcome)) return outcome;
  return outcomeFromMessageStatus(status);
}

export function outcomeIsError(outcome: RunOutcome): boolean {
  return !['completed', 'stopped'].includes(outcome);
}

export function outcomeToMessageStatus(outcome: RunOutcome): ChatMessageStatus {
  return outcomeIsError(outcome) ? 'error' : 'complete';
}

export function agentRunOutcomeIsFailure(outcome: RunOutcome): boolean {
  return !['completed', 'stopped'].includes(outcome);
}

export function phaseLabel(phase: RunPhase): string {
  switch (phase) {
    case 'idle': return '空闲';
    case 'initializing': return '初始化';
    case 'thinking': return '思考中';
    case 'streaming': return '生成中';
    case 'tool_executing': return '执行工具';
    case 'awaiting_permission': return '等待授权';
    case 'awaiting_input': return '等待回答';
    case 'finalizing': return '收尾';
  }
}

export function outcomeLabel(outcome: RunOutcome): string {
  switch (outcome) {
    case 'completed': return '完成';
    case 'stopped': return '已停止';
    case 'max_turns': return '达到轮次上限';
    case 'exec_error': return '执行失败';
    case 'provider_error': return '服务异常';
    case 'disconnected': return '连接中断';
    case 'rejected': return '请求被拒';
  }
}

export function outcomeColor(outcome: RunOutcome): string {
  if (outcome === 'completed' || outcome === 'stopped') return 'var(--success)';
  if (outcome === 'max_turns' || outcome === 'disconnected') return 'var(--warning)';
  return 'var(--danger)';
}

export function outcomeBadgeClass(outcome: RunOutcome): string {
  if (outcome === 'completed' || outcome === 'stopped') return 'badge-success';
  if (outcome === 'max_turns' || outcome === 'disconnected') return 'badge-warning';
  return 'badge-danger';
}

export function phaseBadgeClass(phase: RunPhase): string {
  if (phase === 'awaiting_permission' || phase === 'awaiting_input') return 'badge-warning';
  if (phase === 'idle') return 'badge-muted';
  return 'badge-info';
}

export function isWaitingPhase(phase: RunPhase): boolean {
  return phase === 'awaiting_permission' || phase === 'awaiting_input';
}

export function deriveRunPhase(flags: {
  awaitingPermission?: boolean;
  awaitingInput?: boolean;
  toolExecuting?: boolean;
  thinking?: boolean;
  streaming?: boolean;
  initializing?: boolean;
  finalizing?: boolean;
}): RunPhase {
  if (flags.awaitingPermission) return 'awaiting_permission';
  if (flags.awaitingInput) return 'awaiting_input';
  if (flags.toolExecuting) return 'tool_executing';
  if (flags.thinking) return 'thinking';
  if (flags.streaming) return 'streaming';
  if (flags.initializing) return 'initializing';
  if (flags.finalizing) return 'finalizing';
  return 'idle';
}
