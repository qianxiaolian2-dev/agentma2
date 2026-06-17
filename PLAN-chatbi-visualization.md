# 实现计划:ChatBI 地基(一)可视化渲染 + 产物生命周期

- 配套 spec:`docs/superpowers/specs/2026-06-07-agent-visual-html-rendering-design.md`
- 执行方式:按阶段顺序实现;每阶段末有「验收」。前端改 `dashboard/src`,后端改 `dashboard/server*.ts`。
- 硬约束(务必遵守):
  - iframe **只给 `sandbox="allow-scripts"`,绝不加 `allow-same-origin`**。
  - **不改 `dashboard/src/components/ChatMessageBubble.tsx`**。
  - 临时产物**不进 DB、不建 TTL 任务**;SQLite 只存"已保存"。
  - 不新增前端运行时依赖、不引测试框架。

---

## 阶段 1:后端持久化 + 端点

### 1.1 `dashboard/server-store.ts` — `visuals` 表 + 函数
- 建表(随其他建表逻辑一处,better-sqlite3):
  ```sql
  CREATE TABLE IF NOT EXISTS visuals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    owner_sub TEXT NOT NULL,
    title TEXT,
    html TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    source_slug TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visuals_owner ON visuals(tenant_id, owner_sub, created_at DESC);
  ```
- 导出函数:
  - `createVisual(tenantId, ownerSub, { title, html, sourceSlug }) -> { id }`(`id = crypto.randomUUID()`,`size_bytes = Buffer.byteLength(html)`,`created_at = Date.now()`)
  - `getVisual(tenantId, ownerSub, id) -> row | null`
  - `listVisuals(tenantId, ownerSub) -> Array<{id,title,createdAt,sizeBytes}>`(不含 html)
  - `deleteVisual(tenantId, ownerSub, id) -> boolean`
- 常量:`export const MAX_VISUAL_BYTES = 4 * 1024 * 1024;`

### 1.2 `dashboard/server.ts` — 工具函数:cid→sdkCwd 安全读 workspace 文件
- 新增 helper(复用 `server.ts:199` 的 `isPathInside`、`server-store.ts:2476` 的 `getChatSession`):
  ```ts
  function readWorkspaceVisual(tenantId, ownerSub, cid, relPath) {
    const session = getChatSession(tenantId, ownerSub, cid);
    if (!session?.sdkCwd) throw makeHttpError('该对话没有 workspace', 404);
    if (!/^viz\/[A-Za-z0-9._-]+\.html$/.test(relPath)) throw makeHttpError('非法路径', 400); // 限定 viz/ 下、文件名白名单
    const cwd = fs.realpathSync(path.resolve(expandLocalPath(session.sdkCwd)));
    const file = path.resolve(cwd, relPath);
    if (!isPathInside(file, cwd)) throw makeHttpError('路径越界', 400);
    if (!fs.existsSync(file)) throw makeHttpError('文件不存在', 404);
    const stat = fs.statSync(file);
    if (stat.size > MAX_VISUAL_BYTES) throw makeHttpError('文件过大', 413);
    return { html: fs.readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs };
  }
  ```
- 标题提取 helper:`extractTitle(html)` = `<title>` 内容 → 否则首个 `<h1>` 文本 → 否则 undefined。

### 1.3 `dashboard/server.ts` — 端点(均 `authMiddleware`,用 `req.auth.tenantId` / `req.auth.sub`)
- `GET /api/visuals/file?cid=&path=` → `readWorkspaceVisual` → `{ html, mtimeMs }`(出错按 helper 的 http code)
- `POST /api/visuals` body `{ cid, path, title? }` → `const { html } = readWorkspaceVisual(...)` →
  `MAX_VISUAL_BYTES` 校验 → `createVisual(tenantId, sub, { title: title || extractTitle(html), html, sourceSlug: path })` → `{ id }`
- `GET /api/visuals/:id` → `getVisual` → `{ id, title, html, createdAt }`;null → 404
- `GET /api/visuals` → `listVisuals`
- `DELETE /api/visuals/:id` → `deleteVisual` → `{ ok: true }`

