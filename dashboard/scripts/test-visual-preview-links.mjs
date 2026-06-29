import assert from 'node:assert/strict';
import {
  extractVisualPreviewTargets,
  isVisualPreviewHref,
  normalizeVisualPreviewHref,
} from '../src/utils/visual-preview-links.ts';

const raw = '/viz?cid=chat-1782568567574&path=viz/sales-dashboard-v2.html&sourceVisualId=27cf376e-3f1a-4ddf-a6d2-8d14e3027388';
const absolute = `http://localhost:5173${raw}`;
const markdown = `已生成页面：[打开预览](${raw})，也可以直接访问 ${absolute}`;

assert.equal(isVisualPreviewHref(raw), true);
assert.equal(isVisualPreviewHref('/visuals'), false);
assert.equal(isVisualPreviewHref('https://example.com/viz?cid=x&path=viz/a.html'), false);

assert.equal(normalizeVisualPreviewHref(absolute), raw);
assert.equal(normalizeVisualPreviewHref(`${raw})`), raw);

const targets = extractVisualPreviewTargets(markdown);
assert.equal(targets.length, 1);
assert.deepEqual(targets[0], {
  key: 'file:chat-1782568567574:viz/sales-dashboard-v2.html:27cf376e-3f1a-4ddf-a6d2-8d14e3027388',
  href: raw,
  cid: 'chat-1782568567574',
  path: 'viz/sales-dashboard-v2.html',
  sourceVisualId: '27cf376e-3f1a-4ddf-a6d2-8d14e3027388',
});

const savedTargets = extractVisualPreviewTargets('继续看 /viz?id=saved-123。');
assert.equal(savedTargets.length, 1);
assert.deepEqual(savedTargets[0], {
  key: 'id:saved-123',
  href: '/viz?id=saved-123',
  id: 'saved-123',
});
