import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const OTEL_ENV_VARS = [
  { key: 'CLAUDE_CODE_ENABLE_TELEMETRY', value: '1', description: '启用遥测（必须设置）' },
  { key: 'CLAUDE_CODE_ENHANCED_TELEMETRY_BETA', value: '1', description: '启用增强追踪 span' },
  { key: 'OTEL_TRACES_EXPORTER', value: 'otlp', description: '追踪导出器类型' },
  { key: 'OTEL_METRICS_EXPORTER', value: 'otlp', description: '指标导出器类型' },
  { key: 'OTEL_LOGS_EXPORTER', value: 'otlp', description: '日志导出器类型' },
  { key: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: 'http://localhost:4318', description: 'OTLP 收集器端点' },
  { key: 'OTEL_LOG_USER_PROMPTS', value: '', description: '在事件中包含提示文本' },
  { key: 'OTEL_LOG_TOOL_DETAILS', value: '', description: '包含工具输入参数' },
  { key: 'OTEL_LOG_TOOL_CONTENT', value: '', description: '包含完整工具输入/输出' },
  { key: 'OTEL_LOG_RAW_API_BODIES', value: '', description: '包含原始 API 请求/响应体' },
];

const SPANS = [
  { name: 'claude_code.interaction', description: '单次代理循环轮次' },
  { name: 'claude_code.llm_request', description: '对 Claude API 的调用' },
  { name: 'claude_code.tool', description: '工具调用' },
  { name: 'claude_code.hook', description: 'Hook 执行' },
];

const API_ENV_VARS = [
  { key: 'API_TIMEOUT_MS', value: '600000', description: '每个请求超时时间（默认 10 分钟）' },
  { key: 'CLAUDE_CODE_MAX_RETRIES', value: '10', description: '最大重试次数' },
  { key: 'CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS', value: '600000', description: '子代理停滞检测超时' },
  { key: 'CLAUDE_ENABLE_STREAM_WATCHDOG', value: '', description: '启用流空闲检测' },
  { key: 'CLAUDE_STREAM_IDLE_TIMEOUT_MS', value: '', description: '流空闲超时' },
  { key: 'ENABLE_PROMPT_CACHING_1H', value: '', description: '1h 提示缓存 TTL' },
  { key: 'ENABLE_TOOL_SEARCH', value: '', description: '控制工具搜索 (true/false/auto/auto:N)' },
  { key: 'ANTHROPIC_BASE_URL', value: 'https://api.deepseek.com/anthropic', description: 'Anthropic 兼容 API 端点' },
  { key: 'HTTP_PROXY', value: '', description: 'HTTP 代理' },
  { key: 'HTTPS_PROXY', value: '', description: 'HTTPS 代理' },
];

const PROVIDER_ENV_VARS = [
  { key: 'ANTHROPIC_AUTH_TOKEN', value: '<请填写>', description: 'API 认证 Token' },
  { key: 'ANTHROPIC_BASE_URL', value: 'https://api.deepseek.com/anthropic', description: 'Anthropic 兼容 API 端点' },
  { key: 'ANTHROPIC_MODEL', value: '<本次运行模型>', description: '由 Agent 模板或 Playground 选择的可用模型决定' },
];

type StreamEv = {
  type: string;
  index?: number;
  content_block?: { type: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
};

const STREAM_EVENTS: StreamEv[] = [
  { type: 'message_start' },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好的，让我来分析' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'Read' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"src/index.ts"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_stop', usage: { input_tokens: 450, output_tokens: 120 } },
];

type RunRow = {
  id: string;
  actor: string;
  resource: string;
  createdAt: number;
  diff: { model?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; status?: string };
};

function formatMs(ms?: number) {
  if (!ms) return '-';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd?: number) {
  if (!usd) return '-';
  return `$${usd.toFixed(4)}`;
}

