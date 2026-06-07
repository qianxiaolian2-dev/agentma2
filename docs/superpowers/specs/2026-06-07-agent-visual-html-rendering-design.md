# AI 原生 ChatBI 地基(一):可视化渲染 + 产物生命周期 — 设计文档

- 日期:2026-06-07
- 范围:dashboard 前端 + 后端 + 一个内置 skill/agent 模版
- 状态:已确认设计,待写实现计划

## 0. 北极星与本轮边界

**北极星**:把 agent 输出展示能力做成一个 **AI 原生 ChatBI**——对话驱动 → agent 取数/分析 →
产出可交互可视化 → 沉淀为可分享链接。

**本轮只做地基的第一块:可视化「渲染」与产物「生命周期」。**
- 做:HTML 沙箱渲染基元、独立预览页、产物持久化(临时/已保存)、生命周期提醒 A/B/C/D、
  一个可视化 skill、一个 viz-agent 模版、用会话实测。
- **不做**:数据源接入(知识库/上传/外部 DB 取数)、ChatBI 连接器——留作后续迭代。

## 1. 背景

当前 agent 输出在 `dashboard/src/components/ChatMessageBubble.tsx` 以纯 markdown 渲染,
只能表达文本。我们要让 agent 能产出富可视化(图表/表格/思维导图/流程图/交互组件)。

经讨论确定的核心取向:
- **不引入可视化库**。模型最擅长写 HTML/CSS/SVG/JS,让 agent **直接产出 HTML**,浏览器原生渲染。
  **零新前端运行时依赖。**
- **不内联进对话**。可视化产物走**独立预览链接**:agent 在回复里给出一个 markdown 链接,
  现有 markdown 渲染器直接显示,**`ChatMessageBubble` 零改动**;点击打开独立预览页渲染。
- **产物有生命周期**:默认临时(带过期),用户可手动「保存」转为长期保留;并提供透明的提醒,
  避免"悄无声息被清理 / 被清理了不知道"。

## 2. 端到端流程

```
用户在 /conversations 用 viz-agent(挂 agentma-visual skill)对话
        │
        ▼ agent 按 skill 约定:
        │  1) 写可视化 HTML 到  ./viz/<id>.html  (id = <kebab-slug>-<6位随机>)
        │  2) 回复里给出 markdown 链接 [📊 标题(临时预览…)](/viz/<id>)  + 提醒A
        ▼
后端 /api/chat:本次 run 结束后,扫描 <cwd>/viz/*.html
        │  → upsert 到 SQLite visuals 表(status='temp', expiresAtMs=now+TTL,
        │     tenant/owner 取自 req.auth)
        ▼
用户点链接 → 独立预览页 /viz/<id>(AuthGuard 后)
        │  GET /api/visuals/<id> → { html, status, createdAt, expiresAtMs }
        ▼
   <VisualFrame html> 沙箱渲染 + 顶部状态横幅(提醒B:临时/已保存、倒计时、[保存])
   命中已清理 → 友好失效页(提醒C)
"我的可视化" /visuals 列表(提醒D):集中查看状态/剩余时间,可保存/删除
```

**为什么 id 由 agent 自选(slug+随机后缀)而非服务端生成**:`/api/chat`(`server.ts:1287`)
**收不到 dashboard 会话 id**,且若同步注册需把鉴权 token 注入沙箱(违背沙箱隔离原则,见
[[risk-runagent-settingsources-leak]])。让 agent 自选含随机后缀的 id,即可**先写文件、先给链接**,
服务端**run 结束后用 req.auth 上下文统一登记**——鉴权全在服务端,沙箱内不需要任何凭证或外联。

## 3. 渲染基元(前端,零新依赖)

### 3.1 `dashboard/src/components/artifacts/composeSrcdoc.ts`(纯函数,可无 DOM 断言)

```ts
export type VisualTheme = Record<string, string>; // CSS 变量名 -> 值 + 'font-family'
export function composeSrcdoc(html: string, theme: VisualTheme): string;
```

按顺序拼成一份完整文档:
1. `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;">`
   —— 禁外联(无 CDN/追踪);允许内联 style/script(交互所需);允许 `data:` 图片/字体。
2. **主题基样式**:把 `theme`(dashboard 设计变量:`--bg / --ink / --ink-secondary / --border /
   --accent / --bg-hover` 及 `font-family`,具体清单实现时对 `App.css` 核定)注入 iframe 内 `:root`
   + 基础 reset(`margin:0; color:var(--ink); background:transparent; font-family:…`),使可视化继承深色/浅色主题。
