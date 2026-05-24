import { useState, useCallback } from 'react';
import type { HookEvent, HookCallbackMatcher } from '../simulator/types';
import { sdkSimulator } from '../simulator/sdk-simulator';
import { HOOK_EVENTS } from '../simulator/mock-data';
import JsonViewer from '../components/common/JsonViewer';
import StatusBadge from '../components/common/StatusBadge';

export default function Hooks() {
  const [configs, setConfigs] = useState<Partial<Record<HookEvent, HookCallbackMatcher[]>>>({});
  const [logs, setLogs] = useState<Array<{ event: HookEvent; input: Record<string, unknown>; output: Record<string, unknown>; timestamp: number }>>([]);
  const [selectedEvent, setSelectedEvent] = useState<HookEvent | null>(null);
  const [matcherInput, setMatcherInput] = useState('');
  const [toolTrigger, setToolTrigger] = useState('Read');

  const categoryColors: Record<string, string> = {
    tool: 'var(--warning)',
    session: 'var(--accent)',
    agent: 'var(--info)',
    notification: 'var(--success)',
    config: 'var(--ink-muted)',
  };

  // 配置 Hook
  const addHookConfig = useCallback((event: HookEvent) => {
    const matcher: HookCallbackMatcher = {
      matcher: matcherInput || undefined,
      hooks: [async (input, toolUseID) => {
        const result = { continue: true, decision: 'approve' as const, reason: `处理 ${event}`, hookSpecificOutput: {} };
        return result;
      }],
      timeout: 30000,
    };
    const newConfigs = { ...configs, [event]: [...(configs[event] || []), matcher] };
    setConfigs(newConfigs);
    sdkSimulator.configureHooks(newConfigs);
  }, [configs, matcherInput]);

  // 触发 Hook 并查看日志
  const triggerAndLog = useCallback(async (event: HookEvent) => {
    const result = await sdkSimulator.triggerHook(event, toolTrigger);
    setLogs(prev => [{ event, ...result, timestamp: Date.now() }, ...prev]);
  }, [toolTrigger]);

  const clearLogs = () => {
    sdkSimulator.clearHookLogs();
    setLogs([]);
  };

  const removeHookConfig = (event: HookEvent, idx: number) => {
    const updated = [...(configs[event] || [])];
    updated.splice(idx, 1);
    const newConfigs = { ...configs, [event]: updated };
    if (updated.length === 0) delete newConfigs[event];
    setConfigs(newConfigs);
    sdkSimulator.configureHooks(newConfigs);
  };

  return (
    <div>
      <div className="page-header">
        <h1>🪝 Hook 系统</h1>
        <p>HookCallback / HookCallbackMatcher / PreToolUse / PostToolUse / SessionStart ... 共 {HOOK_EVENTS.length} 个事件</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Hook 事件列表 + 配置 */}
        <div>
          <div className="card">
            <div className="card-header">Hook 事件配置 — Options.hooks</div>
            <div className="form-group">
              <label>工具名 (用于 tool 类 hook 的 matcher)</label>
              <input value={toolTrigger} onChange={e => setToolTrigger(e.target.value)} placeholder="Read" />
            </div>
            <div className="form-group">
              <label>matcher 模式 (可选，正则)</label>
              <input value={matcherInput} onChange={e => setMatcherInput(e.target.value)} placeholder='例如 "Read|Write"' />
            </div>
            <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>事件</th><th>描述</th><th>类别</th><th>配置</th><th>触发</th></tr>
                </thead>
                <tbody>
                  {HOOK_EVENTS.map(ev => {
                    const isConfigured = configs[ev.name]?.length;
                    return (
                      <tr key={ev.name} style={{ background: selectedEvent === ev.name ? 'var(--accent-bg)' : undefined }}>
                        <td>
                          <a href="#" onClick={e => { e.preventDefault(); setSelectedEvent(ev.name); }} style={{ fontFamily: 'var(--font-mono)', fontSize: '.82em', color: 'var(--accent)', textDecoration: 'none' }}>
                            {ev.name}
                          </a>
                        </td>
                        <td style={{ fontSize: '.82em' }}>{ev.description}</td>
                        <td>
                          <span className="badge" style={{ background: categoryColors[ev.category] + '20', color: categoryColors[ev.category] }}>
                            {ev.category}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm btn-primary" onClick={() => addHookConfig(ev.name)}>
                            添加 Hook
                          </button>
                          {isConfigured && <span className="badge badge-success ml-2">{isConfigured}</span>}
                        </td>
                        <td>
                          <button className="btn btn-sm" onClick={() => triggerAndLog(ev.name)}>触发</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 已配置的 Hooks */}
          {Object.keys(configs).length > 0 && (
            <div className="card mt-4">
              <div className="card-header">当前 Hook 配置</div>
              {Object.entries(configs).map(([event, matchers]) => (
                <div key={event} className="tool-card mb-2">
                  <div className="flex-between">
                    <div className="tool-card-name">{event}</div>
                  </div>
                  {matchers?.map((m, i) => (
                    <div key={i} className="flex-between mt-2" style={{ fontSize: '.8em' }}>
                      <span style={{ color: 'var(--ink-secondary)' }}>
                        matcher: {m.matcher || '(无)'} | timeout: {m.timeout}ms | hooks: {m.hooks.length}
                      </span>
                      <button className="btn btn-sm btn-danger" onClick={() => removeHookConfig(event as HookEvent, i)}>移除</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hook 触发日志 */}
        <div>
          <div className="card">
            <div className="flex-between">
              <div className="card-header" style={{ marginBottom: 0 }}>Hook 执行日志</div>
              <button className="btn btn-sm" onClick={clearLogs}>清除日志</button>
            </div>
            {logs.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.84em', padding: 20, textAlign: 'center' }}>
                点击「触发」按钮来测试 Hook 事件
              </div>
            ) : (
              <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                {logs.map((log, i) => (
                  <div key={i} className="tool-card mb-2 fade-in">
                    <div className="flex-between mb-2">
                      <div>
                        <span className="badge badge-info" style={{ marginRight: 8 }}>{log.event}</span>
                        <StatusBadge status="success" label="已执行" />
                      </div>
                      <span style={{ fontSize: '.75em', color: 'var(--ink-muted)' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: '.82em', color: 'var(--accent)' }}>HookInput / HookJSONOutput</summary>
                      <div className="grid-2 mt-2" style={{ gap: 10 }}>
                        <div>
                          <div style={{ fontSize: '.75em', fontWeight: 600, marginBottom: 4 }}>HookInput</div>
                          <JsonViewer data={log.input} maxHeight={200} />
                        </div>
                        <div>
                          <div style={{ fontSize: '.75em', fontWeight: 600, marginBottom: 4 }}>HookJSONOutput</div>
                          <JsonViewer data={log.output} maxHeight={200} />
                        </div>
                      </div>
                    </details>
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
