# AgentMa 产品路线图

> 依据：Claude Agent SDK 文档（`agent-sdk-docs-zh/`）+ 当前 `dashboard/` 代码现状
> 日期：2026-05-30

---

## 1. 现状判断

当前 dashboard 是一个**完整度很高的「Agent 控制台 + 模拟器」**，但执行层尚未落地：

- **配置面齐全**：Agents 模板、Tools / Skills / Hooks / Subagents / Permissions、MCP、多租户账户 + 配额 / 审计。
- **执行是手写的、浅层的**：
  - `dashboard/server.ts` 的 `/api/chat` 直接打上游 `/messages`（deepseek / minimax）跑了个简化工具循环（`MAX=10`），没有真实的 Read/Write/Bash 工作区。
  - `dashboard/src/simulator/`（`sdk-simulator.ts` / `mock-data.ts`）是给 UI 用的**模拟器**。
  - `dashboard/package.json` 里**没有** `@anthropic-ai/claude-agent-sdk`。
- **配额表在空转**：`server-store.ts` 的 `quotas`（monthly active seconds / weekly run count / max concurrent / per-run token / tool calls）显然是为「真实计量的 agent 运行」设计的，但还没有引擎去消费它。
- **已具备的地基**：SSE（`/api/sessions/:id/events`）、多租户账户 + API key、租户级 agent 共享（`/api/agents`）、服务端聊天历史（`chat_sessions` / `chat_messages`）。

**结论**：UI 是照着 SDK 的形状画的，底层却没接 SDK。整条路线的核心岔路只有一个 —— **是否引入官方 Agent SDK 作为执行引擎**。

---

## 2. 核心岔路与取舍

| | 接官方 Agent SDK | 维持手写多-provider 循环 |
|---|---|---|
| **能力** | 内置工具 / 子代理 / 会话 / 检查点 / 权限 / 可观测 / 结构化输出**全部白来** | 只能逐个手写，长期是浅层 |
| **模型** | 偏 Claude / Anthropic 兼容端点（可用 `ANTHROPIC_BASE_URL` 指 deepseek/minimax，但内置工具循环对弱模型效果存疑） | 自由指任意便宜 / 国内模型 |
| **基建** | 需要沙箱（每租户隔离）+ 凭据代理 | 单 node 进程即可 |

**建议：接 SDK。** ~80% 的 UI 已按其接口画好，接上等于「把模拟器变成真的」，性价比极高；模型成本用 `ANTHROPIC_BASE_URL` + 沙箱内代理折中。
**但先做可行性 spike**（见 §7）：验证「Agent SDK + deepseek/minimax 端点」到底跑不跑得动 —— 这直接决定整条路线可行性。

---

## 3. SDK 能力 → 当前产品 → 落地动作

| SDK 能力 | 文档 | 当前产品状态 | 落地动作 |
|---|---|---|---|
| 代理循环（turns / budget / effort / 权限模式 / 自动压缩） | `agent-loop.md` | 手写简化循环 | run 引擎用 `query()` 驱动 |
| 内置工具 Read/Write/Edit/Bash/Glob/Grep/Web*/Monitor | `overview.md` | 仅把 schema 转发上游，无真实执行 | SDK 自带，需沙箱工作区 |
| 子代理（并行 / 隔离 / background） | `subagents.md` | Subagents 页是模拟 | `agents` 选项 + `Agent` 工具 |
| Hooks（PreToolUse / PostToolUse / Notification…） | `hooks.md` | Hooks 页是模拟 | SDK hook 回调；Notification→Slack |
| MCP（stdio / http / sdk） | `mcp.md` | `/api/deploy` 自建 ws 桥 + 模拟列表 | `mcpServers` 选项 |
| 自定义工具 | `custom-tools.md` | `/tmp` 自定义工具 + endpoint | `createSdkMcpServer` |
| 权限（modes + allow/deny + canUseTool） | `permissions.md` | Permissions 页是模拟 | 真审批回调 + 规则 |
| 会话（continue / resume / fork） | `sessions.md` | `chat_sessions` 已落库 | 接入 SDK `session_id` |
| Skills | `skills.md` | 背包（localStorage / 默认） | `settingSources` + `skills` 选项 |
| Slash commands / Memory / Plugins | `plugins.md` `slash-commands.md` | 无 | `.claude/*` + `plugins` 选项 |
| 结构化输出 | `structured-outputs.md` | 无 | `outputFormat: json_schema` |
| 文件检查点（rewind） | `file-checkpointing.md` | 无 | `enableFileCheckpointing` + 时间线 UI |
| 成本 / 用量 | `cost-tracking.md` | 上游 usage 被丢弃；配额表空转 | `ResultMessage.usage` → 配额 / 账单 |
| 可观测性 | `observability.md` | Observability 页是假图表 | OpenTelemetry metrics/logs/traces |
| Todo / Task 跟踪 | `todo-tracking.md` | 无 | `TaskCreate/Update` 流事件 → 进度条 |
| 托管 / 沙箱 | `hosting.md` | 单 node 进程 | Modal / E2B / Fly / Cloudflare 每租户隔离 |
| 安全部署 | `secure-deployment.md` | 无隔离 | 代理注入凭据 + 只读挂载 + 最小权限 |
| 多 provider | `overview.md` | `ANTHROPIC_BASE_URL`（deepseek/minimax） | 可选扩展 Bedrock/Vertex/Azure |

