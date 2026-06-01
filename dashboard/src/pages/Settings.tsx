import { useState, useCallback, useEffect, useRef } from 'react';
import type { SdkOptions, ProviderConfig } from '../simulator/types';
import { getDefaultOptions, getDefaultProviderConfig } from '../simulator/mock-data';
import JsonViewer from '../components/common/JsonViewer';
import CodeBlock from '../components/common/CodeBlock';

const LS_PROVIDER = 'agentma_provider_config';
const LS_OPTIONS = 'agentma_sdk_options';

function loadProvider(): ProviderConfig {
  try {
    const raw = localStorage.getItem(LS_PROVIDER);
    if (raw) return { ...getDefaultProviderConfig(), ...JSON.parse(raw) };
  } catch {}
  return getDefaultProviderConfig();
}

function loadOptions(): SdkOptions {
  try {
    const raw = localStorage.getItem(LS_OPTIONS);
    if (raw) return { ...getDefaultOptions(), ...JSON.parse(raw) };
  } catch {}
  return getDefaultOptions();
}

// env > options 的三组冲突映射
const CONFLICT_PAIRS: { optionsKey: keyof SdkOptions; providerKey: keyof ProviderConfig; label: string }[] = [
  { optionsKey: 'model', providerKey: 'ANTHROPIC_MODEL', label: 'model' },
  { optionsKey: 'effort', providerKey: 'CLAUDE_CODE_EFFORT_LEVEL', label: 'effort' },
];

