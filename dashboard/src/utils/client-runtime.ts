const LOCAL_DEV_AUTH_SEED = {
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlZTE1Zjg3Zi1jODQ5LTQ0OGUtOTczNC1lNTM4ZWI1YjE3NzkiLCJ0ZW5hbnRJZCI6IjhhNDNkYTZjLTEzMzYtNDI4MC1iZWMxLTFiYzBmZTZlNzYxMCIsImV4cCI6MTc4MjI3ODk4N30.5g6DDIr-qWg6mHBPNsC1bURLlh0qraWBbwLHhdTjypY',
  user: {
    id: 'ee15f87f-c849-448e-9734-e538eb5b1779',
    username: 'dash-test',
    email: 'dash-test@example.com',
    name: 'Dash Test',
    tenantId: '8a43da6c-1336-4280-bec1-1bc0fe6e7610',
    role: 'tenant_admin' as const,
  },
};

function isLocalDevAgentma() {
  if (typeof window === 'undefined') return false;
  return isLoopbackHostname(window.location.hostname)
    && (window.location.port === '3005' || window.location.port === '5173');
}

function ensureLocalDevAuthSeed() {
  if (!isLocalDevAgentma()) return;
  try {
    // dev 环境:始终用最新 seed 覆盖,避免老 token 残留导致 401
    const stored = localStorage.getItem('agentma_jwt');
    if (stored !== LOCAL_DEV_AUTH_SEED.token) {
      localStorage.setItem('agentma_jwt', LOCAL_DEV_AUTH_SEED.token);
    }
    if (!localStorage.getItem('agentma_user')) {
      localStorage.setItem('agentma_user', JSON.stringify(LOCAL_DEV_AUTH_SEED.user));
    }
  } catch {}
}

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  ensureLocalDevAuthSeed();
  return localStorage.getItem('agentma_jwt');
}

export function isUsingApiKeyAuth(): boolean {
  return false;
}

export type StoredAuthUser = {
  id?: string;
  username?: string;
  email: string;
  name: string;
  tenantId?: string;
  role?: 'tenant_admin' | 'team_admin' | 'member';
};

export function getStoredAuthUser(): StoredAuthUser | null {
  if (typeof window === 'undefined') return null;
  ensureLocalDevAuthSeed();
  try {
    const raw = localStorage.getItem('agentma_user');
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuthUser;
  } catch {
    return null;
  }
}

export function getAuthHeaders(extra: HeadersInit = {}): HeadersInit {
  const token = getStoredAuthToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function getEndpointProbeBlockReason(endpoint: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(endpoint);
    if (!isLoopbackHostname(url.hostname)) return null;
    if (isLoopbackHostname(window.location.hostname)) return null;
    return '公网页面无法直接访问部署主机的 localhost 服务';
  } catch {
    return null;
  }
}
