import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\n/g, '&#10;');
}

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
  const language = lang?.trim().split(/\s+/)[0] || 'text';
  const escapedCode = escapeHtml(text);
  const escapedLanguage = escapeHtml(language);
  const escapedDataCode = escapeAttribute(text);

  return [
    '<div class="chat-code-block">',
    '<div class="chat-code-toolbar">',
    `<span class="chat-code-lang">${escapedLanguage}</span>`,
    `<button type="button" class="chat-code-copy" data-code="${escapedDataCode}" aria-label="复制代码块">复制</button>`,
    '</div>',
    `<pre><code class="language-${escapedLanguage}">${escapedCode}</code></pre>`,
    '</div>',
  ].join('');
};

export function renderMarkdown(source: string): string {
  try {
    const raw = marked.parse(source, { async: false, renderer }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
  } catch {
    return DOMPurify.sanitize(escapeHtml(source), { ADD_ATTR: ['target', 'rel'] });
  }
}
