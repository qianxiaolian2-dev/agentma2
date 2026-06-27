export type AgentTaskEvent = {
  id: string;
  status: string;
  description: string;
  subagentType?: string;
  taskType?: string;
  lastToolName?: string;
  summary?: string;
  error?: string;
  usage?: {
    total_tokens?: number;
    tool_uses?: number;
    duration_ms?: number;
  };
};

export function mergeAgentTaskEvent(tasks: AgentTaskEvent[], data: Record<string, any>): AgentTaskEvent[] {
  const id = String(data.taskId || '');
  if (!id) return tasks;
  const existing = tasks.find((task) => task.id === id);
  const patch: AgentTaskEvent = {
    id,
    status: data.type === 'task_started' ? 'running'
      : data.type === 'task_notification' ? String(data.status || 'completed')
      : String(data.status || existing?.status || 'running'),
    description: String(data.description || existing?.description || ''),
    subagentType: data.subagentType || existing?.subagentType,
    taskType: data.taskType || existing?.taskType,
    lastToolName: data.lastToolName || existing?.lastToolName,
    summary: data.summary || existing?.summary,
    error: data.error || existing?.error,
    usage: data.usage || existing?.usage,
  };
  if (!existing) return [...tasks, patch];
  return tasks.map((task) => task.id === id ? { ...task, ...patch } : task);
}

export function taskStatusLabel(status: string) {
  if (status === 'completed') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'stopped' || status === 'killed') return '停止';
  if (status === 'paused') return '暂停';
  return '运行中';
}

export function taskStatusColor(status: string) {
  if (status === 'completed') return 'var(--success)';
  if (status === 'failed' || status === 'killed') return 'var(--danger)';
  if (status === 'stopped' || status === 'paused') return 'var(--warning)';
  return 'var(--info)';
}
