import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MODELS, BUILT_IN_TOOLS, HOOK_EVENTS } from '../simulator/mock-data';
import { useAuth } from '../contexts/AuthContext';
import AgentMaMark from '../components/AgentMaMark';
import CosmicBackground from '../components/CosmicBackground';
import CapabilityUniverse from '../components/CapabilityUniverse';
import type { LineIconName } from '../components/LineIcon';
import { bootstrapAgentTemplates, loadCachedAgentTemplates } from '../utils/agent-templates';
import type { AgentTemplate } from '../simulator/types';

const SECTIONS = [
  { path: '/conversations', title: '会话', desc: '多轮对话，Agent 按模板配置执行任务', icon: 'chat', color: '#7c3aed' },
  { path: '/agents', title: 'Agent 市场', desc: '创建和管理 Agent 模板，配置工具和能力', icon: 'market', color: '#f59e0b' },
  { path: '/playground', title: 'Playground', desc: '实时测试 query() 流式 API', icon: 'play', color: '#2563eb' },
  { path: '/tools', title: '工具 & MCP', desc: `${BUILT_IN_TOOLS.length} 内置 + 自定义 MCP 工具`, icon: 'tools', color: '#d97706' },
  { path: '/skills', title: '技能背包', desc: '管理 Agent Skills，扩展专业能力', icon: 'spark', color: '#8b5cf6' },
  { path: '/hooks', title: 'Hook 系统', desc: `${HOOK_EVENTS.length} 种事件监听`, icon: 'hook', color: '#059669' },
  { path: '/subagents', title: '子代理管理', desc: 'AgentDefinition / Task CRUD', icon: 'agents', color: '#8b5cf6' },
  { path: '/permissions', title: '权限系统', desc: 'setPermissionMode / canUseTool', icon: 'shield', color: '#2563eb' },
  { path: '/observability', title: '可观测性', desc: 'OTEL 遥测 / RateLimit / StreamEvent', icon: 'chart', color: '#10b981' },
  { path: '/settings', title: '全局设置', desc: 'SdkOptions 完整配置面板', icon: 'gear', color: '#6b7280' },
] satisfies Array<{ path: string; title: string; desc: string; icon: LineIconName; color: string }>;

export default function Overview() {
  const { user, token } = useAuth();
  const [templates, setTemplates] = useState<AgentTemplate[]>(() => loadCachedAgentTemplates(user?.tenantId));
  const [weeklyRuns, setWeeklyRuns] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;
    void bootstrapAgentTemplates(user.tenantId, false)
      .then(list => { if (!cancelled) setTemplates(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.tenantId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetch('/api/quota/usage', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (!cancelled) setWeeklyRuns(data?.usage?.weeklyRunCount?.used ?? data?.usage?.totalRuns ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="cosmic-route cosmic-overview">
      <CosmicBackground variant="overview" fill="absolute" />
      <div className="cosmic-content">
      <div className="page-header">
        <h1 className="overview-title">
          <AgentMaMark className="overview-title-mark" />
          <span>AgentMa</span>
        </h1>
        <p>Claude Agent SDK 全接口可视化面板 — 每个 SDK 接口都可触发、可观测</p>
      </div>

      {/* 顶部 KPI */}
      <div className="grid-4 mb-4">
        <div className="kpi-card">
          <div className="kpi-label">内置工具</div>
          <div className="kpi-value">{BUILT_IN_TOOLS.length}</div>
          <div className="kpi-sub">个内置工具可调用</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Hook 事件</div>
          <div className="kpi-value">{HOOK_EVENTS.length}</div>
          <div className="kpi-sub">种事件可监听</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Agent 模板</div>
          <div className="kpi-value">{templates.length}</div>
          <div className="kpi-sub">个已配置模板</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">本周运行</div>
          <div className="kpi-value">{weeklyRuns ?? '—'}</div>
          <div className="kpi-sub">次 Agent 执行</div>
        </div>
      </div>

      {/* 功能宇宙 — 每个能力是一颗行星 */}
      <div className="section-title">功能宇宙</div>
      <CapabilityUniverse sections={SECTIONS} />

      {/* SDK 架构概览 */}
      <div className="section">
        <div className="section-title">SDK 架构总览</div>
        <div className="grid-2">
          <div className="card">
            <div className="card-header">TypeScript SDK 入口</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em', lineHeight: 1.8 }}>
              <div style={{ color: 'var(--accent)' }}>import {'{ query, tool, startup }'} from '@anthropic-ai/claude-agent-sdk';</div>
              <div style={{ color: 'var(--ink-muted)', marginTop: 8 }}>// 核心 API</div>
              <div>query(prompt, options?) → AsyncGenerator&lt;SDKMessage&gt;</div>
              <div>startup(options?) → Promise&lt;WarmQuery&gt;</div>
              <div>tool(name, desc, schema, handler, extras?) → SdkMcpToolDefinition</div>
              <div>createSdkMcpServer({'{\n  name, version, tools\n}'}) → McpSdkServerConfig</div>
              <div style={{ color: 'var(--ink-muted)', marginTop: 8 }}>// 会话管理</div>
              <div>listSessions() / getSessionMessages() / renameSession() / tagSession()</div>
              <div style={{ color: 'var(--ink-muted)', marginTop: 8 }}>// 错误类型</div>
              <div>ClaudeSDKError / CLIConnectionError / ProcessError</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">Python SDK 入口</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em', lineHeight: 1.8 }}>
              <div style={{ color: 'var(--accent)' }}>from claude_agent_sdk import query, tool, ClaudeSDKClient</div>
              <div style={{ color: 'var(--ink-muted)', marginTop: 8 }}># 核心 API</div>
              <div>async query(*, prompt, options?, transport?) → AsyncIterator[Message]</div>
              <div>def tool(name, desc, input_schema, annotations?) → decorator</div>
              <div>def create_sdk_mcp_server(name, version, tools) → McpSdkServerConfig</div>
              <div style={{ color: 'var(--ink-muted)', marginTop: 8 }}># ClaudeSDKClient</div>
              <div>client.connect() / client.query() / client.receive_messages()</div>
              <div>client.interrupt() / client.set_permission_mode() / client.set_model()</div>
              <div style={{ color: 'var(--ink-muted)', marginTop: 8 }}># 传输层</div>
              <div>class Transport(ABC): connect / write / read_messages / close</div>
            </div>
          </div>
        </div>
      </div>

      {/* 支持的模型和代理 */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">支持模型 — ModelInfo[]</div>
          <div>
            {MODELS.map(m => (
              <div key={m.value} className="tool-card mb-2">
                <div className="tool-card-name">{m.displayName}</div>
                <div className="tool-card-desc">{m.description}</div>
                <code style={{ fontSize: '.75em' }}>{m.value}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header">Agent 模板 ({templates.length})</div>
          {templates.length === 0 ? (
            <div style={{ color: 'var(--ink-muted)', fontSize: '.82em', padding: '12px 0' }}>
              暂无模板 — 在 <Link to="/agents" style={{ color: 'var(--accent)' }}>Agent 市场</Link> 创建
            </div>
          ) : (
            templates.map(t => (
              <div key={t.id} className="tool-card mb-2">
                <div className="tool-card-name">{t.name}</div>
                <div className="tool-card-desc">{t.description}</div>
                <div className="flex gap-1 mt-1" style={{ flexWrap: 'wrap' }}>
                  <span className="badge badge-muted">{t.model || 'default'}</span>
                  <span className="badge badge-muted">{t.tools.length} tools</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
