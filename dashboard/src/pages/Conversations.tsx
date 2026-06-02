import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatSession, AgentTemplate, ChatMessage, ProviderConfig, ChatImageAttachment, ChatImageMimeType } from '../simulator/types';
import { getDefaultProviderConfig, initCustomTools } from '../simulator/mock-data';
import type { EventSourceConfig } from '../simulator/types';
import { getEndpointProbeBlockReason, isUsingApiKeyAuth, getAuthHeaders } from '../utils/client-runtime';
import { PermissionPromptList, type PermissionRequest } from '../components/PermissionPrompt';
import { AskUserQuestionPromptList, type AskUserQuestionRequest } from '../components/AskUserQuestionPrompt';
import { useAuth } from '../contexts/AuthContext';
import { bootstrapAgentTemplates, loadCachedAgentTemplates } from '../utils/agent-templates';
import { buildRequestToolsForAgent } from '../utils/build-request-tools';
import { mergeAgentTaskEvent, taskStatusColor, taskStatusLabel, type AgentTaskEvent } from '../utils/agent-tasks';
import { appendAssistantDraft, finalizeAssistantDraft, updateAssistantDraft } from '../utils/chat-stream-draft';
import JsonViewer from '../components/common/JsonViewer';
import ChatMessageBubble from '../components/ChatMessageBubble';
import {
  bootstrapChatSessions,
  createChatSessionTitle,
  deleteChatSession as deleteChatSessionApi,
  forkChatSession as forkChatSessionApi,
  getChatSessionDisplayTitle,
  patchChatSession,
  saveChatSession as saveChatSessionApi,
} from '../utils/chat-sessions';

