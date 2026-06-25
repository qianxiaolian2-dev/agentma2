#!/usr/bin/env node
/**
 * 端到端验证：继续修改已保存 visual 应该覆盖原记录，而不是新增
 *
 * 流程：
 * 1. 创建 visual A
 * 2. 创建会话，sourceVisualId = A.id，并写 workspace viz 文件
 * 3. 调 POST /api/visuals 保存（带 sourceVisualId）
 * 4. 验证返回 id == A.id，且 visual 总数未增加
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'http://localhost:3001';
let AUTH_TOKEN = '';

async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  return res.json();
}

// 登录
console.log('0. 登录...');
const testEmail = `e2e-visual-${Date.now()}@example.com`;
const testPassword = 'test1234';

// 先注册
const registerRes = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'E2E Test', email: testEmail, password: testPassword }),
});
if (!registerRes.ok) {
  console.error('注册失败:', await registerRes.text());
  process.exit(1);
}
const loginData = await registerRes.json();
AUTH_TOKEN = loginData.token;
console.log('注册并登录成功，tenantId:', loginData.tenantId);

// 1. 创建临时 workspace + 写 viz 文件 + 在数据库中创建 visual A 和带 sourceVisualId 的会话
console.log('1. 准备 workspace、原始 visual 和会话...');
const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-visual-'));
fs.mkdirSync(path.join(tmpWorkspace, 'viz'), { recursive: true });
fs.writeFileSync(
  path.join(tmpWorkspace, 'viz', 'updated.html'),
  '<!doctype html><title>修改后的页面</title><h1>已修改</h1>',
);

const sessionId = `e2e-session-${Date.now()}`;
const escWorkspace = tmpWorkspace.replace(/'/g, "\\'");
const tenantId = loginData.tenantId;
const ownerSub = loginData.id;

const setupScript = `
import { createVisual, saveChatSession } from './server-store.ts';
const visualA = createVisual('${tenantId}', '${ownerSub}', {
  title: '原始页面',
  html: '<!doctype html><title>原始页面</title><h1>原始</h1>',
  sourceSlug: 'viz/original.html',
});
const sessionResult = saveChatSession('${tenantId}', '${ownerSub}', {
  id: '${sessionId}',
  title: 'E2E 测试会话',
  templateId: 'viz-agent',
  sdkSessionId: 'sdk-e2e-${Date.now()}',
  sdkCwd: '${escWorkspace}',
  sourceVisualId: visualA.id,
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
if (!sessionResult.ok) {
  console.error('saveChatSession failed:', sessionResult.error);
  process.exit(1);
}
console.log(JSON.stringify({ visualA, session: sessionResult.session }));
`;

const { spawnSync } = await import('node:child_process');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', setupScript], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

if (result.status !== 0) {
  console.error('setup 失败:', result.stderr);
  process.exit(1);
}

const { visualA: originalVisual, session } = JSON.parse(result.stdout.trim());
console.log('原始 visual.id:', originalVisual.id);
console.log('会话 ID:', session.id);
console.log('会话 sourceVisualId:', session.sourceVisualId);

// 2. 获取保存前的 visual 总数
console.log('2. 检查保存前状态...');
const beforeList = await req('GET', '/api/visuals', null);
const beforeCount = beforeList.length;
console.log('保存前 visual 总数:', beforeCount);

// 3. 调用保存接口（模拟从预览页点击保存）
console.log('3. 保存修改后的 visual...');
const saved = await req('POST', '/api/visuals', {
  cid: session.id,
  path: 'viz/updated.html',
  title: '修改后的页面',
  sourceVisualId: originalVisual.id, // 前端会从预览 URL 或 /api/visuals/file 获取
});

console.log('保存返回 id:', saved.id);
assert.equal(saved.id, originalVisual.id, '保存应该返回原 visual id（覆盖）');

// 4. 验证总数未增加
console.log('4. 验证覆盖结果...');
const afterList = await req('GET', '/api/visuals', null);
const afterCount = afterList.length;
console.log('保存后 visual 总数:', afterCount);
assert.equal(afterCount, beforeCount, '覆盖保存不应增加 visual 总数');

// 5. 验证内容已更新
const updated = await req('GET', `/api/visuals/${originalVisual.id}`, null);
assert.ok(updated.html.includes('已修改'), 'HTML 内容应该已更新');
assert.equal(updated.title, '修改后的页面', '标题应该已更新');

// 清理
console.log('5. 清理...');
await req('DELETE', `/api/visuals/${originalVisual.id}`, null);
fs.rmSync(tmpWorkspace, { recursive: true, force: true });

console.log('\n✅ 端到端覆盖保存测试通过！');
