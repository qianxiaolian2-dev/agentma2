import type { ChatImageAttachment, ChatMessage, ChatSession } from '../simulator/types';
import { getAuthHeaders } from './client-runtime';

const LEGACY_SESSION_KEY = 'agentma_chat_sessions';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const GENERIC_TITLES = new Set(['新对话', '(无标题)', '未命名对话']);
const MEANINGLESS_TITLE_RE = /^[\d\s,，.。、;；:：|/\\_-]+$/;

function compactTitleText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function isMeaningfulTitle(value: string): boolean {
  return Boolean(value) && !GENERIC_TITLES.has(value) && !MEANINGLESS_TITLE_RE.test(value);
}

export function createChatSessionTitle(messages: ChatMessage[], existingTitle?: string): string {
  const current = compactTitleText(existingTitle);
  if (isMeaningfulTitle(current)) return current.slice(0, 60);

  const firstUser = messages.find((message) => message.role === 'user') || messages[0];
  const content = compactTitleText(firstUser?.content);
  if (isMeaningfulTitle(content)) return content.slice(0, 40);
  if (firstUser?.attachments?.some((attachment) => attachment.type === 'image')) return '图片对话';
  if (content) return '未命名对话';
  return '新对话';
}

export function getChatSessionDisplayTitle(session: Pick<ChatSession, 'title' | 'messages'>): string {
  return createChatSessionTitle(session.messages, session.title);
}

function normalizeAttachments(value: unknown): ChatImageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    if (raw.type !== 'image') return [];
    const mediaType = String(raw.mediaType || '');
    const data = String(raw.data || '');
    if (!IMAGE_TYPES.has(mediaType) || !data) return [];
    return [{
      id: String(raw.id || crypto.randomUUID()),
      type: 'image' as const,
      mediaType: mediaType as ChatImageAttachment['mediaType'],
      data,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      size: Number(raw.size) || 0,
    }];
  });
}

function normalizeMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== 'object') return null;
  const role = (message as { role?: unknown }).role;
  const content = (message as { content?: unknown }).content;
  const attachments = normalizeAttachments((message as { attachments?: unknown }).attachments);
  const timestamp = Number((message as { timestamp?: unknown }).timestamp);
  if (!['user', 'assistant', 'system'].includes(String(role))) return null;
  if (typeof content !== 'string') return null;
  return {
    role: role as ChatMessage['role'],
    content,
    ...(attachments.length ? { attachments } : {}),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

function normalizeSession(session: unknown): ChatSession | null {
  if (!session || typeof session !== 'object') return null;
  const id = String((session as { id?: unknown }).id || '');
  const templateId = String((session as { templateId?: unknown }).templateId || '');
  const title = String((session as { title?: unknown }).title || '');
  const model = String((session as { model?: unknown }).model || '');
  const sdkSessionId = String((session as { sdkSessionId?: unknown }).sdkSessionId || '');
  const sdkCwd = String((session as { sdkCwd?: unknown }).sdkCwd || '');
  const createdAt = Number((session as { createdAt?: unknown }).createdAt);
  const updatedAt = Number((session as { updatedAt?: unknown }).updatedAt);
  if (!id || !templateId) return null;
  const rawMessages = Array.isArray((session as { messages?: unknown[] }).messages)
    ? (session as { messages: unknown[] }).messages
    : [];
  const messages = rawMessages.flatMap((message) => {
    const normalized = normalizeMessage(message);
    return normalized ? [normalized] : [];
  });
  return {
    id,
    templateId,
    title,
    messages,
    model,
    sdkSessionId: sdkSessionId || undefined,
    sdkCwd: sdkCwd || undefined,
    pinned: Boolean((session as { pinned?: unknown }).pinned),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) as T : null;
  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>))
      ? String((data as Record<string, unknown>).error || '请求失败')
      : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function loadLegacyChatSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(LEGACY_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((session) => {
      const normalized = normalizeSession(session);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const res = await fetch('/api/chat-sessions', {
    headers: getAuthHeaders(),
  });
  const data = await readJson<unknown[]>(res);
  return Array.isArray(data)
    ? data.flatMap((session) => {
        const normalized = normalizeSession(session);
        return normalized ? [normalized] : [];
      })
    : [];
}

export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  const res = await fetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 404) return null;
  const data = await readJson<unknown>(res);
  return normalizeSession(data);
}

export async function saveChatSession(session: ChatSession): Promise<ChatSession> {
  const res = await fetch('/api/chat-sessions', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(session),
  });
  const data = await readJson<unknown>(res);
  const normalized = normalizeSession(data);
  if (!normalized) throw new Error('会话保存失败');
  return normalized;
}

export async function patchChatSession(
  sessionId: string,
  patch: Partial<Pick<ChatSession, 'title' | 'pinned' | 'templateId' | 'model' | 'sdkSessionId' | 'sdkCwd'>>,
): Promise<ChatSession> {
  const res = await fetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  const data = await readJson<unknown>(res);
  const normalized = normalizeSession(data);
  if (!normalized) throw new Error('会话更新失败');
  return normalized;
}

export async function forkChatSession(
  sessionId: string,
  patch: Partial<Pick<ChatSession, 'title' | 'templateId' | 'model'>> = {},
): Promise<ChatSession> {
  const res = await fetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  const data = await readJson<unknown>(res);
  const normalized = normalizeSession(data);
  if (!normalized) throw new Error('会话分叉失败');
  return normalized;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await readJson(res);
}

export async function bootstrapChatSessions(allowLegacyImport = true): Promise<ChatSession[]> {
  const remoteSessions = await listChatSessions();
  if (remoteSessions.length > 0) return remoteSessions;

  if (!allowLegacyImport) return [];

  const legacySessions = loadLegacyChatSessions();
  if (legacySessions.length === 0) return [];

  await Promise.allSettled(legacySessions.map((session) => saveChatSession(session)));
  return listChatSessions();
}
