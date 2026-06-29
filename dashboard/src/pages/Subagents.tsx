import { useEffect, useMemo, useState } from 'react';
import type { AgentDefinition, AgentTemplate, EffortLevel, PermissionMode } from '../simulator/types';
import { EFFORT_LEVELS, PERMISSION_MODES } from '../simulator/mock-data';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, loadCachedAgentTemplates, replaceAgentTemplates } from '../utils/agent-templates';
import { listProviderModels, resolveProviderForModel } from '../utils/providers';
import ModelPicker from '../components/common/ModelPicker';
import StatusBadge from '../components/common/StatusBadge';
import JsonViewer from '../components/common/JsonViewer';

type SubagentForm = AgentDefinition & { name: string; toolsText: string };

function newSubagentForm(): SubagentForm {
  return {
    name: '',
    description: '',
    prompt: '',
    tools: ['Read', 'Grep', 'Glob'],
    toolsText: 'Read, Grep, Glob',
    model: '',
    effort: 'medium',
    background: false,
    permissionMode: 'default',
  };
}

function toForm(name: string, agent: AgentDefinition): SubagentForm {
  return {
    ...agent,
    name,
    toolsText: (agent.tools || []).join(', '),
    model: agent.model || '',
    effort: agent.effort || 'medium',
    background: Boolean(agent.background),
    permissionMode: agent.permissionMode || 'default',
  };
}

function fromForm(form: SubagentForm): AgentDefinition {
  return {
    description: form.description.trim(),
    prompt: form.prompt.trim(),
    tools: form.toolsText.split(',').map((item) => item.trim()).filter(Boolean),
    model: form.model?.trim() || undefined,
    effort: form.effort,
    background: Boolean(form.background) || undefined,
    permissionMode: form.permissionMode,
  };
}

function userAgentActor(user: { email?: string; id?: string } | null) {
  return user?.email || user?.id || '';
}

function canManageTemplate(user: { email?: string; id?: string; role?: string } | null, template: AgentTemplate) {
  return user?.role === 'tenant_admin' || Boolean(userAgentActor(user) && template.createdBy === userAgentActor(user));
}

