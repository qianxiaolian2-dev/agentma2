import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, register, loginWithApiKey } = useAuth();

  const [tab, setTab] = useState<'password' | 'apikey'>('password');
  const [isRegister, setIsRegister] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    let result: { ok: boolean; error?: string };
    if (tab === 'password') {
      if (isRegister) {
        result = await register(name, email, password);
      } else {
        result = await login(email, password);
      }
    } else {
      result = await loginWithApiKey(apiKey);
    }

    setLoading(false);
    if (result.ok) {
      navigate('/');
    } else {
      setError(result.error || '操作失败');
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f5f0e8, #ece4d8)',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: '32px 28px',
        background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,.1)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: '1.6em', fontWeight: 700, marginBottom: 4 }}>🐾 AgentMa</div>
          <div style={{ fontSize: '.85em', color: 'var(--ink-muted)' }}>
            {isRegister ? '创建账号开始使用' : '登录你的账号'}
          </div>
        </div>

        {/* 标签切换 */}
        <div style={{ display: 'flex', marginBottom: 20, background: 'var(--bg-hover)', borderRadius: 8, padding: 3 }}>
          <button
            onClick={() => setTab('password')}
            style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: 6,
              background: tab === 'password' ? '#fff' : 'transparent',
              fontWeight: tab === 'password' ? 600 : 400,
              cursor: 'pointer', fontSize: '.85em', boxShadow: tab === 'password' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
            }}
          >
            密码登录
          </button>
          <button
            onClick={() => setTab('apikey')}
            style={{
              flex: 1, padding: '8px 0', border: 'none', borderRadius: 6,
              background: tab === 'apikey' ? '#fff' : 'transparent',
              fontWeight: tab === 'apikey' ? 600 : 400,
              cursor: 'pointer', fontSize: '.85em', boxShadow: tab === 'apikey' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
            }}
          >
            API 密钥
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {tab === 'password' && (
            <>
              {isRegister && (
                <div className="form-group">
                  <label>姓名</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" />
                </div>
              )}
              <div className="form-group">
                <label>邮箱</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required />
              </div>
              <div className="form-group">
                <label>密码</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" required minLength={6} />
              </div>
            </>
          )}

          {tab === 'apikey' && (
            <div className="form-group">
              <label>API 密钥</label>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-tenant_..." style={{ fontFamily: 'var(--font-mono)', fontSize: '.82em' }} />
            </div>
          )}

          {error && (
            <div style={{ fontSize: '.82em', color: 'var(--danger)', marginBottom: 12, padding: '8px 12px', background: 'var(--danger-bg)', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px 0', fontSize: '.95em', fontWeight: 600, marginTop: 8 }}
          >
            {loading ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>
        </form>

        {tab === 'password' && (
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: '.84em', color: 'var(--ink-secondary)' }}>
            {isRegister ? '已有账号？' : '没有账号？'}
            <a href="#" onClick={e => { e.preventDefault(); setIsRegister(!isRegister); setError(''); }} style={{ color: 'var(--accent)', marginLeft: 4 }}>
              {isRegister ? '去登录' : '去注册'}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