const CHAT_IMAGE_MIME_TYPES = new Set<ChatImageMimeType>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const CHAT_IMAGE_MAX_COUNT = 4;
const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function getImageSrc(image: ChatImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

function fileToImageAttachment(file: File): Promise<ChatImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      if (!data) {
        reject(new Error('图片数据为空'));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        type: 'image',
        mediaType: file.type as ChatImageMimeType,
        data,
        name: file.name || 'pasted-image',
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

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
  const [mobileListOpen, setMobileListOpen] = useState(false);

  // 聊天状态
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<AskUserQuestionRequest[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTaskEvent[]>([]);
  const [structuredOutput, setStructuredOutput] = useState<unknown>(null);
  const [runStats, setRunStats] = useState<{ costUsd?: number; durationMs?: number; inTok?: number; outTok?: number } | null>(null);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const provider = useRef<ProviderConfig>(loadGlobalProvider());
  const currentAgent = templates.find(t => t.id === selectedAgentId);

  const [botEvents, setBotEvents] = useState<Array<{ type: string; source?: string; username?: string; message?: string; health?: number; timestamp: number }>>([]);
  const [eventSources, setEventSources] = useState<EventSourceConfig[]>([]);
  const [subbedSources, setSubbedSources] = useState<string[]>([]);
  const [showEventToggles, setShowEventToggles] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const persistRef = useRef<((msgs: ChatMessage[], sid: string | null, sdkSessionId?: string, sdkCwd?: string) => Promise<string>) | null>(null);

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
    const assistantTimestamp = Date.now();
    const draftId0 = crypto.randomUUID();
    setMessages(appendAssistantDraft(newMsgs, draftId0, assistantTimestamp));
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
      const finalMsgs = finalizeAssistantDraft(newMsgs, draftId0, assistantTimestamp, content, status, thinking || undefined);
      setMessages(finalMsgs);
      const sid = await (persistRef.current?.(finalMsgs, activeSessionId, sdkSessionId, sdkCwd) || Promise.resolve(''));
      if (sid) setActiveSessionId(sid);
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: newMsgs.map(m => ({ role: m.role, content: m.content, attachments: m.attachments })),
          systemPrompt: agent.systemPrompt || undefined,
          provider: prov,
          tools: buildRequestToolsForAgent(agent),
          subagents: agent.subagents,
          enableFileCheckpointing: agent.enableFileCheckpointing || undefined,
          useKnowledge: agent.useKnowledge || undefined,
          knowledgeSourceIds: agent.knowledgeSourceIds || [],
          outputSchema: agent.outputSchema || undefined,
          sdkSessionId: sessions.find((session) => session.id === activeSessionId)?.sdkSessionId,
          sdkCwd: sessions.find((session) => session.id === activeSessionId)?.sdkCwd,
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

      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.type === 'delta') {
              if (d.thinking) {
                thinking += d.text || '';
                setMessages(prev => updateAssistantDraft(prev, draftId0, { thinking, status: 'streaming' }));
              } else {
                text += d.text || '';
                setMessages(prev => updateAssistantDraft(prev, draftId0, { content: text, status: 'streaming' }));
              }
            } else if (d.type === 'result') {
              const content = text || d.text || '';
              if (d.structuredOutput !== undefined) setStructuredOutput(d.structuredOutput);
              if (d.cost_usd !== undefined || d.duration_ms !== undefined)
                setRunStats({ costUsd: d.cost_usd, durationMs: d.duration_ms, inTok: d.usage?.input_tokens, outTok: d.usage?.output_tokens });
              await persistFinalMessage(content, 'complete', d.sdkSessionId, d.sdkCwd);
            } else if (d.type === 'permission_request') {
              setPendingPermissions(prev => [...prev, {
                reqId: d.reqId, toolName: d.toolName, input: d.input,
                title: d.title, displayName: d.displayName, description: d.description,
                toolUseID: d.toolUseID,
              }]);
            } else if (d.type === 'permission_resolved') {
              if (d.reqId) setPendingPermissions(prev => prev.filter(p => p.reqId !== d.reqId));
            } else if (d.type === 'ask_user_question') {
              setPendingQuestions(prev => [...prev, {
                reqId: d.reqId,
                questions: d.questions || [],
                toolUseID: d.toolUseID,
              }]);
            } else if (d.type === 'ask_user_question_resolved') {
              if (d.reqId) setPendingQuestions(prev => prev.filter(p => p.reqId !== d.reqId));
            } else if (String(d.type || '').startsWith('task_')) {
              setAgentTasks(prev => mergeAgentTaskEvent(prev, d));
            } else if (d.type === 'error') {
              await persistFinalMessage(`错误: ${d.message}`, 'error');
            }
          } catch {}
        }
      }
      if (!didFinalize) {
        await persistFinalMessage(text || '连接失败: 响应提前结束', text ? 'complete' : 'error');
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        await persistFinalMessage(text ? `${text}\n\n_（已停止）_` : '_（已停止）_', 'complete');
      } else {
        await persistFinalMessage(`连接失败: ${(error as Error).message}`, 'error');
      }
    }
    abortRef.current = null;
    setIsStreaming(false);
  }, [currentAgent, isStreaming, activeSessionId, messages, sessions]);

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
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom || isStreaming) el.scrollTop = el.scrollHeight;
  }, [messages, agentTasks, isStreaming]);

  // 保存会话（服务端持久化 + 本地状态同步）
  const persistSession = useCallback(async (msgs: ChatMessage[], sid: string | null, sdkSessionId?: string, sdkCwd?: string) => {
    if (!selectedAgentId || msgs.length === 0) return '';
    const now = Date.now();
    const id = sid || `chat-${Date.now()}`;
    const existing = sid ? sessions.find((session) => session.id === sid) : undefined;
    const draft: ChatSession = {
      id,
      templateId: selectedAgentId,
      title: createChatSessionTitle(msgs, existing?.title),
      messages: msgs,
      model: currentAgent?.model || provider.current.ANTHROPIC_MODEL || existing?.model || '',
      sdkSessionId: sdkSessionId || existing?.sdkSessionId,
      sdkCwd: sdkCwd || existing?.sdkCwd,
      forkedFromSessionId: existing?.forkedFromSessionId,
      forkedFromTitle: existing?.forkedFromTitle,
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
    setPendingQuestions([]);
    setAgentTasks([]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setAttachments([]);
    setAttachmentError('');
    setMobileListOpen(false);
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
    setPendingQuestions([]);
    setAgentTasks([]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setAttachments([]);
    setAttachmentError('');
    if (s.templateId && templates.find(t => t.id === s.templateId)) {
      setSelectedAgentId(s.templateId);
    }
    setMobileListOpen(false);
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

  const handleCopySession = async (source: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const copied = await forkChatSessionApi(source.id);
      setSessions(prev => [copied, ...prev.filter(s => s.id !== copied.id)]);
      setSessionSearch('');
      handleSelect(copied);
    } catch (error) {
      alert(`复制会话失败: ${(error as Error).message || '未知错误'}`);
    }
  };

  // 删除会话
  const handleDelete = async (id: string) => {
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
      setAttachments([]);
      setAttachmentError('');
    }
    try {
      await deleteChatSessionApi(id);
    } catch (error) {
      console.error('failed to delete chat session', error);
      setSessions(sessions);
    }
  };

  const handlePaste = useCallback(async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData.items || []);
    const clipboardFiles = Array.from(event.clipboardData.files || []);
    const itemFiles = clipboardItems
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = [...clipboardFiles, ...itemFiles]
      .filter((file, index, all) => file.type.startsWith('image/') && all.findIndex(candidate => candidate === file) === index);

    if (!files.length) return;
    event.preventDefault();
    setAttachmentError('');

    const remainingSlots = CHAT_IMAGE_MAX_COUNT - attachments.length;
    if (remainingSlots <= 0) {
      setAttachmentError(`最多一次发送 ${CHAT_IMAGE_MAX_COUNT} 张图片`);
      return;
    }

    const accepted: File[] = [];
    for (const file of files) {
      if (!CHAT_IMAGE_MIME_TYPES.has(file.type as ChatImageMimeType)) {
        setAttachmentError('仅支持 PNG、JPEG、GIF、WebP 图片');
        continue;
      }
      if (file.size > CHAT_IMAGE_MAX_BYTES) {
        setAttachmentError('单张图片不能超过 5MB');
        continue;
      }
      if (accepted.length < remainingSlots) accepted.push(file);
    }

    if (files.length > remainingSlots) {
      setAttachmentError(`最多一次发送 ${CHAT_IMAGE_MAX_COUNT} 张图片`);
    }
    if (!accepted.length) return;

    try {
      const nextAttachments = await Promise.all(accepted.map(fileToImageAttachment));
      setAttachments(prev => [...prev, ...nextAttachments]);
    } catch (error) {
      setAttachmentError((error as Error).message || '图片读取失败');
    }
  }, [attachments.length]);

  // 发送消息
  const handleSend = useCallback(async () => {
    const content = input.trim();
    const messageAttachments = attachments;
    if ((!content && messageAttachments.length === 0) || isStreaming || !currentAgent) return;

    // 合并 provider 配置
    provider.current = loadGlobalProvider();
    if (currentAgent.providerOverrides) {
      provider.current = { ...provider.current, ...currentAgent.providerOverrides };
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
    };
    const newMsgs = [...messages, userMsg];
    const assistantTimestamp = Date.now();
    const draftId = crypto.randomUUID();
    setMessages(appendAssistantDraft(newMsgs, draftId, assistantTimestamp));
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
      finalContent: string,
      status: NonNullable<ChatMessage['status']>,
      sdkSessionId?: string,
      sdkCwd?: string,
    ) => {
      if (didFinalize) return;
      didFinalize = true;
      const finalMsgs = finalizeAssistantDraft(newMsgs, draftId, assistantTimestamp, finalContent, status, thinking || undefined);
      setMessages(finalMsgs);
      const sid = await persistSession(finalMsgs, activeSessionId, sdkSessionId, sdkCwd);
      if (sid) setActiveSessionId(sid);
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: newMsgs.map(m => ({ role: m.role, content: m.content, attachments: m.attachments })),
          systemPrompt: currentAgent.systemPrompt || undefined,
          provider: provider.current,
          tools: buildRequestToolsForAgent(currentAgent),
          subagents: currentAgent.subagents,
          enableFileCheckpointing: currentAgent.enableFileCheckpointing || undefined,
          useKnowledge: currentAgent.useKnowledge || undefined,
          knowledgeSourceIds: currentAgent.knowledgeSourceIds || [],
          outputSchema: currentAgent.outputSchema || undefined,
          sdkSessionId: activeSessionId ? sessions.find((session) => session.id === activeSessionId)?.sdkSessionId : undefined,
          sdkCwd: activeSessionId ? sessions.find((session) => session.id === activeSessionId)?.sdkCwd : undefined,
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
          try {
            const data = JSON.parse(line.slice(6));
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
  }, [input, attachments, isStreaming, currentAgent, messages, activeSessionId, persistSession, sessions]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="conversation-shell">
      <div
        className={`conversation-list-overlay ${mobileListOpen ? 'open' : ''}`}
        onClick={() => setMobileListOpen(false)}
      />
      {/* 左侧：历史对话列表 */}
      <div className={`conversation-sidebar ${mobileListOpen ? 'open' : ''}`}>
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

        {/* 会话搜索 */}
        {sessions.length > 5 && (
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="搜索会话..."
              style={{ width: '100%', fontSize: '.78em', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
            />
          </div>
        )}

        {/* 会话列表 */}
        <div ref={sidebarRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {[...sessions]
            .filter(s => !sessionSearch || getChatSessionDisplayTitle(s).toLowerCase().includes(sessionSearch.toLowerCase()))
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
                      title={`${getChatSessionDisplayTitle(s)} · 双击编辑标题`}
                    >
                      {getChatSessionDisplayTitle(s)}
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
                {s.forkedFromTitle && (
                  <div style={{ fontSize: '.68em', color: 'var(--ink-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    来自：{s.forkedFromTitle}
                  </div>
                )}
                <div className="flex-between" style={{ fontSize: '.68em', color: 'var(--ink-muted)', marginTop: 2 }}>
                  <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                  <span className="flex gap-2">
                    <button
                      className="btn btn-sm"
                      style={{ padding: '0 6px', fontSize: '.85em' }}
                      title="复制当前历史为一个新对话，并立即切换过去"
                      onClick={e => { void handleCopySession(s, e); }}
                    >复制</button>
                    <button
                      className="btn btn-sm"
                      style={{ padding: '0 6px', fontSize: '.85em', color: 'var(--danger)' }}
                      onClick={e => { e.stopPropagation(); void handleDelete(s.id); }}
                    >删除</button>
                  </span>
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
      <div className="conversation-main">
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
            <div className="conversation-header">
              <button
                className="btn btn-sm conversation-list-toggle"
                onClick={() => setMobileListOpen(true)}
                aria-label="打开会话列表"
              >
                历史
              </button>
              <div style={{ fontWeight: 700, fontSize: '.95em' }}>{currentAgent?.name}</div>
              <div className="flex gap-2" style={{ flexWrap: 'wrap', flex: 1 }}>
                {currentAgent?.model && <span className="badge badge-muted">{currentAgent.model}</span>}
                {((currentAgent?.knowledgeSourceIds || []).length > 0 || currentAgent?.useKnowledge) && (
                  <span className="badge badge-success">知识库×{(currentAgent?.knowledgeSourceIds || []).length || '全部'}</span>
                )}
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
            <div className="conversation-messages" ref={messagesRef}>
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

            <div className="conversation-prompts">
              <AskUserQuestionPromptList
                pending={pendingQuestions}
                onResolved={(reqId) => setPendingQuestions(prev => prev.filter(p => p.reqId !== reqId))}
              />
              <PermissionPromptList
                pending={pendingPermissions}
                onResolved={(reqId) => setPendingPermissions(prev => prev.filter(p => p.reqId !== reqId))}
              />
            </div>

            {/* 输入区域 */}
            <div className="conversation-composer">
              <div className="chat-input-area" style={{ padding: 0, borderTop: 'none' }}>
                {(attachments.length > 0 || attachmentError) && (
                  <div style={{ padding: '4px 8px' }}>
                    {attachmentError && <div style={{ color: 'var(--danger)', fontSize: '.75em', marginBottom: 4 }}>{attachmentError}</div>}
                    {attachments.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {attachments.map(img => (
                          <div key={img.id} style={{ position: 'relative' }}>
                            <img src={getImageSrc(img)} alt={img.name}
                              style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                            <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== img.id))}
                              style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, lineHeight: '16px', padding: 0 }}>
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  onPaste={handlePaste}
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
          </>
        )}
      </div>
    </div>
  );
}
