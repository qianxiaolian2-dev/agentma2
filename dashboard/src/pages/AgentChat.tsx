import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { AgentTemplate, ChatMessage, ChatSession, ProviderConfig } from '../simulator/types';
import { getDefaultProviderConfig } from '../simulator/mock-data';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, getCachedAgentTemplateById } from '../utils/agent-templates';
import { isUsingApiKeyAuth, getAuthHeaders } from '../utils/client-runtime';
import { PermissionPromptList, type PermissionRequest } from '../components/PermissionPrompt';
import { AskUserQuestionPromptList, type AskUserQuestionRequest } from '../components/AskUserQuestionPrompt';
import { bootstrapChatSessions, saveChatSession as saveChatSessionApi } from '../utils/chat-sessions';
import { buildRequestToolsForAgent } from '../utils/build-request-tools';
import { mergeAgentTaskEvent, taskStatusColor, taskStatusLabel, type AgentTaskEvent } from '../utils/agent-tasks';
import { appendAssistantDraft, updateAssistantDraft } from '../utils/chat-stream-draft';
import JsonViewer from '../components/common/JsonViewer';

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

export default function AgentChat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const resumeSessionId = searchParams.get('session');
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasResponseStarted, setHasResponseStarted] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [sessionMeta, setSessionMeta] = useState<ChatSession | null>(null);
  const [streamThinking, setStreamThinking] = useState('');
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<AskUserQuestionRequest[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTaskEvent[]>([]);
  const [structuredOutput, setStructuredOutput] = useState<unknown>(null);
  const [runStats, setRunStats] = useState<{ costUsd?: number; durationMs?: number; inTok?: number; outTok?: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const provider = useRef<ProviderConfig>(loadProvider());

  // 加载模板 + 恢复会话
  useEffect(() => {
    let cancelled = false;
    const tenantId = user?.tenantId;
    if (!id || !tenantId) return;

    const cachedTemplate = getCachedAgentTemplateById(tenantId, id);
    if (cachedTemplate) {
      setTemplate(cachedTemplate);
      provider.current = loadProvider(cachedTemplate.providerOverrides);
      if (!provider.current.ANTHROPIC_MODEL && cachedTemplate.model) {
        provider.current.ANTHROPIC_MODEL = cachedTemplate.model;
      }
    }

    (async () => {
      try {
        const templateList = await bootstrapAgentTemplates(tenantId, user.role === 'tenant_admin');
        const serverTemplate = templateList.find((template) => template.id === id) || null;
        if (!serverTemplate) {
          if (!cancelled) navigate('/agents');
          return;
        }
        if (cancelled) return;
        setTemplate(serverTemplate);
        provider.current = loadProvider(serverTemplate.providerOverrides);
        if (!provider.current.ANTHROPIC_MODEL && serverTemplate.model) {
          provider.current.ANTHROPIC_MODEL = serverTemplate.model;
        }

        const sessions = await bootstrapChatSessions(!isUsingApiKeyAuth());
        const existingSession = resumeSessionId
          ? sessions.find((session) => session.id === resumeSessionId)
          : sessions
              .filter((session) => session.templateId === id && session.messages.length > 0)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];

        if (cancelled) return;

        if (existingSession) {
          setSessionId(existingSession.id);
          setSessionMeta(existingSession);
          setMessages(existingSession.messages);
          return;
        }

        setSessionId('');
        setSessionMeta(null);
        setMessages([]);
      } catch (error) {
        console.error('failed to load chat sessions', error);
      }
    })();

    return () => { cancelled = true; };
  }, [id, navigate, resumeSessionId, user?.tenantId, user?.role]);

  const persistSession = useCallback(async (nextMessages: ChatMessage[], sdkSessionId?: string, sdkCwd?: string) => {
    if (!template || !id || nextMessages.length === 0) return '';

    const now = Date.now();
    const nextId = sessionId || `chat-${id}-${now}`;
    const draft: ChatSession = {
      id: nextId,
      templateId: id,
      title: sessionMeta?.title || nextMessages[0]?.content?.slice(0, 40) || '新对话',
      messages: nextMessages,
      model: template.model || provider.current.ANTHROPIC_MODEL || sessionMeta?.model || '',
      sdkSessionId: sdkSessionId || sessionMeta?.sdkSessionId,
      sdkCwd: sdkCwd || sessionMeta?.sdkCwd,
      pinned: sessionMeta?.pinned,
      createdAt: sessionMeta?.createdAt || now,
      updatedAt: now,
    };

    setSessionId(nextId);
    setSessionMeta(draft);

    try {
      const saved = await saveChatSessionApi(draft);
      setSessionId(saved.id);
      setSessionMeta(saved);
      return saved.id;
    } catch (error) {
      console.error('failed to persist chat session', error);
      return nextId;
    }
  }, [template, id, sessionId, sessionMeta]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamThinking, agentTasks]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming || !template) return;

    const userMsg: ChatMessage = {
      role: 'user', content: input.trim(), timestamp: Date.now(),
    };
    const newMessages = [...messages, userMsg];
    const assistantTimestamp = Date.now();
    const draftId = crypto.randomUUID();
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    setHasResponseStarted(false);
    setStreamThinking('');
    setPendingQuestions([]);
    setAgentTasks([]);
    setStructuredOutput(null);
    setRunStats(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: template.systemPrompt || undefined,
          provider: provider.current,
          tools: buildRequestToolsForAgent(template),
          subagents: template.subagents,
          enableFileCheckpointing: template.enableFileCheckpointing || undefined,
          sdkSessionId: sessionMeta?.sdkSessionId,
          sdkCwd: sessionMeta?.sdkCwd,
        }),
      });

      if (!res.ok) {
        setHasResponseStarted(true);
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: `API 错误: ${res.status}`,
          timestamp: Date.now(),
        };
        const finalMessages = [...newMessages, assistantMsg];
        setMessages(finalMessages);
        await persistSession(finalMessages);
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
              if (!hasResponseStarted) {
                setHasResponseStarted(true);
                setMessages(appendAssistantDraft(newMessages, draftId, assistantTimestamp));
              }
              if (data.thinking) {
                thinking += data.text || '';
                setStreamThinking(thinking);
              } else {
                text += data.text || '';
                setMessages(prev => updateAssistantDraft(prev, draftId, { content: text, status: 'streaming' }));
              }
            } else if (data.type === 'result') {
              setHasResponseStarted(true);
              const finalContent = text || thinking || data.text || '';
              setStreamThinking('');
              if (data.structuredOutput !== undefined) setStructuredOutput(data.structuredOutput);
              if (data.cost_usd !== undefined || data.duration_ms !== undefined)
                setRunStats({ costUsd: data.cost_usd, durationMs: data.duration_ms, inTok: data.usage?.input_tokens, outTok: data.usage?.output_tokens });
              const finalMessages = [...newMessages, { id: draftId, role: 'assistant' as const, content: finalContent, status: 'complete' as const, timestamp: assistantTimestamp }];
              setMessages(finalMessages);
              await persistSession(finalMessages, data.sdkSessionId, data.sdkCwd);
            } else if (data.type === 'permission_request') {
              setHasResponseStarted(true);
              setPendingPermissions(prev => [...prev, {
                reqId: data.reqId, toolName: data.toolName, input: data.input,
                title: data.title, displayName: data.displayName, description: data.description,
                toolUseID: data.toolUseID,
              }]);
            } else if (data.type === 'permission_resolved') {
              if (data.reqId) setPendingPermissions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (data.type === 'ask_user_question') {
              setHasResponseStarted(true);
              setPendingQuestions(prev => [...prev, {
                reqId: data.reqId,
                questions: data.questions || [],
                toolUseID: data.toolUseID,
              }]);
            } else if (data.type === 'ask_user_question_resolved') {
              if (data.reqId) setPendingQuestions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (String(data.type || '').startsWith('task_')) {
              setHasResponseStarted(true);
              setAgentTasks(prev => mergeAgentTaskEvent(prev, data));
            } else if (data.type === 'error') {
              setHasResponseStarted(true);
              setStreamThinking('');
              const finalMessages = [...newMessages, { id: draftId, role: 'assistant' as const, content: `错误: ${data.message}`, status: 'error' as const, timestamp: assistantTimestamp }];
              setMessages(finalMessages);
              await persistSession(finalMessages);
            }
          } catch {}
        }
      }
    } catch (e) {
      setHasResponseStarted(true);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: `连接失败: ${(e as Error).message}`,
        timestamp: Date.now(),
      };
      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);
      await persistSession(finalMessages);
    }
    setIsStreaming(false);
  }, [input, isStreaming, template, messages, persistSession]);

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

          {agentTasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {agentTasks.map(task => (
                <div key={task.id} className="chat-msg thinking" style={{ padding: '8px 12px' }}>
                  <div className="flex-between" style={{ gap: 10 }}>
                    <span style={{ fontWeight: 600 }}>{task.subagentType || task.taskType || '子任务'}</span>
                    <span className="badge" style={{ color: taskStatusColor(task.status), background: 'var(--bg-hover)' }}>
                      {taskStatusLabel(task.status)}
                    </span>
                  </div>
                  <div style={{ marginTop: 4 }}>{task.summary || task.description || task.id}</div>
                  {(task.lastToolName || task.usage?.total_tokens) && (
                    <div style={{ marginTop: 4, fontSize: '.78em', color: 'var(--ink-muted)' }}>
                      {task.lastToolName && <span>tool: {task.lastToolName}</span>}
                      {task.usage?.total_tokens && <span>{task.lastToolName ? ' · ' : ''}{task.usage.total_tokens} tokens</span>}
                    </div>
                  )}
                  {task.error && <div style={{ marginTop: 4, color: 'var(--danger)' }}>{task.error}</div>}
                </div>
              ))}
            </div>
          )}

          {streamThinking && (
            <div className="chat-msg thinking">{streamThinking}</div>
          )}

          {isStreaming && !hasResponseStarted && (
            <div className="chat-msg assistant pulse">...</div>
          )}

          {structuredOutput !== null && !isStreaming && (
            <div className="chat-msg assistant" style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: '.72em', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 6 }}>
                结构化输出 (outputSchema)
              </div>
              <JsonViewer data={structuredOutput} maxHeight={300} />
            </div>
          )}

          {runStats && !isStreaming && (
            <div style={{ textAlign: 'right', fontSize: '.72em', color: 'var(--ink-muted)', padding: '2px 4px' }}>
              {runStats.durationMs != null && <span>{(runStats.durationMs / 1000).toFixed(1)}s</span>}
              {runStats.inTok != null && <span style={{ marginLeft: 8 }}>{runStats.inTok}↑ {runStats.outTok ?? 0}↓ tok</span>}
              {runStats.costUsd != null && <span style={{ marginLeft: 8 }}>${runStats.costUsd.toFixed(4)}</span>}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '0 12px' }}>
          <AskUserQuestionPromptList
            pending={pendingQuestions}
            onResolved={(reqId) => setPendingQuestions(prev => prev.filter(p => p.reqId !== reqId))}
          />
          <PermissionPromptList
            pending={pendingPermissions}
            onResolved={(reqId) => setPendingPermissions(prev => prev.filter(p => p.reqId !== reqId))}
          />
        </div>

        <div className="chat-input-area">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
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
    </div>
  );
}
