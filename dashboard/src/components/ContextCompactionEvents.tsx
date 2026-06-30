import type { ContextCompactionEvent } from '../utils/context-events';

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ContextCompactionEvents({ events }: { events: ContextCompactionEvent[] }) {
  if (!events.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.map(event => (
        <div
          key={event.id}
          className="chat-msg thinking"
          style={{
            padding: '8px 12px',
            borderLeft: '3px solid var(--warning, #f59e0b)',
            background: 'color-mix(in srgb, var(--warning, #f59e0b) 8%, var(--bg-card))',
          }}
        >
          <div className="flex-between" style={{ gap: 10 }}>
            <span style={{ fontWeight: 600 }}>上下文压缩边界</span>
            <span className="badge badge-warning">compact</span>
          </div>
          <div style={{ marginTop: 4 }}>{event.message}</div>
          <div style={{ marginTop: 4, fontSize: '.78em', color: 'var(--ink-muted)' }}>
            {formatTime(event.timestamp)}
            {event.sdkSessionId && <span> · session {event.sdkSessionId.slice(0, 8)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
