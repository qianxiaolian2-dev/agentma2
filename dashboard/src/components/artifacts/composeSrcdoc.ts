export type VisualTheme = Record<string, string>;

export const VISUAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;";

export const VISUAL_HEIGHT_SCRIPT = `
<script>
  function post(){ parent.postMessage({__agentmaVisual:1, h:document.documentElement.scrollHeight}, '*'); }
  window.addEventListener('load', post);
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement);
  setTimeout(post, 0);
</script>`;

const THEME_KEYS = ['--bg', '--ink', '--ink-secondary', '--border', '--accent', '--bg-hover'] as const;

function cleanCssValue(value: string) {
  return value.replace(/[;{}<>]/g, '').trim();
}

function themeDeclarations(theme: VisualTheme) {
  const entries = THEME_KEYS.flatMap((key) => {
    const value = cleanCssValue(theme[key] || '');
    return value ? [`${key}:${value}`] : [];
  });
  const fontFamily = cleanCssValue(theme['font-family'] || theme['--font-family'] || '');
  entries.push(`--font-family:${fontFamily || "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}`);
  return entries.join(';');
}

function chrome(theme: VisualTheme) {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${VISUAL_CSP}">`,
    `<style>:root{${themeDeclarations(theme)}}*{box-sizing:border-box}html,body{margin:0;color:var(--ink);background:transparent;font-family:var(--font-family)}</style>`,
  ].join('');
}

function isFullDocument(html: string) {
  return /^\s*(<!doctype|<html)\b/i.test(html);
}

export function composeSrcdoc(html: string, theme: VisualTheme): string {
  const source = String(html || '');
  const headChrome = chrome(theme);

  if (!isFullDocument(source)) {
    return `<!doctype html><html><head>${headChrome}</head><body>${source}${VISUAL_HEIGHT_SCRIPT}</body></html>`;
  }

  const withHead = /<\/head>/i.test(source)
    ? source.replace(/<\/head>/i, `${headChrome}</head>`)
    : source.replace(/<html\b([^>]*)>/i, `<html$1><head>${headChrome}</head>`);

  if (/<\/body>/i.test(withHead)) {
    return withHead.replace(/<\/body>/i, `${VISUAL_HEIGHT_SCRIPT}</body>`);
  }
  if (/<\/html>/i.test(withHead)) {
    return withHead.replace(/<\/html>/i, `${VISUAL_HEIGHT_SCRIPT}</html>`);
  }
  return `${withHead}${VISUAL_HEIGHT_SCRIPT}`;
}
