import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import JsonViewer from '../components/common/JsonViewer';

export default function Account() {
  const { user, token } = useAuth();
  const [tab, setTab] = useState<'info' | 'apikeys' | 'teams' | 'users' | 'quota' | 'audit'>('info');

  return (
    <div>
      <div className="page-header">
        <h1>⚙ 账户管理</h1>
        <p>租户信息 · 用户管理 · API 密钥 · 团队 · 配额 · 审计日志</p>
      </div>

      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        {[
          ['info', '租户信息'], ['users', '用户管理'], ['apikeys', 'API 密钥'],
          ['teams', '团队'], ['quota', '配额管理'], ['audit', '审计日志'],
        ].map(([k, v]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k as any)}>{v}</button>
        ))}
      </div>

      {tab === 'info' && <TenantInfo />}
      {tab === 'users' && <UserManager />}
      {tab === 'apikeys' && <ApiKeyManager />}
      {tab === 'teams' && <TeamManager />}
      {tab === 'quota' && <QuotaManager />}
      {tab === 'audit' && <AuditLogs />}
    </div>
  );
}

function TenantInfo() {
  const [tenant, setTenant] = useState<any>(null);
  const [name, setName] = useState('');
  useEffect(() => { fetch('/api/tenant').then(r => r.json()).then(d => { setTenant(d); setName(d.name || ''); }); }, []);
  const save = async () => {
    await fetch('/api/tenant', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    setTenant({ ...tenant, name });
  };
  if (!tenant) return null;
  return (
    <div className="card">
      <div className="card-header">租户信息</div>
      <div className="grid-2">
        <div className="form-group"><label>名称</label><input value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="form-group"><label>ID</label><input value={tenant.id} readOnly /></div>
        <div className="form-group"><label>区域</label><input value={tenant.region} readOnly /></div>
        <div className="form-group"><label>套餐</label>
          <select value={tenant.plan} onChange={e => { const p = e.target.value; fetch('/api/tenant', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: p }) }).then(() => setTenant({ ...tenant, plan: p })); }}>
            <option value="free">Free</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div className="form-group"><label>状态</label><input value={tenant.status} readOnly /></div>
      </div>
      <button className="btn btn-primary mt-2" onClick={save}>保存</button>
    </div>
  );
}