export default function Settings() {
  const [options, setOptions] = useState<SdkOptions>(loadOptions);
  const [provider, setProvider] = useState<ProviderConfig>(loadProvider);
  const [showEnvPreview, setShowEnvPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // provider 变更时自动保存到 localStorage
  useEffect(() => {
    localStorage.setItem(LS_PROVIDER, JSON.stringify(provider));
    setSaved(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaved(false), 1500);
  }, [provider]);

  // options 变更时自动保存
  useEffect(() => {
    localStorage.setItem(LS_OPTIONS, JSON.stringify(options));
  }, [options]);

  // 检查是否有冲突（env 设置会覆盖 options 中的对应字段）
  const hasConflict = useCallback((optionsKey: keyof SdkOptions, providerKey: keyof ProviderConfig): boolean => {
    const ov = options[optionsKey];
    const pv = provider[providerKey];
    if (ov === undefined || ov === null || !pv) return false;
    // 如果两者都有值且不同，env 会覆盖 options
    return String(ov) !== String(pv);
  }, [options, provider]);

  const updateField = <K extends keyof SdkOptions>(key: K, value: SdkOptions[K]) => {
    setOptions(prev => {
      const next = { ...prev, [key]: value };
      // 双向同步：修改 options 时同步更新 provider
      const pair = CONFLICT_PAIRS.find(p => p.optionsKey === key);
      if (pair) {
        setProvider(prevP => ({ ...prevP, [pair.providerKey]: value }));
      }
      return next;
    });
  };

  const updateProvider = <K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) => {
    setProvider(prev => {
      const next = { ...prev, [key]: value };
      // 双向同步：修改 provider env 时同步更新 options
      const pair = CONFLICT_PAIRS.find(p => p.providerKey === key);
      if (pair) {
        setOptions(prevO => ({ ...prevO, [pair.optionsKey]: value as never }));
      }
      return next;
    });
  };

  const resetToDefaults = () => {
    setOptions(getDefaultOptions());
    setProvider(getDefaultProviderConfig());
  };

  const clearSaved = () => {
    localStorage.removeItem(LS_PROVIDER);
    localStorage.removeItem(LS_OPTIONS);
    setProvider(getDefaultProviderConfig());
    setOptions(getDefaultOptions());
    setSaved(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1>⚙ Options 配置</h1>
        <p>SdkOptions / ClaudeAgentOptions — 完整的 SDK 初始化配置</p>
      </div>

      {/* 优先级说明 */}
      <div className="card mb-4" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning)' }}>
        <div className="flex gap-3" style={{ alignItems: 'flex-start' }}>
          <span style={{ fontSize: '1.2em' }}>⚠</span>
          <div style={{ fontSize: '.84em' }}>
            <strong>环境变量优先级高于 Options：</strong>
            同时设置时，<code>ANTHROPIC_MODEL</code> 会覆盖 <code>options.model</code>，
            <code>CLAUDE_CODE_EFFORT_LEVEL</code> 会覆盖 <code>options.effort</code>。
            此页面已做联动处理 — 修改任一侧，另一侧自动同步。带
            <span className="badge badge-warning" style={{ marginLeft: 4, marginRight: 4 }}>冲突</span>
            标记表示两侧值不一致，以供应商配置为准。
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 左侧：SdkOptions */}
        <div>
          <div className="card">
            <div className="card-header">基础配置</div>
            <div className="grid-2">
              <div className="form-group">
                <label className="flex gap-2" style={{ alignItems: 'center' }}>
                  model
                  {hasConflict('model', 'ANTHROPIC_MODEL') && (
                    <span className="badge badge-warning" title={`被 ANTHROPIC_MODEL="${provider.ANTHROPIC_MODEL}" 覆盖`}>被 env 覆盖</span>
                  )}
                </label>
                <input
                  value={String(options.model || '')}
                  onChange={e => updateField('model', e.target.value)}
                  placeholder="deepseek-v4-pro[1m]"
                  list="model-suggestions"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                <datalist id="model-suggestions">
                  <option value="deepseek-v4-pro[1m]" />
                  <option value="deepseek-v4-flash" />
                  <option value="claude-opus-4-7" />
                  <option value="claude-sonnet-4-6" />
                  <option value="claude-haiku-4-5-20251001" />
                </datalist>
                {hasConflict('model', 'ANTHROPIC_MODEL') && (
                  <div style={{ fontSize: '.72em', color: 'var(--warning)', marginTop: 2 }}>
                    实际生效: {provider.ANTHROPIC_MODEL}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>fallbackModel</label>
                <input value={String(options.fallbackModel || '')} onChange={e => updateField('fallbackModel', e.target.value || undefined)} placeholder="可选回退模型" />
              </div>
              <div className="form-group">
                <label>permissionMode</label>
                <select value={String(options.permissionMode || 'default')} onChange={e => updateField('permissionMode', e.target.value as SdkOptions['permissionMode'])}>
                  <option value="default">default</option>
                  <option value="acceptEdits">acceptEdits</option>
                  <option value="bypassPermissions">bypassPermissions</option>
                  <option value="plan">plan</option>
                  <option value="dontAsk">dontAsk</option>
                  <option value="auto">auto</option>
                </select>
              </div>
              <div className="form-group">
                <label className="flex gap-2" style={{ alignItems: 'center' }}>
                  effort
                  {hasConflict('effort', 'CLAUDE_CODE_EFFORT_LEVEL') && (
                    <span className="badge badge-warning" title={`被 CLAUDE_CODE_EFFORT_LEVEL="${provider.CLAUDE_CODE_EFFORT_LEVEL}" 覆盖`}>被 env 覆盖</span>
                  )}
                </label>
                <select value={String(options.effort || 'high')} onChange={e => updateField('effort', e.target.value as SdkOptions['effort'])}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
                {hasConflict('effort', 'CLAUDE_CODE_EFFORT_LEVEL') && (
                  <div style={{ fontSize: '.72em', color: 'var(--warning)', marginTop: 2 }}>
                    实际生效: {provider.CLAUDE_CODE_EFFORT_LEVEL}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>executable</label>
                <select value={String(options.executable || 'node')} onChange={e => updateField('executable', e.target.value as SdkOptions['executable'])}>
                  <option value="node">node</option>
                  <option value="bun">bun</option>
                  <option value="deno">deno</option>
                </select>
              </div>
              <div className="form-group">
                <label>settingSources</label>
                <select multiple value={options.settingSources || []} onChange={e => updateField('settingSources', Array.from(e.target.selectedOptions, o => o.value as 'user' | 'project' | 'local'))} style={{ height: 60 }}>
                  <option value="user">user</option>
                  <option value="project">project</option>
                  <option value="local">local</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">会话配置</div>
            <div className="grid-2">
              <div className="form-group">
                <label>sessionId</label>
                <input value={String(options.sessionId || '')} onChange={e => updateField('sessionId', e.target.value || undefined)} placeholder="自动生成" />
              </div>
              <div className="form-group">
                <label>resume (会话ID)</label>
                <input value={String(options.resume || '')} onChange={e => updateField('resume', e.target.value || undefined)} placeholder="恢复已有会话" />
              </div>
              <div className="form-group">
                <label>title</label>
                <input value={String(options.title || '')} onChange={e => updateField('title', e.target.value || undefined)} />
              </div>
              <div className="form-group">
                <label>cwd (工作目录)</label>
                <input value={String(options.cwd || '')} onChange={e => updateField('cwd', e.target.value || undefined)} placeholder="process.cwd()" />
              </div>
              <div className="form-group">
                <label>sessionStoreFlush</label>
                <select value={String(options.sessionStoreFlush || 'batched')} onChange={e => updateField('sessionStoreFlush', e.target.value as 'batched' | 'eager')}>
                  <option value="batched">batched</option>
                  <option value="eager">eager</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">限制配置</div>
            <div className="grid-2">
              <div className="form-group">
                <label>maxTurns</label>
                <input type="number" value={options.maxTurns || ''} onChange={e => updateField('maxTurns', Number(e.target.value) || undefined)} />
              </div>
              <div className="form-group">
                <label>maxBudgetUsd</label>
                <input type="number" step="0.1" value={options.maxBudgetUsd || ''} onChange={e => updateField('maxBudgetUsd', Number(e.target.value) || undefined)} />
              </div>
              <div className="form-group">
                <label>maxThinkingTokens</label>
                <input type="number" value={options.maxThinkingTokens || ''} onChange={e => updateField('maxThinkingTokens', Number(e.target.value) || undefined)} />
              </div>
              <div className="form-group">
                <label>loadTimeoutMs</label>
                <input type="number" value={options.loadTimeoutMs || ''} onChange={e => updateField('loadTimeoutMs', Number(e.target.value) || undefined)} />
              </div>
              <div className="form-group">
                <label>taskBudget.total</label>
                <input type="number" value={options.taskBudget?.total || ''} onChange={e => updateField('taskBudget', e.target.value ? { total: Number(e.target.value) } : undefined)} />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧 */}
        <div>
          <div className="card">
            <div className="card-header">功能开关</div>
            <div className="grid-2" style={{ fontSize: '.84em' }}>
              {[
                ['persistSession', '持久化会话'],
                ['continue', '继续上次对话'],
                ['forkSession', '分支会话'],
                ['includePartialMessages', '包含部分消息'],
                ['includeHookEvents', '包含 Hook 事件'],
                ['enableFileCheckpointing', '文件检查点'],
                ['strictMcpConfig', '严格 MCP 配置'],
                ['agentProgressSummaries', '代理进度摘要'],
                ['allowDangerouslySkipPermissions', '允许跳过权限'],
                ['forwardSubagentText', '转发子代理文本'],
                ['debug', '调试模式'],
                ['promptSuggestions', '提示建议'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!options[key as keyof SdkOptions]}
                    onChange={e => updateField(key as keyof SdkOptions, e.target.checked as never)}
                    style={{ width: 'auto' }}
                  />
                  {key}
                  <span style={{ color: 'var(--ink-muted)', fontSize: '.85em' }}>({label})</span>
                </label>
              ))}
            </div>
          </div>

          {/* 供应商配置 — 环境变量 (优先级高) */}
          <div className="card mt-4" style={{ borderColor: 'var(--warning)', borderWidth: 2 }}>
            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="card-header" style={{ marginBottom: 0, color: 'var(--warning)' }}>
                  ⚡ 供应商配置 (环境变量)
                </div>
                {saved && (
                  <span className="badge badge-success fade-in" style={{ fontSize: '.7em' }}>✓ 已保存</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setShowEnvPreview(!showEnvPreview)}>
                  {showEnvPreview ? '隐藏' : '显示'} ENV
                </button>
                <button className="btn btn-sm btn-danger" onClick={clearSaved} title="清除所有已保存的配置">
                  清除保存
                </button>
              </div>
            </div>
            <div style={{ fontSize: '.75em', color: 'var(--ink-muted)', marginBottom: 12 }}>
              通过 <code>options.env</code> 传入，会覆盖 SDK Options 中的同义字段。
              修改此处的值会自动同步到左侧对应字段。
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>ANTHROPIC_AUTH_TOKEN</label>
                <input
                  type="password"
                  value={provider.ANTHROPIC_AUTH_TOKEN}
                  onChange={e => updateProvider('ANTHROPIC_AUTH_TOKEN', e.target.value)}
                  placeholder="请输入 API Key..."
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="form-group">
                <label>ANTHROPIC_BASE_URL</label>
                <input
                  value={provider.ANTHROPIC_BASE_URL}
                  onChange={e => updateProvider('ANTHROPIC_BASE_URL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}
                />
              </div>
              <div className="form-group">
                <label style={{ color: 'var(--warning)' }}>
                  ANTHROPIC_MODEL →
                </label>
                <input
                  value={provider.ANTHROPIC_MODEL}
                  onChange={e => updateProvider('ANTHROPIC_MODEL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', borderColor: hasConflict('model', 'ANTHROPIC_MODEL') ? 'var(--warning)' : undefined }}
                />
                <div style={{ fontSize: '.7em', color: 'var(--ink-muted)', marginTop: 2 }}>
                  覆盖 options.model（当前: {String(options.model)}）
                </div>
              </div>
              <div className="form-group">
                <label>ANTHROPIC_DEFAULT_OPUS_MODEL</label>
                <input
                  value={provider.ANTHROPIC_DEFAULT_OPUS_MODEL}
                  onChange={e => updateProvider('ANTHROPIC_DEFAULT_OPUS_MODEL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="form-group">
                <label>ANTHROPIC_DEFAULT_SONNET_MODEL</label>
                <input
                  value={provider.ANTHROPIC_DEFAULT_SONNET_MODEL}
                  onChange={e => updateProvider('ANTHROPIC_DEFAULT_SONNET_MODEL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="form-group">
                <label>ANTHROPIC_DEFAULT_HAIKU_MODEL</label>
                <input
                  value={provider.ANTHROPIC_DEFAULT_HAIKU_MODEL}
                  onChange={e => updateProvider('ANTHROPIC_DEFAULT_HAIKU_MODEL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="form-group">
                <label>ANTHROPIC_REASONING_MODEL</label>
                <input
                  value={provider.ANTHROPIC_REASONING_MODEL}
                  onChange={e => updateProvider('ANTHROPIC_REASONING_MODEL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div className="form-group">
                <label style={{ color: 'var(--warning)' }}>
                  CLAUDE_CODE_EFFORT_LEVEL →
                </label>
                <select value={provider.CLAUDE_CODE_EFFORT_LEVEL} onChange={e => updateProvider('CLAUDE_CODE_EFFORT_LEVEL', e.target.value)}
                  style={{ borderColor: hasConflict('effort', 'CLAUDE_CODE_EFFORT_LEVEL') ? 'var(--warning)' : undefined }}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
                <div style={{ fontSize: '.7em', color: 'var(--ink-muted)', marginTop: 2 }}>
                  覆盖 options.effort（当前: {String(options.effort)}）
                </div>
              </div>
              <div className="form-group">
                <label>CLAUDE_CODE_SUBAGENT_MODEL</label>
                <input
                  value={provider.CLAUDE_CODE_SUBAGENT_MODEL}
                  onChange={e => updateProvider('CLAUDE_CODE_SUBAGENT_MODEL', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                <div style={{ fontSize: '.7em', color: 'var(--ink-muted)', marginTop: 2 }}>
                  影响 subagent 默认模型
                </div>
              </div>
            </div>

            {showEnvPreview && (
              <div className="mt-4 fade-in">
                <div style={{ fontSize: '.78em', fontWeight: 600, marginBottom: 6, color: 'var(--ink-secondary)' }}>
                  等效环境变量 (.env 或 options.env)
                </div>
                <CodeBlock
                  language="bash"
                  code={Object.entries(provider)
                    .map(([k, v]) => `${k}=${v || '<请填写>'}`)
                    .join('\n')}
                />
              </div>
            )}
          </div>

          <div className="card mt-4">
            <div className="card-header">Tools 配置</div>
            <div className="form-group">
              <label>allowedTools (逗号分隔)</label>
              <input
                value={Array.isArray(options.allowedTools) ? options.allowedTools.join(', ') : ''}
                onChange={e => updateField('allowedTools', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
                placeholder="Read, Write, Edit, Bash"
              />
            </div>
            <div className="form-group">
              <label>disallowedTools</label>
              <input
                value={Array.isArray(options.disallowedTools) ? options.disallowedTools.join(', ') : ''}
                onChange={e => updateField('disallowedTools', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              />
            </div>
            <div className="form-group">
              <label>toolAliases (JSON)</label>
              <input
                value={options.toolAliases ? JSON.stringify(options.toolAliases) : ''}
                onChange={e => {
                  try { updateField('toolAliases', e.target.value ? JSON.parse(e.target.value) : undefined); } catch {}
                }}
                placeholder='{"alias": "tool_name"}'
              />
            </div>
          </div>

          <div className="card mt-4">
            <div className="flex-between">
              <div className="card-header" style={{ marginBottom: 0 }}>完整 Options JSON 预览</div>
              <button className="btn btn-sm" onClick={resetToDefaults}>重置默认值</button>
            </div>
            <div className="mt-4">
              <JsonViewer data={{ ...options, env: provider }} maxHeight={400} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
