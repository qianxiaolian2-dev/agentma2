import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { getStoredAuthToken } from '../utils/client-runtime';

interface User {
  email: string;
  name: string;
  tenantId?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  loginWithApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function saveJwt(token: string) { localStorage.setItem('agentma_jwt', token); }
function clearJwt() { localStorage.removeItem('agentma_jwt'); }
function saveApiKey(key: string) { localStorage.setItem('agentma_api_key', key); }
function clearApiKey() { localStorage.removeItem('agentma_api_key'); }
function saveUser(user: User) { localStorage.setItem('agentma_user', JSON.stringify(user)); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const t = getStoredAuthToken();
    const u = localStorage.getItem('agentma_user');
    return t && u ? t : null;
  });
  const [user, setUser] = useState<User | null>(() => {
    const t = getStoredAuthToken();
    const u = localStorage.getItem('agentma_user');
    if (!t || !u) return null;
    try { return JSON.parse(u) as User; } catch { return null; }
  });

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || '登录失败' };
      clearApiKey();
      saveJwt(data.token);
      saveUser({ email: data.email, name: data.name, tenantId: data.tenantId });
      setToken(data.token);
      setUser({ email: data.email, name: data.name, tenantId: data.tenantId });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || '注册失败' };
      clearApiKey();
      saveJwt(data.token);
      saveUser({ email: data.email, name: data.name, tenantId: data.tenantId });
      setToken(data.token);
      setUser({ email: data.email, name: data.name, tenantId: data.tenantId });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }, []);

  const loginWithApiKey = useCallback(async (key: string) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: 'API 密钥无效' };
      clearJwt();
      saveApiKey(key);
      saveUser({ email: data.email || '', name: data.name || '', tenantId: data.tenantId });
      setToken(key);
      setUser({ email: data.email || '', name: data.name || '', tenantId: data.tenantId });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('agentma_jwt');
    localStorage.removeItem('agentma_user');
    localStorage.removeItem('agentma_api_key');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoggedIn: !!token, login, register, loginWithApiKey, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