### 1.4 `dashboard/server.ts` — `/api/chat` 注入预览基址
- 在 `app.post('/api/chat', ...)`(`server.ts:1287`)读取:`const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';`
- 若 `sessionId`,把一行拼进 `effectiveSystemPrompt`(在调用 `runAgent` 前):
  ```
  [可视化预览] 用 agentma-visual skill 产出可视化时,把 HTML 写到 ./viz/<slug>.html,
  并给用户这个 markdown 链接:/viz?cid=<sessionId>&path=viz/<slug>.html
  ```
  (用实际 `sessionId` 值替换)
- **不做任何 run 后扫描。**

**验收 1**:`curl --noproxy '*'`(见 [[gotcha-local-proxy]])手测:对一个已有 sdkCwd 的会话手动在其 cwd 放 `viz/t.html`,`GET /api/visuals/file?cid=&path=viz/t.html` 返回 html;`POST /api/visuals` 返回 id;`GET /api/visuals/:id` 取回;`GET /api/visuals` 列出;`DELETE` 删除。越界/非法 path 返回 4xx。

---

## 阶段 2:前端渲染基元(零依赖)

### 2.1 `dashboard/src/components/artifacts/composeSrcdoc.ts`(纯函数)
```ts
export type VisualTheme = Record<string, string>;
export function composeSrcdoc(html: string, theme: VisualTheme): string;
```
- 输出顺序:CSP meta → `<style>:root{ <theme 变量> } *{box-sizing:border-box} html,body{margin:0;color:var(--ink);background:transparent;font-family:var(--font-family)}</style>` → 模型 HTML(整篇 vs 片段判定见 spec §3.1.3)→ 高度脚本(spec §3.1.4)。
- CSP 固定为 spec §3.1.1 那串。
- theme 变量名:`--bg --ink --ink-secondary --border --accent --bg-hover` + `font-family`(执行时对 `dashboard/src/App.css` 核对实际变量名,缺的略过)。

### 2.2 `dashboard/src/components/artifacts/VisualFrame.tsx`
- props `{ html: string }`;`useRef` iframe、`useState` height(初始 160)。
- 进入时 `getComputedStyle(document.documentElement)` 读上面变量组成 `theme`,`useMemo(() => composeSrcdoc(html, theme), [html])`。
- 渲染:`<iframe ref sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={composed} style={{width:'100%',height,border:0}} />`
- `useEffect`:`window.addEventListener('message', onMsg)`;`onMsg`:`if (e.source === ref.current?.contentWindow && e.data?.__agentmaVisual) setHeight(clamp(e.data.h, 24, 4000))`;cleanup 移除。
- 错误边界:用一个本地 `class ErrorBoundary` 包住,fallback 显示 `<pre>{html}</pre>` + "无法渲染此可视化"。

**验收 2**:`composeSrcdoc('<h1>hi</h1>', {...})` 字符串含 CSP meta、`:root` 变量、`<h1>hi`、高度脚本;整篇输入(`<!doctype html>…`)不被二次包裹。

---

## 阶段 3:前端页面 + 路由

### 3.1 `dashboard/src/pages/VizPreview.tsx` — 路由 `/viz`
- 读 `useSearchParams`:`id` 或 `cid`+`path`。
- 取数:`id` → `GET /api/visuals/:id`;否则 → `GET /api/visuals/file?cid=&path=`(用 `getAuthHeaders()`)。
- 成功:顶部状态横幅 + `<VisualFrame html={html} />`。
  - 横幅:`id` 来源 → 徽章「已保存」;`cid/path` 来源 → 徽章「临时」+ **[保存]** 按钮。
  - [保存]:`POST /api/visuals {cid, path}` → 成功 `navigate('/viz?id='+id, {replace:true})`。
- 失败(4xx/网络)→ 失效页(spec §5.1 提醒 C):标题"此临时可视化已失效",正文"沙箱已清理/重启/会话删除导致;代码与技能都在,回对话重跑即可",一个返回 `/conversations` 的链接。

### 3.2 `dashboard/src/pages/Visuals.tsx` — 路由 `/visuals`
- `GET /api/visuals` 列表;每行 标题(无则"未命名")、创建时间、[打开](`/viz?id=`)、[删除](`DELETE` 后刷新)。空态友好提示。

