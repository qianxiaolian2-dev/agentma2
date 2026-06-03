import { useState, useEffect, useCallback } from 'react';
import type { ChatSession, ChatMessage } from '../simulator/types';
import { useAuth } from '../contexts/AuthContext';
import JsonViewer from '../components/common/JsonViewer';
import StatusBadge from '../components/common/StatusBadge';

export default function Sessions() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selected, setSelected] = useState<ChatSession | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/chat-sessions', { headers });
      const data = await r.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const selectSession = async (session: ChatSession) => {
    if (!token) return;
    const r = await fetch(`/api/chat-sessions/${session.id}`, { headers });
    const data = await r.json();
    setSelected(data);
  };

  const handleRename = async (id: string) => {
    if (!editingTitle.trim() || !token) return;
    await fetch(`/api/chat-sessions/${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ title: editingTitle }),
    });
    setEditingId(null);
    loadSessions();
    if (selected?.id === id) setSelected(s => s ? { ...s, title: editingTitle } : s);
  };

  const handleTogglePin = async (id: string, pinned: boolean) => {
    if (!token) return;
    await fetch(`/api/chat-sessions/${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ pinned: !pinned }),
    });
    loadSessions();
    if (selected?.id === id) setSelected(s => s ? { ...s, pinned: !pinned } : s);
  };

  return (
    <div>
      <div className="page-header">
        <h1>会话管理</h1>
        <p>浏览、重命名、置顶 chat sessions；点击查看完整消息历史</p>
      </div>

      {error && <div className="card" style={{ marginBottom: 16, color: 'var(--danger)' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 20 }}>
        <div className="card">
          <div className="flex-between mb-4">
            <div className="card-header" style={{ marginBottom: 0 }}>
              会话列表 {sessions.length > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>({sessions.length})</span>}
            </div>
            <button className="btn btn-sm" onClick={loadSessions} disabled={loading}>
              {loading ? '加载中…' : '刷新'}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>标题</th><th>模型</th><th>消息</th><th>更新时间</th><th>操作</th></tr>
              </thead>
              <tbody>
                {sessions.length === 0 && !loading && (
                  <tr><td colSpan={5} style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: '20px 0' }}>暂无会话</td></tr>
                )}
                {sessions.map(s => (
                  <tr key={s.id} style={{ background: selected?.id === s.id ? 'var(--accent-bg)' : undefined }}>
                    <td>
                      {editingId === s.id ? (
                        <div className="flex gap-2">
                          <input
                            autoFocus value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRename(s.id)}
                            style={{ width: 140 }}
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => handleRename(s.id)}>保存</button>
                          <button className="btn btn-sm" onClick={() => setEditingId(null)}>取消</button>
                        </div>
                      ) : (
                        <div className="flex gap-2" style={{ alignItems: 'center' }}>
                          {s.pinned && <StatusBadge status="info" label="置顶" />}
                          <a href="#" onClick={e => { e.preventDefault(); selectSession(s); }}
                            style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                            {s.title || '(无标题)'}
                          </a>
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}>{s.model || '-'}</td>
                    <td style={{ fontSize: '.82em' }}>{Array.isArray(s.messages) ? s.messages.length : '-'}</td>
                    <td style={{ fontSize: '.78em', color: 'var(--ink-secondary)' }}>
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '-'}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-sm" onClick={() => { setEditingId(s.id); setEditingTitle(s.title || ''); }}>
                          重命名
                        </button>
                        <button className="btn btn-sm" onClick={() => handleTogglePin(s.id, Boolean(s.pinned))}>
                          {s.pinned ? '取消置顶' : '置顶'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="card fade-in">
            <div className="flex-between mb-4">
              <div className="card-header" style={{ marginBottom: 0 }}>
                {selected.title || '(无标题)'}
              </div>
              <button className="btn btn-sm" onClick={() => setSelected(null)}>关闭</button>
            </div>
            <div style={{ fontSize: '.78em', color: 'var(--ink-secondary)', marginBottom: 12 }}>
              <div>ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{selected.id}</span></div>
              <div>模型: {selected.model || '-'}</div>
              {selected.sdkSessionId && <div>SDK Session: <span style={{ fontFamily: 'var(--font-mono)' }}>{selected.sdkSessionId}</span></div>}
              {selected.sdkCwd && <div>工作目录: <span style={{ fontFamily: 'var(--font-mono)' }}>{selected.sdkCwd}</span></div>}
              <div>创建: {selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '-'}</div>
            </div>
            <div className="card-header" style={{ fontSize: '.82em', marginBottom: 8 }}>
              消息历史 ({Array.isArray(selected.messages) ? selected.messages.length : 0})
            </div>
            {(selected.messages as ChatMessage[] || []).map((msg, i) => (
              <div key={i} className="tool-card mb-2"
                style={{ borderLeft: `3px solid ${msg.role === 'assistant' ? 'var(--accent)' : 'var(--border)'}` }}>
                <div style={{ fontSize: '.72em', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 4 }}>
                  {msg.role === 'assistant' ? '助手' : '用户'} · {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
                <div style={{ fontSize: '.82em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {typeof msg.content === 'string' ? msg.content.slice(0, 400) : <JsonViewer data={msg.content} maxHeight={120} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