3. **模型 HTML**:若 `html` 以 `<!doctype`/`<html` 开头视为整篇,把样式与高度脚本注入 `</head>`;
   否则作为片段包进 `<body>`。
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
- 从 `document.documentElement` 读取 CSS 变量组成 `theme`,调用 `composeSrcdoc`。
- 渲染 `<iframe sandbox="allow-scripts" srcdoc={composed} referrerpolicy="no-referrer" />`
  —— **只给 `allow-scripts`,绝不给 `allow-same-origin`**(null origin,碰不到父页 DOM/cookie/会话);
  不给 `allow-forms/popups/top-navigation/modals`。
- `message` 监听:**校验 `e.source === iframeRef.current?.contentWindow` 且 `e.data?.__agentmaVisual`**
  (用 source 身份校验,不依赖 origin——null-origin 的 `e.origin==='null'`),取高度 clamp 到 24–4000px。
- 失败兜底:错误边界,降级显示原始 HTML 源码 `<pre>` + "无法渲染此可视化",不崩页面。

## 4. 持久化与生命周期(后端)

### 4.1 SQLite `visuals` 表(`server-store.ts`)

| 字段 | 说明 |
|---|---|
| `id` TEXT PK | agent 自选,`<slug>-<6位随机>`,全局唯一(随机后缀保证) |
| `tenant_id` / `owner_sub` | 取自 `req.auth`,访问按此隔离 |
| `title` | 服务端从 HTML `<title>`/首个 `<h1>` 提取,缺省用 slug |
| `html` | 可视化文档(TEXT) |
| `size_bytes` | 大小,受 `MAX_VISUAL_BYTES`(~2–4MB)上限约束 |
| `status` | `'temp'` \| `'saved'` |
| `created_at` / `expires_at_ms` | temp 行有过期;saved 行 `expires_at_ms=NULL` |
| `source_sdk_cwd` | 来源 workspace(诊断用) |

函数:`upsertVisual` / `getVisual` / `listVisuals` / `saveVisual`(temp→saved 且清过期) /
`deleteVisual` / `cleanupExpiredVisuals`(删 `status='temp' AND expires_at_ms<now`,
仿 `cleanupExpiredRunCwds` 的节流懒清理)。

常量:`MAX_VISUAL_BYTES`(仿 `MAX_SKILL_MD_BYTES` 风格)、`VISUAL_TEMP_TTL_MS`
(默认 7 天,与 workspace TTL 对齐,`AGENTMA_VISUAL_TTL_MS` 可覆盖)。

### 4.2 端点(`server.ts`,均 `authMiddleware`,tenant/owner 隔离)

- `GET /api/visuals` → 列表(提醒 D)
- `GET /api/visuals/:id` → `{ html, title, status, createdAt, expiresAtMs }`;不存在/过期 → 404(提醒 C 据此)
- `POST /api/visuals/:id/save` → temp→saved
- `DELETE /api/visuals/:id`
- **改 `/api/chat`**:`const result = await runAgent(...)` 捕获 `result.sdkCwd`;run 结束后扫描
  `<cwd>/viz/*.html`(数量/大小上限、路径越界保护),`upsertVisual(status:'temp')`。
  跳过已存在且内容未变者。**无 register 端点、沙箱内无需鉴权或外联。**

> 说明:这等价于"workspace 中转 + 手动持久化"的意图,但"临时"用 **DB temp 行**实现而非
> /tmp 文件——链接稳定不依赖会话 id、不随 /tmp 重启失效,更稳健。workspace 仅作 agent 起草处。

## 5. 预览页与列表页(前端路由)

### 5.1 `dashboard/src/pages/VizPreview.tsx` — 路由 `/viz/:id`(AuthGuard 后)
- 拉 `GET /api/visuals/:id` → `<VisualFrame html>` 整页渲染。
- **顶部状态横幅(提醒 B)**:`临时`/`已保存` 徽章;若临时:"创建于 X · 约 N 后清理"(由
  `expiresAtMs` 算)+ **[保存]** 按钮(`POST .../save`,成功后徽章转 `已保存`、倒计时消失)。
- **失效页(提醒 C)**:404 时显示友好说明——"此可视化已被回收:临时产物默认 7 天 TTL /
  机器重启清空 /SQLite 清理 → 失效"+ "回到对话重新生成"指引,而非裸 404。

### 5.2 `dashboard/src/pages/Visuals.tsx` — 路由 `/visuals`(提醒 D)
- `GET /api/visuals` 列表:标题、状态、创建时间、临时项剩余时间;行内 [打开]/[保存]/[删除]。
- 侧栏(`Sidebar.tsx`)加入口"我的可视化"。

### 5.3 路由注册:`App.tsx` 加 `/viz/:id`、`/visuals`。**`ChatMessageBubble.tsx` 不改。**

