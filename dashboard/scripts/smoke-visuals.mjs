import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tsxBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

function runTsx(label, code, env = {}) {
  const result = spawnSync(tsxBin, ['--eval', code], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

runTsx('composeSrcdoc', `
  import assert from 'node:assert/strict';
  import { composeSrcdoc, VISUAL_CSP, VISUAL_HEIGHT_SCRIPT } from './src/components/artifacts/composeSrcdoc.ts';

  const fragment = composeSrcdoc('<h1>hi</h1>', {
    '--bg': '#fff',
    '--ink': '#111',
    '--ink-secondary': '#555',
    '--border': '#ddd',
    '--accent': '#2563eb',
    '--bg-hover': '#f5f5f5',
    'font-family': 'serif',
  });
  assert.match(fragment, /<meta http-equiv="Content-Security-Policy"/);
  assert.ok(fragment.includes(VISUAL_CSP));
  assert.ok(fragment.includes(':root{--bg:#fff'));
  assert.ok(fragment.includes('<h1>hi</h1>'));
  assert.ok(fragment.includes('__agentmaVisual'));
  assert.ok(fragment.includes(VISUAL_HEIGHT_SCRIPT.trim()));

  const fullInput = '<!doctype html><html><head><title>x</title></head><body><h1>x</h1></body></html>';
  const full = composeSrcdoc(fullInput, { '--ink': '#111' });
  assert.equal((full.match(/<!doctype/gi) || []).length, 1);
  assert.equal((full.match(/<html/gi) || []).length, 1);
  assert.equal((full.match(/<body/gi) || []).length, 1);
  assert.ok(full.includes('<title>x</title><meta http-equiv="Content-Security-Policy"'));
  assert.ok(full.includes('__agentmaVisual'));
`);

const frameSource = fs.readFileSync(path.join(root, 'src/components/artifacts/VisualFrame.tsx'), 'utf8');
const sandbox = frameSource.match(/VISUAL_FRAME_SANDBOX\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
assert.equal(sandbox, 'allow-scripts');
assert.ok(!sandbox.includes('allow-same-origin'));
assert.ok(frameSource.includes('allow="fullscreen"'));
assert.ok(frameSource.includes('allowFullScreen'));
assert.ok(frameSource.includes('event.source !== ref.current?.contentWindow'));

const vizPreviewSource = fs.readFileSync(path.join(root, 'src/pages/VizPreview.tsx'), 'utf8');
assert.ok(vizPreviewSource.includes('requestFullscreen'));
assert.ok(vizPreviewSource.includes('fullscreenchange'));
assert.ok(vizPreviewSource.includes('visual-fullscreen-btn'));

const layoutSource = fs.readFileSync(path.join(root, 'src/components/Layout.tsx'), 'utf8');
assert.ok(layoutSource.includes("location.pathname === '/viz'"));
assert.ok(layoutSource.includes('visual-preview-main'));

const cssSource = fs.readFileSync(path.join(root, 'src/App.css'), 'utf8');
assert.ok(cssSource.includes('.visual-preview-main .console-topbar'));
assert.ok(cssSource.includes('max-width: none'));
assert.ok(cssSource.includes('.visual-page:fullscreen'));
assert.ok(cssSource.includes('--visual-frame-min-height'));

const agentTemplateSource = fs.readFileSync(path.join(root, 'src/utils/agent-templates.ts'), 'utf8');
assert.ok(agentTemplateSource.includes('agentma-visual-quality-v4'));
assert.ok(agentTemplateSource.includes('外层全屏都不得重算或重置 scale'));
assert.ok(agentTemplateSource.includes('只能在首次渲染和用户明确点击'));
assert.ok(agentTemplateSource.includes('默认折叠态必须只显示中心主题和一级分支'));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-visuals-smoke-'));
try {
  runTsx('visuals CRUD', `
    import assert from 'node:assert/strict';
    import { createVisual, deleteVisual, getVisual, listVisuals, MAX_VISUAL_BYTES } from './server-store.ts';

    assert.equal(MAX_VISUAL_BYTES, 4 * 1024 * 1024);
    const tenantId = 'tenant-smoke';
    const ownerSub = 'owner-smoke';
    const created = createVisual(tenantId, ownerSub, {
      title: 'Smoke Visual',
      html: '<!doctype html><title>Smoke Visual</title><h1>ok</h1>',
      sourceSlug: 'viz/smoke.html',
    });
    assert.ok(created.id);
    const row = getVisual(tenantId, ownerSub, created.id);
    assert.equal(row?.title, 'Smoke Visual');
    assert.equal(row?.sourceSlug, 'viz/smoke.html');
    assert.ok(row?.sizeBytes > 0);
    const list = listVisuals(tenantId, ownerSub);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
    assert.equal(list[0].html, undefined);
    assert.equal(deleteVisual(tenantId, ownerSub, created.id), true);
    assert.equal(getVisual(tenantId, ownerSub, created.id), null);
  `, { AGENTMA_DATA_DIR: dataDir });
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log('smoke-visuals ok');