export default function Observability() {
  const { token } = useAuth();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch('/api/audit-logs', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((rows: Array<Record<string, unknown>>) => {
        const agentRuns = rows
          .filter(r => r.action === 'agent_run')
          .slice(0, 15)
          .map(r => ({
            id: String(r.id || ''),
            actor: String(r.actor || ''),
            resource: String(r.resource || ''),
            createdAt: Number(r.createdAt || r.created_at || 0),
            diff: (r.diff || r.diff_json || {}) as RunRow['diff'],
          }));
        setRuns(agentRuns);
      })
      .catch(e => setLoadError(String(e?.message || e)));
  }, [token]);

  return (
    <div>
      <div className="page-header">
        <h1>可观测性</h1>
        <p>OpenTelemetry 遥测配置 / 最近运行记录 / 流事件结构</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div className="card">
            <div className="card-header">OpenTelemetry 环境变量</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>变量</th><th>值</th><th>描述</th></tr>
                </thead>
                <tbody>
                  {OTEL_ENV_VARS.map(env => (
                    <tr key={env.key}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}>{env.key}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}>{env.value || '-'}</td>
                      <td style={{ fontSize: '.78em' }}>{env.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">Trace Spans</div>
            <div className="grid-2">
              {SPANS.map(s => (
                <div key={s.name} className="tool-card">
                  <div className="tool-card-name" style={{ fontFamily: 'var(--font-mono)' }}>{s.name}</div>
                  <div className="tool-card-desc">{s.description}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">StreamEvent 结构 (BetaRawMessageStreamEvent)</div>
            <div className="grid-2">
              {STREAM_EVENTS.map((ev, i) => (
                <div key={i} className="tool-card">
                  <div className="tool-card-name">{String(ev.type)}</div>
                  {ev.content_block && (
                    <div className="tool-card-desc">
                      block: {ev.content_block.type}{ev.content_block.name ? ` (${ev.content_block.name})` : ''}
                    </div>
                  )}
                  {ev.delta && (
                    <div className="tool-card-desc">
                      delta: {ev.delta.type}{ev.delta.text ? ` "${ev.delta.text}"` : ''}{ev.delta.partial_json ? ` "${ev.delta.partial_json}"` : ''}
                    </div>
                  )}
                  {ev.usage && (
                    <div className="tool-card-desc">
                      tokens: {ev.usage.input_tokens ?? '-'} in / {ev.usage.output_tokens ?? '-'} out
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-header">最近运行记录</div>
            {loadError && <div style={{ color: 'var(--danger)', fontSize: '.82em', marginBottom: 8 }}>{loadError}</div>}
            {runs.length === 0 && !loadError && (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.82em', padding: '16px 0', textAlign: 'center' }}>
                暂无运行记录
              </div>
            )}
            {runs.map(run => (
              <div key={run.id} className="tool-card mb-2">
                <div className="flex-between">
                  <div className="tool-card-name" style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em' }}>
                    {run.diff.model || run.resource.replace('run:', '')}
                  </div>
                  <span className={`badge ${run.diff.status === 'success' ? 'badge-success' : 'badge-danger'}`}>
                    {run.diff.status || '?'}
                  </span>
                </div>
                <div className="flex gap-3 mt-1" style={{ fontSize: '.76em', color: 'var(--ink-secondary)', flexWrap: 'wrap' }}>
                  <span>时长 {formatMs(run.diff.durationMs)}</span>
                  <span>in {run.diff.inputTokens ?? '-'} / out {run.diff.outputTokens ?? '-'} tokens</span>
                  <span>费用 {formatCost(run.diff.costUsd)}</span>
                  <span>{run.actor}</span>
                  <span>{run.createdAt ? new Date(run.createdAt).toLocaleTimeString() : ''}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card mt-4">
            <div className="card-header">供应商环境变量 (Provider Env)</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>变量</th><th>默认值</th><th>描述</th></tr>
                </thead>
                <tbody>
                  {PROVIDER_ENV_VARS.map(env => (
                    <tr key={env.key}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.76em' }}>{env.key}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.76em', color: env.value === '<请填写>' ? 'var(--warning)' : 'var(--ink-secondary)' }}>{env.value}</td>
                      <td style={{ fontSize: '.76em' }}>{env.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">API 调优环境变量</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>变量</th><th>默认值</th><th>描述</th></tr>
                </thead>
                <tbody>
                  {API_ENV_VARS.map(env => (
                    <tr key={env.key}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.76em' }}>{env.key}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.76em' }}>{env.value || '-'}</td>
                      <td style={{ fontSize: '.76em' }}>{env.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
