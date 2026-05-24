import { useState, useCallback, useEffect } from 'react';
import type { BuiltInTool, ToolAnnotations, RegisteredTool, ToolEndpoint } from '../simulator/types';
import { BUILT_IN_TOOLS, initCustomTools, saveCustomTools } from '../simulator/mock-data';
import JsonViewer from '../components/common/JsonViewer';
import StatusBadge from '../components/common/StatusBadge';

// MCP 服务端管理组件
function McpServerManager({ server, tools }: { server: string; tools: RegisteredTool[] }) {
  const [showCode, setShowCode] = useState(false);
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [deployMsg, setDeployMsg] = useState('');
  const endpoints = tools.filter(t => t.endpoint);

  // 生成服务端代码
  const generateServerCode = () => {
    const funcs = endpoints.map(t => {
      const method = t.endpoint!.method.toLowerCase();
      const path = new URL(t.endpoint!.url).pathname;
      const params = Object.keys(t.inputSchema as Record<string, string>).filter(k => k !== 'bot_name');
      return `
// ${t.description}
app.${method}('${path}', ${method === 'get' || method === 'delete' ? '' : 'async '}(req, res) => {
${method === 'get' ? '  const params = req.query;\n  // TODO: 调用 Mineflayer API\n  res.json({ ok: true });' : `  const { ${params.join(', ')} } = req.body;\n  // TODO: 调用 Mineflayer API\n  console.log('${t.name}:', { ${params.join(', ')} });\n  res.json({ ok: true });`}
});`;
    }).join('\n');

    const port = endpoints[0]?.endpoint?.url ? new URL(endpoints[0].endpoint.url).port || '3005' : '3005';
    return `// MCP Server: ${server} — ${tools.length} tools
// 零依赖，使用 Node.js 内置 http 模块
const http = require('http');

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function route(method, path, handler) {
  return { method: method.toUpperCase(), path, handler };
}

const routes = [${endpoints.map(t => {
      const m = (t.endpoint!.method || 'POST').toUpperCase();
      const p = new URL(t.endpoint!.url).pathname;
      const params = Object.keys(t.inputSchema as Record<string, string>).filter(k => k !== 'bot_name');
      return `
  route('${m}', '${p}', async (req, res${m !== 'GET' ? ', body' : ''}) => {
    ${m !== 'GET' ? `const { ${params.join(', ')} } = body;\n    console.log('${t.name}', { ${params.join(', ')} });` : `console.log('${t.name} called');`}
    json(res, { ok: true${m !== 'GET' ? `, ${params[0] || 'result'}: ${params[0] || '"done"'}` : ''} });
  }),`;
    }).join('')}
];

// Health check route
routes.push(route('GET', '/api/health', (req, res) => json(res, { ok: true, server: '${server}', tools: ${tools.length} })));
routes.push(route('OPTIONS', '/', (req, res) => { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }); res.end(); }));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const r = routes.find(r => r.method === req.method && r.path === url.pathname);
  if (!r) { res.writeHead(404); res.end('Not found'); return; }
  const body = req.method !== 'GET' ? await parseBody(req) : null;
  await r.handler(req, res, body);
});