---

## 4. 分阶段路线

### P1 · 让执行变真（地基）
- 引入 `@anthropic-ai/claude-agent-sdk`，新建 run 引擎；`AgentTemplate` 字段 ~1:1 映射 `ClaudeAgentOptions`：
  `tools → allowedTools`、`skills`、`mcpServers`、`effort`、`permissionMode`、`maxTurns`、`providerOverrides → env`。
- 用 `query()` 的流式消息驱动现有 SSE → Conversations 实时显示。
- `ResultMessage` 的 usage / cost **写入现有配额 / 审计表**。
- **完成判据**：能在 UI 里用一个模板真实跑一轮（含 Read/Bash），结果与用量落库。

### P2 · 把配置面接到真能力
- Permissions 页 → 真 `canUseTool` 审批 + allow/deny 规则（聊天里弹「是否允许 `Bash(rm)`」）。
- Hooks 页 → 真 `PreToolUse/PostToolUse/Notification`。
- Subagents 页 → 真子代理（并行 / 隔离 / background）。
- Sessions / Conversations → resume / fork。
- **完成判据**：四个原模拟页面至少一个走通真实链路。

### P3 · 生产化 / 多租户 SaaS
- 沙箱托管：每租户 run 跑在隔离容器；配额表的 active-seconds / 并发 / token **真正强制执行**。
- 安全：凭据走代理注入、只读挂载、最小权限。
- 可观测性页 → 接 OpenTelemetry，假图表变真 trace。
- **完成判据**：两个租户并发跑、互不串数据、超额被拦。

### P4 · 差异化 / 丰富度
- 文件检查点 → 会话「回滚到某一步」时间线。
- 结构化输出 → 模板可定义 JSON schema，做「数据抽取型 agent」。
- Skills / Plugins 市场 → 延续租户级共享，做成可安装 / 共享市场。
- 多 provider 路由、`AskUserQuestion` 多选澄清、Todo/Task 进度条。

---

## 5. 不依赖大改、能马上落地的小赢
1. **成本 / 用量**：上游已返回 usage，现被丢弃 —— 写进会话和配额，先让「配额管理」有真数据。
2. **resume / fork**：`chat_sessions` 已落库，补「继续 / 分叉」按钮。
3. **AskUserQuestion**：聊天里渲染多选澄清，体验立刻像真 agent。
4. **结构化输出**：上游兼容 messages，加个 `outputFormat` demo。

---

## 6. 风险与未决问题
- **弱模型 + 内置工具循环**：deepseek/minimax 能否驱动 SDK 的工具循环（尤其 ToolSearch / 子代理）未知 —— 需 spike 验证。
- **沙箱成本与复杂度**：多租户隔离运行会引入容器编排成本（参考 `hosting.md` ≈ $0.05/小时/容器 + token）。
- **品牌合规**：`overview.md` 要求不得使用「Claude Code」品牌；对外用「Powered by Claude」。
- **并发与配额强制**：当前无运行引擎，配额只是 schema，需要引擎层真正计量与限流。

---

## 7. 建议下一步
1. **先定岔路**（§2）：接 SDK / 维持手写。
2. 若接 SDK，**先做最小 spike**：`@anthropic-ai/claude-agent-sdk` + `ANTHROPIC_BASE_URL` 指向 deepseek/minimax，跑一个含 Read+Bash 的任务，确认可行性与效果。
3. spike 通过后，按 P1 落地 run 引擎 + 模板→options 映射 + 串到现有 SSE / 配额。
