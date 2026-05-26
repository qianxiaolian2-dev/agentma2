import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', border: '1.5px solid #e5e0d8',
  borderRadius: 10, fontSize: '1em', outline: 'none',
  background: '#fafaf8', transition: 'border-color .2s',
};

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
      result = isRegister ? await register(name, email, password) : await login(email, password);
    } else {
      result = await loginWithApiKey(apiKey);
    }
    setLoading(false);
    if (result.ok) navigate('/');
    else setError(result.error || '操作失败');
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f7f5f0', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 36 }}>🐾</div>
          <div style={{ fontSize: '1.5em', fontWeight: 800, color: '#2d2a26', letterSpacing: '-.02em', marginTop: 4 }}>
            AgentMa
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 16, padding: '36px 32px',
          boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 8px 32px rgba(0,0,0,.06)',
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', marginBottom: 28, gap: 4 }}>
            {[
              ['password', '密码'],
              ['apikey', 'API 密钥'],
            ].map(([k, v]) => (
              <button
                key={k}
                onClick={() => setTab(k as 'password' | 'apikey')}
                style={{
                  flex: 1, padding: '10px 0', border: 'none', borderRadius: 8,
                  background: tab === k ? '#2d2a26' : 'transparent',
                  color: tab === k ? '#fff' : '#9c9590',
                  fontWeight: 600, fontSize: '.88em', cursor: 'pointer',
                  transition: 'all .2s',
                }}
              >
                {v}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {tab === 'password' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {isRegister && (
                  <div>
                    <div style={{ fontSize: '.82em', fontWeight: 600, color: '#8c857e', marginBottom: 6 }}>姓名</div>
                    <input value={name} onChange={e => setName(e.target.value)}
                      placeholder="你的名字" style={inputStyle} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '.82em', fontWeight: 600, color: '#8c857e', marginBottom: 6 }}>邮箱</div>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="email@example.com" required style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontSize: '.82em', fontWeight: 600, color: '#8c857e', marginBottom: 6 }}>密码</div>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="至少 6 位" required minLength={6} style={inputStyle} />
                </div>
              </div>
            )}

            {tab === 'apikey' && (
              <div>
                <div style={{ fontSize: '.82em', fontWeight: 600, color: '#8c857e', marginBottom: 6 }}>API 密钥</div>
                <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-tenant_..." style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '.85em' }} />
              </div>
            )}

            {error && (
              <div style={{
                fontSize: '.84em', color: '#c0392b', marginTop: 16,
                padding: '10px 14px', background: '#fef2f2', borderRadius: 8, lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '14px 0', marginTop: 24,
                background: loading ? '#b0aaa3' : '#2d2a26',
                color: '#fff', border: 'none', borderRadius: 12,
                fontSize: '1em', fontWeight: 700, cursor: loading ? 'default' : 'pointer',
                letterSpacing: '.04em', transition: 'background .2s',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#4a4540'; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#2d2a26'; }}
            >
              {loading ? '...' : isRegister ? '创建账号' : '登 录'}
            </button>
          </form>

          {tab === 'password' && (
            <div style={{ textAlign: 'center', marginTop: 20, fontSize: '.86em', color: '#8c857e' }}>
              {isRegister ? '已有账号？' : '没有账号？'}
              <span onClick={() => { setIsRegister(!isRegister); setError(''); }}
                style={{ color: '#2d2a26', fontWeight: 600, cursor: 'pointer', marginLeft: 4 }}>
                {isRegister ? '去登录' : '去注册'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
