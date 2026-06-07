# AI 原生 ChatBI 地基(一):可视化渲染 + 产物生命周期 — 设计文档

- 日期:2026-06-07
- 范围:dashboard 前端 + 后端 + 一个内置 skill/agent 模版
- 状态:已确认设计,待写实现计划

## 0. 北极星与本轮边界

**北极星**:把 agent 输出展示能力做成 **AI 原生 ChatBI**——对话驱动 → 取数/分析 →
可交互可视化 → 沉淀为可分享链接。

**本轮只做地基第一块:可视化「渲染」与产物「生命周期」。**
- 做:HTML 沙箱渲染基元、独立预览页、已保存产物持久化、生命周期提醒 A/B/C/D、
  一个 agentma-visual skill、一个 viz-agent 模版、用会话实测。
- **不做**:数据源接入(知识库/上传/外部 DB 取数)——留作后续迭代。

## 1. 核心取向(经讨论确定)

- **不引入可视化库**。模型最擅长写 HTML/CSS/SVG/JS,让 agent **直接产出 HTML**,浏览器原生渲染。
  **零新前端运行时依赖**(放弃 markmap/recharts/mermaid)。
- **不内联进对话、不改 `ChatMessageBubble`**。可视化走**独立预览链接**:agent 在回复里给出一个
  markdown 链接,现有 markdown 渲染器直接显示;点击打开独立预览页渲染。
- **两种状态,各归各位**(关键简化,源于"没保存就别久存,代码/技能都在、重跑即可"):
  - **未保存(临时)= 只活在 workspace 文件里**,随沙箱生命周期自然消失。**不进 DB、无任何平行 TTL 任务**。
    没了就回对话重跑(便宜、本应如此)。
  - **已保存 = 落 SQLite `visuals`**,稳定、永久、可分享。**持久库只装用户主动留下的东西**。

## 2. 端到端流程

```
用户在 /conversations 用 viz-agent(挂 agentma-visual skill)对话
        │  客户端 body 带上 sessionId=activeSessionId(已在发送前 persist)
        ▼ 服务端 /api/chat 把"预览基址 /viz?cid=<sessionId>&path=" 注入 agent 上下文
        ▼ agent 按 skill 约定:
        │  1) 用 Write 把可视化 HTML 写到  ./viz/<slug>.html
        │  2) 回复里给链接 [📊 标题(临时预览,未保存重启/换天需回对话重跑)](/viz?cid=<sid>&path=viz/<slug>.html) (提醒A)
        ▼
用户点链接 → 独立预览页 /viz(AuthGuard 后)
   ├─ 临时: ?cid&path → GET /api/visuals/file 解析 cid→sdkCwd 读 workspace 文件 → 渲染 + [保存](提醒B)
   │        读不到(沙箱已清/重启/会话删) → 失效页"回对话重跑"(提醒C)
   └─ 已保存: ?id → GET /api/visuals/:id 读 SQLite → 渲染
[保存] = POST /api/visuals {cid,path} → 服务端读 workspace 文件存为 saved 行 → 跳 /viz?id=<新id>
"我的可视化" /visuals 列表(提醒D)= 只列已保存,可打开/删除
```

> 关于会话 id:`/api/chat`(`server.ts:1287`)当前不收会话 id,但客户端手里就有
> `activeSessionId`(`Conversations.tsx:154/317`,发送前已 persist)。body 加一行 + 服务端读一行即可
> ——非"一堆管道"。sdkCwd 在首次 run 完成后写入 `chat_sessions.sdk_cwd`,用户在消息完成后点链接时可解析。

## 3. 渲染基元(前端,零新依赖)

### 3.1 `dashboard/src/components/artifacts/composeSrcdoc.ts`(纯函数,可无 DOM 断言)

```ts
export type VisualTheme = Record<string, string>; // CSS 变量名 -> 值,含 'font-family'
export function composeSrcdoc(html: string, theme: VisualTheme): string;
```
按顺序拼成完整文档:
1. `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;">`
   —— 禁外联;允许内联 style/script(交互所需)、`data:` 图片/字体。null-origin 沙箱下 `'unsafe-inline'` 风险可接受。
2. **主题基样式**:把 `theme`(dashboard 设计变量 `--bg/--ink/--ink-secondary/--border/--accent/--bg-hover`
   及 `font-family`,实现时对 `App.css` 核定)注入 iframe 内 `:root` + 基础 reset
   (`margin:0; color:var(--ink); background:transparent; font-family:…`)。
