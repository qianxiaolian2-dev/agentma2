import type { ChatMessage, ChatRunStats } from '../simulator/types';
import { outcomeToMessageStatus, type RunOutcome } from '../simulator/run-state';

export function createAssistantDraft(id: string, timestamp: number): ChatMessage {
  return { id, role: 'assistant', content: '', status: 'pending', timestamp };
}

export function appendAssistantDraft(baseMessages: ChatMessage[], id: string, timestamp: number): ChatMessage[] {
  return [...baseMessages, createAssistantDraft(id, timestamp)];
}

export function updateAssistantDraft(
  messages: ChatMessage[],
  id: string,
  patch: Partial<Pick<ChatMessage, 'content' | 'thinking' | 'status' | 'outcome' | 'outcomeDetail' | 'runId'>>,
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
  outcome: RunOutcome,
  thinking?: string,
  outcomeDetail?: string,
  runId?: string,
  runStats?: ChatRunStats,
): ChatMessage[] {
  const assistantMessage: ChatMessage = {
    id,
    role: 'assistant',
    content,
    status: outcomeToMessageStatus(outcome),
    outcome,
    timestamp,
    ...(thinking ? { thinking } : {}),
    ...(outcomeDetail ? { outcomeDetail } : {}),
    ...(runId ? { runId } : {}),
    ...(runStats ? { runStats } : {}),
  };

  const existingIndex = baseMessages.findIndex((message) => message.id === id);
  if (existingIndex < 0) return [...baseMessages, assistantMessage];
  return baseMessages.map((message, index) => index === existingIndex ? assistantMessage : message);
}
