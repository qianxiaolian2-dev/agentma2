import { useState } from 'react';
import { getAuthHeaders } from '../utils/client-runtime';

export interface PermissionRequest {
  reqId: string;
  toolName: string;
  input: unknown;
  title?: string;
  displayName?: string;
  description?: string;
  toolUseID: string;
}

function PermissionPromptCard({ req, onResolved }: {
  req: PermissionRequest;
  onResolved: (reqId: string) => void;
}) {
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const decide = async (decision: 'allow' | 'deny') => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/agents/permissions/${req.reqId}`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          decision,
          rememberForSession: decision === 'allow' ? remember : false,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        const message = e.error || `HTTP ${r.status}`;
        if (r.status === 404 && /unknown reqId|not found/i.test(message)) {
          onResolved(req.reqId);
          return;
        }
        setErr(message);
        setBusy(false);
        return;
      }
      onResolved(req.reqId);
    } catch (e) {
      setErr((e as Error).message || 'network error');
      setBusy(false);
    }
  };

  const title = req.title || `Agent 想要使用工具 ${req.toolName}`;
  return (
    <div
      className="card mb-2"
      style={{
        borderColor: 'var(--warning)',
        background: 'var(--warning-bg)',
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '.92em' }}>🔐 {title}</div>
      {req.description && (
        <div style={{ fontSize: '.82em', color: 'var(--ink-secondary)', marginTop: 4 }}>{req.description}</div>
      )}
      <details style={{ marginTop: 6, fontSize: '.78em' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--ink-secondary)' }}>
          工具参数 ({req.toolName})
        </summary>
        <pre style={{ fontSize: '.78em', overflow: 'auto', maxHeight: 200, marginTop: 4, padding: 8, background: 'var(--bg-card)', borderRadius: 4 }}>
          {JSON.stringify(req.input, null, 2)}
        </pre>
      </details>
      {err && (
        <div style={{ fontSize: '.8em', color: 'var(--danger)', marginTop: 6 }}>{err}</div>
      )}
      <div className="flex gap-2 mt-4" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => decide('allow')}>
          ✓ 允许
        </button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => decide('deny')}>
          ✗ 拒绝
        </button>
        <label style={{ fontSize: '.78em', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            disabled={busy}
            style={{ width: 'auto' }}
          />
          本次会话内总是允许 {req.toolName}
        </label>
      </div>
    </div>
  );
}

export function PermissionPromptList({ pending, onResolved }: {
  pending: PermissionRequest[];
  onResolved: (reqId: string) => void;
}) {
  const visible = Array.from(
    new Map(pending.filter(req => req.reqId).map(req => [req.reqId, req])).values(),
  );
  if (!visible.length) return null;
  return (
    <div className="mb-4">
      {visible.map(req => (
        <PermissionPromptCard key={req.reqId} req={req} onResolved={onResolved} />
      ))}
    </div>
  );
}
