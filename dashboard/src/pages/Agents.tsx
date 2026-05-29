import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentTemplate, EffortLevel, PermissionMode, SkillInfo, RegisteredTool } from '../simulator/types';
import { BUILT_IN_TOOLS, EFFORT_LEVELS, PERMISSION_MODES, DEFAULT_SKILLS, MOCK_MCP_SERVERS, initCustomTools } from '../simulator/mock-data';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, loadCachedAgentTemplates, replaceAgentTemplates } from '../utils/agent-templates';

function loadSkills(): SkillInfo[] {
  try { const raw = localStorage.getItem('agentma_skills'); if (raw) return JSON.parse(raw); } catch {}
  return DEFAULT_SKILLS;
}

function loadMcpServers(): { name: string }[] {
  try { const raw = localStorage.getItem('agentma_mcp_servers'); if (raw) return JSON.parse(raw); } catch {}
  return [];
}

function newTemplate(): AgentTemplate {
  return {
    id: '', name: '', description: '', systemPrompt: '',
    model: 'deepseek-v4-pro[1m]', tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    mcpServers: [], eventSources: [], skills: [],
    effort: 'high', maxTurns: 50, permissionMode: 'default',
    providerOverrides: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

const TOOL_CATEGORIES = [
  { name: 'file', label: '文件', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] },
  { name: 'execution', label: '执行', tools: ['Bash', 'EnterWorktree'] },
  { name: 'search', label: '搜索', tools: ['WebSearch', 'WebFetch', 'ToolSearch'] },
  { name: 'task', label: '任务', tools: ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop', 'TaskOutput'] },
  { name: 'agent', label: '代理', tools: ['Agent', 'Skill', 'AskUserQuestion', 'ExitPlanMode'] },
  { name: 'mcp', label: 'MCP', tools: ['ListMcpResources', 'ReadMcpResource'] },
  { name: 'notebook', label: 'Notebook', tools: ['NotebookEdit'] },
];

export default function Agents() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [form, setForm] = useState<AgentTemplate>(newTemplate());
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  // 动态加载技能和 MCP 服务器（非写死）
  const [liveSkills] = useState<SkillInfo[]>(loadSkills);
  const [liveMcp] = useState<{ name: string }[]>(loadMcpServers);
  const [liveEventSources, setLiveEventSources] = useState<Array<{ name: string; type: string; url: string; enabled: boolean }>>([]);

  useEffect(() => {
    fetch('/api/events/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) })
      .then(r => r.json()).then(data => { if (Array.isArray(data)) setLiveEventSources(data); }).catch(() => {});
  }, []);
  const [liveCustomTools, setLiveCustomTools] = useState<RegisteredTool[]>(() => initCustomTools());

  // 每次页面可见时刷新自定义工具
  useEffect(() => {
    const onFocus = () => setLiveCustomTools(initCustomTools());
    window.addEventListener('focus', onFocus);
    // 也监听 storage 事件（跨 tab）
    const onStorage = (e: StorageEvent) => { if (e.key === 'agentma_custom_tools') setLiveCustomTools(initCustomTools()); };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    if (!user?.tenantId) return;

    let cancelled = false;
    setTemplates(loadCachedAgentTemplates(user.tenantId));
    setIsLoading(true);

    void bootstrapAgentTemplates(user.tenantId, user.role === 'tenant_admin')
      .then((list) => {
        if (cancelled) return;
        setTemplates(list);
        setError('');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError((loadError as Error).message || '加载 Agent 失败');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [user?.tenantId, user?.role]);

  useEffect(() => {
    if (!form.id) return;
    const current = templates.find((template) => template.id === form.id);
    if (current) {
      setForm(current);
      setIsEditing(true);
      return;
    }
    if (isEditing) {
      setForm(newTemplate());
      setIsEditing(false);
    }
  }, [templates, form.id, isEditing]);

  const handleSelect = (t: AgentTemplate) => {
    setForm({ ...t });
    setIsEditing(true);
  };

  const handleNew = () => {
    setForm(newTemplate());
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !user?.tenantId) return;
    const now = Date.now();
    const saved: AgentTemplate = {
      ...form,
      id: form.id || `agent-${now}`,
      name: form.name.trim(),
      createdAt: form.createdAt || now,
      updatedAt: now,
    };
    const nextTemplates = isEditing
      ? templates.map(t => t.id === saved.id ? saved : t)
      : [saved, ...templates];

    setIsSaving(true);
    try {
      const persisted = await replaceAgentTemplates(user.tenantId, nextTemplates);
      setTemplates(persisted);
      setForm(persisted.find((template) => template.id === saved.id) || saved);
      setIsEditing(true);
      setError('');
    } catch (saveError) {
      setError((saveError as Error).message || '保存 Agent 失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user?.tenantId) return;
    const nextTemplates = templates.filter(t => t.id !== id);
    setIsSaving(true);
    try {
      const persisted = await replaceAgentTemplates(user.tenantId, nextTemplates);
      setTemplates(persisted);
      setError('');
      if (form.id === id) { setForm(newTemplate()); setIsEditing(false); }
    } catch (saveError) {
      setError((saveError as Error).message || '删除 Agent 失败');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTool = (tool: string) => {
    setForm(prev => ({
      ...prev,
      tools: prev.tools.includes(tool)
        ? prev.tools.filter(t => t !== tool)
        : [...prev.tools, tool],
    }));
  };

  const toggleMcp = (srv: string) => {
    setForm(prev => ({
      ...prev,
      mcpServers: prev.mcpServers.includes(srv)
        ? prev.mcpServers.filter(s => s !== srv)
        : [...prev.mcpServers, srv],
    }));
  };

  const toggleEventSource = (name: string) => {
    setForm(prev => ({
      ...prev,
      eventSources: (prev.eventSources || []).includes(name)
        ? (prev.eventSources || []).filter(s => s !== name)
        : [...(prev.eventSources || []), name],
    }));
  };

  const toggleSkill = (skill: string) => {
    setForm(prev => ({
      ...prev,
      skills: (prev.skills || []).includes(skill)
        ? (prev.skills || []).filter(s => s !== skill)
        : [...(prev.skills || []), skill],
    }));
  };

  const startChat = (t: AgentTemplate) => {
    navigate('/conversations');
  };

  return (
    <div>
      <div className="page-header">
        <h1>🤖 Agent 市场</h1>
        <p>创建可复用的 Agent 配置模版，选择工具和技能，保存后开启多轮对话</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20 }}>
        {/* 模板列表 */}
        <div>
          <button className="btn btn-primary mb-4" onClick={handleNew} style={{ width: '100%' }} disabled={isSaving}>
            + 新建 Agent
          </button>

          {isLoading ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: 40 }}>
              加载中...
            </div>
          ) : templates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: 40 }}>
              暂无 Agent，点击上方按钮创建
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map(t => (
                <div
                  key={t.id}
                  className={`agent-card ${form.id === t.id ? 'selected' : ''}`}
                  onClick={() => handleSelect(t)}
                >
                  <div className="flex-between">
                    <div className="agent-card-name">{t.name}</div>
                    <span style={{ fontSize: '.7em', color: 'var(--ink-muted)' }}>
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="agent-card-desc">{t.description || t.systemPrompt.slice(0, 80)}</div>
                  <div className="agent-card-tags">
                    <span className="badge badge-muted">{t.model}</span>
                    {t.tools.slice(0, 3).map(tool => <span key={tool} className="badge badge-info">{tool}</span>)}
                    {t.tools.length > 3 && <span className="badge badge-muted">+{t.tools.length - 3}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 编辑表单 */}
        <div>
          <div className="card">
            <div className="flex-between mb-4">
              <div className="card-header" style={{ marginBottom: 0 }}>
                {isEditing ? `编辑: ${form.name}` : '新建 Agent'}
              </div>
              <div className="flex gap-2">
                {isEditing && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => startChat(form)} disabled={isSaving}>💬 开始对话</button>
                    <button className="btn btn-sm btn-danger" onClick={() => { void handleDelete(form.id); }} disabled={isSaving}>删除</button>
                  </>
                )}
                <button className="btn btn-sm btn-primary" onClick={() => { void handleSave(); }} disabled={isSaving}>
                  {isSaving ? '保存中...' : '收养'}
                </button>
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>名称 *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：代码审查助手" />
              </div>
              <div className="form-group">
                <label>描述</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="简要描述这个 Agent 的功能" />
              </div>
            </div>

            <div className="form-group">
              <label>System Prompt（系统提示词）</label>
              <textarea
                value={form.systemPrompt}
                onChange={e => setForm({ ...form, systemPrompt: e.target.value })}
                rows={3}
                placeholder="你是一位资深的...&#10;&#10;请遵循以下规则：&#10;1. ..."
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>模型</label>
                <input
                  value={form.model}
                  onChange={e => setForm({ ...form, model: e.target.value })}
                  placeholder="deepseek-v4-pro[1m]"
                  list="model-suggestions"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="form-group">
                <label>效能等级</label>
                <select value={form.effort} onChange={e => setForm({ ...form, effort: e.target.value as EffortLevel })}>
                  {EFFORT_LEVELS.map(e => <option key={e.value} value={e.value}>{e.label} ({e.value})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>maxTurns</label>
                <input type="number" value={form.maxTurns} onChange={e => setForm({ ...form, maxTurns: Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>权限模式</label>
                <select value={form.permissionMode} onChange={e => setForm({ ...form, permissionMode: e.target.value as PermissionMode })}>
                  {PERMISSION_MODES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* 供应商配置覆盖 (Agent 级别) */}
            <details style={{ marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.85em', color: 'var(--warning)', marginBottom: 10 }}>
                ⚡ 供应商配置覆盖 (可选 — 留空则使用全局配置)
              </summary>
              <div className="grid-2" style={{ marginTop: 10, padding: '10px 14px', background: 'var(--warning-bg)', borderRadius: 6 }}>
                <div className="form-group">
                  <label>ANTHROPIC_AUTH_TOKEN</label>
                  <input
                    type="password"
                    value={form.providerOverrides?.ANTHROPIC_AUTH_TOKEN || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_AUTH_TOKEN: e.target.value } })}
                    placeholder="留空使用全局 Key"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label>ANTHROPIC_BASE_URL</label>
                  <input
                    value={form.providerOverrides?.ANTHROPIC_BASE_URL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_BASE_URL: e.target.value } })}
                    placeholder="留空使用全局端点"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}
                  />
                </div>
                <div className="form-group">
                  <label>ANTHROPIC_MODEL (覆盖模板 model)</label>
                  <input
                    value={form.providerOverrides?.ANTHROPIC_MODEL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_MODEL: e.target.value } })}
                    placeholder={`当前: ${form.model}`}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label>CLAUDE_CODE_SUBAGENT_MODEL</label>
                  <input
                    value={form.providerOverrides?.CLAUDE_CODE_SUBAGENT_MODEL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, CLAUDE_CODE_SUBAGENT_MODEL: e.target.value } })}
                    placeholder="子代理模型"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label>ANTHROPIC_DEFAULT_OPUS_MODEL</label>
                  <input
                    value={form.providerOverrides?.ANTHROPIC_DEFAULT_OPUS_MODEL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_DEFAULT_OPUS_MODEL: e.target.value } })}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label>ANTHROPIC_DEFAULT_SONNET_MODEL</label>
                  <input
                    value={form.providerOverrides?.ANTHROPIC_DEFAULT_SONNET_MODEL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_DEFAULT_SONNET_MODEL: e.target.value } })}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label>ANTHROPIC_DEFAULT_HAIKU_MODEL</label>
                  <input
                    value={form.providerOverrides?.ANTHROPIC_DEFAULT_HAIKU_MODEL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_DEFAULT_HAIKU_MODEL: e.target.value } })}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <div className="form-group">
                  <label>ANTHROPIC_REASONING_MODEL</label>
                  <input
                    value={form.providerOverrides?.ANTHROPIC_REASONING_MODEL || ''}
                    onChange={e => setForm({ ...form, providerOverrides: { ...form.providerOverrides, ANTHROPIC_REASONING_MODEL: e.target.value } })}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
            </details>

            {/* 工具选择 */}
            <div className="form-group">
              <label>启用的工具 (tools: string[]) — 已选 {form.tools.length} 个</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {TOOL_CATEGORIES.map(cat => (
                  <div key={cat.name}>
                    <div style={{ fontSize: '.72em', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
                      {cat.label}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {cat.tools.map(tool => (
                        <label
                          key={tool}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 8px', borderRadius: 4,
                            fontSize: '.76em', cursor: 'pointer',
                            background: form.tools.includes(tool) ? 'var(--accent-bg)' : 'var(--bg-hover)',
                            color: form.tools.includes(tool) ? 'var(--accent)' : 'var(--ink-secondary)',
                            border: `1px solid ${form.tools.includes(tool) ? 'var(--accent)' : 'transparent'}`,
                          }}
                        >
                          <input
                            type="checkbox" checked={form.tools.includes(tool)}
                            onChange={() => toggleTool(tool)}
                            style={{ width: 'auto', margin: 0 }}
                          />
                          {tool}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {/* 自定义工具（动态加载，和内置工具混在一起） */}
                {liveCustomTools.length > 0 && (
                  <div>
                    <div style={{ fontSize: '.72em', fontWeight: 600, color: 'var(--success)', marginBottom: 4, textTransform: 'uppercase' }}>
                      自定义 · <a href="/tools" style={{ color: 'var(--accent)', fontWeight: 400, textTransform: 'none' }}>管理</a>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {liveCustomTools.map(tool => (
                        <label
                          key={tool.name}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 8px', borderRadius: 4,
                            fontSize: '.76em', cursor: 'pointer',
                            background: form.tools.includes(tool.name) ? 'var(--accent-bg)' : 'var(--bg-hover)',
                            color: form.tools.includes(tool.name) ? 'var(--accent)' : 'var(--ink-secondary)',
                            border: `1px solid ${form.tools.includes(tool.name) ? 'var(--accent)' : 'transparent'}`,
                          }}
                        >
                          <input
                            type="checkbox" checked={form.tools.includes(tool.name)}
                            onChange={() => toggleTool(tool.name)}
                            style={{ width: 'auto', margin: 0 }}
                          />
                          {tool.name}
                          {tool.endpoint && <span style={{ fontSize: '.8em', opacity: .6 }}>🔗</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 技能选择 */}
            {liveSkills.length > 0 && (
              <div className="form-group">
                <label>技能 (Skills) — 已选 {(form.skills || []).length} 个 · <a href="/skills" style={{ color: 'var(--accent)', fontSize: '.85em' }}>管理技能</a></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {liveSkills.map(skill => (
                    <label
                      key={skill.name}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 4,
                        fontSize: '.76em', cursor: 'pointer',
                        background: (form.skills || []).includes(skill.name) ? 'var(--accent-bg)' : 'var(--bg-hover)',
                        color: (form.skills || []).includes(skill.name) ? 'var(--accent)' : 'var(--ink-secondary)',
                        border: `1px solid ${(form.skills || []).includes(skill.name) ? 'var(--accent)' : 'transparent'}`,
                        opacity: skill.enabled ? 1 : .5,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={(form.skills || []).includes(skill.name)}
                        onChange={() => toggleSkill(skill.name)}
                        disabled={!skill.enabled}
                        style={{ width: 'auto', margin: 0 }}
                      />
                      {skill.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* MCP 服务器选择 */}
            <div className="form-group">
              <label>MCP 服务器 · <a href="/tools" style={{ color: 'var(--accent)', fontSize: '.85em' }}>管理</a></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(liveMcp.length > 0 ? liveMcp : MOCK_MCP_SERVERS).map(srv => (
                  <label
                    key={srv.name}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 4,
                      fontSize: '.76em', cursor: 'pointer',
                      background: form.mcpServers.includes(srv.name) ? 'var(--info-bg)' : 'var(--bg-hover)',
                      color: form.mcpServers.includes(srv.name) ? 'var(--info)' : 'var(--ink-secondary)',
                      border: `1px solid ${form.mcpServers.includes(srv.name) ? 'var(--info)' : 'transparent'}`,
                    }}
                  >
                    <input
                      type="checkbox" checked={form.mcpServers.includes(srv.name)}
                      onChange={() => toggleMcp(srv.name)}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    {srv.name}
                  </label>
                ))}
                {liveMcp.length === 0 && (
                  <span style={{ fontSize: '.76em', color: 'var(--ink-muted)' }}>暂无自定义 MCP 服务器，显示默认列表</span>
                )}
              </div>
            </div>

            {/* 事件订阅 (EventSource) */}
            {liveEventSources.length > 0 && (
              <div className="form-group">
                <label>📡 事件订阅 (EventSource) · 已选 {(form.eventSources || []).length} 个</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {liveEventSources.map(es => (
                    <label
                      key={es.name}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 4, fontSize: '.76em', cursor: 'pointer',
                        background: (form.eventSources || []).includes(es.name) ? 'var(--accent-bg)' : 'var(--bg-hover)',
                        color: (form.eventSources || []).includes(es.name) ? 'var(--accent)' : 'var(--ink-secondary)',
                        border: `1px solid ${(form.eventSources || []).includes(es.name) ? 'var(--accent)' : 'transparent'}`,
                      }}
                    >
                      <input type="checkbox" checked={(form.eventSources || []).includes(es.name)}
                        onChange={() => toggleEventSource(es.name)} style={{ width: 'auto', margin: 0 }} />
                      📡 {es.name}
                      <span style={{ opacity: .5, fontSize: '.9em' }}>({es.type})</span>
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: '.7em', color: 'var(--ink-muted)', marginTop: 4 }}>
                  勾选后，该 Agent 的会话将实时接收事件推送
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <datalist id="model-suggestions">
        <option value="deepseek-v4-pro[1m]" />
        <option value="deepseek-v4-flash" />
        <option value="claude-opus-4-7" />
        <option value="claude-sonnet-4-6" />
        <option value="claude-haiku-4-5-20251001" />
      </datalist>
    </div>
  );
}
