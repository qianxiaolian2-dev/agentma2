import { useState } from 'react';
import type { AgentDefinition, TodoItem } from '../simulator/types';
import { sdkSimulator } from '../simulator/sdk-simulator';
import { generateMockSubagents, generateMockTodos, PERMISSION_MODES, EFFORT_LEVELS } from '../simulator/mock-data';
import StatusBadge from '../components/common/StatusBadge';
import JsonViewer from '../components/common/JsonViewer';

export default function Subagents() {
  const [subagents] = useState<AgentDefinition[]>(generateMockSubagents());
  const [todos, setTodos] = useState<TodoItem[]>(generateMockTodos());
  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 新子代理表单
  const [newAgent, setNewAgent] = useState({
    description: '', prompt: '', model: 'claude-sonnet-4-6',
    effort: 'high', background: false, permissionMode: 'default' as const,
  });

  // createTodo()
  const handleCreateTodo = async () => {
    const todo = await sdkSimulator.createTodo('新任务', '手动创建的任务');
    setTodos(prev => [...prev, todo]);
  };

  // TaskUpdate
  const handleUpdateTodo = async (id: string, status: TodoItem['status']) => {
    await sdkSimulator.updateTodoStatus(id, status);
    setTodos(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const statusLabel = (s: string) => s === 'pending' ? '待处理' : s === 'in_progress' ? '进行中' : '已完成';
  const statusColor = (s: string) => s === 'completed' ? 'success' as const : s === 'in_progress' ? 'warning' as const : 'info' as const;

  return (
    <div>
      <div className="page-header">
        <h1>🤖 子代理管理</h1>
        <p>AgentDefinition 配置 + Task CRUD + stopTask()</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 子代理定义 */}
        <div>
          <div className="card">
            <div className="flex-between">
              <div className="card-header" style={{ marginBottom: 0 }}>AgentDefinition 列表</div>
              <button className="btn btn-sm btn-primary" onClick={() => setShowCreateForm(!showCreateForm)}>
                + 新代理
              </button>
            </div>

            {/* 创建表单 */}
            {showCreateForm && (
              <div className="tool-card mb-4 mt-4 fade-in" style={{ border: '2px solid var(--accent)' }}>
                <div className="form-group">
                  <label>description (代理描述)</label>
                  <input value={newAgent.description} onChange={e => setNewAgent({ ...newAgent, description: e.target.value })} placeholder="例如：代码审查专家" />
                </div>
                <div className="form-group">
                  <label>prompt (系统提示词)</label>
                  <textarea value={newAgent.prompt} onChange={e => setNewAgent({ ...newAgent, prompt: e.target.value })} rows={2} placeholder="你是一位资深的代码审查专家..." />
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label>model</label>
                    <select value={newAgent.model} onChange={e => setNewAgent({ ...newAgent, model: e.target.value })}>
                      <option value="claude-opus-4-7">Claude Opus 4.7</option>
                      <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                      <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>effort</label>
                    <select value={newAgent.effort} onChange={e => setNewAgent({ ...newAgent, effort: e.target.value })}>
                      {EFFORT_LEVELS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                    </select>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <input type="checkbox" checked={newAgent.background} onChange={e => setNewAgent({ ...newAgent, background: e.target.checked })} style={{ width: 'auto' }} />
                  background (后台运行)
                </label>
                <button className="btn btn-primary btn-sm" onClick={() => setShowCreateForm(false)}>确认创建</button>
              </div>
            )}

            {subagents.map((agent, i) => (
              <div key={i} className="tool-card mb-2" onClick={() => setSelectedAgent(agent)} style={{ cursor: 'pointer' }}>
                <div className="flex-between">
                  <div className="tool-card-name">{agent.description}</div>
                  {agent.background && <StatusBadge status="info" label="后台" />}
                </div>
                <div className="tool-card-desc">{agent.prompt.slice(0, 80)}...</div>
                <div className="mt-2 flex gap-2" style={{ flexWrap: 'wrap' }}>
                  <span className="badge badge-muted">model: {agent.model}</span>
                  <span className="badge badge-muted">effort: {agent.effort}</span>
                  {agent.tools?.map(t => <span key={t} className="badge badge-info">{t}</span>)}
                </div>
              </div>
            ))}
          </div>

          {selectedAgent && (
            <div className="card mt-4 fade-in">
              <div className="flex-between">
                <div className="card-header" style={{ marginBottom: 0 }}>{selectedAgent.description}</div>
                <button className="btn btn-sm" onClick={() => setSelectedAgent(null)}>关闭</button>
              </div>
              <JsonViewer data={selectedAgent} maxHeight={300} />
            </div>
          )}
        </div>

        {/* 任务管理 */}
        <div>
          <div className="card">
            <div className="flex-between">
              <div className="card-header" style={{ marginBottom: 0 }}>Task CRUD (TaskCreate / TaskUpdate / TaskList)</div>
              <button className="btn btn-sm btn-primary" onClick={handleCreateTodo}>
                TaskCreate()
              </button>
            </div>
            <div className="mt-4">
              {todos.map(todo => (
                <div key={todo.id} className="tool-card mb-2">
                  <div className="flex-between">
                    <div>
                      <div className="tool-card-name">{todo.subject}</div>
                      <div className="tool-card-desc">{todo.description}</div>
                    </div>
                    <StatusBadge status={statusColor(todo.status)} label={statusLabel(todo.status)} />
                  </div>
                  {todo.blockedBy && todo.blockedBy.length > 0 && (
                    <div className="mt-2" style={{ fontSize: '.75em', color: 'var(--ink-muted)' }}>
                      被阻塞: {todo.blockedBy.join(', ')}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button className="btn btn-sm" onClick={() => handleUpdateTodo(todo.id, 'completed')}>TaskUpdate → completed</button>
                    <button className="btn btn-sm" onClick={() => handleUpdateTodo(todo.id, 'in_progress')}>→ in_progress</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
