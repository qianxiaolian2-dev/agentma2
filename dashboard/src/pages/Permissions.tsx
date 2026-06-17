import { useEffect, useMemo, useState } from 'react';
import { PERMISSION_MODES } from '../simulator/mock-data';
import StatusBadge from '../components/common/StatusBadge';
import JsonViewer from '../components/common/JsonViewer';
import { getAuthHeaders } from '../utils/client-runtime';

type PermissionRuleBehavior = 'allow' | 'deny';
type PermissionDecisionBehavior = PermissionRuleBehavior | 'ask';

type PermissionRule = {
  id: string;
  toolName: string;
  ruleContent: string;
  behavior: PermissionRuleBehavior;
  enabled: boolean;
  position: number;
  createdAt?: number;
  updatedAt?: number;
};

type EvaluationResult = {
  behavior: PermissionDecisionBehavior;
  reason: string;
  rule: PermissionRule | null;
};

type EvaluationEntry = {
  toolName: string;
  input: Record<string, unknown>;
  result: EvaluationResult;
  timestamp: number;
};

const TOOLS = ['*', 'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'WebFetch'];
const DEFAULT_RULES: PermissionRule[] = [
  {
    id: crypto.randomUUID(),
    toolName: 'Bash',
    ruleContent: 'rm ',
    behavior: 'deny',
    enabled: true,
    position: 0,
  },
  {
    id: crypto.randomUUID(),
    toolName: 'Write',
    ruleContent: '/tmp/agentma-run-',
    behavior: 'allow',
    enabled: true,
    position: 1,
  },
];

const jsonAuthHeaders = () => getAuthHeaders({ 'Content-Type': 'application/json' });

function createRule(position: number): PermissionRule {
  return {
    id: crypto.randomUUID(),
    toolName: 'Bash',
    ruleContent: '',
    behavior: 'deny',
    enabled: true,
    position,
  };
}

function normalizeRules(rules: PermissionRule[]) {
  return rules.map((rule, index) => ({ ...rule, position: index }));
}

function behaviorStatus(behavior: PermissionDecisionBehavior) {
  if (behavior === 'allow') return 'success';
  if (behavior === 'deny') return 'error';
  return 'warning';
}

export default function Permissions() {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [draftRules, setDraftRules] = useState<PermissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [evalForm, setEvalForm] = useState({
    toolName: 'Bash',
    input: '{ "command": "rm -rf /tmp/demo" }',
  });
  const [results, setResults] = useState<EvaluationEntry[]>([]);

  const changed = useMemo(() => JSON.stringify(rules) !== JSON.stringify(draftRules), [rules, draftRules]);

  const loadRules = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/permission-rules', { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载权限规则失败');
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

  const updateRule = (id: string, patch: Partial<PermissionRule>) => {
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
      const response = await fetch('/api/permission-rules', {
        method: 'PUT',
        headers: jsonAuthHeaders(),
        body: JSON.stringify(normalizeRules(nextRules)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存权限规则失败');
      setRules(data);
      setDraftRules(data);
      setStatus('已保存，新的 agent 运行会立即使用这些规则');
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
      const response = await fetch('/api/permission-rules/evaluate', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ toolName: evalForm.toolName, input }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '权限检查失败');
      setResults((current) => [{ toolName: evalForm.toolName, input, result, timestamp: Date.now() }, ...current]);
    } catch (evalError) {
      setError((evalError as Error).message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>🛡 权限系统</h1>
        <p>租户级 allow/deny 规则已接入真实 SDK canUseTool；未命中规则时继续走聊天内审批。</p>
      </div>

      {error && <div className="card mb-4" style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      {status && <div className="card mb-4" style={{ borderColor: 'var(--success)', background: 'var(--success-bg)', color: 'var(--success)' }}>{status}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(360px, .7fr)', gap: 20 }}>
        <div>
          <div className="card">
            <div className="flex-between" style={{ alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <div className="card-header" style={{ marginBottom: 4 }}>真实权限规则</div>
                <div className="tool-card-desc">按顺序匹配。工具名可用 <code>*</code>，规则内容为空表示该工具全部匹配；不为空时匹配工具输入 JSON。</div>
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
              <div style={{ color: 'var(--ink-muted)', padding: 20, textAlign: 'center' }}>还没有规则。未命中规则的危险工具会在聊天里弹出审批。</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {draftRules.map((rule, index) => (
                  <div key={rule.id} className="tool-card fade-in">
                    <div className="grid-4" style={{ alignItems: 'end', gap: 10 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>行为</label>
                        <select value={rule.behavior} onChange={(event) => updateRule(rule.id, { behavior: event.target.value as PermissionRuleBehavior })}>
                          <option value="deny">deny</option>
                          <option value="allow">allow</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>工具</label>
                        <select value={rule.toolName} onChange={(event) => updateRule(rule.id, { toolName: event.target.value })}>
                          {TOOLS.map((toolName) => <option key={toolName} value={toolName}>{toolName}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>规则内容</label>
                        <input
                          value={rule.ruleContent}
                          onChange={(event) => updateRule(rule.id, { ruleContent: event.target.value })}
                          placeholder="例如 rm、/private、package.json"
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
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card mt-4">
            <div className="card-header">权限模式参考</div>
            <div className="grid-3" style={{ gap: 10 }}>
              {PERMISSION_MODES.map((mode) => (
                <div key={mode.value} className="tool-card">
                  <div className="tool-card-name">{mode.value}</div>
                  <div className="tool-card-desc">{mode.description}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-header">canUseTool 真实检查</div>
            <div className="form-group">
              <label>工具名</label>
              <select value={evalForm.toolName} onChange={(event) => setEvalForm({ ...evalForm, toolName: event.target.value })}>
                {TOOLS.filter((toolName) => toolName !== '*').map((toolName) => <option key={toolName} value={toolName}>{toolName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>输入 JSON</label>
              <textarea
                value={evalForm.input}
                onChange={(event) => setEvalForm({ ...evalForm, input: event.target.value })}
                rows={5}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '.82em' }}
              />
            </div>
            <button className="btn btn-primary" onClick={() => void evaluate()}>执行检查</button>
          </div>

          <div className="card mt-4">
            <div className="card-header">决策日志</div>
            {results.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.84em', padding: 20, textAlign: 'center' }}>
                点击「执行检查」查看后端规则匹配结果
              </div>
            ) : (
              <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                {results.map((entry) => (
                  <div key={`${entry.timestamp}-${entry.toolName}`} className="tool-card mb-2 fade-in">
                    <div className="flex-between mb-2">
                      <div className="flex gap-2" style={{ alignItems: 'center' }}>
                        <span className="badge badge-info">{entry.toolName}</span>
                        <StatusBadge status={behaviorStatus(entry.result.behavior)} label={entry.result.behavior} />
                      </div>
                      <span style={{ fontSize: '.75em', color: 'var(--ink-muted)' }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="tool-card-desc" style={{ marginBottom: 8 }}>{entry.result.reason}</div>
                    <JsonViewer data={{ input: entry.input, result: entry.result }} maxHeight={260} />
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
