import { useEffect, useRef, useState } from 'react';
import type { SDKMessage } from '../../simulator/types';
import JsonViewer from './JsonViewer';

interface Props {
  messages: SDKMessage[];
  isStreaming?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  system: '系统', assistant: '助手', user: '用户', result: '结果',
  stream_event: '流事件', hook_started: 'Hook 启动', hook_progress: 'Hook 进度',
  hook_response: 'Hook 响应', tool_progress: '工具进度',
  task_started: '任务开始', task_progress: '任务进度', task_notification: '任务通知',
};

// 从消息中提取可展示的文本
function extractContent(msg: SDKMessage): { text: string; toolName?: string; toolInput?: Record<string, unknown> } {
  // 直接的字符串 message
  if (typeof msg.message === 'string') return { text: msg.message };

  // result 消息
  if (msg.result) return { text: String(msg.result) };

  const m = msg.message as Record<string, unknown> | undefined;
  if (!m) return { text: '' };

  // Anthropic 格式: { role, content: [...] }
  const content = m.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    let toolName: string | undefined;
    let toolInput: Record<string, unknown> | undefined;

    for (const block of content) {
      if (typeof block === 'string') {
        texts.push(block);
      } else if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          texts.push(b.text);
        } else if (b.type === 'tool_use') {
          toolName = b.name as string;
          toolInput = b.input as Record<string, unknown>;
        } else if (b.type === 'tool_result') {
          texts.push(typeof b.content === 'string' ? b.content.slice(0, 500) : '[tool result]');
        } else if (b.type === 'thinking') {
          texts.push('[思考过程]');
        }
      }
    }
    return { text: texts.join('\n'), toolName, toolInput };
  }

  return { text: '' };
}

export default function StreamDisplay({ messages, isStreaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [rawIds, setRawIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleRaw = (id: string) => {
    setRawIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (messages.length === 0) {
    return (
      <div className="stream-display" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', minHeight: 120 }}>
        {isStreaming ? <span className="pulse">等待响应...</span> : <span>发送一个 prompt 开始交互</span>}
      </div>
    );
  }

  return (
    <div className="stream-display">
      {messages.map((msg, i) => {
        const rawId = msg.uuid || `${msg.type}-${i}`;
        const showRaw = rawIds.has(rawId);

        const isThinking = msg.subtype === 'thinking';
        const typeClass =
          msg.type === 'assistant' && isThinking ? 'system'
          : msg.type === 'assistant' ? 'assistant'
          : msg.type === 'result' ? 'result'
          : msg.type === 'system' ? 'system'
          : msg.type === 'user' ? 'user'
          : msg.type?.includes('hook') ? 'system'
          : msg.type?.includes('tool') ? 'tool'
          : 'system';

        const { text, toolName, toolInput } = extractContent(msg);

        return (
          <div key={i} className={`stream-msg ${typeClass}`}>
            <div
              className="stream-msg-header"
              onClick={() => toggleRaw(rawId)}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              title="点击切换原始 JSON / 文本视图"
            >
              <span>{isThinking ? '💭 思考' : TYPE_LABELS[msg.type] || msg.type}</span>
              {msg.subtype && !isThinking && <span style={{ opacity: .6 }}>{msg.subtype}</span>}
              {msg.model && <span style={{ opacity: .5, fontSize: '.8em' }}>{msg.model}</span>}
              {toolName && <span className="badge badge-info" style={{ marginLeft: 4 }}>{toolName}</span>}
              {msg.duration_ms != null && <span style={{ opacity: .5 }}>{msg.duration_ms}ms</span>}
              <span style={{ marginLeft: 'auto', fontSize: '.7em', opacity: .5 }}>{showRaw ? 'RAW' : '文本'}</span>
            </div>

            {showRaw ? (
              <JsonViewer data={msg} maxHeight={300} />
            ) : (
              <div style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7,
                ...(isThinking ? { opacity: .55, fontSize: '.92em', fontStyle: 'italic' } : {}),
              }}>
                {text || (
                  <>
                    {msg.tool_name && `工具: ${msg.tool_name}`}
                    {msg.hook_event_name && `事件: ${msg.hook_event_name}`}
                    {!msg.tool_name && !msg.hook_event_name && !text && (
                      <span style={{ opacity: .5 }}>[空消息]</span>
                    )}
                  </>
                )}
                {toolName && toolInput && (
                  <div style={{ marginTop: 8, fontSize: '.85em', opacity: .8 }}>
                    <span style={{ color: '#9cdcfe' }}>{toolName}</span>(
                    {Object.entries(toolInput).map(([k, v], j) => (
                      <span key={k}>
                        {j > 0 && ', '}
                        <span style={{ color: '#ce9178' }}>{k}</span>:{' '}
                        <span style={{ color: '#b5cea8' }}>{JSON.stringify(v)}</span>
                      </span>
                    ))}
                    )
                  </div>
                )}
                {msg.type === 'result' && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: '.82em', opacity: .8 }}>
                    {msg.duration_ms != null && <span>耗时 {msg.duration_ms}ms</span>}
                    {msg.total_cost_usd != null && <span>费用 ${msg.total_cost_usd}</span>}
                    {msg.num_turns != null && <span>{msg.num_turns} 轮</span>}
                    {msg.stop_reason && <span>{msg.stop_reason}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {isStreaming && (
        <div className="stream-msg assistant pulse" style={{ padding: '8px 14px' }}>
          正在生成...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
