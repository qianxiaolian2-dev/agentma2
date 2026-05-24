import { useState, useEffect } from 'react';
import type { RateLimitInfo } from '../simulator/types';
import { sdkSimulator } from '../simulator/sdk-simulator';
import { generateStreamEvents } from '../simulator/mock-data';
import JsonViewer from '../components/common/JsonViewer';
import CodeBlock from '../components/common/CodeBlock';

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
  { key: 'ANTHROPIC_MODEL', value: 'deepseek-v4-pro[1m]', description: '默认模型' },
  { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', value: 'deepseek-v4-pro[1m]', description: 'Opus 级模型映射' },
  { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', value: 'deepseek-v4-pro[1m]', description: 'Sonnet 级模型映射' },
  { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', value: 'deepseek-v4-flash', description: 'Haiku 级模型映射' },
  { key: 'ANTHROPIC_REASONING_MODEL', value: 'deepseek-v4-pro[1m]', description: '推理模型' },
  { key: 'CLAUDE_CODE_EFFORT_LEVEL', value: 'max', description: '效能等级 (low/medium/high/xhigh/max)' },
  { key: 'CLAUDE_CODE_SUBAGENT_MODEL', value: 'deepseek-v4-flash', description: '子代理默认模型' },
];

export default function Observability() {
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [streamEvents] = useState(generateStreamEvents());

  useEffect(() => {
    setRateLimit(sdkSimulator.getRateLimit());
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>📊 可观测性</h1>
        <p>OpenTelemetry 遥测 / RateLimitInfo / StreamEvent / 环境变量配置</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* OTEL 配置 */}
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
        </div>

        {/* 速率限制 + 流事件 */}
        <div>
          <div className="card">
            <div className="card-header">RateLimitInfo</div>
            {rateLimit && (
              <div className="grid-2">
                <div className="kpi-card">
                  <div className="kpi-label">5h 状态</div>
                  <div className="kpi-value" style={{ fontSize: '1.2em' }}>{rateLimit.status}</div>
                  <div className="kpi-sub">利用率: {(rateLimit.utilization! * 100).toFixed(0)}%</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">重置时间</div>
                  <div className="kpi-value" style={{ fontSize: '1em' }}>
                    {rateLimit.resetsAt ? new Date(rateLimit.resetsAt).toLocaleTimeString() : '-'}
                  </div>
                </div>
              </div>
            )}
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

          <div className="card mt-4">
            <div className="card-header">StreamEvent 结构 (BetaRawMessageStreamEvent)</div>
            <div className="grid-2">
              {streamEvents.map((ev, i) => (
                <div key={i} className="tool-card">
                  <div className="tool-card-name">{ev.type}</div>
                  {ev.content_block && (
                    <div className="tool-card-desc">
                      block: {ev.content_block.type}
                      {ev.content_block.name && ` (${ev.content_block.name})`}
                    </div>
                  )}
                  {ev.delta && (
                    <div className="tool-card-desc">
                      delta: {ev.delta.type}
                      {ev.delta.text && ` "${ev.delta.text}"`}
                      {ev.delta.partial_json && ` "${ev.delta.partial_json}"`}
                    </div>
                  )}
                  {ev.usage && (
                    <div className="tool-card-desc">
                      tokens: {ev.usage.input_tokens} in / {ev.usage.output_tokens} out
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
