import { useState, useCallback, useEffect } from 'react';
import type { RegisteredTool } from '../simulator/types';
import { genMinecraftServerCode } from '../simulator/mock-data';
import StatusBadge from './common/StatusBadge';

export function McpServerCard({ server, tools, code }: { server: string; tools: RegisteredTool[]; code: string }) {
  const [showCode, setShowCode] = useState(false);
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [deployMsg, setDeployMsg] = useState('');
  const endpoints = tools.filter(t => t.endpoint);

  const checkStatus = useCallback(async () => {
    if (endpoints.length === 0) return;
    const url = endpoints[0].endpoint!.url;
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

  const handleDeploy = async () => {
    setDeployMsg('部署中...');
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, code, tools: tools.map(t => ({ name: t.name, endpoint: t.endpoint })) }),
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
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setShowCode(!showCode)}>生成服务端</button>
          <button className="btn btn-sm btn-primary" onClick={handleDeploy}>部署</button>
        </div>
      </div>

      <div className="flex gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
        {tools.map(t => <span key={t.name} className="badge badge-info">{t.name}</span>)}
      </div>

      {deployMsg && (
        <div className="mb-2" style={{ fontSize: '.82em', color: deployMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
          {deployMsg}
        </div>
      )}

      {showCode && (
        <div className="fade-in">
          <pre style={{ background: 'var(--bg-code)', color: '#d4d4d4', borderRadius: 6, padding: 14, fontSize: '.78em', lineHeight: 1.7, overflowX: 'auto', maxHeight: 400 }}>
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
