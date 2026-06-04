import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClipboardEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { AgentTemplate, ChatAttachment, ChatMessage, ChatSession, ProviderConfig, ChatImageMimeType } from '../simulator/types';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, getCachedAgentTemplateById } from '../utils/agent-templates';
import { isUsingApiKeyAuth, getAuthHeaders } from '../utils/client-runtime';
import { PermissionPromptList, type PermissionRequest } from '../components/PermissionPrompt';
import { AskUserQuestionPromptList, type AskUserQuestionRequest } from '../components/AskUserQuestionPrompt';
import {
  bootstrapChatSessions,
  createChatSessionTitle,
  getChatSession,
  saveChatSession as saveChatSessionApi,
  setChatSessionCollaboration,
  subscribeChatSessionEvents,
} from '../utils/chat-sessions';
import { buildRequestToolsForAgent } from '../utils/build-request-tools';
import { mergeAgentTaskEvent, taskStatusColor, taskStatusLabel, type AgentTaskEvent } from '../utils/agent-tasks';
import { appendAssistantDraft, finalizeAssistantDraft, updateAssistantDraft } from '../utils/chat-stream-draft';
import { loadProviderProfiles, resolveProviderForModel } from '../utils/providers';
import JsonViewer from '../components/common/JsonViewer';
import ChatMessageBubble from '../components/ChatMessageBubble';
import {
  CHAT_FILE_ACCEPT,
  CHAT_FILE_MAX_COUNT,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MIME_TYPES,
  fileToChatAttachment,
  formatAttachmentBytes,
  getChatImageSrc,
} from '../utils/chat-attachments-ui';

