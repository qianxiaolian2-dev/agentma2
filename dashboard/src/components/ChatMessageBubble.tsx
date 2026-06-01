import type { ChatMessage } from '../simulator/types';

type Props = {
  message: ChatMessage;
};

export default function ChatMessageBubble({ message }: Props) {
  const isPending = message.role === 'assistant' && message.status === 'pending' && !message.content && !message.thinking;

  return (
    <div className={`chat-msg ${message.role}${isPending ? ' pulse' : ''}`}>
      {message.thinking && (
        <div
          style={{
            color: 'var(--ink-muted)',
            fontSize: '.88em',
            fontStyle: 'italic',
            borderLeft: '2px solid var(--border)',
            paddingLeft: 10,
            marginBottom: message.content ? 8 : 0,
          }}
        >
          {message.thinking}
        </div>
      )}
      {message.content || (isPending ? '...' : '')}
    </div>
  );
}
