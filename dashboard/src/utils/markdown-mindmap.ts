export type MindMapNode = {
  id: string;
  level: number;
  title: string;
  body: string[];
  children: MindMapNode[];
};

export type MindMapTree = {
  root: MindMapNode;
  headingCount: number;
  maxDepth: number;
};

const HEADING_RE = /^(#{1,6})(?!#)\s*(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createNode(id: string, level: number, title: string): MindMapNode {
  return { id, level, title, body: [], children: [] };
}

export function isLikelyMarkdownMindMap(source: string) {
  let inFence = false;
  let headingCount = 0;
  const lines = String(source || '').split(/\r?\n/);
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && HEADING_RE.test(line)) headingCount += 1;
    if (headingCount >= 2) return true;
  }
  return false;
}

export function extractMarkdownTitle(source: string, fallback = '思维导图') {
  let firstHeading = '';
  let inFence = false;
  const lines = String(source || '').split(/\r?\n/);
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(HEADING_RE);
    if (!match) continue;
    const title = cleanInlineMarkdown(match[2]);
    if (!title) continue;
    if (match[1].length === 1) return title.slice(0, 160);
    firstHeading ||= title;
  }
  return (fallback || firstHeading || '思维导图').slice(0, 160);
}

export function parseMarkdownMindMap(source: string, fallbackTitle = '思维导图'): MindMapTree {
  const syntheticRoot = createNode('root', 0, fallbackTitle || '思维导图');
  const stack: MindMapNode[] = [syntheticRoot];
  let inFence = false;
  let headingCount = 0;

  const lines = String(source || '').split(/\r?\n/);
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const title = cleanInlineMarkdown(heading[2]);
      if (!title) continue;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1] || syntheticRoot;
      const node = createNode(`node-${headingCount}`, level, title);
      parent.children.push(node);
      stack.push(node);
      headingCount += 1;
      continue;
    }

    const text = cleanInlineMarkdown(line);
    if (text && stack.length > 1) {
      const current = stack[stack.length - 1];
      if (current.body.length < 3) current.body.push(text);
    }
  }

  const hasSingleH1Root = syntheticRoot.children.length === 1 && syntheticRoot.children[0].level === 1;
  const root = hasSingleH1Root ? syntheticRoot.children[0] : syntheticRoot;
  const maxDepth = measureDepth(root);

  return { root, headingCount, maxDepth };
}

function measureDepth(node: MindMapNode): number {
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map(measureDepth));
}
