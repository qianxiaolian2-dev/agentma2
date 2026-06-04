import { useState, useEffect } from 'react';
import type { SdkOptions } from '../simulator/types';
import { getDefaultOptions } from '../simulator/mock-data';
import JsonViewer from '../components/common/JsonViewer';
import { listProviderModels } from '../utils/providers';

const LS_OPTIONS = 'agentma_sdk_options';

function loadOptions(): SdkOptions {
  try {
    const raw = localStorage.getItem(LS_OPTIONS);
    if (raw) return { ...getDefaultOptions(), ...JSON.parse(raw) };
  } catch {}
  return getDefaultOptions();
}

export default function Settings() {
  const [options, setOptions] = useState<SdkOptions>(loadOptions);
  const providerModels = listProviderModels();

  // options 变更时自动保存
  useEffect(() => {
    localStorage.setItem(LS_OPTIONS, JSON.stringify(options));
  }, [options]);

  const updateField = <K extends keyof SdkOptions>(key: K, value: SdkOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const resetToDefaults = () => {
    setOptions(getDefaultOptions());
  };

  return (
    <div>
      <div className="page-header">
        <h1>⚙ Options 配置</h1>
        <p>SdkOptions / ClaudeAgentOptions — 完整的 SDK 初始化配置</p>
      </div>

      <div className="card mb-4">
        <div className="flex gap-3" style={{ alignItems: 'flex-start' }}>
          <span style={{ fontSize: '1.2em' }}>⚙</span>
          <div style={{ fontSize: '.84em' }}>
            <strong>供应商配置已迁移到账户管理：</strong>
            这里保留 SDK Options；模型供应商、API Key 和可用模型请在 <a href="/account" style={{ color: 'var(--accent)' }}>账户管理 → 供应商</a> 维护。
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
                <label>model</label>
                <input
                  value={String(options.model || '')}
                  onChange={e => updateField('model', e.target.value)}
                  placeholder="输入模型 ID"
                  list="model-suggestions"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                <datalist id="model-suggestions">
                  {providerModels.map(model => <option key={model} value={model} />)}
                </datalist>
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
                <label>effort</label>
                <select value={String(options.effort || 'high')} onChange={e => updateField('effort', e.target.value as SdkOptions['effort'])}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
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
              <JsonViewer data={options} maxHeight={400} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
