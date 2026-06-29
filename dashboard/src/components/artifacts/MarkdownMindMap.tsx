import { useMemo } from 'react';
import { parseMarkdownMindMap, type MindMapNode } from '../../utils/markdown-mindmap';
import { renderMarkdown } from '../../utils/render-markdown';

export type MarkdownVisualMode = 'mindmap' | 'markdown';

type MarkdownMindMapProps = {
  markdown: string;
  title?: string;
  mode: MarkdownVisualMode;
};

function MindMapNodeView({ node, depth }: { node: MindMapNode; depth: number }) {
  const note = node.body.find(Boolean);
  return (
    <div className={`mindmap-node-row depth-${Math.min(depth, 5)}`}>
      <div className="mindmap-node">
        {node.level > 0 && <span className="mindmap-node-level">H{node.level}</span>}
        <strong>{node.title}</strong>
        {note && <span>{note}</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="mindmap-children">
          {node.children.map((child) => (
            <li key={child.id} className="mindmap-child">
              <MindMapNodeView node={child} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MarkdownMindMap({ markdown, title, mode }: MarkdownMindMapProps) {
  const tree = useMemo(() => parseMarkdownMindMap(markdown, title || '思维导图'), [markdown, title]);
  const markdownHtml = useMemo(() => renderMarkdown(markdown), [markdown]);

  if (mode === 'markdown') {
    return (
      <div className="markdown-visual markdown-reader">
        <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
      </div>
    );
  }

  if (tree.headingCount === 0) {
    return (
      <div className="markdown-visual markdown-visual-empty">
        <strong>没有检测到 Markdown 标题层级</strong>
        <p>用 #、##、### 组织内容后，这里会自动生成思维导图。</p>
      </div>
    );
  }

  return (
    <div className="markdown-visual mindmap-visual" data-depth={tree.maxDepth}>
      <div className="mindmap-canvas">
        <div className="mindmap-tree">
          <MindMapNodeView node={tree.root} depth={0} />
        </div>
      </div>
    </div>
  );
}
