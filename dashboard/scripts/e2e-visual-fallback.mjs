// 验证：只靠会话内 sourceVisualId（不在 POST 里显式传），也能正确覆盖
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'http://localhost:3001';
let AUTH_TOKEN = '';

async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  return res.json();
}

const testEmail = `e2e-fallback-${Date.now()}@example.com`;
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'E2E', email: testEmail, password: 'test1234' }),
});
const auth = await reg.json();
AUTH_TOKEN = auth.token;
console.log('登录成功');

const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-fallback-'));
fs.mkdirSync(path.join(tmpWorkspace, 'viz'), { recursive: true });
fs.writeFileSync(path.join(tmpWorkspace, 'viz', 'changed.html'),
  '<!doctype html><title>仅靠会话兜底</title><h1>fallback</h1>');

const sessionId = `e2e-fb-${Date.now()}`;
const escW = tmpWorkspace.replace(/'/g, "\\'");
const { spawnSync } = await import('node:child_process');
const r = spawnSync(process.execPath, ['--import', 'tsx', '--eval', `
import { createVisual, saveChatSession } from './server-store.ts';
const v = createVisual('${auth.tenantId}', '${auth.id}', {
  title: '原始', html: '<!doctype html><title>原始</title>', sourceSlug: 'viz/o.html',
});
const s = saveChatSession('${auth.tenantId}', '${auth.id}', {
  id: '${sessionId}', title: 'fb', templateId: 'viz-agent',
  sdkSessionId: 'sdk-fb', sdkCwd: '${escW}', sourceVisualId: v.id,
  messages: [], createdAt: Date.now(), updatedAt: Date.now(),
});
console.log(JSON.stringify({ v, s: s.session }));
`], { cwd: process.cwd(), encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const { v: original, s: session } = JSON.parse(r.stdout.trim());
console.log('原始 visual.id:', original.id);
console.log('会话.sourceVisualId:', session.sourceVisualId);

// 关键：先 GET /api/visuals/file，确认返回里包含 sourceVisualId
const fileRes = await req('GET', `/api/visuals/file?cid=${encodeURIComponent(sessionId)}&path=viz/changed.html`, null);
console.log('GET /api/visuals/file → sourceVisualId:', fileRes.sourceVisualId);
assert.equal(fileRes.sourceVisualId, original.id, '/api/visuals/file 必须返回会话 sourceVisualId');

// 然后 POST /api/visuals 不带 sourceVisualId，靠会话兜底
const before = (await req('GET', '/api/visuals', null)).length;
const saved = await req('POST', '/api/visuals', {
  cid: sessionId,
  path: 'viz/changed.html',
  title: '仅靠会话兜底',
  // 故意不传 sourceVisualId
});
console.log('保存返回 id:', saved.id);
assert.equal(saved.id, original.id, '不传 sourceVisualId 也应靠会话兜底覆盖');
const after = (await req('GET', '/api/visuals', null)).length;
assert.equal(after, before, '不应新增');

await req('DELETE', `/api/visuals/${original.id}`, null);
fs.rmSync(tmpWorkspace, { recursive: true, force: true });
console.log('\n✅ 兜底（仅靠会话 sourceVisualId）测试通过');
