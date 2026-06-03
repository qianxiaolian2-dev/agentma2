import { useEffect, useMemo, useState } from 'react';
import { HOOK_EVENTS } from '../simulator/mock-data';
import StatusBadge from '../components/common/StatusBadge';
import JsonViewer from '../components/common/JsonViewer';
import { getAuthHeaders } from '../utils/client-runtime';

type HookRuleEvent = 'PreToolUse' | 'PostToolUse' | 'Notification';
type HookRuleAction = 'allow' | 'block' | 'context' | 'log';
type HookDecisionAction = HookRuleAction | 'none';

type HookRule = {
  id: string;
  eventName: HookRuleEvent;
  matcher: string;
  ruleContent: string;
  action: HookRuleAction;
  message: string;
  enabled: boolean;
  position: number;
  createdAt?: number;
  updatedAt?: number;
};

type EvaluationResult = {
  action: HookDecisionAction;
  reason: string;
  output: Record<string, unknown>;
  rule: HookRule | null;
};

type EvaluationEntry = {
  eventName: HookRuleEvent;
  input: Record<string, unknown>;
  result: EvaluationResult;
  timestamp: number;
};

const SUPPORTED_EVENTS: HookRuleEvent[] = ['PreToolUse', 'PostToolUse', 'Notification'];
const ACTIONS: HookRuleAction[] = ['block', 'context', 'allow', 'log'];
const DEFAULT_RULES: HookRule[] = [
  {
    id: crypto.randomUUID(),
    eventName: 'PreToolUse',
    matcher: 'Bash',
    ruleContent: 'rm ',
    action: 'block',
    message: 'Blocked destructive shell command by tenant hook policy.',
    enabled: true,
    position: 0,
  },
  {
    id: crypto.randomUUID(),
    eventName: 'PostToolUse',
    matcher: 'Write',
    ruleContent: '',
    action: 'context',
    message: 'Write operation was recorded by a tenant PostToolUse hook.',
    enabled: true,
    position: 1,
  },
];

const jsonAuthHeaders = () => getAuthHeaders({ 'Content-Type': 'application/json' });

function createRule(position: number): HookRule {
  return {
    id: crypto.randomUUID(),
    eventName: 'PreToolUse',
    matcher: 'Bash',
    ruleContent: '',
    action: 'block',
    message: '',
    enabled: true,
    position,
  };
}

function normalizeRules(rules: HookRule[]) {
  return rules.map((rule, index) => ({ ...rule, position: index }));
}

function actionStatus(action: HookDecisionAction) {
  if (action === 'block') return 'error';
  if (action === 'allow' || action === 'context' || action === 'log') return 'success';
  return 'warning';
}

function defaultInputFor(eventName: HookRuleEvent) {
  if (eventName === 'Notification') {
    return '{ "hook_event_name": "Notification", "notification_type": "status", "message": "Agent is waiting" }';
  }
  if (eventName === 'PostToolUse') {
    return '{ "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": "/tmp/demo.txt" }, "tool_response": "ok" }';
  }
  return '{ "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": { "command": "rm -rf /tmp/demo" } }';
}

