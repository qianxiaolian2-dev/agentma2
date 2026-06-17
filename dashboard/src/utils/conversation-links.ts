export function parseConversationIdInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const looksLikeConversationLink = /^(https?:\/\/|\/|conversations(?:[/?]|$)|\?)/i.test(trimmed);
  if (!looksLikeConversationLink) return trimmed;

  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://dandelion.skin';
    const url = new URL(trimmed, baseUrl);
    return (url.searchParams.get('conversationId') || url.searchParams.get('join') || '').trim();
  } catch {
    return '';
  }
}
