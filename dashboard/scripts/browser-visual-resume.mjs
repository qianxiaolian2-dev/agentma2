// 真实浏览器链路测试：素材库 → 继续修改 → 会话 → 发送 → 检查会话 source_visual_id
// 用 puppeteer-core 驱动系统 Chrome，走真实前端 (5173)
// 注意：dev 端口 5173 下前端强制用固定 LOCAL_DEV_AUTH_SEED 账号，所以这里直接复用该账号，
// 与用户真实浏览器环境完全一致。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FRONTEND = 'http://127.0.0.1:5173';
const BACKEND = 'http://localhost:3001';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 与 src/utils/client-runtime.ts 的 LOCAL_DEV_AUTH_SEED 完全一致
const SEED = {
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlZTE1Zjg3Zi1jODQ5LTQ0OGUtOTczNC1lNTM4ZWI1YjE3NzkiLCJ0ZW5hbnRJZCI6IjhhNDNkYTZjLTEzMzYtNDI4MC1iZWMxLTFiYzBmZTZlNzYxMCIsImV4cCI6MTc4Mjg5MTc2OH0.y8aIoExu2Bix-6ateMhZthxYfM6dRnzvgDDgf5gF57g',
  tenantId: '8a43da6c-1336-4280-bec1-1bc0fe6e7610',
  userId: 'ee15f87f-c849-448e-9734-e538eb5b1779',
};

function log(...a) { console.log('[browser-test]', ...a); }

// 1. 用种子账号通过 server-store 建一个已保存 visual（模拟"团队销售看板"）
const { spawnSync } = await import('node:child_process');
const setup = spawnSync(process.execPath, ['--import', 'tsx', '--eval', `
import { createVisual, getVisual } from './server-store.ts';
const v = createVisual('${SEED.tenantId}', '${SEED.userId}', {
  title: '浏览器测试-团队销售看板',
  html: '<!doctype html><html><head><title>团队销售看板</title></head><body><h1>原始销售看板</h1></body></html>',
  sourceSlug: 'viz/team-sales.html',
});
const full = getVisual('${SEED.tenantId}', '${SEED.userId}', v.id);
console.log(JSON.stringify({ id: v.id, title: full?.title }));
`], { cwd: process.cwd(), encoding: 'utf8' });
if (setup.status !== 0) { console.error(setup.stderr); process.exit(1); }
const visual = JSON.parse(setup.stdout.trim());
log('创建 visual id=', visual.id, 'title=', visual.title);

// 2. 启动浏览器（用干净的临时 user data dir）；Chrome 启动偶发握手超时，做几次重试
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-visual-'));
async function launchWithRetry(attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        protocolTimeout: 120000,
        userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'],
      });
    } catch (e) {
      lastErr = e;
      log(`Chrome 启动失败(第${i + 1}次)，重试...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}
const browser = await launchWithRetry();
const page = await browser.newPage();

// 捕获所有 /api/chat* 的请求体（调试用，记录每一个）
let chatRequestBody = null;
const allChatReqs = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/chat') && req.method() === 'POST') {
    let body = null;
    try { body = JSON.parse(req.postData() || '{}'); } catch {}
    allChatReqs.push({ url: u.replace(BACKEND, '').replace(FRONTEND, ''), keys: body ? Object.keys(body) : [], sessionId: body?.sessionId, sourceVisualId: body?.sourceVisualId });
    // 主聊天请求：路径恰好是 /api/chat（不是 /runs /files 等子路径）
    if (/\/api\/chat(\?|$)/.test(u)) chatRequestBody = body;
  }
  req.continue();
});
page.on('console', (msg) => {
  const t = msg.text();
  if (msg.type() === 'error') log('PAGE-ERR:', t);
  if (t.includes('[RVC')) log('PAGE-LOG:', t);
});

try {
  // 3. 打开素材库（dev 端口前端自动用 LOCAL_DEV_AUTH_SEED 账号登录）
  await page.goto(`${FRONTEND}/visuals`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  const lsState = await page.evaluate(() => ({
    jwt: (localStorage.getItem('agentma_jwt') || '').slice(0, 30),
    user: localStorage.getItem('agentma_user') || '(null)',
  }));
  log('注入校验: localStorage.agentma_jwt[0..30]=', lsState.jwt);
  log('注入校验: localStorage.agentma_user=', lsState.user.slice(0, 80));
  log('期望 user.id=', SEED.userId);
  log('素材库已加载, URL=', page.url());

  // 找到"继续修改"按钮（指向 visualId）
  const continueBtnSelector = `a[href*="visualId=${visual.id}"]`;
  try {
    await page.waitForSelector(continueBtnSelector, { timeout: 10000 });
  } catch (e) {
    // 调试：dump 当前页面状态
    const dump = await page.evaluate(() => ({
      url: location.href,
      bodyText: document.body.innerText.slice(0, 600),
      links: Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href')).filter(Boolean).slice(0, 40),
      rows: document.querySelectorAll('table tbody tr').length,
    }));
    log('DEBUG 页面状态:', JSON.stringify(dump, null, 2));
    throw e;
  }
  log('找到"继续修改"按钮');

  // 4. 点击继续修改
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click(continueBtnSelector),
  ]);
  await new Promise(r => setTimeout(r, 2000));
  log('已进入会话页, URL=', page.url());

  // 5. 在输入框输入内容并发送
  const textareaSel = 'textarea';
  await page.waitForSelector(textareaSel, { timeout: 10000 });
  await page.click(textareaSel);
  // 清空预填内容再输入
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, textareaSel);
  await page.type(textareaSel, '把标题颜色改成红色');
  log('已输入消息');

  // 点发送按钮（btn-primary 且文本含"发送"）
  const sendClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const send = btns.find(b => b.textContent?.includes('发送') && !b.disabled);
    if (send) { send.click(); return true; }
    return false;
  });
  log('发送按钮点击:', sendClicked);

  // 等待 /api/chat 请求被捕获
  for (let i = 0; i < 20 && !chatRequestBody; i++) {
    await new Promise(r => setTimeout(r, 500));
  }

  log('=== 捕获到的所有 /api/chat* 请求 ===');
  for (const r of allChatReqs) {
    log(`  ${r.url} | keys=[${r.keys.join(',')}] | sessionId=${r.sessionId} | sourceVisualId=${r.sourceVisualId ?? '(无)'}`);
  }

  log('=== 主 POST /api/chat 请求体关键字段 ===');
  if (chatRequestBody) {
    log('  sessionId:', chatRequestBody.sessionId);
    log('  sourceVisualId:', chatRequestBody.sourceVisualId ?? '(缺失!)');
    log('  workspaceBootstrapFiles:', Array.isArray(chatRequestBody.workspaceBootstrapFiles)
      ? `${chatRequestBody.workspaceBootstrapFiles.length} 个文件` : '(无)');
  } else {
    log('  未捕获到 /api/chat 请求！');
  }

  // 6. 等一会让会话持久化，再查 DB
  await new Promise(r => setTimeout(r, 3000));
  const sid = chatRequestBody?.sessionId || '';

  console.log('\n=== 结论 ===');
  const expected = visual.id;
  const actual = chatRequestBody?.sourceVisualId;
  if (actual === expected) {
    console.log('✅ 前端正确传递了 sourceVisualId =', actual);
  } else {
    console.log('❌ 前端没有正确传递 sourceVisualId');
    console.log('   期望:', expected);
    console.log('   实际:', actual ?? '(缺失)');
  }
  // 把结果写出来给后续 DB 检查用
  console.log('SESSION_ID=' + sid);
  console.log('VISUAL_ID=' + visual.id);
} finally {
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
