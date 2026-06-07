# Agent 友好的 HTML 可视化渲染基元 — 设计文档

- 日期:2026-06-07
- 范围:dashboard 前端
- 状态:已确认设计,待写实现计划

## 1. 背景与目标

当前 agent 的输出在 `dashboard/src/components/ChatMessageBubble.tsx` 中以纯 markdown
字符串渲染(`marked`),只能表达文本、列表、代码、图片。我们希望**拓展 agent 输出结果的展示能力**,
让 agent 能产出富可视化内容(思维导图、图表、表格、流程图/时间线,以及任意交互小组件)。

### 设计取向(经讨论确定)

- **不引入可视化库**(放弃 markmap/recharts/mermaid)。模型最擅长写 HTML/CSS/SVG,
  让 agent **直接产出 HTML**,浏览器原生渲染,这才是真正的 "agent 友好",且表达力无上限。
- 核心工程从 "集成多个渲染库 + 设计 JSON 协议" 转为 **"做一个安全的 HTML 渲染宿主(沙箱 iframe)"**。
- **零新运行时依赖。**

### 本次范围(明确)

只做**渲染基元层**:产出约定 + 解析器 + `VisualFrame` 沙箱宿主 + `ChatMessageBubble` 接入。
**不**写任何 `SKILL.md`、**不**建可视化 agent 模版(留到以后)。但产出约定要被沉淀成一个可复用常量,
作为将来做 skill 时直接可用的资产。

### 非目标

- 不做 skill 文件,不做 agent 模版。
- 不改服务端输出管道(`server-agent.ts`):artifact 走现有文本流,无需新协议字段。
- 不支持流式中途渲染可视化(见 §6)。
- 不允许 iframe 联网加载外部资源(CSP 禁外联;若将来需要 CDN 库再单独评估)。

## 2. 总体架构

```
agent 文本流 ──► message.content (字符串, 内含 agentma-visual 围栏块)
                      │  (仅在 message 完成后)
                      ▼
              parseSegments(content)
                      │  有序切段
        ┌─────────────┴──────────────┐
        ▼                            ▼
  {kind:'markdown'}            {kind:'visual', html}
   marked → HTML                <VisualFrame html=.../>
                                   sandbox iframe (null origin)
```

## 3. 产出约定(Agent 友好的协议)

agent 在正常文本里输出一个带**专用语言标签**的围栏块。用专用标签 `agentma-visual`
(而非裸 ```` ```html ````)以区分 "渲染这段" 与 "展示 HTML 源码":

````markdown
这是对比分析:

```agentma-visual
<div style="font-family:inherit">
  <h3>季度营收</h3>
  <svg width="100%" height="160">…</svg>
</div>
```

如上所示……
````

约定要点:

- 模型只需写**片段**(body 内容,可含 `<style>` / `<script>`),宿主自动包成完整文档并注入主题。
- 也兼容模型直接写整篇 `<!DOCTYPE html>` / `<html>`(见 §5 检测逻辑)。
- 一条消息里可有**多个** `agentma-visual` 块,与散文任意穿插,按出现顺序渲染。
- 标签常量:`VISUAL_FENCE_TAG = 'agentma-visual'`。

### 协议文档资产

导出常量 `VISUAL_PROTOCOL_DOC: string`(协议说明 + 每类用法的简短示例:思维导图用嵌套列表/SVG、
图表用内联 SVG 或 canvas+JS、表格用 `<table>`、流程图用 SVG)。这是留给**将来做 skill** 的现成资产
——届时直接把这段塞进 `SKILL.md` 或系统提示即可,本次不创建 skill。

## 4. 解析器 `dashboard/src/utils/visual-artifacts.ts`(纯函数,无 DOM 依赖)

```ts
export const VISUAL_FENCE_TAG = 'agentma-visual';

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'visual'; html: string };

/** 把消息正文按出现顺序切成 markdown 段与 visual 段。
 *  仅识别**已闭合**的 ```agentma-visual ... ``` 块;未闭合的尾块留作 markdown。 */
export function parseSegments(content: string): Segment[];

export const VISUAL_PROTOCOL_DOC: string;
```

行为:

- 用全局正则匹配 ```` ```agentma-visual\n …非贪婪… \n``` ````,提取块内 HTML;块之间/前后的文本作为 markdown 段。
- **只有闭合块**才算 visual 段;尾部未闭合块(流式中常见)整体作为 markdown 段,避免半截 HTML。
- 连续相邻的 markdown 文本合并为一个段;空 markdown 段丢弃。
- 已知限制:若模型在 HTML 内写出独立成行的 ```` ``` ````,可能提前截断——在 `VISUAL_PROTOCOL_DOC`
  中提示模型不要这样写;此为可接受风险。

## 5. 宿主组件 `dashboard/src/components/artifacts/VisualFrame.tsx`(安全是核心)

```ts
type VisualFrameProps = { html: string };
```

### 5.1 沙箱与隔离(关键安全约束)

- `<iframe sandbox="allow-scripts" srcdoc={composed} />`
- **只给 `allow-scripts`,绝不给 `allow-same-origin`** → iframe 处于 null origin,
  碰不到父页 DOM / cookie / localStorage / 后端会话。
- 不给 `allow-forms` / `allow-popups` / `allow-top-navigation` / `allow-modals`。
- `referrerpolicy="no-referrer"`。

### 5.2 srcdoc 组装(`composeSrcdoc(html, theme)`,纯函数)

