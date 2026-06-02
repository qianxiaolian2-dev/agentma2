import { useState, useMemo } from 'react';
import { marked } from 'marked';
import type { ChatMessage, ChatImageAttachment } from '../simulator/types';

// Configure marked for safe rendering
marked.setOptions({ gfm: true, breaks: true });

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
          style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }}
        />
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      title="复制"
      style={{
        position: 'absolute', top: 6, right: 6,
        opacity: 0, transition: 'opacity 0.15s',
        background: 'var(--bg-hover)', border: '1px solid var(--border)',
        borderRadius: 4, padding: '2px 6px', fontSize: '.7em',
        color: copied ? 'var(--success)' : 'var(--ink-secondary)',
        cursor: 'pointer', lineHeight: 1.4,
      }}
      className="copy-btn"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

export default function ChatMessageBubble({ message }: Props) {
  const isPending = message.role === 'assistant' && message.status === 'pending' && !message.content && !message.thinking;
  const isError = message.status === 'error';
  const isStreaming = message.status === 'streaming';
  const isComplete = message.role === 'assistant' && message.status === 'complete' && !!message.content;
  const useMarkdown = isComplete;

  const htmlContent = useMemo(() => {
    if (!useMarkdown) return '';
    try {
      return marked.parse(message.content) as string;
    } catch {
      return message.content;
    }
  }, [useMarkdown, message.content]);

  return (
    <div
      className={`chat-msg ${message.role}${isPending ? ' pulse' : ''}`}
      style={{
        position: 'relative',
        ...(isError ? { borderLeft: '3px solid var(--danger)', color: 'var(--danger)' } : {}),
      }}
    >
      {message.attachments && message.attachments.length > 0 && (
        <ImageGrid attachments={message.attachments} />
      )}

      {message.thinking && (
        <div style={{
          color: 'var(--ink-muted)', fontSize: '.88em', fontStyle: 'italic',
          borderLeft: '2px solid var(--border)', paddingLeft: 10,
          marginBottom: message.content ? 8 : 0,
        }}>
          {message.thinking}
        </div>
      )}

      {useMarkdown ? (
        <div
          className="chat-markdown"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      ) : (
        <span>
          {message.content || (isPending ? '...' : '')}
          {isStreaming && !message.content && !message.thinking && (
            <span className="pulse" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', verticalAlign: 'middle', marginLeft: 4 }} />
          )}
        </span>
      )}

      {isComplete && <CopyButton text={message.content} />}

      {message.timestamp > 0 && (message.role === 'user' || isComplete) && (
        <div style={{ fontSize: '.65em', color: 'var(--ink-muted)', marginTop: 4, opacity: 0.6 }}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
