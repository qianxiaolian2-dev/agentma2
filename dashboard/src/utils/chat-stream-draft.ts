import type { ChatMessage } from '../simulator/types';

export function createAssistantDraft(id: string, timestamp: number): ChatMessage {
  return { id, role: 'assistant', content: '', status: 'pending', timestamp };
}

export function appendAssistantDraft(baseMessages: ChatMessage[], id: string, timestamp: number): ChatMessage[] {
  return [...baseMessages, createAssistantDraft(id, timestamp)];
}

export function updateAssistantDraft(
  messages: ChatMessage[],
  id: string,
  patch: Partial<Pick<ChatMessage, 'content' | 'thinking' | 'status'>>,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== id) return message;
    return { ...message, ...patch };
  });
}

export function finalizeAssistantDraft(
  baseMessages: ChatMessage[],
  id: string,
  timestamp: number,
  content: string,
  status: NonNullable<ChatMessage['status']>,
  thinking?: string,
): ChatMessage[] {
  const assistantMessage: ChatMessage = {
    id,
    role: 'assistant',
    content,
    status,
    timestamp,
    ...(thinking ? { thinking } : {}),
  };

  return [...baseMessages, assistantMessage];
}