export default function Subagents() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<AgentTemplate[]>(() => loadCachedAgentTemplates(user?.tenantId));
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedAgentName, setSelectedAgentName] = useState('');
  const [form, setForm] = useState<SubagentForm>(newSubagentForm());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const modelSuggestions = listProviderModels();
  const availableModelSet = new Set(modelSuggestions);

  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;
    setTemplates(loadCachedAgentTemplates(user.tenantId));
    void bootstrapAgentTemplates(user.tenantId, user.role === 'tenant_admin')
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch((loadError) => {
        if (!cancelled) setError((loadError as Error).message || '加载 Agent 模板失败');
      });
    return () => { cancelled = true; };
  }, [user?.tenantId, user?.role]);

  const editableTemplates = useMemo(
    () => templates.filter((template) => canManageTemplate(user || null, template)),
    [templates, user],
  );
  const activeTemplateId = selectedTemplateId && editableTemplates.some((template) => template.id === selectedTemplateId)
    ? selectedTemplateId
    : editableTemplates[0]?.id || '';

  const selectedTemplate = useMemo(
    () => editableTemplates.find((template) => template.id === activeTemplateId) || null,
    [editableTemplates, activeTemplateId],
  );

  const subagentEntries = Object.entries(selectedTemplate?.subagents || {});
  const selectedSubagentModel = form.model?.trim() || '';
  const selectedTemplateModel = selectedTemplate?.model?.trim() || '';
  const selectedSubagentModelAvailable = selectedSubagentModel ? availableModelSet.has(selectedSubagentModel) : false;
  const subagentProviderMatch = selectedSubagentModelAvailable ? resolveProviderForModel(selectedSubagentModel) : null;
  const templateProviderMatch = selectedTemplateModel ? resolveProviderForModel(selectedTemplateModel) : null;
  const crossProviderModel = Boolean(
    selectedSubagentModel
    && subagentProviderMatch
    && templateProviderMatch
    && subagentProviderMatch.profile.id !== templateProviderMatch.profile.id,
  );

  const handleSelectSubagent = (name: string, agent: AgentDefinition) => {
    setSelectedAgentName(name);
    setForm(toForm(name, agent));
  };

  const handleNewSubagent = () => {
    setSelectedAgentName('');
    setForm(newSubagentForm());
  };

  const saveSubagent = async () => {
    if (!user?.tenantId || !selectedTemplate || !form.name.trim() || !form.description.trim() || !form.prompt.trim()) return;
    if (selectedSubagentModel && !selectedSubagentModelAvailable) {
      setError('请选择供应商中已配置的可用模型，或留空继承主模型');
      return;
    }
    if (crossProviderModel) {
      setError('子代理模型属于另一个供应商；同一次 SDK 运行只能使用一个供应商');
      return;
    }
    const name = form.name.trim();
    const agent = fromForm(form);
    const nextTemplates = templates.map((template) => {
      if (template.id !== selectedTemplate.id) return template;
      const subagents = { ...(template.subagents || {}) };
      if (selectedAgentName && selectedAgentName !== name) delete subagents[selectedAgentName];
      subagents[name] = agent;
      return {
        ...template,
        tools: template.tools.includes('Agent') ? template.tools : [...template.tools, 'Agent'],
        subagents,
        updatedAt: Date.now(),
      };
    });
    setIsSaving(true);
    try {
      const saved = await replaceAgentTemplates(user.tenantId, nextTemplates);
      setTemplates(saved);
      setSelectedAgentName(name);
      setForm(toForm(name, agent));
      setError('');
    } catch (saveError) {
      setError((saveError as Error).message || '保存子代理失败');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSubagent = async (name: string) => {
    if (!user?.tenantId || !selectedTemplate) return;
    const nextTemplates = templates.map((template) => {
      if (template.id !== selectedTemplate.id) return template;
      const subagents = { ...(template.subagents || {}) };
      delete subagents[name];
      return { ...template, subagents, updatedAt: Date.now() };
    });
    setIsSaving(true);
    try {
      const saved = await replaceAgentTemplates(user.tenantId, nextTemplates);
      setTemplates(saved);
      if (selectedAgentName === name) handleNewSubagent();
      setError('');
    } catch (saveError) {
      setError((saveError as Error).message || '删除子代理失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>子代理管理</h1>
        <p>编辑 Agent 模板里的 SDK agents；聊天运行时通过 Agent tool 调用并显示任务事件</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 420px) 1fr', gap: 20 }}>
        <div>
          <div className="card">
            <div className="form-group">
              <label>Agent 模板</label>
              <select value={activeTemplateId} onChange={e => { setSelectedTemplateId(e.target.value); handleNewSubagent(); }}>
                {editableTemplates.length === 0 && <option value="">暂无可编辑 Agent 模板</option>}
                {editableTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              {templates.length > editableTemplates.length && (
                <div style={{ marginTop: 6, color: 'var(--ink-muted)', fontSize: '.74em' }}>
                  公共 Agent 只能克隆或对话，不能在这里直接编辑子代理。
                </div>
              )}
            </div>

            <div className="flex-between" style={{ marginBottom: 12 }}>
              <div className="card-header" style={{ marginBottom: 0 }}>AgentDefinition 列表</div>
              <button className="btn btn-sm btn-primary" onClick={handleNewSubagent} disabled={!selectedTemplate}>
                + 新代理
              </button>
            </div>

            {subagentEntries.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.82em', padding: '20px 0', textAlign: 'center' }}>
                当前模板还没有子代理
              </div>
            ) : (
              subagentEntries.map(([name, agent]) => (
                <div key={name} className="tool-card mb-2" onClick={() => handleSelectSubagent(name, agent)} style={{ cursor: 'pointer', borderColor: selectedAgentName === name ? 'var(--accent)' : undefined }}>
                  <div className="flex-between">
                    <div className="tool-card-name">{name}</div>
                    {agent.background && <StatusBadge status="info" label="后台" />}
                  </div>
                  <div className="tool-card-desc">{agent.description}</div>
                  <div className="mt-2 flex gap-2" style={{ flexWrap: 'wrap' }}>
                    {agent.model && <span className="badge badge-muted">model: {agent.model}</span>}
                    {agent.effort && <span className="badge badge-muted">effort: {agent.effort}</span>}
                    {(agent.tools || []).map(t => <span key={t} className="badge badge-info">{t}</span>)}
                  </div>
                </div>
              ))
            )}
          </div>

          {selectedTemplate && (
            <div className="card mt-4 fade-in">
              <div className="card-header">运行配置预览</div>
              <JsonViewer data={{ template: selectedTemplate.name, tools: selectedTemplate.tools, subagents: selectedTemplate.subagents || {} }} maxHeight={260} />
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <div className="card-header" style={{ marginBottom: 0 }}>
                {selectedAgentName ? `编辑: ${selectedAgentName}` : '新建子代理'}
              </div>
              {selectedAgentName && (
                <button className="btn btn-sm btn-danger" onClick={() => { void deleteSubagent(selectedAgentName); }} disabled={isSaving}>
                  删除
                </button>
              )}
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>名称 *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="code-reviewer" style={{ fontFamily: 'var(--font-mono)' }} />
              </div>
              <div className="form-group">
                <label className="flex gap-2" style={{ alignItems: 'center' }}>
                  模型覆盖
                  {selectedSubagentModel
                    ? (
                        crossProviderModel
                          ? <span className="badge badge-warning">跨供应商</span>
                          : selectedSubagentModelAvailable && subagentProviderMatch
                            ? <span className="badge badge-muted">{subagentProviderMatch.profile.name}</span>
                            : <span className="badge badge-warning">不可用</span>
                      )
                    : <span className="badge badge-muted">继承</span>}
                </label>
                <ModelPicker
                  value={form.model || ''}
                  models={modelSuggestions}
                  onChange={model => setForm({ ...form, model })}
                  allowEmpty
                  placeholder="留空继承主模型"
                />
              </div>
            </div>

            <div className="form-group">
              <label>description *</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="何时使用这个子代理" />
            </div>

            <div className="form-group">
              <label>prompt *</label>
              <textarea value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} rows={4} placeholder="子代理系统提示词" style={{ resize: 'vertical' }} />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>tools</label>
                <input value={form.toolsText} onChange={e => setForm({ ...form, toolsText: e.target.value })} placeholder="Read, Grep, Glob" style={{ fontFamily: 'var(--font-mono)' }} />
              </div>
              <div className="form-group">
                <label>effort</label>
                <select value={form.effort || ''} onChange={e => setForm({ ...form, effort: e.target.value as EffortLevel })}>
                  {EFFORT_LEVELS.map(e => <option key={e.value} value={e.value}>{e.label} ({e.value})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>权限模式</label>
                <select value={form.permissionMode || 'default'} onChange={e => setForm({ ...form, permissionMode: e.target.value as PermissionMode })}>
                  {PERMISSION_MODES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                <input type="checkbox" checked={Boolean(form.background)} onChange={e => setForm({ ...form, background: e.target.checked })} style={{ width: 'auto' }} />
                background
              </label>
            </div>

            <button className="btn btn-primary btn-sm" onClick={() => { void saveSubagent(); }} disabled={isSaving || !selectedTemplate || !form.name.trim() || !form.description.trim() || !form.prompt.trim()}>
              {isSaving ? '保存中...' : '保存到模板'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
