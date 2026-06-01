import type { ChatMessage } from '../simulator/types';

export function withAssistantDraft(baseMessages: ChatMessage[], content: string, timestamp: number): ChatMessage[] {
  return [...baseMessages, { role: 'assistant', content, timestamp }];
}

export function hasTrailingAssistantMessage(messages: ChatMessage[]) {
  return messages[messages.length - 1]?.role === 'assistant';
}