server.listen(${port}, () => console.log('[${server}] http://localhost:${port}'));`;
  };

  // 部署到本地
  const handleDeploy = async () => {
    setDeployMsg('部署中...');
    try {
      const code = generateServerCode();
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          code,
          tools: tools.map(t => ({ name: t.name, endpoint: t.endpoint })),
        }),
      });
      const data = await res.json();
      setDeployMsg(data.ok ? '✓ 已启动' : '✗ ' + (data.error || '失败'));
      setTimeout(() => checkStatus(), 2000);
    } catch (e) {
      setDeployMsg('✗ ' + (e as Error).message);
    }
  };

  const checkStatus = useCallback(async () => {
    if (endpoints.length === 0) return;
    const url = endpoints[0].endpoint!.url;
    const base = url.replace(/\/api\/[^/]+$/, '');
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(base + '/api/health', { signal: controller.signal });
      clearTimeout(t);
      setStatus(res.ok ? 'online' : 'offline');
    } catch { setStatus('offline'); }
  }, [endpoints]);

  useEffect(() => { checkStatus(); const iv = setInterval(checkStatus, 15000); return () => clearInterval(iv); }, [checkStatus]);

  return (
    <div className="card mb-4" style={{ borderColor: status === 'online' ? 'var(--success)' : 'var(--border)' }}>
      <div className="flex-between mb-3">
        <div className="flex gap-3" style={{ alignItems: 'center' }}>
          <div className="card-header" style={{ marginBottom: 0, fontFamily: 'var(--font-mono)', fontSize: '.85em' }}>
            mcpServers.{server}
          </div>
          <StatusBadge status={status === 'online' ? 'success' : status === 'checking' ? 'info' : 'error'}
            label={status === 'online' ? '在线' : status === 'checking' ? '检测中' : '离线'} />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setShowCode(!showCode)}>生成服务端</button>
          <button className="btn btn-sm btn-primary" onClick={handleDeploy}>部署</button>
        </div>
      </div>

      <div className="flex gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
        {tools.map(t => (
          <span key={t.name} className="badge badge-info">{t.name}</span>
        ))}
      </div>

      {deployMsg && (
        <div className="mb-2" style={{
          fontSize: '.82em',
          color: deployMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
        }}>{deployMsg}</div>
      )}

      {showCode && (
        <div className="fade-in">
          <pre style={{
            background: 'var(--bg-code)', color: '#d4d4d4', borderRadius: 6, padding: 14,
            fontSize: '.78em', lineHeight: 1.7, overflowX: 'auto', maxHeight: 400,
          }}>
            <code>{generateServerCode()}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

const BUILTIN_TAG_META: Record<string, string> = {
  file: '文件操作', execution: '命令执行', task: '任务管理',
  search: '搜索查询', interaction: '用户交互', mcp: 'MCP 资源', notebook: 'Notebook', agent: '子代理',
};

export default function Tools() {
  const [customTools, setCustomTools] = useState<RegisteredTool[]>(() => initCustomTools());
  const [selectedTool, setSelectedTool] = useState<BuiltInTool | RegisteredTool | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('all');

  // tag 管理
  const [tagRenaming, setTagRenaming] = useState<{ old: string; val: string } | null>(null);
  const [newTagName, setNewTagName] = useState('');

  const allTools: (BuiltInTool | RegisteredTool)[] = [...BUILT_IN_TOOLS, ...customTools];

  // 收集所有 tag
  const tags = Array.from(new Set(allTools.map(t => t.category)));

  const persist = (list: RegisteredTool[]) => { setCustomTools(list); saveCustomTools(list); };

  // 按 tag 过滤 + 搜索筛选
  const filtered = allTools
    .filter(t => tagFilter === 'all' || t.category === tagFilter)
    .filter(t => {
      if (!search) return true;
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
    });

  const handleDelete = (name: string) => { persist(customTools.filter(t => t.name !== name)); };

  // tag 重命名
  const startRename = (tag: string) => setTagRenaming({ old: tag, val: tag });
  const confirmRename = () => {
    if (!tagRenaming || !tagRenaming.val.trim() || tagRenaming.val === tagRenaming.old) { setTagRenaming(null); return; }
    // 更新所有使用该 tag 的自定义工具
    const updated = customTools.map(t => t.category === tagRenaming.old ? { ...t, category: tagRenaming.val.trim() } : t);
    persist(updated);
    if (tagFilter === tagRenaming.old) setTagFilter(tagRenaming.val.trim());
    setTagRenaming(null);
  };

  // tag 删除 (把使用该 tag 的工具移到 '未分类')
  const deleteTag = (tag: string) => {
    if (BUILTIN_TAG_META[tag]) return; // 内置 tag 不可删除
    const updated = customTools.map(t => t.category === tag ? { ...t, category: '未分类' } : t);
    persist(updated);
    if (tagFilter === tag) setTagFilter('all');
  };

  // 新建 tag (实际上就是新建一个空标签，下次注册工具时可以选)
  const createTag = () => {
    if (!newTagName.trim() || tags.includes(newTagName.trim())) return;
    setTagFilter(newTagName.trim());
    setNewTagName('');
  };

  // --- 注册表单 ---
  const [form, setForm] = useState({
    name: '', description: '', category: '', mcpServer: '', inputSchema: '{}',
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    endpointUrl: '', endpointMethod: 'GET' as ToolEndpoint['method'],
    endpointHeaders: '', endpointBody: '',
  });

  const handleRegister = () => {
    if (!form.name || !form.description || !form.category) return;
    try { JSON.parse(form.inputSchema); } catch { alert('inputSchema 必须是有效的 JSON'); return; }
    const endpoint: ToolEndpoint | undefined = form.endpointUrl ? {
      url: form.endpointUrl, method: form.endpointMethod,
      headers: form.endpointHeaders ? JSON.parse(form.endpointHeaders || '{}') : undefined,
      bodyTemplate: form.endpointBody || undefined,
    } : undefined;
    const tool: RegisteredTool = {
      name: form.name, description: form.description, category: form.category,
      inputSchema: JSON.parse(form.inputSchema),
      annotations: { readOnlyHint: form.readOnlyHint, destructiveHint: form.destructiveHint, idempotentHint: form.idempotentHint, openWorldHint: form.openWorldHint },
      source: 'local', endpoint, mcpServer: form.mcpServer || undefined,
    };
    const existing = customTools.find(t => t.name === tool.name);
    persist(existing ? customTools.map(t => t.name === tool.name ? tool : t) : [...customTools, tool]);
    setForm({ name: '', description: '', category: '', mcpServer: '', inputSchema: '{}', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true, endpointUrl: '', endpointMethod: 'GET', endpointHeaders: '', endpointBody: '' });
  };

  // GitHub 导入
  const [ghUrl, setGhUrl] = useState('');
  const [ghLoading, setGhLoading] = useState(false);
  const [ghMsg, setGhMsg] = useState('');
  const handleGhImport = async () => {
    if (!ghUrl.trim()) return; setGhLoading(true); setGhMsg('');
    try {
      let raw = ghUrl.trim().replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/');
      if (!raw.endsWith('.json')) raw = raw.replace(/\/$/, '') + '/tool.json';
      const res = await fetch(raw);
      if (!res.ok) { setGhMsg(`HTTP ${res.status}`); setGhLoading(false); return; }
      const data = await res.json();
      const name = data.name || raw.split('/').slice(-2)[0];
      if (customTools.find(t => t.name === name)) { setGhMsg(`"${name}" 已存在`); setGhLoading(false); return; }
      const tool: RegisteredTool = { name, description: data.description || '', category: data.category || 'imported', inputSchema: data.input_schema || {}, annotations: data.annotations, source: 'github', sourceUrl: ghUrl, endpoint: data.endpoint, mcpServer: data.mcp_server };
      persist([...customTools, tool]);
      setGhUrl(''); setGhMsg(`✓ 已导入 "${name}"`);
    } catch (e) { setGhMsg(`失败: ${(e as Error).message}`); }
    setGhLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1>🎒 工具 & MCP</h1>
        <p>按 Tag 分类管理 — 内置工具 + 自定义 MCP 工具，通过 mcpServers 注入 SDK</p>
      </div>

      {/* 搜索 + Tag 筛选 */}
      <div className="flex gap-3 mb-3" style={{ alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`搜索 ${allTools.length} 个工具...`}
          style={{ flex: 1, minWidth: 200, maxWidth: 340 }}
        />
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={`btn btn-sm ${tagFilter === 'all' ? 'btn-primary' : ''}`} onClick={() => setTagFilter('all')}>
            全部 ({allTools.length})
          </button>
          {tags.map(tag => (
            <button key={tag} className={`btn btn-sm ${tagFilter === tag ? 'btn-primary' : ''}`} onClick={() => setTagFilter(tag)}
              onDoubleClick={e => { e.preventDefault(); if (!BUILTIN_TAG_META[tag]) startRename(tag); }}
              title="单击筛选，双击重命名自定义标签">
              {BUILTIN_TAG_META[tag] || tag}
              <span style={{ marginLeft: 4, opacity: .6 }}>{allTools.filter(t => t.category === tag).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tag 管理 */}
      <details className="card mb-4">
        <summary className="card-header" style={{ cursor: 'pointer', marginBottom: 0 }}>Tag 管理 (增/删/改)</summary>
        <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={newTagName} onChange={e => setNewTagName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createTag(); }}
            placeholder="新标签名" style={{ width: 140, fontSize: '.82em' }} />
          <button className="btn btn-sm btn-primary" onClick={createTag}>新建 Tag</button>
          <span style={{ color: 'var(--ink-muted)', fontSize: '.78em' }}>
            · 双击上方标签按钮可重命名 · 内置标签不可删除
          </span>
        </div>
        {tagRenaming && (
          <div className="flex gap-2 mt-2 fade-in" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: '.8em' }}>重命名 "{tagRenaming.old}" →</span>
            <input autoFocus value={tagRenaming.val} onChange={e => setTagRenaming({ ...tagRenaming, val: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setTagRenaming(null); }}
              style={{ width: 160, fontSize: '.82em' }} />
            <button className="btn btn-sm btn-primary" onClick={confirmRename}>确认</button>
            <button className="btn btn-sm" onClick={() => setTagRenaming(null)}>取消</button>
          </div>
        )}
        <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {tags.filter(t => !BUILTIN_TAG_META[t]).map(tag => (
            <span key={tag} className="flex gap-1" style={{ alignItems: 'center', fontSize: '.8em', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: 4 }}>
              {tag}
              <span onClick={() => deleteTag(tag)} style={{ cursor: 'pointer', color: 'var(--danger)', fontSize: '1.1em' }} title="删除标签(工具移到未分类)">×</span>
            </span>
          ))}
        </div>
      </details>

      {/* 工具卡片 */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--ink-muted)' }}>无匹配工具</div>
      ) : (
        <div className="grid-2">
          {filtered.map(tool => (
            <div key={tool.name} className="tool-card" onClick={() => setSelectedTool(tool)} style={{ cursor: 'pointer' }}>
              <div className="flex-between">
                <div className="tool-card-name">{tool.name}</div>
                {'source' in tool && <span className="badge badge-info">自定义</span>}
              </div>
              <div className="tool-card-desc">{tool.description}</div>
              <div className="mt-2 flex gap-2" style={{ flexWrap: 'wrap' }}>
                <span className="badge badge-muted">{BUILTIN_TAG_META[tool.category] || tool.category}</span>
                {'endpoint' in tool && (tool as RegisteredTool).endpoint && (
                  <span className="badge" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>{(tool as RegisteredTool).endpoint!.method} API</span>
                )}
                {'mcpServer' in tool && (tool as RegisteredTool).mcpServer && (
                  <span className="badge" style={{ background: 'var(--success-bg)', color: 'var(--success)', fontFamily: 'var(--font-mono)', fontSize: '.72em' }}>
                    mcp__{(tool as RegisteredTool).mcpServer}__*
                  </span>
                )}
                {tool.annotations?.readOnlyHint && <span className="badge badge-success">只读</span>}
              </div>
              {'source' in tool && (
                <button className="btn btn-sm btn-danger mt-2" onClick={e => { e.stopPropagation(); handleDelete(tool.name); }}>删除</button>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedTool && (
        <div className="card mt-4 fade-in">
          <div className="flex-between">
            <div className="card-header" style={{ marginBottom: 0 }}>{selectedTool.name}</div>
            <button className="btn btn-sm" onClick={() => setSelectedTool(null)}>关闭</button>
          </div>
          <div className="mt-4"><JsonViewer data={selectedTool} maxHeight={400} /></div>
        </div>
      )}

      {/* MCP 服务器管理 */}
      {(() => {
        const servers = Array.from(new Set(customTools.filter(t => t.mcpServer).map(t => t.mcpServer!)));
        if (servers.length === 0) return null;
        return (
          <div className="section mt-4">
            <div className="section-title">MCP 服务端管理</div>
            {servers.map(server => {
              const serverTools = customTools.filter(t => t.mcpServer === server);
              const endpoints = serverTools.filter(t => t.endpoint);
              return <McpServerManager key={server} server={server} tools={serverTools} />;
            })}
          </div>
        );
      })()}

      {/* 注册工具 */}
      <details className="section mt-4">
        <summary className="section-title" style={{ cursor: 'pointer' }}>+ 注册 MCP 工具</summary>
        <div className="card mt-2" style={{ borderColor: 'var(--success)' }}>
          <div className="grid-2">
            <div>
              <div className="form-group">
                <label>MCP 服务器名</label>
                <input value={form.mcpServer} onChange={e => setForm({ ...form, mcpServer: e.target.value })} placeholder="minecraft" style={{ fontFamily: 'var(--font-mono)' }} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label>工具名 *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="my-tool" />
                </div>
                <div className="form-group">
                  <label>Tag * (自由输入)</label>
                  <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Minecraft" list="tag-list" />
                  <datalist id="tag-list">{tags.map(t => <option key={t} value={t} />)}</datalist>
                </div>
              </div>
              <div className="form-group">
                <label>描述 *</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="工具功能描述" />
              </div>
              <div className="form-group">
                <label>inputSchema (JSON)</label>
                <textarea value={form.inputSchema} onChange={e => setForm({ ...form, inputSchema: e.target.value })} rows={3} style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em' }} />
              </div>
            </div>
            <div>
              <div className="form-group">
                <label>ToolAnnotations</label>
                {[['readOnlyHint', '只读'], ['destructiveHint', '破坏性'], ['idempotentHint', '幂等'], ['openWorldHint', '外部']].map(([k, v]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: '.82em' }}>
                    <input type="checkbox" checked={!!form[k as keyof typeof form]} onChange={e => setForm({ ...form, [k]: e.target.checked })} style={{ width: 'auto' }} />
                    {k} ({v})
                  </label>
                ))}
              </div>
              <details style={{ marginBottom: 8 }}>
                <summary style={{ fontSize: '.82em', fontWeight: 600, color: 'var(--info)', cursor: 'pointer' }}>🔗 API 端点</summary>
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--info-bg)', borderRadius: 6 }}>
                  <div className="form-group"><label>URL</label><input value={form.endpointUrl} onChange={e => setForm({ ...form, endpointUrl: e.target.value })} placeholder="http://localhost:3005/api/action" style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }} /></div>
                  <div className="grid-2">
                    <div className="form-group"><label>Method</label><select value={form.endpointMethod} onChange={e => setForm({ ...form, endpointMethod: e.target.value as ToolEndpoint['method'] })}>{['GET','POST','PUT','DELETE','PATCH'].map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                    <div className="form-group"><label>Headers (JSON)</label><input value={form.endpointHeaders} onChange={e => setForm({ ...form, endpointHeaders: e.target.value })} placeholder='{"Authorization":"Bearer {{token}}"}' style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }} /></div>
                  </div>
                  <div className="form-group"><label>Body ({'{{param}}'})</label><textarea value={form.endpointBody} onChange={e => setForm({ ...form, endpointBody: e.target.value })} rows={2} style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }} /></div>
                </div>
              </details>
              <button className="btn btn-primary" onClick={handleRegister}>注册工具</button>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