`VisualFrame` 负责从父页 `document.documentElement` 读取 CSS 变量,组成 `theme` 对象;
实际拼装由纯函数 `composeSrcdoc(html, theme)` 完成(无 DOM 依赖,便于断言测试)。
`composed` 按顺序拼:

1. `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;">`
   —— 禁外联(无 CDN/无追踪);允许内联 style/script(模型交互所需);允许 data: 图片/字体。
   因 iframe 已是 null-origin 沙箱,`'unsafe-inline'` 风险可接受。
2. **主题基样式**:把 `theme`(由 VisualFrame 从父页读取的 `--bg` / `--ink` / `--accent`
   / `font-family` 等 dashboard 设计变量)注入为 iframe 内 `:root` 变量 + 基础 reset
   (`margin:0; color:var(--ink); background:transparent; font-family:…`),使可视化继承深色/浅色主题。
3. **模型 HTML**:
   - 若 `html` 去空白后以 `<!doctype` 或含 `<html` 开头 → 视为整篇文档,
     把主题样式与高度脚本注入到 `</head>`(无则 `<body>` 前)。
   - 否则 → 作为片段包进 `<!DOCTYPE html><html><head>…</head><body>{html}</body></html>`。
4. **自适应高度脚本**(内联):
   ```html
   <script>
     function post(){ parent.postMessage({__agentmaVisual:1, h:document.documentElement.scrollHeight}, '*'); }
     window.addEventListener('load', post);
     if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement);
   </script>
   ```

### 5.3 父页高度联动

- `useEffect` 监听 `window` 的 `message`:
  - 校验 `e.source === iframeRef.current?.contentWindow` 且 `e.data?.__agentmaVisual`(**用 source 身份校验,不依赖 origin**,因 null-origin 的 `e.origin === 'null'`)。
  - 取 `e.data.h`,clamp 到合理范围(如 24–4000px),设为 iframe 高度。
- iframe 初始高度给一个占位(如 120px),收到消息后更新。

### 5.4 状态与降级

- 渲染中:占位骨架/loading。
- 失败兜底:`VisualFrame` 外包一层错误边界;任何异常 → 降级显示原始 HTML 源码于 `<pre>`,
  并附小字 "无法渲染此可视化"。**绝不拖垮整条消息。**

## 6. 接入 `dashboard/src/components/ChatMessageBubble.tsx`

- 现状:`useMarkdown = isComplete` 时对整段 `message.content` 调 `marked` 后
  `dangerouslySetInnerHTML`。
- 改为:`isComplete` 时先 `parseSegments(message.content)`,**按段有序渲染**:
  - `markdown` 段:`marked.parse` → `dangerouslySetInnerHTML`(沿用现有 `chat-markdown` 类)。
  - `visual` 段:`<VisualFrame html={seg.html} />`。
- 流式 / 非完成态:维持现有纯文本/流式行为,**不**解析可视化(避免半截 HTML)。
- 复制按钮(`CopyButton`)仍复制原始 `message.content`(含围栏),不受影响。

## 7. 组件边界小结

| 单元 | 职责 | 依赖 | 可独立测试 |
|---|---|---|---|
| `visual-artifacts.ts` | 切段 + 协议文档常量 | 无(纯函数) | 是(node 脚本) |
| `VisualFrame.tsx` | 安全沙箱渲染 + 主题注入 + 高度联动 | React、父页 CSS 变量 | 是(断言 sandbox/srcdoc) |
| `ChatMessageBubble.tsx` | 按段编排 markdown 与 visual | 上面两者、marked | 现有渲染路径 |

## 8. 测试策略(尊重 "少引入模块")

当前仓库**无测试框架**,既有模式是 `dashboard/scripts/smoke-*.mjs` 的 node 脚本。

- **解析器**:新增 `dashboard/scripts/smoke-visual-artifacts.mjs`(沿用既有 smoke 风格),
  覆盖:单块抽取 / 多块穿插 / 流式未闭合尾块作 markdown / 无块 / 块内含特殊字符。
- **VisualFrame 安全回归**(关键):一个轻量断言——校验生成的 iframe `sandbox` 属性
  **不含 `allow-same-origin`** 且含 `allow-scripts`;`srcdoc` 含注入主题与模型 HTML、含 CSP meta。
  可先做成纯函数 `composeSrcdoc(html, theme)` 便于无 DOM 断言;`VisualFrame` 只负责把它塞进 iframe。
- **手动验证**:在 AgentChat 里贴一条含 `agentma-visual` 块的消息,确认渲染、深色主题继承、
  自适应高度、源码降级。
- 可选:若日后引入 vitest + jsdom,可补 `VisualFrame` 组件级测试;本次不引入。

## 9. 文件清单

新增:
- `dashboard/src/utils/visual-artifacts.ts`
- `dashboard/src/components/artifacts/VisualFrame.tsx`
- `dashboard/src/components/artifacts/composeSrcdoc.ts`(纯函数,被 VisualFrame 调用,便于测试)
- `dashboard/scripts/smoke-visual-artifacts.mjs`

修改:
- `dashboard/src/components/ChatMessageBubble.tsx`

依赖变更:**无。**

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 渲染模型生成 HTML 的 XSS | 沙箱 iframe,无 `allow-same-origin`,null origin;CSP 禁外联;安全回归测试断言 |
| 模型 HTML 内出现 ``` 截断解析 | 协议文档提示;可接受风险 |
| iframe 高度抖动/超长 | 高度 clamp;ResizeObserver 去抖(实现时按需) |
| 主题不一致(深色) | 从父页读 CSS 变量注入 iframe `:root` |
| 流式半截 HTML | 仅 `isComplete` 后渲染;未闭合块作 markdown |
