import type { ChatMessage, ChatImageAttachment } from '../simulator/types';

type Props = {
  message: ChatMessage;
};

function ImageGrid({ attachments }: { attachments: ChatImageAttachment[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {attachments.map(img => (
        <img
          key={img.id}
          src={`data:${img.mediaType};base64,${img.data}`}
          alt={img.name || '图片'}
          style={{
            maxWidth: 200, maxHeight: 200, borderRadius: 6,
            objectFit: 'cover', border: '1px solid var(--border)',
          }}
        />
      ))}
    </div>
  );
}

export default function ChatMessageBubble({ message }: Props) {
  const isPending = message.role === 'assistant' && message.status === 'pending' && !message.content && !message.thinking;
  const isError = message.status === 'error';
  const isStreaming = message.status === 'streaming';

  return (
    <div
      className={`chat-msg ${message.role}${isPending ? ' pulse' : ''}`}
      style={isError ? { borderLeft: '3px solid var(--danger)', color: 'var(--danger)' } : undefined}
    >
      {message.attachments && message.attachments.length > 0 && (
        <ImageGrid attachments={message.attachments} />
      )}

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

      <span>
        {message.content || (isPending ? '...' : '')}
        {isStreaming && !message.content && !message.thinking && (
          <span className="pulse" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', verticalAlign: 'middle', marginLeft: 4 }} />
        )}
      </span>
    </div>
  );
}
