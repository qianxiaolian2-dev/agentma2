import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentDefinition, AgentTemplate, EffortLevel, PermissionMode, SkillInfo, RegisteredTool } from '../simulator/types';
import { EFFORT_LEVELS, PERMISSION_MODES, DEFAULT_SKILLS, initCustomTools } from '../simulator/mock-data';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, loadCachedAgentTemplates, replaceAgentTemplates } from '../utils/agent-templates';
import { getAuthHeaders } from '../utils/client-runtime';

type KnowledgeSource = {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
};

function loadSkills(): SkillInfo[] {
  try { const raw = localStorage.getItem('agentma_skills'); if (raw) return JSON.parse(raw); } catch {}
  return DEFAULT_SKILLS;
}

function loadMcpServers(): { name: string }[] {
  try { const raw = localStorage.getItem('agentma_mcp_servers'); if (raw) return JSON.parse(raw); } catch {}
  return [];
}

function normalizeKnowledgeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const path = typeof raw.path === 'string' ? raw.path : '';
    if (!id || !path) return [];
    return [{
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : path.split('/').filter(Boolean).pop() || '知识库',
      path,
      enabled: raw.enabled !== false,
    }];
  });
}

function newTemplate(): AgentTemplate {
  return {
    id: '', name: '', description: '', systemPrompt: '',
    model: 'deepseek-v4-pro[1m]', tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    mcpServers: [], eventSources: [], skills: [], knowledgeSourceIds: [],
    effort: 'high', maxTurns: 50, permissionMode: 'default',
    providerOverrides: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function defaultSubagent(): AgentDefinition {
  return {
    description: '只读代码探索代理',
    prompt: '你是一个只读代码探索子代理。分析文件和结构，最后给出简短结论，不修改文件。',
    tools: ['Read', 'Grep', 'Glob'],
    effort: 'medium',
    permissionMode: 'default',
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
const KNOWLEDGE_TOOLS = ['Read', 'Grep', 'Glob'];

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
  const [liveKnowledgeSources, setLiveKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [liveEventSources, setLiveEventSources] = useState<Array<{ name: string; type: string; url: string; enabled: boolean }>>([]);

  useEffect(() => {
    fetch('/api/events/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) })
      .then(r => r.json()).then(data => { if (Array.isArray(data)) setLiveEventSources(data); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.tenantId) return;
    fetch('/api/knowledge/sources', { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setLiveKnowledgeSources(normalizeKnowledgeSources(data)))
      .catch(() => setLiveKnowledgeSources([]));
  }, [user?.tenantId]);
  const [liveCustomTools, setLiveCustomTools] = useState<RegisteredTool[]>(() => initCustomTools());
  const subagentEntries = Object.entries(form.subagents || {});

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
      const selectedKnowledgeIds = (current.knowledgeSourceIds || []).length
        ? current.knowledgeSourceIds || []
        : current.useKnowledge
          ? liveKnowledgeSources.filter(source => source.enabled).map(source => source.id)
          : [];
      setForm({
        ...current,
        knowledgeSourceIds: selectedKnowledgeIds,
        useKnowledge: selectedKnowledgeIds.length > 0 || current.useKnowledge || undefined,
      });
      setIsEditing(true);
      return;
    }
    if (isEditing) {
      setForm(newTemplate());
      setIsEditing(false);
    }
  }, [templates, form.id, isEditing, liveKnowledgeSources]);

  const handleSelect = (t: AgentTemplate) => {
    const selectedKnowledgeIds = (t.knowledgeSourceIds || []).length
      ? t.knowledgeSourceIds || []
      : t.useKnowledge
        ? liveKnowledgeSources.filter(source => source.enabled).map(source => source.id)
        : [];
    setForm({
      ...t,
      knowledgeSourceIds: selectedKnowledgeIds,
      useKnowledge: selectedKnowledgeIds.length > 0 || t.useKnowledge || undefined,
    });
    setIsEditing(true);
  };

  const handleNew = () => {
    setForm(newTemplate());
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !user?.tenantId) return;
    const now = Date.now();
    const selectedKnowledgeIds = (form.knowledgeSourceIds || []).filter(Boolean);
    const hasLegacyAllKnowledge = Boolean(form.useKnowledge && selectedKnowledgeIds.length === 0 && liveKnowledgeSources.length === 0);
    const saved: AgentTemplate = {
      ...form,
      id: form.id || `agent-${now}`,
      name: form.name.trim(),
      knowledgeSourceIds: selectedKnowledgeIds,
      useKnowledge: selectedKnowledgeIds.length > 0 || hasLegacyAllKnowledge || undefined,
      tools: selectedKnowledgeIds.length > 0 || hasLegacyAllKnowledge
        ? Array.from(new Set([...form.tools, ...KNOWLEDGE_TOOLS]))
        : form.tools,
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

  const toggleKnowledgeSource = (sourceId: string) => {
    setForm(prev => ({
      ...prev,
      knowledgeSourceIds: (prev.knowledgeSourceIds || []).includes(sourceId)
        ? (prev.knowledgeSourceIds || []).filter(id => id !== sourceId)
        : [...(prev.knowledgeSourceIds || []), sourceId],
    }));
  };

  const addSubagent = () => {
    setForm(prev => {
      const count = Object.keys(prev.subagents || {}).length + 1;
      return {
        ...prev,
        tools: prev.tools.includes('Agent') ? prev.tools : [...prev.tools, 'Agent'],
        subagents: {
          ...(prev.subagents || {}),
          [`worker-${count}`]: defaultSubagent(),
        },
      };
    });
  };

  const renameSubagent = (oldName: string, nextName: string) => {
    const cleanName = nextName.trim();
    if (!cleanName || cleanName === oldName) return;
    setForm(prev => {
      const subagents = { ...(prev.subagents || {}) };
      if (!subagents[oldName] || subagents[cleanName]) return prev;
      subagents[cleanName] = subagents[oldName];
      delete subagents[oldName];
      return { ...prev, subagents };
    });
  };

  const updateSubagent = (name: string, patch: Partial<AgentDefinition>) => {
    setForm(prev => ({
      ...prev,
      subagents: {
        ...(prev.subagents || {}),
        [name]: { ...(prev.subagents || {})[name], ...patch },
      },
    }));
  };

  const deleteSubagent = (name: string) => {
    setForm(prev => {
      const subagents = { ...(prev.subagents || {}) };
      delete subagents[name];
      return { ...prev, subagents };
    });
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

  const startChat = () => {
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
                    {((t.knowledgeSourceIds || []).length > 0 || t.useKnowledge) && (
                      <span className="badge badge-success">
                        知识库×{(t.knowledgeSourceIds || []).length || liveKnowledgeSources.filter(source => source.enabled).length || '全部'}
                      </span>
                    )}
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
                    <button className="btn btn-sm btn-primary" onClick={startChat} disabled={isSaving}>💬 开始对话</button>
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
            <details className="provider-overrides-panel">
              <summary className="provider-overrides-summary">
                ⚡ 供应商配置覆盖 (可选 — 留空则使用全局配置)
              </summary>
              <div className="grid-2 provider-overrides-grid">
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

            {/* 结构化输出 */}
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '.82em', color: 'var(--ink-secondary)', marginBottom: 8 }}>
                结构化输出 (outputSchema) {form.outputSchema ? '✓' : '— 可选'}
              </summary>
              <div className="form-group">
                <label>JSON Schema（留空 = 纯文本输出）</label>
                <textarea
                  rows={6}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '.76em', resize: 'vertical' }}
                  placeholder={'{\n  "type": "object",\n  "properties": {\n    "title": { "type": "string" },\n    "summary": { "type": "string" }\n  },\n  "required": ["title", "summary"]\n}'}
                  value={form.outputSchema ? JSON.stringify(form.outputSchema, null, 2) : ''}
                  onChange={e => {
                    const raw = e.target.value.trim();
                    if (!raw) { setForm({ ...form, outputSchema: undefined }); return; }
                    try { setForm({ ...form, outputSchema: JSON.parse(raw) }); } catch { /* keep existing until valid */ }
                  }}
                />
                {form.outputSchema && (
                  <div style={{ fontSize: '.72em', color: 'var(--success)', marginTop: 4 }}>schema 有效，运行时启用结构化输出</div>
                )}
              </div>
            </details>

            {/* 文件检查点 */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(form.enableFileCheckpointing)}
                onChange={e => setForm({ ...form, enableFileCheckpointing: e.target.checked || undefined })}
                style={{ width: 'auto' }}
              />
              <span style={{ fontSize: '.85em' }}>
                enableFileCheckpointing — 编辑前快照文件，支持 /rewind 回滚
              </span>
            </label>

            {/* 知识库选择 */}
            <div className="form-group">
              <label>
                知识库 (Knowledge) — 已选 {(form.knowledgeSourceIds || []).length} 个 ·{' '}
                <a href="/knowledge" style={{ color: 'var(--accent)', fontSize: '.85em' }}>管理知识库</a>
              </label>
              {liveKnowledgeSources.length === 0 ? (
                <div style={{ color: 'var(--ink-muted)', fontSize: '.78em', padding: '8px 0' }}>
                  暂无知识库，请先在知识库页面创建。
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {liveKnowledgeSources.map(source => {
                    const selected = (form.knowledgeSourceIds || []).includes(source.id);
                    return (
                      <label
                        key={source.id}
                        title={source.path}
                        style={{
                          display: 'inline-grid',
                          gridTemplateColumns: 'auto minmax(0, 1fr)',
                          alignItems: 'start',
                          gap: 6,
                          padding: '6px 9px',
                          borderRadius: 4,
                          fontSize: '.76em',
                          cursor: source.enabled || selected ? 'pointer' : 'not-allowed',
                          background: selected ? 'var(--success-bg)' : 'var(--bg-hover)',
                          color: selected ? 'var(--success)' : 'var(--ink-secondary)',
                          border: `1px solid ${selected ? 'var(--success)' : 'transparent'}`,
                          opacity: source.enabled ? 1 : .5,
                          maxWidth: 340,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleKnowledgeSource(source.id)}
                          disabled={!source.enabled && !selected}
                          style={{ width: 'auto', margin: '2px 0 0' }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 700 }}>{source.name}</span>
                          <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.8em', color: 'inherit', opacity: .72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {source.path}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

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

            {/* 子代理定义 */}
            <div className="form-group">
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <label style={{ marginBottom: 0 }}>子代理 (SDK agents) — 已定义 {subagentEntries.length} 个</label>
                <button type="button" className="btn btn-sm btn-primary" onClick={addSubagent}>
                  + 子代理
                </button>
              </div>
              {subagentEntries.length === 0 ? (
                <div style={{ color: 'var(--ink-muted)', fontSize: '.78em', padding: '8px 0' }}>
                  添加后会自动启用 Agent 工具，运行时通过 SDK Agent tool 调用。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {subagentEntries.map(([name, agent]) => (
                    <div key={name} className="tool-card" style={{ padding: 12 }}>
                      <div className="grid-2">
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label>名称</label>
                          <input
                            defaultValue={name}
                            onBlur={e => renameSubagent(name, e.target.value)}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label>模型覆盖</label>
                          <input
                            value={agent.model || ''}
                            onChange={e => updateSubagent(name, { model: e.target.value || undefined })}
                            placeholder="留空继承主模型"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label>description</label>
                        <input
                          value={agent.description}
                          onChange={e => updateSubagent(name, { description: e.target.value })}
                          placeholder="何时使用这个子代理"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 8 }}>
                        <label>prompt</label>
                        <textarea
                          value={agent.prompt}
                          onChange={e => updateSubagent(name, { prompt: e.target.value })}
                          rows={2}
                          placeholder="子代理系统提示词"
                          style={{ resize: 'vertical' }}
                        />
                      </div>
                      <div className="grid-2">
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label>tools</label>
                          <input
                            value={(agent.tools || []).join(', ')}
                            onChange={e => updateSubagent(name, { tools: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                            placeholder="Read, Grep, Glob"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label>maxTurns</label>
                          <input
                            type="number"
                            value={agent.maxTurns || ''}
                            onChange={e => updateSubagent(name, { maxTurns: Number(e.target.value) || undefined })}
                            placeholder="继承默认"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label>effort</label>
                          <select value={agent.effort || ''} onChange={e => updateSubagent(name, { effort: e.target.value as EffortLevel || undefined })}>
                            <option value="">继承</option>
                            {EFFORT_LEVELS.map(e => <option key={e.value} value={e.value}>{e.label} ({e.value})</option>)}
                          </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label>权限模式</label>
                          <select value={agent.permissionMode || ''} onChange={e => updateSubagent(name, { permissionMode: e.target.value as PermissionMode || undefined })}>
                            <option value="">继承</option>
                            {PERMISSION_MODES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex-between">
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: '.78em' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(agent.background)}
                            onChange={e => updateSubagent(name, { background: e.target.checked || undefined })}
                            style={{ width: 'auto', margin: 0 }}
                          />
                          background
                        </label>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteSubagent(name)}>
                          删除子代理
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                {liveMcp.map(srv => (
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
