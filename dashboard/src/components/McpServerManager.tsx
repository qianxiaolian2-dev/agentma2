import { useState, useCallback, useEffect } from 'react';
import type { RegisteredTool } from '../simulator/types';
import { genMinecraftServerCode } from '../simulator/mock-data';
import StatusBadge from './common/StatusBadge';
import { getEndpointProbeBlockReason } from '../utils/client-runtime';

export function McpServerCard({ server, tools }: { server: string; tools: RegisteredTool[] }) {
  const [showCode, setShowCode] = useState(false);
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [deployMsg, setDeployMsg] = useState('');
  const [deployProgress, setDeployProgress] = useState('');
  const [botName, setBotName] = useState('LianLian');
  const endpoints = tools.filter(t => t.endpoint);

  const checkStatus = useCallback(async () => {
    if (endpoints.length === 0) return;
    const url = endpoints[0].endpoint!.url;
    const blockedReason = getEndpointProbeBlockReason(url);
    if (blockedReason) {
      setStatus('offline');
      return;
    }
    const base = url.replace(/\/api\/[^/]+$/, '');
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(base + '/api/health', { signal: controller.signal });
      clearTimeout(t);
      setStatus(res.ok ? 'online' : 'offline');
    } catch { setStatus('offline'); }
  }, [endpoints]);

  useEffect(() => { checkStatus(); const iv = setInterval(checkStatus, 15000); return () => clearInterval(iv); }, [checkStatus]);

  // 轮询部署进度
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/deploy/status/${server}`);
        const s = await r.json();
        if (!s || s.status === 'idle' || s.status === 'online') { setDeployProgress(''); return; }
        setDeployProgress(s.message || s.status);
        if (s.status === 'install_failed') setDeployProgress('✗ 安装失败');
      } catch { setDeployProgress(''); }
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => clearInterval(iv);
  }, [server]);

  const handleDeploy = async () => {
    setDeployMsg('部署中...');
    try {
      const deployCode = genMinecraftServerCode(server, endpoints[0]?.endpoint?.url ? new URL(endpoints[0].endpoint.url).port || '3005' : '3005', botName);
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, code: deployCode, tools: tools.map(t => ({ name: t.name, endpoint: t.endpoint })) }),
      });
      const data = await res.json();
      setDeployMsg(data.ok ? '✓ 已启动' : '✗ ' + (data.error || '失败'));
      setTimeout(() => checkStatus(), 2000);
    } catch (e) {
      setDeployMsg('✗ ' + (e as Error).message);
    }
  };

  return (
    <div className="card mb-4" style={{ borderColor: status === 'online' ? 'var(--success)' : 'var(--border)' }}>
      <div className="flex-between mb-3">
        <div className="flex gap-3" style={{ alignItems: 'center' }}>
          <div className="card-header" style={{ marginBottom: 0, fontFamily: 'var(--font-mono)', fontSize: '.85em' }}>
            mcpServers.{server}
          </div>
          <StatusBadge status={status === 'online' ? 'success' : status === 'checking' ? 'info' : 'error'}
            label={status === 'online' ? '在线' : status === 'checking' ? '检测中' : '离线'} />
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <input value={botName} onChange={e => setBotName(e.target.value)}
            placeholder="Bot 名称" style={{ width: 100, fontSize: '.8em', fontFamily: 'var(--font-mono)' }} />
          <button className="btn btn-sm" onClick={() => setShowCode(!showCode)}>代码</button>
          <button className="btn btn-sm btn-primary" onClick={handleDeploy}>部署</button>
        </div>
      </div>

      <div className="flex gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
        {tools.map(t => <span key={t.name} className="badge badge-info">{t.name}</span>)}
      </div>

      {deployProgress && (
        <div className="mb-2 fade-in" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: deployProgress.includes('失败') ? '100%' : '60%', background: deployProgress.includes('失败') ? 'var(--danger)' : 'var(--accent)', borderRadius: 2, animation: 'pulse 1.5s infinite' }} />
          </div>
          <span style={{ fontSize: '.78em', color: deployProgress.includes('失败') ? 'var(--danger)' : 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>{deployProgress}</span>
        </div>
      )}
      {deployMsg && (
        <div className="mb-2" style={{ fontSize: '.82em', color: deployMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
          {deployMsg}
        </div>
      )}

      {showCode && (
        <div className="fade-in">
          <pre style={{ background: 'var(--bg-code)', color: '#d4d4d4', borderRadius: 6, padding: 14, fontSize: '.78em', lineHeight: 1.7, overflowX: 'auto', maxHeight: 400 }}>
            <code>{genMinecraftServerCode(server, endpoints[0]?.endpoint?.url ? new URL(endpoints[0].endpoint.url).port || '3005' : '3005', botName)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