3. **模型 HTML**:以 `<!doctype`/`<html` 开头视为整篇(把样式/高度脚本注入 `</head>`);否则作片段包进 `<body>`。
4. **自适应高度脚本**(内联):
   ```html
   <script>
     function post(){ parent.postMessage({__agentmaVisual:1, h:document.documentElement.scrollHeight}, '*'); }
     window.addEventListener('load', post);
     if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement);
   </script>
   ```

### 3.2 `dashboard/src/components/artifacts/VisualFrame.tsx`
```ts
type VisualFrameProps = { html: string };
```
- 从 `document.documentElement` 读 CSS 变量组 `theme`,调 `composeSrcdoc`。
- `<iframe sandbox="allow-scripts" srcdoc={composed} referrerpolicy="no-referrer" />`
  —— **只给 `allow-scripts`,绝不给 `allow-same-origin`**(null origin,碰不到父页 DOM/cookie/会话);
  不给 `allow-forms/popups/top-navigation/modals`。
- `message` 监听:**校验 `e.source === iframeRef.current?.contentWindow` 且 `e.data?.__agentmaVisual`**
  (source 身份校验,不依赖 origin),取高度 clamp 24–4000px。
- 失败兜底:错误边界 → 降级显示原始 HTML 源码 `<pre>` + "无法渲染",不崩页面。

## 4. 后端

### 4.1 SQLite `visuals` 表(`server-store.ts`,只存已保存)

| 字段 | 说明 |
|---|---|
| `id` TEXT PK | 保存时服务端生成(随机,不可猜) |
| `tenant_id`/`owner_sub` | 取自 `req.auth`,访问按此隔离 |
| `title` | 服务端从 HTML `<title>`/首个 `<h1>` 提取,缺省用 slug |
| `html` | 文档(TEXT) |
| `size_bytes` | 受 `MAX_VISUAL_BYTES`(~2–4MB,仿 `MAX_SKILL_MD_BYTES` 风格)上限约束 |
| `created_at` | 创建时间 |
| `source_slug` | 来源 workspace 文件名(诊断用) |

函数:`createVisual` / `getVisual` / `listVisuals` / `deleteVisual`。**无 temp 行、无 TTL 清理任务。**

### 4.2 端点(`server.ts`,均 `authMiddleware`,tenant/owner 隔离)
- `GET /api/visuals/file?cid=&path=` → 解析 cid→session→`sdk_cwd`(tenant/owner 校验),
  安全读 `<cwd>/<path>`(`path` 限定在 `viz/` 下、`isPathInside` 防越界)→ `{ html, exists, mtimeMs }`。
  复用 `server.ts:491` 处"由 session 解析 sdkCwd"的既有模式。
- `POST /api/visuals` body `{cid, path, title?}` → 服务端按上法读 workspace 文件 → `createVisual`(saved)→ `{id}`。
- `GET /api/visuals/:id` → `{ html, title, createdAt }`;不存在 → 404(失效页据此)。
- `GET /api/visuals` → 已保存列表(提醒 D)。
- `DELETE /api/visuals/:id`。
- **改 `/api/chat`**:读 `req.body.sessionId`;若有,则把一行"可视化预览基址:`/viz?cid=<sessionId>&path=`(把写到 `./viz/<slug>.html` 的文件按此拼成链接给用户)"注入 `effectiveSystemPrompt`。**不做任何 run 后扫描。**

## 5. 预览页与列表页(前端路由)

### 5.1 `dashboard/src/pages/VizPreview.tsx` — 路由 `/viz`(AuthGuard 后,单页处理两种来源)
- `?id` → `GET /api/visuals/:id`;`?cid&path` → `GET /api/visuals/file`。→ `<VisualFrame html>` 整页渲染。
- **状态横幅(提醒 B)**:`临时`/`已保存` 徽章。临时时显示 [保存] 按钮(`POST /api/visuals` → 成功后
  `replace` 到 `/viz?id=<新id>`,徽章转 `已保存`)。不做精确倒计时(临时寿命=沙箱)。
- **失效页(提醒 C)**:file 读不到 / :id 404 → 友好说明"此临时可视化已失效(沙箱已清理/重启/会话删除);
  代码与技能都在,回对话重跑即可"+ 返回对话指引,而非裸 404。

### 5.2 `dashboard/src/pages/Visuals.tsx` — 路由 `/visuals`(提醒 D)
- `GET /api/visuals` 列出**已保存**项:标题、创建时间;行内 [打开]/[删除]。侧栏(`Sidebar.tsx`)加入口"我的可视化"。