export default function Hooks() {
  const [rules, setRules] = useState<HookRule[]>([]);
  const [draftRules, setDraftRules] = useState<HookRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [evalForm, setEvalForm] = useState({
    eventName: 'PreToolUse' as HookRuleEvent,
    input: defaultInputFor('PreToolUse'),
  });
  const [results, setResults] = useState<EvaluationEntry[]>([]);

  const changed = useMemo(() => JSON.stringify(rules) !== JSON.stringify(draftRules), [rules, draftRules]);

  const loadRules = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/hook-rules', { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载 Hook 规则失败');
      const next = Array.isArray(data) ? data : [];
      setRules(next);
      setDraftRules(next);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  const updateRule = (id: string, patch: Partial<HookRule>) => {
    setDraftRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    setDraftRules((current) => [...current, createRule(current.length)]);
  };

  const removeRule = (id: string) => {
    setDraftRules((current) => normalizeRules(current.filter((rule) => rule.id !== id)));
  };

  const moveRule = (id: string, direction: -1 | 1) => {
    setDraftRules((current) => {
      const index = current.findIndex((rule) => rule.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return normalizeRules(next);
    });
  };

  const saveRules = async (nextRules = draftRules) => {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/hook-rules', {
        method: 'PUT',
        headers: jsonAuthHeaders(),
        body: JSON.stringify(normalizeRules(nextRules)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存 Hook 规则失败');
      setRules(data);
      setDraftRules(data);
      setStatus('已保存，新的 agent 运行会把这些规则编译进 SDK hooks');
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const installDefaults = () => {
    const next = normalizeRules(DEFAULT_RULES.map((rule) => ({ ...rule, id: crypto.randomUUID() })));
    setDraftRules(next);
    void saveRules(next);
  };

  const evaluate = async () => {
    setError('');
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(evalForm.input);
      input = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      setError('输入必须是有效的 JSON 对象');
      return;
    }

    try {
      const response = await fetch('/api/hook-rules/evaluate', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ eventName: evalForm.eventName, input }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Hook 检查失败');
      setResults((current) => [{ eventName: evalForm.eventName, input, result, timestamp: Date.now() }, ...current]);
    } catch (evalError) {
      setError((evalError as Error).message);
    }
  };

  const onEvalEventChange = (eventName: HookRuleEvent) => {
    setEvalForm({ eventName, input: defaultInputFor(eventName) });
  };

  const supportedNames = new Set<string>(SUPPORTED_EVENTS);

  return (
    <div>
      <div className="page-header">
        <h1>🪝 Hook 系统</h1>
        <p>租户级 Hook 规则已接入真实 SDK hooks；当前支持 PreToolUse / PostToolUse / Notification。</p>
      </div>

      {error && <div className="card mb-4" style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      {status && <div className="card mb-4" style={{ borderColor: 'var(--success)', background: 'var(--success-bg)', color: 'var(--success)' }}>{status}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(360px, .7fr)', gap: 20 }}>
        <div>
          <div className="card">
            <div className="flex-between" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <div className="card-header" style={{ marginBottom: 4 }}>真实 Hook 规则</div>
                <div className="tool-card-desc">按顺序匹配。matcher 匹配工具名或通知类型；规则内容为空表示只按事件和 matcher 匹配。</div>
              </div>
              <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={addRule}>添加规则</button>
                <button className="btn btn-sm" onClick={installDefaults} disabled={saving}>装入默认</button>
                <button className="btn btn-sm btn-primary" onClick={() => void saveRules()} disabled={!changed || saving}>
                  {saving ? '保存中...' : '保存规则'}
                </button>
              </div>
            </div>

            {loading ? (
              <div style={{ color: 'var(--ink-muted)', padding: 20, textAlign: 'center' }}>加载中...</div>
            ) : draftRules.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', padding: 20, textAlign: 'center' }}>还没有 Hook 规则。未配置时 agent 运行不会传入自定义 hooks。</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {draftRules.map((rule, index) => (
                  <div key={rule.id} className="tool-card fade-in">
                    <div className="grid-4" style={{ alignItems: 'end', gap: 10 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>事件</label>
                        <select value={rule.eventName} onChange={(event) => updateRule(rule.id, { eventName: event.target.value as HookRuleEvent })}>
                          {SUPPORTED_EVENTS.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>动作</label>
                        <select value={rule.action} onChange={(event) => updateRule(rule.id, { action: event.target.value as HookRuleAction })}>
                          {ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>matcher</label>
                        <input
                          value={rule.matcher}
                          onChange={(event) => updateRule(rule.id, { matcher: event.target.value })}
                          placeholder="例如 Bash、Write、status"
                        />
                      </div>
                      <div className="flex gap-2" style={{ justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 0 }}>
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                            style={{ width: 'auto' }}
                          />
                          启用
                        </label>
                        <button className="btn btn-sm" onClick={() => moveRule(rule.id, -1)} disabled={index === 0}>上移</button>
                        <button className="btn btn-sm" onClick={() => moveRule(rule.id, 1)} disabled={index === draftRules.length - 1}>下移</button>
                        <button className="btn btn-sm btn-danger" onClick={() => removeRule(rule.id)}>删除</button>
                      </div>
                    </div>
                    <div className="grid-2 mt-2">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>规则内容</label>
                        <input
                          value={rule.ruleContent}
                          onChange={(event) => updateRule(rule.id, { ruleContent: event.target.value })}
                          placeholder="例如 rm、/etc、error"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>附加消息</label>
                        <input
                          value={rule.message}
                          onChange={(event) => updateRule(rule.id, { message: event.target.value })}
                          placeholder="传给模型或日志的上下文"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card mt-4">
            <div className="card-header">Hook 事件支持状态</div>
            <div className="grid-3" style={{ gap: 10 }}>
              {HOOK_EVENTS.map((event) => (
                <div key={event.name} className="tool-card">
                  <div className="flex-between" style={{ alignItems: 'center', gap: 8 }}>
                    <div className="tool-card-name">{event.name}</div>
                    <StatusBadge status={supportedNames.has(event.name) ? 'success' : 'disabled'} label={supportedNames.has(event.name) ? '已接入' : '待接入'} />
                  </div>
                  <div className="tool-card-desc">{event.description}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-header">Hook 真实检查</div>
            <div className="form-group">
              <label>事件</label>
              <select value={evalForm.eventName} onChange={(event) => onEvalEventChange(event.target.value as HookRuleEvent)}>
                {SUPPORTED_EVENTS.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>HookInput JSON</label>
              <textarea
                value={evalForm.input}
                onChange={(event) => setEvalForm({ ...evalForm, input: event.target.value })}
                rows={8}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '.82em' }}
              />
            </div>
            <button className="btn btn-primary" onClick={() => void evaluate()}>执行检查</button>
          </div>

          <div className="card mt-4">
            <div className="card-header">Hook 决策日志</div>
            {results.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.84em', padding: 20, textAlign: 'center' }}>
                点击「执行检查」查看后端 hook 规则输出
              </div>
            ) : (
              <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                {results.map((entry) => (
                  <div key={`${entry.timestamp}-${entry.eventName}`} className="tool-card mb-2 fade-in">
                    <div className="flex-between mb-2">
                      <div className="flex gap-2" style={{ alignItems: 'center' }}>
                        <span className="badge badge-info">{entry.eventName}</span>
                        <StatusBadge status={actionStatus(entry.result.action)} label={entry.result.action} />
                      </div>
                      <span style={{ fontSize: '.75em', color: 'var(--ink-muted)' }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="tool-card-desc" style={{ marginBottom: 8 }}>{entry.result.reason}</div>
                    <JsonViewer data={{ input: entry.input, output: entry.result.output, rule: entry.result.rule }} maxHeight={320} />
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
