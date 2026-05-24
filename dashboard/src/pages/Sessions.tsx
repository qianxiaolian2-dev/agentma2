import { useState, useEffect } from 'react';
import type { SDKSessionInfo, SessionMessage } from '../simulator/types';
import { sdkSimulator } from '../simulator/sdk-simulator';
import JsonViewer from '../components/common/JsonViewer';
import StatusBadge from '../components/common/StatusBadge';

export default function Sessions() {
  const [sessions, setSessions] = useState<SDKSessionInfo[]>([]);
  const [selected, setSelected] = useState<SDKSessionInfo | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  // listSessions()
  const loadSessions = async () => {
    const data = await sdkSimulator.listSessions();
    setSessions(data);
  };

  useEffect(() => { loadSessions(); }, []);

  // getSessionMessages() + getSessionInfo()
  const selectSession = async (session: SDKSessionInfo) => {
    setSelected(session);
    const msgs = await sdkSimulator.getSessionMessages(session.sessionId);
    setMessages(msgs);
  };

  // renameSession()
  const handleRename = async (sessionId: string) => {
    if (!editingTitle.trim()) return;
    await sdkSimulator.renameSession(sessionId, editingTitle);
    setEditingId(null);
    loadSessions();
    if (selected?.sessionId === sessionId) {
      setSelected({ ...selected, customTitle: editingTitle });
    }
  };

  // tagSession()
  const handleTag = async (sessionId: string) => {
    await sdkSimulator.tagSession(sessionId, tagInput || null);
    setTagInput('');
    loadSessions();
  };

  return (
    <div>
      <div className="page-header">
        <h1>💬 会话管理</h1>
        <p>listSessions() / getSessionMessages() / renameSession() / tagSession() / getSessionInfo()</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 20 }}>
        {/* 会话列表 */}
        <div className="card">
          <div className="flex-between mb-4">
            <div className="card-header" style={{ marginBottom: 0 }}>会话列表 — listSessions()</div>
            <button className="btn btn-sm" onClick={loadSessions}>刷新</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>标签</th>
                  <th>分支</th>
                  <th>最近活动</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.sessionId} style={{ background: selected?.sessionId === s.sessionId ? 'var(--accent-bg)' : undefined }}>
                    <td>
                      {editingId === s.sessionId ? (
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRename(s.sessionId)}
                            style={{ width: 120 }}
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => handleRename(s.sessionId)}>保存</button>
                        </div>
                      ) : (
                        <a href="#" onClick={e => { e.preventDefault(); selectSession(s); }} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                          {s.customTitle || s.summary.slice(0, 30)}
                        </a>
                      )}
                    </td>
                    <td>
                      {s.tag ? (
                        <span className="badge badge-info">{s.tag}</span>
                      ) : (
                        <span style={{ color: 'var(--ink-muted)', fontSize: '.8em' }}>-</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em' }}>{s.gitBranch || '-'}</td>
                    <td style={{ fontSize: '.8em', color: 'var(--ink-secondary)' }}>{new Date(s.lastModified).toLocaleString()}</td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-sm" onClick={() => { setEditingId(s.sessionId); setEditingTitle(s.customTitle || ''); }}>
                          renameSession()
                        </button>
                        <button className="btn btn-sm" onClick={() => { setTagInput(s.tag || ''); handleTag(s.sessionId); }}>
                          tagSession()
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 消息详情 */}
        {selected && (
          <div className="card fade-in">
            <div className="card-header">
              getSessionMessages("{selected.sessionId}")
              {selected.tag && <StatusBadge status="info" label={selected.tag} />}
            </div>
            <div style={{ fontSize: '.82em', color: 'var(--ink-secondary)', marginBottom: 12 }}>
              <div>会话 ID: {selected.sessionId}</div>
              <div>创建: {selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '-'}</div>
              <div>工作目录: {selected.cwd || '-'}</div>
              <div>首条提示: {selected.firstPrompt || '-'}</div>
            </div>
            <div className="card-header" style={{ fontSize: '.82em' }}>消息历史 ({messages.length})</div>
            {messages.map((msg, i) => (
              <div key={i} className="tool-card mb-2" style={{ borderLeft: `3px solid ${msg.type === 'assistant' ? 'var(--accent)' : 'var(--border)'}` }}>
                <div style={{ fontSize: '.75em', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 4 }}>
                  {msg.type === 'assistant' ? '助手消息' : '用户消息'}
                </div>
                <JsonViewer data={msg.message} maxHeight={150} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