function UserManager() {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { fetch('/api/users').then(r => r.json()).then(setUsers); }, []);
  const changeRole = async (email: string, role: string) => {
    await fetch(`/api/users/${encodeURIComponent(email)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    setUsers(users.map((u: any) => u.email === email ? { ...u, role } : u));
  };
  const remove = async (email: string) => {
    if (!confirm('确定删除用户 ' + email + '？')) return;
    await fetch(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
    setUsers(users.filter((u: any) => u.email !== email));
  };
  return (
    <div className="card">
      <div className="card-header">用户管理 ({users.length})</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>邮箱</th><th>名称</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.email}>
                <td>{u.email}</td><td>{u.name}</td>
                <td>
                  <select value={u.role} onChange={e => changeRole(u.email, e.target.value)} style={{ width: 130 }}>
                    <option value="tenant_admin">管理员</option><option value="team_admin">团队管理</option><option value="member">成员</option>
                  </select>
                </td>
                <td style={{ fontSize: '.8em' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td><button className="btn btn-sm btn-danger" onClick={() => remove(u.email)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApiKeyManager() {
  const [keys, setKeys] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newScopes, setNewScopes] = useState<string[]>([]);
  const [rawKey, setRawKey] = useState('');
  useEffect(() => { fetch('/api/api-keys').then(r => r.json()).then(setKeys); }, []);

  const create = async () => {
    const r = await fetch('/api/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, scopes: newScopes }) });
    const k = await r.json();
    setKeys([...keys, k]);
    setRawKey(k.rawKey);
    setNewName(''); setNewScopes([]);
  };
  const revoke = async (id: string) => {
    await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
    setKeys(keys.filter((k: any) => k.id !== id));
  };

  const SCOPES = ['runs:write', 'runs:read', 'templates:write', 'templates:read', 'connections:use'];
  return (
    <div className="card">
      <div className="card-header">API 密钥</div>
      {rawKey && <div className="card mb-4" style={{ background: 'var(--success-bg)', borderColor: 'var(--success)' }}><div className="card-header">新密钥（仅显示一次）</div><code style={{ fontSize: '.8em', wordBreak: 'break-all' }}>{rawKey}</code></div>}
      <div className="grid-2 mb-4">
        <div className="form-group"><label>名称</label><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="My API Key" /></div>
        <div className="form-group">
          <label>权限范围</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {SCOPES.map(s => (
              <label key={s} style={{ fontSize: '.76em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={newScopes.includes(s)} onChange={() => setNewScopes(newScopes.includes(s) ? newScopes.filter(x => x !== s) : [...newScopes, s])} style={{ width: 'auto' }} />{s}
              </label>
            ))}
          </div>
        </div>
      </div>
      <button className="btn btn-primary" onClick={create}>创建密钥</button>
      <div className="table-wrap mt-4">
        <table>
          <thead><tr><th>名称</th><th>前缀</th><th>权限</th><th>创建</th><th>操作</th></tr></thead>
          <tbody>
            {keys.map((k: any) => (
              <tr key={k.id}>
                <td>{k.name}</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: '.8em' }}>{k.keyPrefix}</td>
                <td>{k.scopes?.join(', ') || '全部'}</td>
                <td style={{ fontSize: '.8em' }}>{new Date(k.createdAt).toLocaleDateString()}</td>
                <td><button className="btn btn-sm btn-danger" onClick={() => revoke(k.id)}>撤销</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamManager() {
  const [teams, setTeams] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  useEffect(() => { fetch('/api/teams').then(r => r.json()).then(setTeams); }, []);

  const create = async () => {
    const r = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) });
    const t = await r.json();
    setTeams([...teams, t]); setNewName('');
  };
  const select = async (t: any) => {
    setSel(t);
    const r = await fetch(`/api/teams/${t.id}/members`);
    setMembers(await r.json());
  };
  const addMember = async () => {
    await fetch(`/api/teams/${sel.id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: addEmail, role: 'member' }) });
    setAddEmail('');
    select(sel);
  };
  const removeMember = async (uid: string) => {
    await fetch(`/api/teams/${sel.id}/members/${uid}`, { method: 'DELETE' });
    select(sel);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <div className="card">
        <div className="card-header">团队列表</div>
        <div className="flex gap-2 mb-4"><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="团队名" style={{ flex: 1 }} /><button className="btn btn-primary btn-sm" onClick={create}>创建</button></div>
        {teams.map((t: any) => (
          <div key={t.id} className="tool-card mb-2" onClick={() => select(t)} style={{ cursor: 'pointer', background: sel?.id === t.id ? 'var(--accent-bg)' : undefined }}>
            <div className="tool-card-name">{t.name}</div>
            <div className="tool-card-desc">{t.memberCount} 人</div>
          </div>
        ))}
      </div>
      {sel && (
        <div className="card">
          <div className="card-header">{sel.name} — 成员</div>
          <div className="flex gap-2 mb-4"><input value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="用户邮箱" style={{ flex: 1 }} /><button className="btn btn-primary btn-sm" onClick={addMember}>添加</button></div>
          {members.map((m: any) => (
            <div key={m.userId} className="flex-between tool-card mb-2">
              <div><div className="tool-card-name">{m.email}</div><div className="tool-card-desc">{m.role}</div></div>
              <button className="btn btn-sm btn-danger" onClick={() => removeMember(m.userId)}>移除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuotaManager() {
  const [quota, setQuota] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  useEffect(() => { fetch('/api/quota').then(r => r.json()).then(d => { setQuota(d); setForm(d); }); }, []);

  const save = async () => {
    const r = await fetch('/api/quota', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setQuota(await r.json()); setEditing(false);
  };

  if (!quota) return null;
  const FIELDS = [
    ['monthlyActiveSecondsLimit', '月活跃秒数上限', '秒'],
    ['weeklyRunCountLimit', '周运行次数上限', '次'],
    ['maxConcurrentRuns', '最大并发运行数', '个'],
    ['perRunMaxActiveHours', '单次最大活跃时长', '小时'],
    ['perRunMaxWallClockHours', '单次最大墙钟时长', '小时'],
    ['perRunMaxLlmTokens', '单次最大 LLM Token', 'tokens'],
    ['perRunMaxToolCalls', '单次最大工具调用', '次'],
  ];

  return (
    <div className="card">
      <div className="flex-between">
        <div className="card-header" style={{ marginBottom: 0 }}>配额管理</div>
        <button className="btn btn-sm" onClick={() => setEditing(!editing)}>{editing ? '取消' : '调整配额'}</button>
      </div>
      <div className="grid-2 mt-4">
        {FIELDS.map(([k, label, unit]) => (
          <div key={k} className="kpi-card">
            <div className="kpi-label">{label}</div>
            {editing ? (
              <input type="number" value={form[k] || 0} onChange={e => setForm({ ...form, [k]: Number(e.target.value) })} style={{ fontSize: '1.2em', fontWeight: 700 }} />
            ) : (
              <div className="kpi-value" style={{ fontSize: '1.1em' }}>{quota[k]?.toLocaleString?.() || quota[k]} {unit}</div>
            )}
          </div>
        ))}
      </div>
      {editing && <button className="btn btn-primary mt-4" onClick={save}>保存配额</button>}
    </div>
  );
}

function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { fetch('/api/audit-logs').then(r => r.json()).then(setLogs); }, []);
  return (
    <div className="card">
      <div className="card-header">审计日志 ({logs.length})</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>资源</th></tr></thead>
          <tbody>
            {logs.map((l: any) => (
              <tr key={l.id}>
                <td style={{ fontSize: '.8em' }}>{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.action}</td>
                <td>{l.actor}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }}>{l.resource}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
