import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatSession, AgentTemplate, ChatMessage, ProviderConfig } from '../simulator/types';
import { getDefaultProviderConfig, initCustomTools } from '../simulator/mock-data';
import type { EventSourceConfig } from '../simulator/types';
import { getEndpointProbeBlockReason, isUsingApiKeyAuth, getAuthHeaders } from '../utils/client-runtime';
import { PermissionPromptList, type PermissionRequest } from '../components/PermissionPrompt';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, loadCachedAgentTemplates } from '../utils/agent-templates';
import {
  bootstrapChatSessions,
  deleteChatSession as deleteChatSessionApi,
  patchChatSession,
  saveChatSession as saveChatSessionApi,
} from '../utils/chat-sessions';

// MCP 服务状态指示灯（自动 ping 端点）
function McpStatusDot({ server, endpoint }: { server: string; endpoint: string }) {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [detail, setDetail] = useState('');

  const doPing = useCallback(async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const blockedReason = getEndpointProbeBlockReason(endpoint);
      if (blockedReason) {
        if (!cancelled) {
          setStatus('offline');
          setDetail(blockedReason);
        }
        return;
      }
      // 试 /api/health
      const base = endpoint.replace(/\/api\/[^/]+$/, '');
      let ok = await doPing(base + '/api/health');
      if (!ok) ok = await doPing(endpoint); // 试直接请求 endpoint
      if (!cancelled) {
        setStatus(ok ? 'online' : 'offline');
        setDetail(ok ? '' : `无法连接 ${base}`);
      }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [endpoint, doPing]);

  const colors: Record<string, string> = { checking: 'var(--ink-muted)', online: 'var(--success)', offline: 'var(--danger)' };
  return (
    <span title={`${server}: ${status}${detail ? ' — ' + detail : ''}`} style={{
      width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
      background: colors[status], cursor: 'pointer',
    }} onClick={() => { if (status === 'offline') alert(`${server} 离线\n${detail}`); }} />
  );
}

function loadGlobalProvider(): ProviderConfig {
  try {
    const raw = localStorage.getItem('agentma_provider_config');
    if (raw) return { ...getDefaultProviderConfig(), ...JSON.parse(raw) };
  } catch {}
  return getDefaultProviderConfig();
}

function formatEvent(ev: { type: string; source?: string; username?: string; message?: string; health?: number }): string {
  if (ev.type === 'chat') return `[${ev.source || 'bot'}] ${ev.username || '?'}: ${ev.message || ''}`;
  if (ev.type === 'health') return `[${ev.source || 'bot'}] 血量: ${ev.health}`;
  if (ev.type === 'playerJoin') return `[${ev.source || 'bot'}] ${ev.username || '?'} 加入了游戏`;
  if (ev.type === 'playerLeave') return `[${ev.source || 'bot'}] ${ev.username || '?'} 离开了游戏`;
  return `[${ev.source || 'bot'}] ${ev.type}`;
}

