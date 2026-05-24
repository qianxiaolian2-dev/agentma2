import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { AgentTemplate, ChatMessage, ChatSession, ProviderConfig } from '../simulator/types';
import { getDefaultProviderConfig } from '../simulator/mock-data';

const LS_SESSIONS = 'agentma_chat_sessions';

function loadProvider(templateOverrides?: Partial<ProviderConfig>): ProviderConfig {
  try {
    const raw = localStorage.getItem('agentma_provider_config');
    const global: ProviderConfig = raw
      ? { ...getDefaultProviderConfig(), ...JSON.parse(raw) }
      : getDefaultProviderConfig();
    // Agent 模板的覆盖优先
    return { ...global, ...templateOverrides };
  } catch {}
  return getDefaultProviderConfig();
}

function loadTemplate(id: string): AgentTemplate | null {
  try {
    const raw = localStorage.getItem('agentma_templates');
    if (raw) {
      const list: AgentTemplate[] = JSON.parse(raw);
      return list.find(t => t.id === id) || null;
    }
  } catch {}
  return null;
}

function loadSessions(): ChatSession[] {
  try { const raw = localStorage.getItem(LS_SESSIONS); if (raw) return JSON.parse(raw); } catch {}
  return [];
}

function saveSessions(list: ChatSession[]) {
  localStorage.setItem(LS_SESSIONS, JSON.stringify(list));
}

export default function AgentChat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeSessionId = searchParams.get('session');
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [streamThinking, setStreamThinking] = useState('');
  const [streamText, setStreamText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const provider = useRef<ProviderConfig>(loadProvider());

  // 加载模板 + 恢复会话
  useEffect(() => {
    if (!id) return;
    const tpl = loadTemplate(id);
    if (!tpl) { navigate('/agents'); return; }
    setTemplate(tpl);

    // 合并全局 + Agent 级别的 provider 配置
    provider.current = loadProvider(tpl.providerOverrides);
    // 如果模板没有覆盖 model，且 provider 也没有，用模板的 model
    if (!provider.current.ANTHROPIC_MODEL && tpl.model) {
      provider.current.ANTHROPIC_MODEL = tpl.model;
    }

    const sessions = loadSessions();
    // 优先按 URL 参数中的 session ID 恢复，否则找该模板最近的一个会话
    const existingSession = resumeSessionId
      ? sessions.find(s => s.id === resumeSessionId)
      : sessions.filter(s => s.templateId === id && s.messages.length > 0)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (existingSession) {
      setSessionId(existingSession.id);
      setMessages(existingSession.messages);
    }
  }, [id, navigate]);

  // 保存会话
  useEffect(() => {
    if (!template || messages.length === 0) return;

    const sessions = loadSessions();
    const now = Date.now();
    const session: ChatSession = {
      id: sessionId || `chat-${id}-${now}`,
      templateId: id!,
      title: messages[0]?.content?.slice(0, 40) || '新对话',
      messages,
      model: template.model,
      createdAt: sessionId ? (sessions.find(s => s.id === sessionId)?.createdAt || now) : now,
      updatedAt: now,
    };

    const updated = sessionId
      ? sessions.map(s => s.id === sessionId ? session : s)
      : [session, ...sessions];

    saveSessions(updated);
    if (!sessionId) setSessionId(session.id);
  }, [messages, sessionId, id, template]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamThinking, streamText]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming || !template) return;

    const userMsg: ChatMessage = {
      role: 'user', content: input.trim(), timestamp: Date.now(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    setStreamThinking('');
    setStreamText('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: template.systemPrompt || undefined,
          provider: provider.current,
        }),
      });

      if (!res.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `API 错误: ${res.status}`,
          timestamp: Date.now(),
        }]);
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
          const json = line.slice(6);
          try {
            const data = JSON.parse(json);
            if (data.type === 'delta') {
              if (data.thinking) {
                thinking += data.text || '';
                setStreamThinking(thinking);
              } else {
                text += data.text || '';
                setStreamText(text);
              }
            } else if (data.type === 'result') {
              // 完成 — 追加最终消息
              const finalContent = text || thinking || data.text || '';
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: finalContent,
                timestamp: Date.now(),
              }]);
              setStreamThinking('');
              setStreamText('');
            } else if (data.type === 'error') {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `错误: ${data.message}`,
                timestamp: Date.now(),
              }]);
              setStreamThinking('');
              setStreamText('');
            }
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `连接失败: ${(e as Error).message}`,
        timestamp: Date.now(),
      }]);
    }
    setIsStreaming(false);
  }, [input, isStreaming, template, messages]);

  if (!template) {
    return <div className="page-header"><h1>加载中...</h1></div>;
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div className="flex-between">
          <div>
            <h1 style={{ fontSize: '1.2em' }}>💬 {template.name}</h1>
            <p style={{ fontSize: '.8em' }}>{template.description || template.systemPrompt.slice(0, 60)}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => navigate('/conversations')}>← 返回会话</button>
          </div>
        </div>
        <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          <span className="badge badge-muted">{template.model}</span>
          {template.tools.slice(0, 5).map(t => <span key={t} className="badge badge-info">{t}</span>)}
          {template.tools.length > 5 && <span className="badge badge-muted">+{template.tools.length - 5}</span>}
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && !isStreaming && (
            <div style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: 40, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div>
                <div style={{ fontSize: '1.5em', marginBottom: 8 }}>🤖</div>
                <div>{template.name}</div>
                <div style={{ fontSize: '.82em' }}>{template.systemPrompt.slice(0, 60) || '开始一段对话吧'}</div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              {msg.content}
            </div>
          ))}

          {/* 流式思考过程 */}
          {(streamThinking || streamText) && (
            <>
              {streamThinking && (
                <div className="chat-msg thinking">{streamThinking}</div>
              )}
              {streamText && (
                <div className="chat-msg assistant">{streamText}</div>
              )}
            </>
          )}

          {isStreaming && !streamThinking && !streamText && (
            <div className="chat-msg assistant pulse">...</div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="chat-input-area">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={1}
            disabled={isStreaming}
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={isStreaming || !input.trim()}>
            {isStreaming ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
