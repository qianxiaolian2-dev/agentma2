import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { AgentTemplate, ChatMessage, ChatSession, ProviderConfig, ChatImageAttachment } from '../simulator/types';
import { getDefaultProviderConfig } from '../simulator/mock-data';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, getCachedAgentTemplateById } from '../utils/agent-templates';
import { isUsingApiKeyAuth, getAuthHeaders } from '../utils/client-runtime';
import { PermissionPromptList, type PermissionRequest } from '../components/PermissionPrompt';
import { AskUserQuestionPromptList, type AskUserQuestionRequest } from '../components/AskUserQuestionPrompt';
import { bootstrapChatSessions, saveChatSession as saveChatSessionApi } from '../utils/chat-sessions';
import { buildRequestToolsForAgent } from '../utils/build-request-tools';
import { mergeAgentTaskEvent, taskStatusColor, taskStatusLabel, type AgentTaskEvent } from '../utils/agent-tasks';
import { appendAssistantDraft, finalizeAssistantDraft, updateAssistantDraft } from '../utils/chat-stream-draft';
import JsonViewer from '../components/common/JsonViewer';
import ChatMessageBubble from '../components/ChatMessageBubble';

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
  const [sessionId, setSessionId] = useState<string>('');
  const [sessionMeta, setSessionMeta] = useState<ChatSession | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<AskUserQuestionRequest[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTaskEvent[]>([]);
  const [structuredOutput, setStructuredOutput] = useState<unknown>(null);
  const [runStats, setRunStats] = useState<{ costUsd?: number; durationMs?: number; inTok?: number; outTok?: number } | null>(null);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom || isStreaming) el.scrollTop = el.scrollHeight;
  }, [messages, agentTasks, isStreaming]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    const messageAttachments = attachments;
    if ((!content && messageAttachments.length === 0) || isStreaming || !template) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
    };
    const newMessages = [...messages, userMsg];
    const assistantTimestamp = Date.now();
    const draftId = crypto.randomUUID();
    setMessages(appendAssistantDraft(newMessages, draftId, assistantTimestamp));
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setAttachments([]);
    setIsStreaming(true);
    setPendingQuestions([]);
    setAgentTasks([]);
    setStructuredOutput(null);
    setRunStats(null);

    let thinking = '';
    let text = '';
    let didFinalize = false;
    const persistFinalMessage = async (
      content: string,
      status: NonNullable<ChatMessage['status']>,
      sdkSessionId?: string,
      sdkCwd?: string,
    ) => {
      if (didFinalize) return;
      didFinalize = true;
      const finalMessages = finalizeAssistantDraft(newMessages, draftId, assistantTimestamp, content, status, thinking || undefined);
      setMessages(finalMessages);
      await persistSession(finalMessages, sdkSessionId, sdkCwd);
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content, attachments: m.attachments })),
          systemPrompt: template.systemPrompt || undefined,
          provider: provider.current,
          tools: buildRequestToolsForAgent(template),
          subagents: template.subagents,
          enableFileCheckpointing: template.enableFileCheckpointing || undefined,
          useKnowledge: template.useKnowledge || undefined,
          knowledgeSourceIds: template.knowledgeSourceIds || [],
          outputSchema: template.outputSchema || undefined,
          sdkSessionId: sessionMeta?.sdkSessionId,
          sdkCwd: sessionMeta?.sdkCwd,
        }),
      });

      if (!res.ok) {
        await persistFinalMessage(`API 错误: ${res.status}`, 'error');
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        await persistFinalMessage('连接失败: 响应体为空', 'error');
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buf = '';

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
                setMessages(prev => updateAssistantDraft(prev, draftId, { thinking, status: 'streaming' }));
              } else {
                text += data.text || '';
                setMessages(prev => updateAssistantDraft(prev, draftId, { content: text, status: 'streaming' }));
              }
            } else if (data.type === 'result') {
              const finalContent = text || data.text || '';
              if (data.structuredOutput !== undefined) setStructuredOutput(data.structuredOutput);
              if (data.cost_usd !== undefined || data.duration_ms !== undefined)
                setRunStats({ costUsd: data.cost_usd, durationMs: data.duration_ms, inTok: data.usage?.input_tokens, outTok: data.usage?.output_tokens });
              await persistFinalMessage(finalContent, 'complete', data.sdkSessionId, data.sdkCwd);
            } else if (data.type === 'permission_request') {
              setPendingPermissions(prev => [...prev, {
                reqId: data.reqId, toolName: data.toolName, input: data.input,
                title: data.title, displayName: data.displayName, description: data.description,
                toolUseID: data.toolUseID,
              }]);
            } else if (data.type === 'permission_resolved') {
              if (data.reqId) setPendingPermissions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (data.type === 'ask_user_question') {
              setPendingQuestions(prev => [...prev, {
                reqId: data.reqId,
                questions: data.questions || [],
                toolUseID: data.toolUseID,
              }]);
            } else if (data.type === 'ask_user_question_resolved') {
              if (data.reqId) setPendingQuestions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (String(data.type || '').startsWith('task_')) {
              setAgentTasks(prev => mergeAgentTaskEvent(prev, data));
            } else if (data.type === 'error') {
              await persistFinalMessage(`错误: ${data.message}`, 'error');
            }
          } catch {}
        }
      }
      if (!didFinalize) {
        await persistFinalMessage(text || '连接失败: 响应提前结束', text ? 'complete' : 'error');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        await persistFinalMessage(text ? `${text}\n\n_（已停止）_` : '_（已停止）_', 'complete');
      } else {
        await persistFinalMessage(`连接失败: ${(e as Error).message}`, 'error');
      }
    }
    abortRef.current = null;
    setIsStreaming(false);
  }, [input, attachments, isStreaming, template, messages, persistSession]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
          {((template.knowledgeSourceIds || []).length > 0 || template.useKnowledge) && (
            <span className="badge badge-success">知识库×{(template.knowledgeSourceIds || []).length || '全部'}</span>
          )}
          {template.tools.slice(0, 5).map(t => <span key={t} className="badge badge-info">{t}</span>)}
          {template.tools.length > 5 && <span className="badge badge-muted">+{template.tools.length - 5}</span>}
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-messages" ref={messagesRef}>
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
            <ChatMessageBubble key={msg.id || i} message={msg} />
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
          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: 6, padding: '4px 0', flexWrap: 'wrap' }}>
              {attachments.map(img => (
                <div key={img.id} style={{ position: 'relative' }}>
                  <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name}
                    style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                  <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== img.id))}
                    style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, lineHeight: '16px', padding: 0 }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={e => {
              const items = Array.from(e.clipboardData?.items || []);
              const imgItems = items.filter(it => it.type.startsWith('image/'));
              if (imgItems.length === 0) return;
              e.preventDefault();
              imgItems.slice(0, 4).forEach(item => {
                const file = item.getAsFile();
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = String(reader.result || '');
                  const data = result.includes(',') ? result.split(',')[1] : result;
                  if (!data) return;
                  setAttachments(prev => [...prev, {
                    id: crypto.randomUUID(), type: 'image',
                    mediaType: file.type as ChatImageAttachment['mediaType'],
                    data, name: file.name || 'pasted-image', size: file.size,
                  }]);
                };
                reader.readAsDataURL(file);
              });
            }}
            placeholder="输入消息，Shift+Enter 发送，可粘贴图片"
            style={{ resize: 'none', overflowY: 'hidden', minHeight: 38, maxHeight: 200 }}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button className="btn btn-danger" onClick={handleStop}>停止</button>
          ) : (
            <button className="btn btn-primary" onClick={handleSend} disabled={!input.trim() && attachments.length === 0}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