export default function Conversations() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>(() => loadCachedAgentTemplates(user?.tenantId));
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // 聊天状态
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamThinking, setStreamThinking] = useState('');
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [streamText, setStreamText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const provider = useRef<ProviderConfig>(loadGlobalProvider());
  const currentAgent = templates.find(t => t.id === selectedAgentId);

  const [botEvents, setBotEvents] = useState<Array<{ type: string; source?: string; username?: string; message?: string; timestamp: number }>>([]);
  const [eventSources, setEventSources] = useState<EventSourceConfig[]>([]);
  const [subbedSources, setSubbedSources] = useState<string[]>([]);
  const [showEventToggles, setShowEventToggles] = useState(false);
  const autoReplyRef = useRef<((eventText: string) => Promise<void>) | null>(null);
  const persistRef = useRef<((msgs: ChatMessage[], sid: string | null) => Promise<string>) | null>(null);

  // 自动回复
  const doAutoReply = useCallback(async (eventText: string) => {
    if (!currentAgent || isStreaming || !activeSessionId) return;

    const agent = currentAgent;
    const currentMsgs = messages;
    const prov = { ...loadGlobalProvider() };
    if (agent.providerOverrides) Object.assign(prov, agent.providerOverrides);

    setIsStreaming(true);
    const eventMsg: ChatMessage = { role: 'user', content: eventText, timestamp: Date.now() };
    const newMsgs = [...currentMsgs, eventMsg];
    setMessages(newMsgs);
    setStreamThinking('');
    setStreamText('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: agent.systemPrompt || undefined,
          provider: prov,
          tools: (() => {
            if (!agent?.tools?.length) return undefined;
            const customs = initCustomTools();
            const BUILTIN_SCHEMAS: Record<string, Record<string, unknown>> = {
              Read: { file_path: 'string' }, Write: { file_path: 'string', content: 'string' },
              Edit: { file_path: 'string', old_string: 'string', new_string: 'string' },
              Bash: { command: 'string' }, Grep: { pattern: 'string' }, Glob: { pattern: 'string' },
              WebSearch: { query: 'string' }, WebFetch: { url: 'string', prompt: 'string' },
            };
            return agent.tools.map(t => {
              const custom = customs.find(c => c.name === t);
              if (custom) return { name: t, description: custom.description, input_schema: custom.inputSchema };
              const schema = BUILTIN_SCHEMAS[t];
              if (schema) return { name: t, description: t, input_schema: schema };
              return { name: t, description: t, input_schema: {} };
            });
          })(),
        }),
      });

      if (res.ok) {
        const reader = res.body?.getReader(); if (!reader) { setIsStreaming(false); return; }
        const dec = new TextDecoder(); let buf = ''; let thinking = ''; let text = '';
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'delta') {
                if (d.thinking) { thinking += d.text || ''; setStreamThinking(thinking); }
                else { text += d.text || ''; setStreamText(text); }
              } else if (d.type === 'result') {
                const content = d.text || text || thinking || '';
                const respMsg: ChatMessage = { role: 'assistant', content, timestamp: Date.now() };
                const finalMsgs = [...newMsgs, respMsg];
                setMessages(finalMsgs);
                setStreamThinking(''); setStreamText('');
                const sid = await (persistRef.current?.(finalMsgs, activeSessionId) || Promise.resolve(''));
                if (sid) setActiveSessionId(sid);
              } else if (d.type === 'permission_request') {
                setPendingPermissions(prev => [...prev, {
                  reqId: d.reqId, toolName: d.toolName, input: d.input,
                  title: d.title, displayName: d.displayName, description: d.description,
                  toolUseID: d.toolUseID,
                }]);
              } else if (d.type === 'permission_resolved') {
                if (d.reqId) setPendingPermissions(prev => prev.filter(p => p.reqId !== d.reqId));
              }
            } catch {}
          }
        }
      }
    } catch {}
    setIsStreaming(false);
  }, [currentAgent, isStreaming, activeSessionId, messages]);

  // 订阅 EventSource — 当 MCP 服务器部署后，自动桥接 bot 事件到当前会话
  useEffect(() => {
    if (!activeSessionId) return;
    const sid = activeSessionId;

    const setup = async () => {
      // 1. 获取已注册的事件源
      const srcRes = await fetch('/api/events/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
      const sources: EventSourceConfig[] = await srcRes.json().catch(() => []);
      if (!Array.isArray(sources) || sources.length === 0) return;

      // 首次打开自动订阅所有可用源，后续以用户手动选择为准
      const savedSubs: string[] = (() => { try { const r = localStorage.getItem(`session_subs_${sid}`); return r ? JSON.parse(r) : sources.map((s: EventSourceConfig) => s.name); } catch { return sources.map((s: EventSourceConfig) => s.name); } })();
      if (!localStorage.getItem(`session_subs_${sid}`)) {
        localStorage.setItem(`session_subs_${sid}`, JSON.stringify(savedSubs));
      }
      setEventSources(sources);
      setSubbedSources(savedSubs);

      for (const s of sources) {
        if (!s.enabled || !savedSubs.includes(s.name)) continue;
        fetch(`/api/sessions/${sid}/events/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceName: s.name }) }).catch(() => {});
      }

      // 3. 连接 SSE 事件流
      const evtSource = new EventSource(`/api/sessions/${sid}/events`);
      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') return;
          const ev = { ...data, timestamp: Date.now() };
          setBotEvents(prev => [...prev.slice(-50), ev]);
          // 事件自动触发 agent 回复
          if (!isStreaming && currentAgent) {
            doAutoReply(formatEvent(ev));
          }
        } catch {}
      };
      evtSource.onerror = () => { /* 自动重连 */ };
      return () => evtSource.close();
    };

    const cleanup = setup();
    return () => { cleanup.then(fn => fn?.()); };
  }, [activeSessionId, currentAgent]);

  // 加载数据
  // 锁定外层滚动，让内部区域各自独立滚动
  useEffect(() => {
    const el = document.querySelector('.main-content');
    if (el) el.classList.add('no-scroll');
    return () => { if (el) el.classList.remove('no-scroll'); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (user?.tenantId) {
      setTemplates(loadCachedAgentTemplates(user.tenantId));
      void bootstrapAgentTemplates(user.tenantId, user.role === 'tenant_admin')
        .then((list) => {
          if (!cancelled) setTemplates(list);
        })
        .catch((error) => {
          console.error('failed to load agent templates', error);
        });
    }

    (async () => {
      try {
        const savedSessions = await bootstrapChatSessions(!isUsingApiKeyAuth());
        if (!cancelled) setSessions(savedSessions);
      } catch (error) {
        console.error('failed to load chat sessions', error);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.tenantId, user?.role]);

  useEffect(() => {
    if (selectedAgentId) return;
    const lastId = sessions.length > 0
      ? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0].templateId
      : templates[0]?.id || '';
    if (lastId) setSelectedAgentId(lastId);
  }, [sessions, templates, selectedAgentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamThinking, streamText]);

  // 保存会话（服务端持久化 + 本地状态同步）
  const persistSession = useCallback(async (msgs: ChatMessage[], sid: string | null) => {
    if (!selectedAgentId || msgs.length === 0) return '';
    const now = Date.now();
    const id = sid || `chat-${Date.now()}`;
    const existing = sid ? sessions.find((session) => session.id === sid) : undefined;
    const draft: ChatSession = {
      id,
      templateId: selectedAgentId,
      title: existing?.title || msgs[0]?.content?.slice(0, 40) || '新对话',
      messages: msgs,
      model: currentAgent?.model || provider.current.ANTHROPIC_MODEL || existing?.model || '',
      pinned: existing?.pinned,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    setSessions(prev => {
      const existingSession = prev.find((session) => session.id === id);
      if (existingSession) {
        return prev.map((session) => session.id === id ? { ...draft, createdAt: existingSession.createdAt } : session);
      }
      return [draft, ...prev];
    });

    try {
      const saved = await saveChatSessionApi(draft);
      setSessions(prev => {
        const exists = prev.some((session) => session.id === saved.id);
        if (!exists) return [saved, ...prev];
        return prev.map((session) => session.id === saved.id ? saved : session);
      });
      return saved.id;
    } catch (error) {
      console.error('failed to persist chat session', error);
      return id;
    }
  }, [selectedAgentId, currentAgent, sessions]);

  // 把 persistSession 存到 ref 供 doAutoReply 使用
  persistRef.current = persistSession;

  // 新建对话
  const handleNew = () => {
    if (!selectedAgentId) return;
    setActiveSessionId(null);
    setMessages([]);
    setStreamThinking('');
    setStreamText('');
    setInput('');
  };

  // 选中会话时滚动到可见位置
  useEffect(() => {
    if (activeSessionId && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [activeSessionId]);

  // 恢复已有会话
  const handleSelect = useCallback((s: ChatSession) => {
    setActiveSessionId(s.id);
    setMessages(s.messages);
    setStreamThinking('');
    setStreamText('');
    setInput('');
    if (s.templateId && templates.find(t => t.id === s.templateId)) {
      setSelectedAgentId(s.templateId);
    }
  }, [templates]);

  // 编辑标题
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startRename = (s: ChatSession) => {
    setEditingId(s.id);
    setEditTitle(s.title || s.messages[0]?.content?.slice(0, 40) || '');
  };

  const handleRename = async (id: string) => {
    const nextTitle = editTitle.trim();
    if (!nextTitle) return;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: nextTitle } : s));
    setEditingId(null);
    try {
      const saved = await patchChatSession(id, { title: nextTitle });
      setSessions(prev => prev.map(s => s.id === id ? saved : s));
    } catch (error) {
      console.error('failed to rename chat session', error);
    }
  };

  // 置顶
  const handlePin = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = sessions.find((session) => session.id === id);
    const nextPinned = !current?.pinned;
    setSessions(prev => prev.map(s => s.id === id ? { ...s, pinned: nextPinned } : s));
    try {
      const saved = await patchChatSession(id, { pinned: nextPinned });
      setSessions(prev => prev.map(s => s.id === id ? saved : s));
    } catch (error) {
      console.error('failed to pin chat session', error);
    }
  };

  // 删除会话
  const handleDelete = async (id: string) => {
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
    try {
      await deleteChatSessionApi(id);
    } catch (error) {
      console.error('failed to delete chat session', error);
      setSessions(sessions);
    }
  };

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming || !currentAgent) return;

    // 合并 provider 配置
    provider.current = loadGlobalProvider();
    if (currentAgent.providerOverrides) {
      provider.current = { ...provider.current, ...currentAgent.providerOverrides };
    }

    const userMsg: ChatMessage = { role: 'user', content: input.trim(), timestamp: Date.now() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput('');
    setIsStreaming(true);
    setStreamThinking('');
    setStreamText('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: currentAgent.systemPrompt || undefined,
          provider: provider.current,
          tools: (() => {
            if (!currentAgent?.tools?.length) return undefined;
            const customs = initCustomTools();
            // 内置工具 schema（简化的）
            const BUILTIN_SCHEMAS: Record<string, Record<string, unknown>> = {
              Read: { file_path: 'string', offset: 'number?', limit: 'number?' },
              Write: { file_path: 'string', content: 'string' },
              Edit: { file_path: 'string', old_string: 'string', new_string: 'string', replace_all: 'boolean?' },
              Bash: { command: 'string', timeout: 'number?', description: 'string?' },
              Grep: { pattern: 'string', path: 'string?' },
              Glob: { pattern: 'string' },
              WebSearch: { query: 'string' },
              WebFetch: { url: 'string', prompt: 'string' },
              TaskCreate: { subject: 'string', description: 'string' },
              TaskUpdate: { taskId: 'string', status: 'string' },
              TaskList: {},
            };
            return currentAgent.tools.map(t => {
              const custom = customs.find(c => c.name === t);
              if (custom) return { name: t, description: custom.description, input_schema: custom.inputSchema };
              const schema = BUILTIN_SCHEMAS[t];
              if (schema) return { name: t, description: t, input_schema: schema };
              return { name: t, description: t, input_schema: {} };
            });
          })(),
        }),
      });

      if (!res.ok) {
        const errMsg: ChatMessage = { role: 'assistant', content: `API 错误: ${res.status}`, timestamp: Date.now() };
        const finalMsgs = [...newMsgs, errMsg];
        setMessages(finalMsgs);
        const sid = await persistSession(finalMsgs, activeSessionId);
        if (sid) setActiveSessionId(sid);
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setIsStreaming(false); return; }

      const decoder = new TextDecoder();
      let buf = '';
      let thinking = '';
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'delta') {
              if (data.thinking) { thinking += data.text || ''; setStreamThinking(thinking); }
              else { text += data.text || ''; setStreamText(text); }
            } else if (data.type === 'result') {
              const content = data.text || text || thinking || '';
              const respMsg: ChatMessage = { role: 'assistant', content, timestamp: Date.now() };
              const finalMsgs = [...newMsgs, respMsg];
              setMessages(finalMsgs);
              const sid = await persistSession(finalMsgs, activeSessionId);
              if (sid) setActiveSessionId(sid);
              setStreamThinking('');
              setStreamText('');
            } else if (data.type === 'permission_request') {
              setPendingPermissions(prev => [...prev, {
                reqId: data.reqId, toolName: data.toolName, input: data.input,
                title: data.title, displayName: data.displayName, description: data.description,
                toolUseID: data.toolUseID,
              }]);
            } else if (data.type === 'permission_resolved') {
              if (data.reqId) setPendingPermissions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (data.type === 'error') {
              const err: ChatMessage = { role: 'assistant', content: `错误: ${data.message}`, timestamp: Date.now() };
              const finalMsgs = [...newMsgs, err];
              setMessages(finalMsgs);
              const sid = await persistSession(finalMsgs, activeSessionId);
              if (sid) setActiveSessionId(sid);
              setStreamThinking('');
              setStreamText('');
            }
          } catch {}
        }
      }
    } catch (e) {
      const err: ChatMessage = { role: 'assistant', content: `连接失败: ${(e as Error).message}`, timestamp: Date.now() };
      const finalMsgs = [...newMsgs, err];
      setMessages(finalMsgs);
      const sid = await persistSession(finalMsgs, activeSessionId);
      if (sid) setActiveSessionId(sid);
    }
    setIsStreaming(false);
  }, [input, isStreaming, currentAgent, messages, activeSessionId, persistSession]);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 左侧：历史对话列表 */}
      <div style={{
        width: 280, minWidth: 280, borderRight: '1px solid var(--border)',
        background: 'var(--bg-card)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Agent 选择 + 新对话 */}
        <div style={{ padding: '14px 14px 8px', borderBottom: '1px solid var(--border)' }}>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <select
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(e.target.value)}
              style={{ fontSize: '.82em' }}
            >
              {templates.length === 0 && <option value="">暂无 Agent</option>}
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleNew}
            disabled={!selectedAgentId}
            style={{ width: '100%' }}
          >
            + 新对话
          </button>
        </div>

        {/* 会话列表 */}
        <div ref={sidebarRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {[...sessions]
            .sort((a, b) => {
              if (a.pinned && !b.pinned) return -1;
              if (!a.pinned && b.pinned) return 1;
              return b.updatedAt - a.updatedAt;
            })
            .map(s => (
              <div
                key={s.id}
                ref={activeSessionId === s.id ? activeItemRef : undefined}
                onClick={() => handleSelect(s)}
                style={{
                  padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                  marginBottom: 4, transition: 'all .1s',
                  background: activeSessionId === s.id ? 'var(--accent-bg)' : s.pinned ? 'var(--warning-bg)' : 'transparent',
                }}
                onMouseEnter={e => { if (activeSessionId !== s.id && !s.pinned) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (activeSessionId !== s.id && !s.pinned) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* 标题行 */}
                <div className="flex-between" style={{ marginBottom: 3 }}>
                  {editingId === s.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleRename(s.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => { void handleRename(s.id); }}
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: '.82em', padding: '3px 6px', flex: 1 }}
                    />
                  ) : (
                    <div
                      style={{ fontSize: '.84em', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                      onDoubleClick={e => { e.stopPropagation(); startRename(s); }}
                      title="双击编辑标题"
                    >
                      {s.pinned && <span style={{ marginRight: 4 }}>📌</span>}
                      {s.title || s.messages[0]?.content?.slice(0, 25) || '(无标题)'}
                    </div>
                  )}
                  <span
                    onClick={e => { void handlePin(s.id, e); }}
                    style={{ cursor: 'pointer', fontSize: '.85em', opacity: s.pinned ? 1 : .3, marginLeft: 4 }}
                    title={s.pinned ? '取消置顶' : '置顶'}
                  >📌</span>
                </div>
                <div className="flex-between" style={{ fontSize: '.72em', color: 'var(--ink-muted)' }}>
                  <span>{templates.find(t => t.id === s.templateId)?.name || 'Agent'}</span>
                  <span style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>{s.messages.length} 条</span>
                </div>
                <div className="flex-between" style={{ fontSize: '.68em', color: 'var(--ink-muted)', marginTop: 2 }}>
                  <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                  <button
                    className="btn btn-sm"
                    style={{ padding: '0 6px', fontSize: '.85em', color: 'var(--danger)' }}
                    onClick={e => { e.stopPropagation(); void handleDelete(s.id); }}
                  >删除</button>
                </div>
              </div>
            ))}
          {sessions.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink-muted)', fontSize: '.82em' }}>
              {templates.length === 0 ? '请先创建 Agent' : '选择 Agent 开始对话'}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：对话区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selectedAgentId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2em', marginBottom: 8 }}>💬</div>
              <div>{templates.length === 0 ? (
                <>请先去 <a href="/agents" style={{ color: 'var(--accent)' }}>Agent 市场</a> 创建 Agent</>
              ) : '请选择一个 Agent 开始对话'}</div>
            </div>
          </div>
        ) : (
          <>
            {/* 对话头部 */}
            <div style={{
              padding: '10px 20px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontWeight: 700, fontSize: '.95em' }}>{currentAgent?.name}</div>
              <div className="flex gap-2" style={{ flexWrap: 'wrap', flex: 1 }}>
                {currentAgent?.model && <span className="badge badge-muted">{currentAgent.model}</span>}
                {(() => {
                  const tools = currentAgent?.tools || [];
                  const customs = initCustomTools();
                  const serverNames = Array.from(new Set(
                    tools
                      .filter(t => customs.find(c => c.name === t)?.mcpServer)
                      .map(t => customs.find(c => c.name === t)!.mcpServer!)
                  ));
                  return (
                    <>
                      {serverNames.length > 0 ? (
                        <span className="badge" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                          MCP ×{serverNames.length}
                        </span>
                      ) : (
                        <span className="badge badge-muted">MCP ×0</span>
                      )}
                      {serverNames.map(s => {
                        const serverTools = customs.filter(c => c.mcpServer === s && tools.includes(c.name));
                        const firstEndpoint = serverTools.find(t => t.endpoint)?.endpoint;
                        return (
                          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span className="badge badge-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '.7em' }}>
                              {s} ({serverTools.length}工具)
                            </span>
                            {firstEndpoint && <McpStatusDot server={s} endpoint={firstEndpoint.url} />}
                          </span>
                        );
                      })}
                      {tools.length === 0 && <span className="badge badge-muted">无工具</span>}
                    </>
                  );
                })()}
                {/* 事件源开关（会话级） */}
                {eventSources.length > 0 && (
                  <span style={{ position: 'relative' }}>
                    <span className="badge" style={{ cursor: 'pointer', background: subbedSources.length > 0 ? 'var(--success-bg)' : 'var(--bg-hover)', color: subbedSources.length > 0 ? 'var(--success)' : 'var(--ink-muted)', userSelect: 'none' }}
                      onClick={() => setShowEventToggles(!showEventToggles)}>
                      📡 {subbedSources.length > 0 ? subbedSources.length : '0'}
                    </span>
                    {showEventToggles && (
                      <div className="fade-in" style={{ position: 'absolute', top: 24, left: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', zIndex: 20, minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
                        {eventSources.map(es => (
                          <label key={es.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: '.8em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={subbedSources.includes(es.name)} onChange={() => {
                              const next = subbedSources.includes(es.name) ? subbedSources.filter(s => s !== es.name) : [...subbedSources, es.name];
                              setSubbedSources(next);
                              localStorage.setItem(`session_subs_${activeSessionId}`, JSON.stringify(next));
                              fetch(`/api/sessions/${activeSessionId}/events/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceName: es.name }) }).catch(() => {});
                            }} style={{ width: 'auto', margin: 0 }} />
                            📡 {es.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </div>
              <button className="btn btn-sm" onClick={() => navigate('/agents')}>Agent 市场</button>
            </div>

            {/* 消息列表 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Bot 实时事件 */}
              {activeSessionId && (
                <details style={{ fontSize: '.78em' }}>
                  <summary style={{ color: botEvents.length > 0 ? 'var(--success)' : 'var(--ink-muted)', cursor: 'pointer' }}>📡 实时事件 ({botEvents.length})</summary>
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                    {botEvents.length === 0 && <div style={{ color: 'var(--ink-muted)', padding: 4 }}>等待 Minecraft 事件...</div>}
                    {botEvents.slice(-20).reverse().map((ev, i) => (
                      <div key={i} className="chat-msg thinking" style={{ marginBottom: 4, padding: '4px 10px' }}>
                        <span className="badge badge-muted">{ev.source}</span>{' '}
                        {ev.type === 'chat' ? <><b>{ev.username}</b>: {ev.message}</>
                        : ev.type === 'playerJoin' ? <>{ev.username} 加入了</>
                        : ev.type === 'playerLeave' ? <>{ev.username} 离开了</>
                        : ev.type === 'health' ? <>血量 {ev.health}</>
                        : <>{ev.type}</>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {messages.length === 0 && !isStreaming && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-muted)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2em' }}>🤖</div>
                    <div style={{ fontWeight: 600 }}>{currentAgent?.name}</div>
                    <div style={{ fontSize: '.82em', maxWidth: 300 }}>
                      {currentAgent?.systemPrompt?.slice(0, 80) || '发送消息开始对话'}
                    </div>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role}`}>{msg.content}</div>
              ))}
              {streamThinking && <div className="chat-msg thinking">{streamThinking}</div>}
              {streamText && <div className="chat-msg assistant">{streamText}</div>}
              {isStreaming && !streamThinking && !streamText && (
                <div className="chat-msg assistant pulse">...</div>
              )}
              <div ref={bottomRef} />
            </div>

            <div style={{ padding: '0 20px' }}>
              <PermissionPromptList
                pending={pendingPermissions}
                onResolved={(reqId) => setPendingPermissions(prev => prev.filter(p => p.reqId !== reqId))}
              />
            </div>

            {/* 输入区域 */}
            <div style={{
              padding: '12px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-card)',
            }}>
              <div className="chat-input-area" style={{ padding: 0, borderTop: 'none' }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="输入消息，Enter 换行，Shift+Enter 发送"
                  rows={1}
                  disabled={isStreaming}
                />
                <button className="btn btn-primary" onClick={handleSend} disabled={isStreaming || !input.trim()}>
                  {isStreaming ? '...' : '发送'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
