# PLAN: 对话页面渲染改进

目标:修复 markdown 渲染的安全隐患 + 流式体验跳变,并补齐几个低成本的体感提升。
范围只动前端渲染层,不碰 `/api/chat` 流式协议。

涉及文件:
- `dashboard/src/components/ChatMessageBubble.tsx`(核心,几乎全部改动)
- `dashboard/src/App.css`(代码块/回底按钮样式)
- `dashboard/src/pages/AgentChat.tsx`(回底按钮,可选)
- `dashboard/package.json`(新增 1 个依赖)

现状基线(已确认):`marked@14.1.4`、React 19、**未安装** DOMPurify、未安装语法高亮库。
`ChatMessageBubble.tsx:91` 仅在 `isComplete` 时走 markdown;`:148` 用 `dangerouslySetInnerHTML` 注入未消毒 HTML。

---

## P0-1 — markdown 输出消毒(安全,必做)

**问题**:`marked.parse()` 结果直接进 `dangerouslySetInnerHTML`。marked v5+ 已无内置 sanitize,
模型/协作对端/知识库内容输出 `<img onerror>`、`<script>`、`javascript:` 链接即可在多租户页面执行 XSS。

**做法**:
1. 安装依赖:`cd dashboard && npm i dompurify && npm i -D @types/dompurify`
2. 在 `ChatMessageBubble.tsx` 顶部 `import DOMPurify from 'dompurify';`
3. 新建一个纯函数(放本文件或 `dashboard/src/utils/` 里新建 `render-markdown.ts`,推荐后者便于复用):
   ```ts
   import { marked } from 'marked';
   import DOMPurify from 'dompurify';
   marked.setOptions({ gfm: true, breaks: true });
   export function renderMarkdown(src: string): string {
     const raw = marked.parse(src, { async: false }) as string;
     return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
   }
   ```
4. `htmlContent` 的 `useMemo` 改为调用 `renderMarkdown(message.content)`,catch 兜底返回转义后的纯文本。
5. 把原文件顶部那行全局 `marked.setOptions(...)` 移进 util,避免重复配置。

**验收**:发一条内容为 `<img src=x onerror=alert(1)>` 和 `[x](javascript:alert(1))` 的助手消息(可用回显 agent 或手填 session),
DOM 里不出现 `onerror`/`javascript:`,无弹窗;正常 markdown(表格/代码/列表)渲染不变。

## P0-2 — 流式过程也渲染 markdown(去除完成瞬间跳变)

**问题**:`useMarkdown = isComplete`,流式时显示原始 `**bold**`/`#`/代码围栏,`result` 到达才一次性变排版,长回答闪烁明显。

**做法**:
1. 把 `useMarkdown` 判定从「仅 complete」放宽到「assistant 且有 content 且非 error」:
   `const useMarkdown = message.role === 'assistant' && !isError && !!message.content;`
   (pending/无内容仍走纯文本分支显示光标点。)
2. `useMemo` 依赖已含 `message.content`,流式每帧重解析即可——marked 对未闭合语法(半截代码围栏/表格)容错足够,不会抛错。
3. 流式中的光标点逻辑保留:仅当 `isStreaming && !content` 时显示;有 content 后由 markdown 接管,可在末尾追加一个 CSS 闪烁光标(见下,选做)。

**性能配套(同批做)**:
- 用 `React.memo` 包裹 `ChatMessageBubble` 导出,比较函数按 `message`(引用)+ 关键字段。
  当前每个 delta `setMessages` 整个数组会重渲染所有气泡;memo 后只有 draft 那条变。
- 注意:`updateAssistantDraft` 必须返回**新的 message 对象**(看 `chat-stream-draft.ts` 确认是 immutable 更新),否则 memo 会漏更新。先读该文件确认,再决定 memo 比较函数。

**验收**:发一条会输出标题+列表+代码块的长回答,流式途中即为排版态、无原始符号;完成时不再整体跳变;
DevTools Profiler 里非 draft 气泡在 delta 期间不重渲染。

---

## P1（体感,做完 P0 再评估是否一起上)

### P1-1 链接安全打开
DOMPurify sanitize 后,用 `DOMPurify.addHook('afterSanitizeAttributes', ...)` 给所有 `<a>` 加 `target=_blank` + `rel=noopener noreferrer`。
(放在 util 模块初始化处,注册一次。)避免点外链顶掉对话页。

### P1-2 代码块:语言标签 + 单块复制(不引高亮库)
不引 highlight.js(体积/暗色主题适配成本高),先做轻量版:
- 用 marked 的 `renderer.code` 自定义,把 `<pre>` 包一层带语言标签和复制按钮的容器,或
- 渲染后在 `chat-markdown` 容器内用一个 effect 给每个 `<pre>` 注入复制按钮(更解耦)。
- 复制按钮复用现有 `CopyButton` 的交互(已复制态 1.5s)。
语法高亮作为独立后续项,本轮不做。

### P1-3 回到底部按钮(AgentChat.tsx)
- `chat-messages` 滚动监听:当 `scrollHeight - scrollTop - clientHeight > 150`(用户上翻)时,显示一个浮动「↓」按钮。
- 点击 `el.scrollTop = el.scrollHeight`。
- 现有自动滚动逻辑(`AgentChat.tsx:247-252`)保留不变。

### P1-4 复制按钮可达性
现 `.chat-msg.assistant:hover .copy-btn { opacity: 1 }`,触屏/键盘够不到。
改为 `:focus-within` 也显示,且 `.copy-btn:focus { opacity: 1 }`;移动端(媒体查询 <768px)默认常显。

---

## 执行顺序与交付
1. P0-1 + P0-2 + 性能 memo 一起做(同一改动面,互相依赖渲染分支)。先读 `chat-stream-draft.ts` 确认 immutable。
2. 自测 build:`cd dashboard && npm run build`(或 typecheck)通过,无 TS 报错。
3. P1 项视时间逐条加,每条独立可回滚。
4. 不写入新协议字段、不改 session 持久化结构。

## 风险点
- DOMPurify 默认会移除 `target` 属性 → 必须 `ADD_ATTR: ['target','rel']` 或用 hook,否则 P1-1 失效。
- marked 14 的 `parse` 在 `async:false` 下返回 string;若误配 `async:true` 会返回 Promise 导致渲染 `[object Promise]`——务必显式 `{ async: false }`。
- 流式每帧重解析 markdown,极长回答(数万字)可能有 CPU 压力;若 Profiler 显示卡顿,再加「内容长度 > N 时流式降级为纯文本、仅完成时 markdown」的开关。先不预优化。
