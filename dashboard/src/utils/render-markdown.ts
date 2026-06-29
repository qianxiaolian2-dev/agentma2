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

const SQL_KEYWORDS = new Set([
  'ADD', 'ALTER', 'AS', 'ASC', 'BEGIN', 'BY', 'CASE', 'CHECK', 'COMMIT', 'CONSTRAINT',
  'CREATE', 'DEFAULT', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'END', 'EXISTS',
  'FOREIGN', 'FROM', 'GROUP', 'HAVING', 'IF', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTO',
  'IS', 'JOIN', 'LEFT', 'LIKE', 'LIMIT', 'NOT', 'NULL', 'ON', 'OR', 'ORDER', 'OUTER',
  'PRIMARY', 'REFERENCES', 'RETURNING', 'RIGHT', 'ROLLBACK', 'SELECT', 'SET', 'TABLE',
  'THEN', 'UNION', 'UNIQUE', 'UPDATE', 'VALUES', 'WHEN', 'WHERE', 'WITH',
]);

const SQL_TYPES = new Set([
  'BIGINT', 'BOOLEAN', 'CHAR', 'DATE', 'DECIMAL', 'DOUBLE', 'FLOAT', 'INT', 'INTEGER',
  'INTERVAL', 'JSON', 'JSONB', 'NUMERIC', 'REAL', 'SERIAL', 'TEXT', 'TIME', 'TIMESTAMP',
  'UUID', 'VARCHAR',
]);

function token(className: string, value: string): string {
  return `<span class="chat-code-token chat-code-token--${className}">${escapeHtml(value)}</span>`;
}

function highlightSql(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const rest = source.slice(i);

    if (rest.startsWith('--')) {
      const end = source.indexOf('\n', i);
      const next = end === -1 ? source.length : end;
      out += token('comment', source.slice(i, next));
      i = next;
      continue;
    }

    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2);
      const next = end === -1 ? source.length : end + 2;
      out += token('comment', source.slice(i, next));
      i = next;
      continue;
    }

    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let next = i + 1;
      while (next < source.length) {
        if (source[next] === quote) {
          if (source[next + 1] === quote) {
            next += 2;
            continue;
          }
          next += 1;
          break;
        }
        if (source[next] === '\\') next += 1;
        next += 1;
      }
      out += token('string', source.slice(i, next));
      i = next;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) out += token('keyword', word);
      else if (SQL_TYPES.has(upper)) out += token('type', word);
      else out += escapeHtml(word);
      i += word.length;
      continue;
    }

    const number = /^\b\d+(?:\.\d+)?\b/.exec(rest)?.[0];
    if (number) {
      out += token('number', number);
      i += number.length;
      continue;
    }

    const punctuation = /^[(),.;=*<>+-]/.exec(rest)?.[0];
    if (punctuation) {
      out += token('punctuation', punctuation);
      i += punctuation.length;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}

function highlightCode(source: string, language: string): string {
  const normalized = language.toLowerCase();
  if (['sql', 'postgres', 'postgresql', 'mysql', 'sqlite'].includes(normalized)) {
    return highlightSql(source);
  }
  return escapeHtml(source);
}

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
  const language = lang?.trim().split(/\s+/)[0] || 'text';
  const highlightedCode = highlightCode(text, language);
  const escapedLanguage = escapeHtml(language);
  const escapedDataCode = escapeAttribute(text);

  return [
    '<div class="chat-code-block">',
    '<div class="chat-code-toolbar">',
    `<span class="chat-code-lang">${escapedLanguage}</span>`,
    `<button type="button" class="chat-code-copy" data-code="${escapedDataCode}" aria-label="复制代码块">复制</button>`,
    '</div>',
    `<pre><code class="language-${escapedLanguage}">${highlightedCode}</code></pre>`,
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
