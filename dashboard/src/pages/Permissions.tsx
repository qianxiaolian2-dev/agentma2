import { useState } from 'react';
import type { PermissionMode, PermissionResult, PermissionUpdate } from '../simulator/types';
import { sdkSimulator } from '../simulator/sdk-simulator';
import { PERMISSION_MODES } from '../simulator/mock-data';
import StatusBadge from '../components/common/StatusBadge';
import JsonViewer from '../components/common/JsonViewer';

const TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'WebFetch'];

export default function Permissions() {
  const [currentMode, setCurrentMode] = useState<PermissionMode>('default');
  const [results, setResults] = useState<Array<{ tool: string; input: Record<string, unknown>; result: PermissionResult; timestamp: number }>>([]);
  const [simForm, setSimForm] = useState({ toolName: 'Read', input: '{"file_path": "/path/to/file.ts"}', behavior: 'allow' as 'allow' | 'deny' });

  // setPermissionMode()
  const handleSetMode = (mode: PermissionMode) => {
    sdkSimulator.setPermissionMode(mode);
    setCurrentMode(mode);
  };

  // canUseTool 模拟器
  const handleSimulate = async () => {
    let input: Record<string, unknown>;
    try { input = JSON.parse(simForm.input); } catch {
      alert('输入必须是有效的 JSON');
      return;
    }
    const result = await sdkSimulator.simulateCanUseTool(simForm.toolName, input, simForm.behavior);
    setResults(prev => [{ tool: simForm.toolName, input, result, timestamp: Date.now() }, ...prev]);
  };

  return (
    <div>
      <div className="page-header">
        <h1>🛡 权限系统</h1>
        <p>setPermissionMode() / canUseTool / PermissionResult / PermissionUpdate / PermissionBehavior</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 权限模式管理 */}
        <div>
          <div className="card">
            <div className="card-header">setPermissionMode() — 权限模式</div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
              {PERMISSION_MODES.map(pm => (
                <button
                  key={pm.value}
                  className={`btn ${currentMode === pm.value ? 'btn-primary' : ''}`}
                  onClick={() => handleSetMode(pm.value)}
                >
                  {pm.label}
                </button>
              ))}
            </div>
            <div>
              <div className="kpi-label">当前模式</div>
              <div className="kpi-value" style={{ fontSize: '1.2em' }}>{currentMode}</div>
              <div className="kpi-sub" style={{ marginTop: 4 }}>
                {PERMISSION_MODES.find(p => p.value === currentMode)?.description}
              </div>
            </div>
          </div>

          {/* PermissionBehavior 说明 */}
          <div className="card mt-4">
            <div className="card-header">PermissionBehavior</div>
            <div className="grid-3" style={{ gap: 10 }}>
              <div className="tool-card" style={{ textAlign: 'center' }}>
                <div className="tool-card-name" style={{ color: 'var(--success)' }}>allow</div>
                <div className="tool-card-desc">允许执行</div>
              </div>
              <div className="tool-card" style={{ textAlign: 'center' }}>
                <div className="tool-card-name" style={{ color: 'var(--danger)' }}>deny</div>
                <div className="tool-card-desc">拒绝执行</div>
              </div>
              <div className="tool-card" style={{ textAlign: 'center' }}>
                <div className="tool-card-name" style={{ color: 'var(--warning)' }}>ask</div>
                <div className="tool-card-desc">询问用户</div>
              </div>
            </div>
          </div>

          {/* PermissionUpdateDestination */}
          <div className="card mt-4">
            <div className="card-header">PermissionUpdateDestination</div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {['userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg'].map(d => (
                <span key={d} className="badge badge-muted">{d}</span>
              ))}
            </div>
          </div>
        </div>

        {/* canUseTool 模拟器 */}
        <div>
          <div className="card">
            <div className="card-header">canUseTool() — 权限检查模拟器</div>
            <div className="form-group">
              <label>工具名 (toolName)</label>
              <select value={simForm.toolName} onChange={e => setSimForm({ ...simForm, toolName: e.target.value })}>
                {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>输入 (input: Record&lt;string, unknown&gt;)</label>
              <textarea value={simForm.input} onChange={e => setSimForm({ ...simForm, input: e.target.value })} rows={3} style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em' }} />
            </div>
            <div className="form-group">
              <label>预期行为</label>
              <div className="flex gap-3">
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" checked={simForm.behavior === 'allow'} onChange={() => setSimForm({ ...simForm, behavior: 'allow' })} style={{ width: 'auto' }} />
                  allow
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" checked={simForm.behavior === 'deny'} onChange={() => setSimForm({ ...simForm, behavior: 'deny' })} style={{ width: 'auto' }} />
                  deny
                </label>
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleSimulate}>执行 canUseTool()</button>
          </div>

          {/* 权限决策日志 */}
          <div className="card mt-4">
            <div className="card-header">PermissionResult 日志</div>
            {results.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.84em', padding: 20, textAlign: 'center' }}>
                点击「执行 canUseTool()」来查看权限决策结果
              </div>
            ) : (
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {results.map((r, i) => (
                  <div key={i} className="tool-card mb-2 fade-in">
                    <div className="flex-between mb-2">
                      <div className="flex gap-2">
                        <span className="badge badge-info">{r.tool}</span>
                        <StatusBadge status={r.result.behavior === 'allow' ? 'success' : 'error'} label={r.result.behavior} />
                      </div>
                      <span style={{ fontSize: '.75em', color: 'var(--ink-muted)' }}>
                        {new Date(r.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <JsonViewer data={r.result} maxHeight={200} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