### 3.3 路由 + 入口
- `dashboard/src/App.tsx`:在内层 `<Routes>`(`App.tsx:30-46`)加 `<Route path="/viz" element={<VizPreview/>} />` 和 `<Route path="/visuals" element={<Visuals/>} />`。
- `dashboard/src/components/Sidebar.tsx`:第一组(用户向,`Sidebar.tsx:11`)加 `{ path: '/visuals', label: '我的可视化', icon: 'chart' }`(`icon` 用现有 `LineIconName`,没有合适的就复用 `'spark'`/`'chart'`)。

**验收 3**:`/visuals` 能开;手动构造 `/viz?id=<阶段1存的>` 能渲染;`/viz?cid=&path=` 临时能渲染并能[保存]跳到 `?id=`;乱填 id 进失效页。

---

## 阶段 4:客户端传 sessionId
- `dashboard/src/pages/Conversations.tsx` 的 `/api/chat` 请求体(`Conversations.tsx:330`)加一行:`sessionId: activeSessionId || undefined,`(`activeSessionId` 见 `:154`,发送路径 `:317` 已先 persist)。
- 另外两处 `/api/chat` 调用(`Conversations.tsx:978`、`AgentChat.tsx:365`)按需同样补 `sessionId`(若它们也要支持可视化预览;AgentChat 没有 dashboard session 概念则略过)。

**验收 4**:发消息时 Network 里 `/api/chat` body 含 `sessionId`;服务端日志/行为确认 effectiveSystemPrompt 注入了预览基址。

---

## 阶段 5:Skill + Agent 模版

### 5.1 `~/.claude/skills/agentma-visual/SKILL.md`
- frontmatter:`name: agentma-visual`、`description:` 说明"把内容渲染成可视化 HTML 并给预览链接"。
- 正文(= spec §6.1,即 `VISUAL_PROTOCOL_DOC`):何时用;三步(选 slug → `Write` 到 `./viz/<slug>.html` → 给链接,链接前缀用服务端注入的预览基址,并附"临时,未保存重启/换天需回对话重跑;预览页可点保存"提醒);HTML 编写约定(CSP 禁外联→内联 style/SVG/inline JS、`data:` 图片;用 `--ink/--accent` 等变量继承主题;含 `<title>`)。
- 给 1-2 个示例(一张内联 SVG 柱状图、一张 `<table>`)。

### 5.2 viz-agent 模版(仿 `ensureWikiAgentTemplate`,`Knowledge.tsx:517`)
- 新增 `ensureVizAgentTemplate()`(可放 `dashboard/src/utils/agent-templates.ts` 或 Conversations 内),
  确保存在 `{ id:'viz-agent', name:'可视化助手', skills:['agentma-visual'], systemPrompt:'你是可视化助手…善用 agentma-visual skill 把内容做成可视化并给出预览链接', tools: 默认含 Write/Read/Bash }`。
- 在 `/conversations` 加载时调用一次(或放进默认模版集),使其出现在 agent 选择器。

**验收 5**:技能背包/Agent 列表能看到;`/conversations` 可选 viz-agent。

---

## 阶段 6:测试 + 端到端验证

### 6.1 `dashboard/scripts/smoke-visuals.mjs`(沿用既有 smoke 风格)
- `composeSrcdoc`:含 CSP/主题/高度脚本;片段被包、整篇不被二次包。
- 安全断言:从 `VisualFrame` 取(或单独导出常量)确认 sandbox 串 = `allow-scripts` 且**不含** `allow-same-origin`。
- visuals 表 CRUD(可用临时 sqlite 或 mock)。

### 6.2 手动端到端(see [[gotcha-local-proxy]] 用 `--noproxy`)
viz-agent 开会话 → "把这三个季度营收做成柱状图" → agent 写 `viz/*.html` + 给链接 → 点链接看渲染/深色主题/高度自适应 → [保存] → `/visuals` 查到 → `/viz?id=` 打开 → 删除 → 关会话/改 cwd 后点旧临时链接进失效页。

---

## 执行顺序与交付
阶段 1 → 2 → 3 → 4 → 5 → 6。每阶段过验收再下一阶段。完成后我(Claude)按 spec + 本计划逐项 verify。
按 [[feedback-workflow-plan-then-handoff]]:本计划交 GPT 执行,我负责计划与验证。