### 5.3 路由注册:`App.tsx` 加 `/viz`、`/visuals`。**`ChatMessageBubble.tsx` 不改。**

## 6. Skill 与 Agent 模版

### 6.1 skill:`agentma-visual`(`~/.claude/skills/agentma-visual/SKILL.md`,无需脚本)
- **何时用**:输出图表/对比/层级/流程/统计等结构化信息时,优先产出可视化。
- **怎么做**:① 选 `slug`(kebab);② `Write` 写 HTML 到 `./viz/<slug>.html`;
  ③ 回复给链接 `[📊 <标题>(临时预览,未保存重启/换天需回对话重跑;预览页可点「保存」长期保留)](<预览基址>viz/<slug>.html)`(提醒 A)——预览基址由服务端注入。
- **HTML 编写约定**(即 `VISUAL_PROTOCOL_DOC` 内容,内嵌 SKILL.md):CSP 禁外联 → 只用内联 style/SVG/inline JS、`data:` 图片;
  用提供的 CSS 变量继承主题;不引 CDN/外链;含 `<title>` 便于服务端提取标题。

### 6.2 viz-agent 模版(仿 `wiki-agent`,见 `Knowledge.tsx:517`)
- `id:'viz-agent'`,`skills:['agentma-visual']`,systemPrompt 说明"你是可视化助手,善用 agentma-visual skill
  把内容做成可视化并给出预览链接"。作为**默认模版**种子化(供各租户可见);本轮不建专用触发页,直接在
  `/conversations` 选它对话。将来任何页面可仿 wiki `navigate('/conversations?agent=viz-agent&draft=…')` 拉起——统一 `AgentTemplate` 接口。

## 7. 文件清单
新增:
- `dashboard/src/components/artifacts/composeSrcdoc.ts`
- `dashboard/src/components/artifacts/VisualFrame.tsx`
- `dashboard/src/pages/VizPreview.tsx`
- `dashboard/src/pages/Visuals.tsx`
- `dashboard/scripts/smoke-visuals.mjs`
- `~/.claude/skills/agentma-visual/SKILL.md`(+ 可选 `dashboard/src/utils/visual-protocol.ts` 共享文案常量)

修改:
- `dashboard/server-store.ts`(visuals 表 + 函数)
- `dashboard/server.ts`(端点 + `/api/chat` 注入预览基址)
- `dashboard/src/pages/Conversations.tsx`(body 加 `sessionId: activeSessionId`)
- `dashboard/src/App.tsx`(路由)、`dashboard/src/components/Sidebar.tsx`(入口)
- viz-agent 默认模版种子(位置实现时定)

依赖变更:**无前端运行时新依赖。**

## 8. 测试与验证(沿用 `scripts/smoke-*.mjs`,不引测试框架)
- `smoke-visuals.mjs`:`composeSrcdoc` 含 CSP/主题/高度脚本、片段与整篇两种输入;visuals 表 CRUD。
- **安全回归(关键)**:断言 `VisualFrame` iframe `sandbox` **含 `allow-scripts` 且不含 `allow-same-origin`**;
  `composeSrcdoc` 输出含 CSP meta。
- **手动端到端**:viz-agent 开会话 → 让它做一张图 → 点临时链接看预览/主题/高度自适应 → [保存] →
  `/visuals` 列表查到 → 用 `/viz?id=` 打开 → 删除 → 验证失效页(关掉会话/改 cwd 后点临时链接)。

## 9. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 渲染模型 HTML 的 XSS | 沙箱 iframe 无 `allow-same-origin`(null origin)+ CSP 禁外联 + 安全回归断言 |
| 读 workspace 文件越权/穿越 | cid→session 按 tenant/owner 校验;`path` 限定 `viz/` + `isPathInside` 防越界 |
| 大 HTML 撑爆 DB | 仅"保存"时入库,受 `MAX_VISUAL_BYTES` 上限;超限拒绝并提示精简 |
| 临时产物失效让用户困惑 | 提醒 A/B/C/D:产出即告知、预览页可保存、失效页指引重跑、列表页管已保存 |
| 已保存链接"可分享" | 本轮按 tenant 鉴权可见;真正公开(免登录)链接留作后续 |

## 10. 非目标
- 不做数据源/取数连接器(下一块地基)。
- 不在对话内联渲染、不改 `ChatMessageBubble`。
- 不为临时产物建 DB 或 TTL 任务(沙箱生命周期即其寿命)。
- 不做公开免登录分享链接;不引前端可视化库或测试框架。
