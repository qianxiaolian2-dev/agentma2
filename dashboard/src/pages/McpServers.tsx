import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, loadCachedAgentTemplates } from '../utils/agent-templates';
import type { AgentTemplate } from '../simulator/types';
import JsonViewer from '../components/common/JsonViewer';

const MCP_TYPE_DOCS = [
  { type: 'stdio', desc: '本地子进程，通过 stdin/stdout 通信', example: 'npx -y @anthropic-ai/mcp-server-filesystem' },
  { type: 'http', desc: 'HTTP/SSE 远程服务器', example: 'http://localhost:8080/mcp' },
  { type: 'sdk', desc: '通过 createSdkMcpServer() 注册的本地工具桥', example: '代码内部注册，见 server-agent.ts' },
];

export default function McpServers() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<AgentTemplate[]>(() => loadCachedAgentTemplates(user?.tenantId));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;
    void bootstrapAgentTemplates(user.tenantId, false)
      .then(list => { if (!cancelled) setTemplates(list); })
      .catch(e => { if (!cancelled) setError(String((e as Error).message)); });
    return () => { cancelled = true; };
  }, [user?.tenantId]);

  const mcpUsage = templates.flatMap(t =>
    (t.mcpServers || []).map(srv => ({ template: t.name, server: srv }))
  );
  const uniqueServers = [...new Set(templates.flatMap(t => t.mcpServers || []))];

  return (
    <div>
      <div className="page-header">
        <h1>MCP 服务器</h1>
        <p>MCP 服务器在 Agent 模板里配置；运行时由 SDK 按模板设置启动</p>
      </div>

      {error && <div className="card" style={{ marginBottom: 16, color: 'var(--danger)' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div className="card">
            <div className="card-header">模板引用的 MCP 服务器</div>
            {uniqueServers.length === 0 ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.82em', padding: '16px 0', textAlign: 'center' }}>
                当前没有模板引用 MCP 服务器
              </div>
            ) : (
              uniqueServers.map(srv => {
                const users = mcpUsage.filter(u => u.server === srv).map(u => u.template);
                return (
                  <div key={srv} className="tool-card mb-2">
                    <div className="tool-card-name" style={{ fontFamily: 'var(--font-mono)' }}>{srv}</div>
                    <div className="tool-card-desc">使用模板: {users.join(', ')}</div>
                  </div>
                );
              })
            )}
          </div>

          <div className="card mt-4">
            <div className="card-header">模板 MCP 配置一览</div>
            {templates.filter(t => (t.mcpServers || []).length > 0).map(t => (
              <div key={t.id} className="tool-card mb-2">
                <div className="tool-card-name">{t.name}</div>
                <div className="flex gap-2 mt-1" style={{ flexWrap: 'wrap' }}>
                  {t.mcpServers.map(s => (
                    <span key={s} className="badge badge-info" style={{ fontFamily: 'var(--font-mono)' }}>{s}</span>
                  ))}
                </div>
              </div>
            ))}
            {templates.filter(t => (t.mcpServers || []).length > 0).length === 0 && (
              <div style={{ color: 'var(--ink-muted)', fontSize: '.82em' }}>
                在 Agents 页的模板编辑器里添加 MCP 服务器名称
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-header">MCP 连接类型</div>
            {MCP_TYPE_DOCS.map(doc => (
              <div key={doc.type} className="tool-card mb-2">
                <div className="tool-card-name" style={{ fontFamily: 'var(--font-mono)' }}>{doc.type}</div>
                <div className="tool-card-desc">{doc.desc}</div>
                <div style={{ fontSize: '.72em', color: 'var(--ink-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  {doc.example}
                </div>
              </div>
            ))}
          </div>

          <div className="card mt-4">
            <div className="card-header">当前激活的自定义工具桥 (sdk 类型)</div>
            <div style={{ fontSize: '.82em', color: 'var(--ink-secondary)' }}>
              通过 <code>createSdkMcpServer()</code> 注册的工具在 Agent 运行时自动挂载，无需手动配置。
              查看 <span style={{ fontFamily: 'var(--font-mono)' }}>server-agent.ts → customMcp</span> 了解实现细节。
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">全部模板（包含 mcpServers 字段）</div>
            <JsonViewer
              data={templates.map(t => ({ id: t.id, name: t.name, mcpServers: t.mcpServers }))}
              maxHeight={300}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