async function readChatError(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return `API 错误: ${response.status}`;
  try {
    const data = JSON.parse(text) as { error?: unknown };
    return data?.error ? String(data.error) : `API 错误: ${response.status}`;
  } catch {
    return text.slice(0, 240) || `API 错误: ${response.status}`;
  }
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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [collaborationError, setCollaborationError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const provider = useRef<ProviderConfig>(resolveProviderForModel().provider);

  // 加载模板 + 恢复会话
  useEffect(() => {
    let cancelled = false;
    const tenantId = user?.tenantId;
    if (!id || !tenantId) return;

    const cachedTemplate = getCachedAgentTemplateById(tenantId, id);
    if (cachedTemplate) {
      setTemplate(cachedTemplate);
      provider.current = resolveProviderForModel(cachedTemplate.model).provider;
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
        provider.current = resolveProviderForModel(serverTemplate.model).provider;

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
      title: createChatSessionTitle(nextMessages, sessionMeta?.title),
      messages: nextMessages,
      model: template.model || sessionMeta?.model || '',
      sdkSessionId: sdkSessionId || sessionMeta?.sdkSessionId,
      sdkCwd: sdkCwd || sessionMeta?.sdkCwd,
      forkedFromSessionId: sessionMeta?.forkedFromSessionId,
      forkedFromTitle: sessionMeta?.forkedFromTitle,
      pinned: sessionMeta?.pinned,
      ownerSub: sessionMeta?.ownerSub,
      collaborationEnabled: sessionMeta?.collaborationEnabled,
      collaborationRole: sessionMeta?.collaborationRole,
      collaborationUpdatedAt: sessionMeta?.collaborationUpdatedAt,
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

  const refreshSession = useCallback(async (targetSessionId: string) => {
    const refreshed = await getChatSession(targetSessionId);
    if (!refreshed) {
      if (sessionId === targetSessionId) {
        setSessionId('');
        setSessionMeta(null);
        setMessages([]);
      }
      return null;
    }
    if (sessionId === targetSessionId) {
      setSessionMeta(refreshed);
      setMessages(refreshed.messages);
    }
    return refreshed;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !sessionMeta?.collaborationEnabled) return;
    return subscribeChatSessionEvents(sessionId, (event) => {
      if (event.type === 'connected') return;
      if (event.type === 'session_deleted') {
        setSessionId('');
        setSessionMeta(null);
        setMessages([]);
        return;
      }
      void refreshSession(sessionId).catch((error) => {
        console.error('failed to refresh collaboration session', error);
      });
    }, (error) => {
      console.error('collaboration stream failed', error);
    });
  }, [sessionId, sessionMeta?.collaborationEnabled, refreshSession]);

  const handleToggleCollaboration = async () => {
    if (!sessionId || sessionMeta?.collaborationRole === 'member') return;
    setCollaborationError('');
    setCopyStatus('');
    try {
      const saved = await setChatSessionCollaboration(sessionId, !sessionMeta?.collaborationEnabled);
      setSessionMeta(saved);
      setMessages(saved.messages);
    } catch (error) {
      setCollaborationError((error as Error).message || '协作设置失败');
    }
  };

  const handleCopyCollaborationLink = async () => {
    if (!sessionId) return;
    const link = `${window.location.origin}/conversations?join=${encodeURIComponent(sessionId)}`;
    setCollaborationError('');
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus('已复制');
      setTimeout(() => setCopyStatus(''), 1800);
    } catch {
      window.prompt('复制协作链接', link);
    }
  };

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom || isStreaming) el.scrollTop = el.scrollHeight;
  }, [messages, agentTasks, isStreaming]);

  const handleFilePicked = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!files.length) return;
    setAttachmentError('');

    const currentFileCount = attachments.filter((item) => item.type === 'file').length;
    const remainingFiles = CHAT_FILE_MAX_COUNT - currentFileCount;
    if (remainingFiles <= 0) {
      setAttachmentError(`最多一次发送 ${CHAT_FILE_MAX_COUNT} 个文件`);
      return;
    }

    const accepted = files.slice(0, remainingFiles);
    if (files.length > remainingFiles) setAttachmentError(`最多一次发送 ${CHAT_FILE_MAX_COUNT} 个文件`);
    try {
      const formData = new FormData();
      for (const file of accepted) formData.append('files', file, file.name);
      const response = await fetch('/api/chat/files/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await response.json().catch(() => ({})) as { attachments?: ChatAttachment[]; error?: string };
      if (!response.ok) throw new Error(data.error || `上传失败: ${response.status}`);
      const nextAttachments = Array.isArray(data.attachments) ? data.attachments : [];
      setAttachments(prev => [...prev, ...nextAttachments]);
    } catch (error) {
      setAttachmentError((error as Error).message || '文件读取失败');
    }
  }, [attachments]);

  const handlePaste = useCallback(async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    setAttachmentError('');

    const imageCount = attachments.filter((item) => item.type === 'image').length;
    const remainingSlots = CHAT_IMAGE_MAX_COUNT - imageCount;
    if (remainingSlots <= 0) {
      setAttachmentError(`最多一次发送 ${CHAT_IMAGE_MAX_COUNT} 张图片`);
      return;
    }
    const accepted = files
      .filter(file => CHAT_IMAGE_MIME_TYPES.has(file.type as ChatImageMimeType))
      .slice(0, remainingSlots);
    if (!accepted.length) {
      setAttachmentError('不支持这种图片格式；普通文件请用 + 上传');
      return;
    }
    if (files.length > remainingSlots) setAttachmentError(`最多一次发送 ${CHAT_IMAGE_MAX_COUNT} 张图片`);
    try {
      const nextAttachments = await Promise.all(accepted.map(fileToChatAttachment));
      setAttachments(prev => [...prev, ...nextAttachments]);
    } catch (error) {
      setAttachmentError((error as Error).message || '图片读取失败');
    }
  }, [attachments]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    const messageAttachments = attachments;
    if ((!content && messageAttachments.length === 0) || isStreaming || !template) return;
    provider.current = resolveProviderForModel(template.model).provider;

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
    setAttachmentError('');
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
          messages: newMessages.map((m, index) => ({
            role: m.role,
            content: m.content,
            attachments: index === newMessages.length - 1 ? m.attachments : undefined,
          })),
          systemPrompt: template.systemPrompt || undefined,
          model: template.model,
          provider: provider.current,
          providerProfiles: loadProviderProfiles(),
          tools: buildRequestToolsForAgent(template),
          subagents: template.subagents,
          skills: template.skills || [],
          enableFileCheckpointing: template.enableFileCheckpointing || undefined,
          useKnowledge: template.useKnowledge || undefined,
          knowledgeSourceIds: template.knowledgeSourceIds || [],
          outputSchema: template.outputSchema || undefined,
          sdkSessionId: sessionMeta?.sdkSessionId,
          sdkCwd: sessionMeta?.sdkCwd,
        }),
      });

      if (!res.ok) {
        await persistFinalMessage(await readChatError(res), 'error');
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
          {sessionMeta && (
            <>
              <span className={`badge ${sessionMeta.collaborationEnabled ? 'badge-success' : 'badge-muted'}`}>
                协作{sessionMeta.collaborationEnabled ? `·${sessionMeta.collaborationRole === 'member' ? '成员' : 'Owner'}` : '关闭'}
              </span>
              {sessionMeta.collaborationRole !== 'member' && (
                <button className="btn btn-sm" onClick={handleToggleCollaboration}>
                  {sessionMeta.collaborationEnabled ? '关闭协作' : '开启协作'}
                </button>
              )}
              {sessionMeta.collaborationEnabled && (
                <button className="btn btn-sm" onClick={handleCopyCollaborationLink}>
                  {copyStatus || '复制链接'}
                </button>
              )}
            </>
          )}
          {collaborationError && <span style={{ color: 'var(--danger)', fontSize: '.76em' }}>{collaborationError}</span>}
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
          {(attachments.length > 0 || attachmentError) && (
            <div style={{ padding: '4px 0' }}>
              {attachmentError && <div style={{ color: 'var(--danger)', fontSize: '.75em', marginBottom: 4 }}>{attachmentError}</div>}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {attachments.map(item => (
                    <div key={item.id} style={{ position: 'relative' }}>
                      {item.type === 'image' ? (
                        <img src={getChatImageSrc(item)} alt={item.name}
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                      ) : (
                        <div
                          className="badge badge-info"
                          title={`${item.name} · ${formatAttachmentBytes(item.size)}`}
                          style={{ maxWidth: 220, height: 28, display: 'flex', alignItems: 'center', paddingRight: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {item.name} · {formatAttachmentBytes(item.size)}
                        </div>
                      )}
                      <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== item.id))}
                        style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, lineHeight: '16px', padding: 0 }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={CHAT_FILE_ACCEPT}
            onChange={e => void handleFilePicked(e.currentTarget.files)}
            style={{ display: 'none' }}
          />
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            title="上传文件"
            aria-label="上传文件"
            style={{ width: 34, height: 34, minWidth: 34, padding: 0, borderRadius: 6, fontSize: 20, lineHeight: '30px' }}
          >
            +
          </button>
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
            onPaste={e => void handlePaste(e)}
            placeholder="输入消息，Shift+Enter 发送，可粘贴图片，也可上传文件"
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
