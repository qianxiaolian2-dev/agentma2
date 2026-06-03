export default function CodeBlock({ code, language = 'typescript' }: { code: string; language?: string }) {
  return (
    <div className="json-viewer" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {language !== 'plain' && (
        <div style={{ color: '#6a9955', fontSize: '.75em', marginBottom: 6 }}>// {language}</div>
      )}
      <code>{code}</code>
    </div>
  );
}
