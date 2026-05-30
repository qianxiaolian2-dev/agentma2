import type { ChatMessage, ChatSession } from '../simulator/types';
import { getAuthHeaders } from './client-runtime';

const LEGACY_SESSION_KEY = 'agentma_chat_sessions';

function normalizeMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== 'object') return null;
  const role = (message as { role?: unknown }).role;
  const content = (message as { content?: unknown }).content;
  const timestamp = Number((message as { timestamp?: unknown }).timestamp);
  if (!['user', 'assistant', 'system'].includes(String(role))) return null;
  if (typeof content !== 'string') return null;
  return {
    role: role as ChatMessage['role'],
    content,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

function normalizeSession(session: unknown): ChatSession | null {
  if (!session || typeof session !== 'object') return null;
  const id = String((session as { id?: unknown }).id || '');
  const templateId = String((session as { templateId?: unknown }).templateId || '');
  const title = String((session as { title?: unknown }).title || '');
  const model = String((session as { model?: unknown }).model || '');
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
  patch: Partial<Pick<ChatSession, 'title' | 'pinned' | 'templateId' | 'model'>>,
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
