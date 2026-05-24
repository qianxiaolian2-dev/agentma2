import { useState } from 'react';
import type { McpServerStatus, McpServerConfig } from '../simulator/types';
import { sdkSimulator } from '../simulator/sdk-simulator';
import { MOCK_MCP_SERVERS } from '../simulator/mock-data';
import StatusBadge from '../components/common/StatusBadge';
import JsonViewer from '../components/common/JsonViewer';

const TYPE_OPTIONS = ['stdio', 'sse', 'http', 'sdk'] as const;

export default function McpServers() {
  const [servers, setServers] = useState<McpServerStatus[]>(MOCK_MCP_SERVERS);
  const [selectedServer, setSelectedServer] = useState<McpServerStatus | null>(null);

  // 新服务器表单
  const [newServer, setNewServer] = useState({
    name: '', type: 'stdio' as McpServerConfig['type'], command: '', url: '', version: '1.0.0',
  });

  const refresh = () => {
    const status = sdkSimulator.getMcpStatus();
    setServers([...status]);
  };

  // reconnectMcpServer()
  const reconnect = async (name: string) => {
    await sdkSimulator.reconnectMcpServer(name);
    refresh();
  };

  // toggleMcpServer()
  const toggle = async (name: string, enabled: boolean) => {
    await sdkSimulator.toggleMcpServer(name, enabled);
    refresh();
  };

  // createSdkMcpServer() —— 创建新的 MCP 服务器
  const createServer = async () => {
    if (!newServer.name) return;
    const config: Record<string, unknown> = {
      name: newServer.name,
      version: newServer.version,
      type: newServer.type,
    };
    if (newServer.type === 'stdio') config.command = newServer.command;
    else if (newServer.type === 'sse' || newServer.type === 'http') config.url = newServer.url;

    await sdkSimulator.addMcpServer(newServer.name, config);
    refresh();
    setNewServer({ name: '', type: 'stdio', command: '', url: '', version: '1.0.0' });
  };

  return (
    <div>
      <div className="page-header">
        <h1>🔌 MCP 服务器管理</h1>
        <p>mcpServerStatus() / reconnectMcpServer() / toggleMcpServer() / createSdkMcpServer() / McpServerConfig</p>
      </div>

      {/* 创建 MCP 服务器 */}
      <div className="card mb-4">
        <div className="card-header">createSdkMcpServer() — 新建 MCP 服务器</div>
        <div className="grid-2">
          <div className="form-group">
            <label>name (服务器名称)</label>
            <input value={newServer.name} onChange={e => setNewServer({ ...newServer, name: e.target.value })} placeholder="my-mcp-server" />
          </div>
          <div className="form-group">
            <label>type (连接类型)</label>
            <select value={newServer.type} onChange={e => setNewServer({ ...newServer, type: e.target.value as typeof newServer.type })}>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {newServer.type === 'stdio' && (
            <div className="form-group">
              <label>command</label>
              <input value={newServer.command} onChange={e => setNewServer({ ...newServer, command: e.target.value })} placeholder="npx -y @anthropic-ai/mcp-server" />
            </div>
          )}
          {(newServer.type === 'sse' || newServer.type === 'http') && (
            <div className="form-group">
              <label>url</label>
              <input value={newServer.url} onChange={e => setNewServer({ ...newServer, url: e.target.value })} placeholder="http://localhost:8080" />
            </div>
          )}
          <div className="form-group">
            <label>version</label>
            <input value={newServer.version} onChange={e => setNewServer({ ...newServer, version: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-primary mt-2" onClick={createServer}>创建服务器</button>
      </div>

      {/* 服务器列表 */}
      <div>
        <div className="flex-between mb-4">
          <div className="section-title" style={{ marginBottom: 0 }}>MCP 服务器列表 — McpServerStatus[]</div>
          <button className="btn btn-sm" onClick={refresh}>刷新状态</button>
        </div>
        <div className="grid-2">
          {servers.map(srv => (
            <div key={srv.name} className="tool-card" onClick={() => setSelectedServer(srv)} style={{ cursor: 'pointer' }}>
              <div className="flex-between">
                <div className="tool-card-name">{srv.name}</div>
                <StatusBadge status={srv.status} />
              </div>
              {srv.serverInfo && (
                <div className="tool-card-desc">
                  {srv.serverInfo.name} v{srv.serverInfo.version}
                </div>
              )}
              {srv.error && (
                <div className="tool-card-desc" style={{ color: 'var(--danger)' }}>{srv.error}</div>
              )}
              <div className="flex gap-2 mt-2">
                <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); reconnect(srv.name); }} disabled={srv.status === 'connected'}>
                  reconnectMcpServer()
                </button>
                <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); toggle(srv.name, srv.status !== 'connected'); }}>
                  toggleMcpServer({srv.status === 'connected' ? 'false' : 'true'})
                </button>
              </div>
              {srv.tools && srv.tools.length > 0 && (
                <div className="mt-2 flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {srv.tools.map(t => (
                    <span key={t.name} className="badge badge-muted">{t.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 选中服务器详情 */}
        {selectedServer && (
          <div className="card mt-4 fade-in">
            <div className="flex-between">
              <div className="card-header" style={{ marginBottom: 0 }}>
                {selectedServer.name} — 完整状态 (McpServerStatus)
              </div>
              <button className="btn btn-sm" onClick={() => setSelectedServer(null)}>关闭</button>
            </div>
            <div className="mt-4">
              <JsonViewer data={selectedServer} maxHeight={400} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