## 6. Skill 与 Agent 模版

### 6.1 skill:`agentma-visual`(`~/.claude/skills/agentma-visual/SKILL.md`)
教模型(无需脚本):
- **何时用**:输出图表/对比/层级/流程/统计等结构化信息时,优先产出可视化而非纯文本。
- **怎么产出**:
  1. 选 `id = <kebab-slug>-<6位随机字母数字>`;
  2. 用 `Write` 把可视化 HTML 写到 `./viz/<id>.html`(片段或整篇均可);
  3. 回复里给出链接:`[📊 <标题>(临时预览,默认7天后清理、可在预览页点「保存」长期保留)](/viz/<id>)`(**提醒 A**)。
- **HTML 编写约定**(即导出常量 `VISUAL_PROTOCOL_DOC` 的内容,SKILL.md 内嵌):
  CSP 禁外联→只用内联 style/SVG/inline JS、`data:` 图片;用提供的 CSS 变量(`--ink/--accent/…`)继承主题;
  不要引用 CDN/外链;HTML 内含 `<title>` 便于服务端提取标题。

### 6.2 viz-agent 模版(仿 `wiki-agent`,见 `Knowledge.tsx:517`)
- `id:'viz-agent'`,`skills:['agentma-visual']`,systemPrompt 说明"你是可视化助手,
  善用 agentma-visual skill 把内容做成可视化并给出预览链接"。
- 作为**默认模版**种子化(供各租户可见);本轮不建专用触发页,直接在 `/conversations` 选它对话即可。
  (将来任何页面可仿 wiki 的 `navigate('/conversations?agent=viz-agent&draft=…')` 拉起它——统一 `AgentTemplate` 接口。)

## 7. 文件清单

新增:
- `dashboard/src/components/artifacts/composeSrcdoc.ts`
- `dashboard/src/components/artifacts/VisualFrame.tsx`
- `dashboard/src/pages/VizPreview.tsx`
- `dashboard/src/pages/Visuals.tsx`
- `dashboard/scripts/smoke-visuals.mjs`(composeSrcdoc/CRUD/清理冒烟)
- skill:`~/.claude/skills/agentma-visual/SKILL.md`(+ 导出常量 `VISUAL_PROTOCOL_DOC` 可放 `dashboard/src/utils/visual-protocol.ts` 供前后端共享文案)

修改:
- `dashboard/server-store.ts`(visuals 表 + 函数)
- `dashboard/server.ts`(端点 + `/api/chat` 扫描登记)
- `dashboard/src/App.tsx`(路由)、`dashboard/src/components/Sidebar.tsx`(入口)
- viz-agent 默认模版的种子(位置实现时定:server 端 seed 或模版默认集)

依赖变更:**无前端运行时新依赖。**

## 8. 测试与验证(尊重"少引入模块",沿用 `scripts/smoke-*.mjs`)
- `smoke-visuals.mjs`:`composeSrcdoc` 含 CSP/主题/高度脚本、片段与整篇两种输入;
  visuals 表 upsert/get/list/save/cleanup;过期清理只删 temp。
- **安全回归(关键)**:断言 `VisualFrame` 生成的 iframe `sandbox` **含 `allow-scripts` 且不含
  `allow-same-origin`**;`composeSrcdoc` 输出含 CSP meta。
- **手动端到端**:用 viz-agent 开会话 → 让它做一张图 → 点链接看预览/主题/高度自适应 →
  点[保存]→ 列表页查状态 →(临时调小 TTL)验证过期与失效页。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 渲染模型 HTML 的 XSS | 沙箱 iframe 无 `allow-same-origin`(null origin)+ CSP 禁外联 + 安全回归断言 |
| 沙箱内鉴权/外联泄漏 | 不在沙箱内调 API;登记全在服务端 run 结束后用 `req.auth` 完成 |
| id 可猜测(枚举) | 随机后缀 + `GET /api/visuals/:id` 按 tenant/owner 鉴权;跨租户不可见 |
| 大 HTML 撑爆 DB | `MAX_VISUAL_BYTES` 上限;超限拒绝并提示 agent 精简数据 |
| 临时产物悄悄丢失 | 提醒 A/B/C/D:产出即告知、预览页倒计时+保存、失效页解释、列表页集中管理 |
| "可分享"跨用户 | 本轮按 tenant 鉴权可见;真正公开链接(不可猜 share token)留作后续 |

## 10. 非目标
- 不做数据源/取数连接器(ChatBI 下一块地基)。
- 不在对话内联渲染可视化;不改 `ChatMessageBubble`。
- 不做公开(免登录)分享链接。
- 不引入前端可视化库或测试框架。
