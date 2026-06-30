export interface ContextCompactionEvent {
  id: string;
  subtype: 'compact_boundary';
  message: string;
  sdkSessionId?: string;
  timestamp: number;
}

export function mergeContextCompactionEvent(
  current: ContextCompactionEvent[],
  event: Record<string, unknown>,
): ContextCompactionEvent[] {
  if (event.type !== 'context_compaction' || event.subtype !== 'compact_boundary') return current;
  const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
  const sdkSessionId = typeof event.sdkSessionId === 'string' ? event.sdkSessionId : undefined;
  const id = `compact-boundary:${sdkSessionId || 'run'}:${timestamp}`;
  if (current.some(item => item.id === id)) return current;
  return [
    ...current,
    {
      id,
      subtype: 'compact_boundary',
      message: typeof event.message === 'string' && event.message.trim()
        ? event.message
        : 'SDK 已触发上下文自动压缩边界',
      sdkSessionId,
      timestamp,
    },
  ];
}
