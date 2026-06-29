export type VisualPreviewTarget = {
  key: string;
  href: string;
  id?: string;
  cid?: string;
  path?: string;
  sourceVisualId?: string;
};

const VISUAL_HREF_PATTERN = /(?:https?:\/\/[^\s<>"'`)]*)?\/viz\?[^\s<>"'`)]+/g;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function currentOrigin() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function stripTrailingPunctuation(value: string) {
  let next = value.trim();
  while (/[),.;:!?，。；：！？、]+$/.test(next)) {
    next = next.slice(0, -1);
  }
  return next;
}

function isLocalAbsoluteUrl(url: URL) {
  const origin = currentOrigin();
  return (origin && url.origin === origin) || LOCAL_HOSTS.has(url.hostname);
}

export function normalizeVisualPreviewHref(input: string) {
  const value = stripTrailingPunctuation(input);
  if (!value) return '';

  try {
    const url = new URL(value);
    if (url.pathname !== '/viz' || !isLocalAbsoluteUrl(url)) return '';
    return `${url.pathname}${url.search}`;
  } catch {
    if (!value.startsWith('/viz?')) return '';
    return value;
  }
}

export function parseVisualPreviewTarget(input: string): VisualPreviewTarget | null {
  const href = normalizeVisualPreviewHref(input);
  if (!href) return null;

  const url = new URL(href, 'http://agentma.local');
  if (url.pathname !== '/viz') return null;

  const id = url.searchParams.get('id')?.trim() || '';
  if (id) {
    return {
      key: `id:${id}`,
      href: `/viz?id=${encodeURIComponent(id)}`,
      id,
    };
  }

  const cid = url.searchParams.get('cid')?.trim() || '';
  const path = url.searchParams.get('path')?.trim() || '';
  const sourceVisualId = url.searchParams.get('sourceVisualId')?.trim() || '';
  if (!cid || !/^viz\/[A-Za-z0-9._-]+\.html$/.test(path)) return null;

  const fileHref = [
    `/viz?cid=${encodeURIComponent(cid)}`,
    `path=${path}`,
    sourceVisualId ? `sourceVisualId=${encodeURIComponent(sourceVisualId)}` : '',
  ].filter(Boolean).join('&');
  return {
    key: `file:${cid}:${path}:${sourceVisualId}`,
    href: fileHref,
    cid,
    path,
    sourceVisualId: sourceVisualId || undefined,
  };
}

export function isVisualPreviewHref(input: string) {
  return parseVisualPreviewTarget(input) !== null;
}

export function extractVisualPreviewTargets(source: string): VisualPreviewTarget[] {
  const seen = new Set<string>();
  const targets: VisualPreviewTarget[] = [];
  const matches = source.matchAll(VISUAL_HREF_PATTERN);
  for (const match of matches) {
    const target = parseVisualPreviewTarget(match[0]);
    if (!target || seen.has(target.key)) continue;
    seen.add(target.key);
    targets.push(target);
  }
  return targets;
}
