export default function JsonViewer({ data, maxHeight = 400 }: { data: unknown; maxHeight?: number }) {
  const formatJson = (obj: unknown): string => {
    if (obj === null) return '<span class="json-null">null</span>';
    if (typeof obj === 'boolean') return `<span class="json-boolean">${obj}</span>`;
    if (typeof obj === 'number') return `<span class="json-number">${obj}</span>`;
    if (typeof obj === 'string') return `<span class="json-string">"${escapeHtml(obj)}"</span>`;
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      const items = obj.map((item, i) => {
        const comma = i < obj.length - 1 ? ',' : '';
        return `  ${formatJson(item)}${comma}`;
      }).join('\n');
      return '[\n' + items + '\n]';
    }
    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      const items = keys.map((key, i) => {
        const comma = i < keys.length - 1 ? ',' : '';
        return `  <span class="json-key">"${escapeHtml(key)}"</span>: ${formatJson((obj as Record<string, unknown>)[key])}${comma}`;
      }).join('\n');
      return '{\n' + items + '\n}';
    }
    return String(obj);
  };

  return (
    <div className="json-viewer" style={{ maxHeight }} dangerouslySetInnerHTML={{ __html: formatJson(data) }} />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
