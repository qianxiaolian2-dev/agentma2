export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('agentma_jwt') || localStorage.getItem('agentma_api_key');
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
