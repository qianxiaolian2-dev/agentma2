# Agent SDK 参考 - TypeScript

> TypeScript Agent SDK 的完整 API 参考，包括所有函数、类型和接口。

## 安装

```bash
npm install @anthropic-ai/claude-agent-sdk
```

**注意：** SDK 为您的平台捆绑了一个本地 Claude Code 二进制文件，作为可选依赖项，例如 `@anthropic-ai/claude-agent-sdk-darwin-arm64`。您无需单独安装 Claude Code。如果您的包管理器跳过可选依赖项，SDK 会抛出 `Native CLI binary for <platform> not found`；改为将 [`pathToClaudeCodeExecutable`](#options) 设置为单独安装的 `claude` 二进制文件。

### 编译为单个可执行文件

当您使用 `bun build --compile` 将应用程序编译为单文件可执行文件时，SDK 无法在运行时解析捆绑的 CLI 二进制文件。`require.resolve` 在编译后的可执行文件的 `$bunfs` 虚拟文件系统内不起作用，因此 SDK 会抛出 `Native CLI binary for <platform> not found`。

要解决此问题，请将平台二进制文件作为文件资产嵌入，在启动时使用 `extractFromBunfs()` 将其提取到真实路径，然后将该路径传递给 [`pathToClaudeCodeExecutable`](#options)。

`extractFromBunfs()` 辅助函数需要 `@anthropic-ai/claude-agent-sdk` v0.3.144 或更高版本。下面的示例为 Apple Silicon 上的 macOS 构建：

```typescript
import binPath from "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" with { type: "file" };
import { extractFromBunfs } from "@anthropic-ai/claude-agent-sdk/extract";
import { query } from "@anthropic-ai/claude-agent-sdk";

const cliPath = extractFromBunfs(binPath);

for await (const message of query({
  prompt: "Hello",
  options: { pathToClaudeCodeExecutable: cliPath },
})) {
  console.log(message);
}
```

`extractFromBunfs()` 将嵌入的二进制文件从编译后的可执行文件的虚拟文件系统复制到每个用户的临时目录，并返回真实路径。在编译后的可执行文件之外，它返回输入路径不变，因此相同的代码在开发中无需修改即可运行。

每个编译后的可执行文件都嵌入了单个平台的二进制文件。将导入中的平台包与您的 `--target` 匹配：

- 要进行交叉编译，请安装不匹配的平台包，例如 `npm install @anthropic-ai/claude-agent-sdk-linux-x64 --force`。
- 在 Windows 上，二进制文件子路径是 `claude.exe`，例如 `@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`。

---

## 函数

### `query()`

与 Claude Code 交互的主要函数。创建一个异步生成器，在消息到达时流式传输消息。

```typescript
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

#### 参数

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `prompt` | `string \| AsyncIterable<SDKUserMessage>` | 输入提示，可以是字符串或异步可迭代对象（用于流式模式） |
| `options` | `Options` | 可选配置对象（请参阅下面的 Options 类型） |

#### 返回值

返回一个 [`Query`](#query-object) 对象，该对象扩展 `AsyncGenerator<SDKMessage, void>`，并具有其他方法。

---

### `startup()`

通过生成 CLI 子进程并在提示可用之前完成初始化握手来预热 CLI 子进程。返回的 [`WarmQuery`](#warmquery) 句柄稍后接受提示并将其写入已准备好的进程，因此第一个 `query()` 调用解析时无需支付子进程生成和初始化成本。

```typescript
function startup(params?: {
  options?: Options;
  initializeTimeoutMs?: number;
}): Promise<WarmQuery>;
```

#### 参数

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `options` | `Options` | 可选配置对象。与 `query()` 的 `options` 参数相同 |
| `initializeTimeoutMs` | `number` | 等待子进程初始化的最长时间（毫秒）。默认为 `60000`。如果初始化未在规定时间内完成，promise 将以超时错误拒绝 |

#### 返回值

返回一个 `Promise<WarmQuery>`，在子进程生成并完成其初始化握手后解析。

#### 示例

早期调用 `startup()`，例如在应用程序启动时，然后在提示准备好后在返回的句柄上调用 `.query()`。这会将子进程生成和初始化移出关键路径。

```typescript
import { startup } from "@anthropic-ai/claude-agent-sdk";

// 提前支付启动成本
const warm = await startup({ options: { maxTurns: 3 } });

// 稍后，当提示准备好时，这是立即的
for await (const message of warm.query("What files are here?")) {
  console.log(message);
}
```

---

### `tool()`

为与 SDK MCP 服务器一起使用创建类型安全的 MCP 工具定义。

```typescript
function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
): SdkMcpToolDefinition<Schema>;
```

#### 参数

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `name` | `string` | 工具的名称 |
| `description` | `string` | 工具功能的描述 |
| `inputSchema` | `Schema extends AnyZodRawShape` | 定义工具输入参数的 Zod 架构（支持 Zod 3 和 Zod 4） |
| `handler` | `(args, extra) => Promise<CallToolResult>` | 执行工具逻辑的异步函数 |
| `extras` | `{ annotations?: ToolAnnotations }` | 可选的 MCP 工具注释，为客户端提供行为提示 |

#### `ToolAnnotations`

从 `@modelcontextprotocol/sdk/types.js` 重新导出。所有字段都是可选提示；客户端不应依赖它们做出安全决策。

| 字段 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `title` | `string` | `undefined` | 工具的人类可读标题 |
| `readOnlyHint` | `boolean` | `false` | 如果为 `true`，工具不会修改其环境 |
| `destructiveHint` | `boolean` | `true` | 如果为 `true`，工具可能执行破坏性更新（仅在 `readOnlyHint` 为 `false` 时有意义） |
| `idempotentHint` | `boolean` | `false` | 如果为 `true`，使用相同参数的重复调用没有额外效果（仅在 `readOnlyHint` 为 `false` 时有意义） |
| `openWorldHint` | `boolean` | `true` | 如果为 `true`，工具与外部实体交互（例如，网络搜索）。如果为 `false`，工具的域是封闭的（例如，内存工具） |

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const searchTool = tool(
  "search",
  "Search the web",
  { query: z.string() },
  async ({ query }) => {
    return { content: [{ type: "text", text: `Results for: ${query}` }] };
  },
  { annotations: { readOnlyHint: true, openWorldHint: true } }
);
```

---

### `createSdkMcpServer()`

创建在与应用程序相同的进程中运行的 MCP 服务器实例。

```typescript
function createSdkMcpServer(options: {
  name: string;
  version?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
}): McpSdkServerConfigWithInstance;
```

#### 参数

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `options.name` | `string` | MCP 服务器的名称 |
| `options.version` | `string` | 可选版本字符串 |
| `options.tools` | `Array<SdkMcpToolDefinition>` | 使用 `tool()` 创建的工具定义数组 |

---

### `listSessions()`

发现并列出具有轻量级元数据的过去会话。按项目目录筛选或列出所有项目中的会话。

```typescript
function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
```

#### 参数

| 参数 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `options.dir` | `string` | `undefined` | 列出会话的目录。省略时，返回所有项目中的会话 |
| `options.limit` | `number` | `undefined` | 要返回的最大会话数 |
| `options.includeWorktrees` | `boolean` | `true` | 当 `dir` 在 git 存储库内时，包括来自所有 worktree 路径的会话 |

#### 返回类型：`SDKSessionInfo`

| 属性 | 类型 | 描述 |
| :--- | :--- | :--- |
| `sessionId` | `string` | 唯一会话标识符 (UUID) |
| `summary` | `string` | 显示标题：自定义标题、自动生成的摘要或第一个提示 |
| `lastModified` | `number` | 上次修改时间（自纪元以来的毫秒数） |
| `fileSize` | `number \| undefined` | 会话文件大小（字节）。仅对本地 JSONL 存储进行填充 |
| `customTitle` | `string \| undefined` | 用户设置的会话标题（通过 `/rename`） |
| `firstPrompt` | `string \| undefined` | 会话中的第一个有意义的用户提示 |
| `gitBranch` | `string \| undefined` | 会话结束时的 git 分支 |
| `cwd` | `string \| undefined` | 会话的工作目录 |
| `tag` | `string \| undefined` | 用户设置的会话标签（请参阅 `tagSession()`） |
| `createdAt` | `number \| undefined` | 创建时间（自纪元以来的毫秒数），来自第一个条目的时间戳 |

#### 示例

```typescript
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

const sessions = await listSessions({ dir: "/path/to/project", limit: 10 });

for (const session of sessions) {
  console.log(`${session.summary} (${session.sessionId})`);
}
```

---

### `getSessionMessages()`

从过去的会话记录中读取用户和助手消息。

```typescript
function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions
): Promise<SessionMessage[]>;
```

#### 参数

| 参数 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `sessionId` | `string` | 必需 | 要读取的会话 UUID（请参阅 `listSessions()`） |
| `options.dir` | `string` | `undefined` | 查找会话的项目目录。省略时，搜索所有项目 |
| `options.limit` | `number` | `undefined` | 要返回的最大消息数 |
| `options.offset` | `number` | `undefined` | 从开始跳过的消息数 |

#### 返回类型：`SessionMessage`

| 属性 | 类型 | 描述 |
| :--- | :--- | :--- |
| `type` | `"user" \| "assistant"` | 消息角色 |
| `uuid` | `string` | 唯一消息标识符 |
| `session_id` | `string` | 此消息所属的会话 |
| `message` | `unknown` | 来自记录的原始消息有效负载 |
| `parent_tool_use_id` | `string \| null` | 对于子代理消息，生成 `Agent` 工具调用的 `tool_use_id`。对于主会话消息和较旧的会话为 `null` |

#### 示例

```typescript
import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const [latest] = await listSessions({ dir: "/path/to/project", limit: 1 });

if (latest) {
  const messages = await getSessionMessages(latest.sessionId, {
    dir: "/path/to/project",
    limit: 20
  });

  for (const msg of messages) {
    console.log(`[${msg.type}] ${msg.uuid}`);
  }
}
```

---

### `getSessionInfo()`

按 ID 读取单个会话的元数据，无需扫描完整项目目录。

```typescript
function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions
): Promise<SDKSessionInfo | undefined>;
```

#### 参数

| 参数 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `sessionId` | `string` | 必需 | 要查找的会话 UUID |
| `options.dir` | `string` | `undefined` | 项目目录路径。省略时，搜索所有项目目录 |

返回 `SDKSessionInfo`，如果找不到会话，则返回 `undefined`。

---

### `renameSession()`

通过附加自定义标题条目来重命名会话。重复调用是安全的；最新的标题获胜。

```typescript
function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions
): Promise<void>;
```

#### 参数

| 参数 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `sessionId` | `string` | 必需 | 要重命名的会话 UUID |
| `title` | `string` | 必需 | 新标题。修剪空格后必须非空 |
| `options.dir` | `string` | `undefined` | 项目目录路径。省略时，搜索所有项目目录 |

---

### `tagSession()`

标记会话。传递 `null` 以清除标签。重复调用是安全的；最新的标签获胜。

```typescript
function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions
): Promise<void>;
```

#### 参数

| 参数 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `sessionId` | `string` | 必需 | 要标记的会话 UUID |
| `tag` | `string \| null` | 必需 | 标签字符串，或 `null` 以清除 |
| `options.dir` | `string` | `undefined` | 项目目录路径。省略时，搜索所有项目目录 |

---

### `resolveSettings()`

使用与 CLI 相同的合并引擎为给定目录解析有效的 Claude Code 设置，无需生成 Claude CLI。在调用 `query()` 之前使用它来检查 `query()` 调用将看到的配置。

**注意：** 此函数处于 alpha 阶段，其 API 在稳定之前可能会更改。它读取 MDM 源，包括 macOS plist 和 Windows HKLM/HKCU，以与 CLI 启动保持一致，但不执行管理员配置的 `policyHelper` 子进程。`permissions.defaultMode` 字段从所有层级（包括项目设置）按原样返回。CLI 在遵守升级权限模式之前应用的信任过滤器不被应用。

```typescript
function resolveSettings(
  options?: ResolveSettingsOptions
): Promise<ResolvedSettings>;
```

#### 参数

所有字段都是可选的。

| 参数 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `options.cwd` | `string` | `process.cwd()` | 用于解析项目和本地设置的相对目录 |
| `options.settingSources` | `SettingSource[]` | 所有源 | 要加载的文件系统源。传递 `[]` 以跳过用户、项目和本地设置。托管策略设置在所有情况下都会加载 |
| `options.managedSettings` | `Settings` | `undefined` | 由嵌入主机提供的限制性策略层设置 |
| `options.serverManagedSettings` | `Settings` | `undefined` | 来自 `/api/claude_code/settings` 的服务器托管设置有效负载 |

#### 返回类型：`ResolvedSettings`

| 属性 | 类型 | 描述 |
| :--- | :--- | :--- |
| `effective` | `Settings` | 在按优先级顺序应用所有启用的源后合并的设置 |
| `provenance` | `Partial<Record<keyof Settings, ProvenanceEntry>>` | 对于 `effective` 中的每个顶级密钥，哪个源提供了该值 |
| `sources` | `Array<{ source, settings, path?, policyOrigin? }>` | 每个源的原始设置，按从最低到最高优先级排序 |

#### 示例

```typescript
import { resolveSettings } from "@anthropic-ai/claude-agent-sdk";

const { effective, provenance } = await resolveSettings({
  cwd: "/path/to/project",
  settingSources: ["user", "project", "local"],
});

console.log(`Cleanup period: ${effective.cleanupPeriodDays} days`);
console.log(`Set by: ${provenance.cleanupPeriodDays?.source}`);
```

---

## 类型

### `Options`

`query()` 函数的配置对象。

| 属性 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| `abortController` | `AbortController` | `new AbortController()` | 用于取消操作的控制器 |
| `additionalDirectories` | `string[]` | `[]` | Claude 可以访问的其他目录 |
| `agent` | `string` | `undefined` | 主线程的代理名称。代理必须在 `agents` 选项或设置中定义 |
| `agents` | `Record<string, AgentDefinition>` | `undefined` | 以编程方式定义子代理 |
| `agentProgressSummaries` | `boolean` | `false` | 当为 `true` 时，为子代理生成单行进度摘要 |
| `allowDangerouslySkipPermissions` | `boolean` | `false` | 启用绕过权限。使用 `permissionMode: 'bypassPermissions'` 时需要 |
| `allowedTools` | `string[]` | `[]` | 无需提示即可自动批准的工具 |
| `betas` | `SdkBeta[]` | `[]` | 启用测试功能 |
| `canUseTool` | `CanUseTool` | `undefined` | 工具使用的自定义权限函数 |
| `continue` | `boolean` | `false` | 继续最近的对话 |
| `cwd` | `string` | `process.cwd()` | 当前工作目录 |
| `debug` | `boolean` | `false` | 为 Claude Code 进程启用调试模式 |
| `debugFile` | `string` | `undefined` | 将调试日志写入特定文件路径。隐式启用调试模式 |
| `disallowedTools` | `string[]` | `[]` | 要拒绝的工具 |
| `effort` | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | `'high'` | 控制 Claude 在其响应中投入的努力程度 |
| `enableFileCheckpointing` | `boolean` | `false` | 启用文件更改跟踪以进行回滚 |
| `env` | `Record<string, string \| undefined>` | `process.env` | 环境变量 |
| `executable` | `'bun' \| 'deno' \| 'node'` | 自动检测 | 要使用的 JavaScript 运行时 |
| `executableArgs` | `string[]` | `[]` | 传递给可执行文件的参数 |
| `extraArgs` | `Record<string, string \| null>` | `{}` | 其他参数 |
| `fallbackModel` | `string` | `undefined` | 主模型失败时使用的模型 |
| `forkSession` | `boolean` | `false` | 使用 `resume` 恢复时，分叉到新会话 ID 而不是继续原始会话 |
| `forwardSubagentText` | `boolean` | `false` | 转发子代理文本和思考块作为助手和用户消息 |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | `{}` | 事件的 Hook 回调 |
| `includeHookEvents` | `boolean` | `false` | 在消息流中包括 hook 生命周期事件 |
| `includePartialMessages` | `boolean` | `false` | 包括部分消息事件 |
| `loadTimeoutMs` | `number` | `60000` | *Alpha.* 每个 `sessionStore.load()` 和 `sessionStore.listSubkeys()` 调用在恢复物化期间的超时时间 |
| `managedSettings` | `Settings` | `undefined` | 由生成的父进程提供的策略层设置 |
| `maxBudgetUsd` | `number` | `undefined` | 当客户端成本估计达到此 USD 值时停止查询 |
| `maxThinkingTokens` | `number` | `undefined` | *已弃用：* 改用 `thinking` |
| `maxTurns` | `number` | `undefined` | 最大代理轮次（工具使用往返） |
| `mcpServers` | `Record<string, McpServerConfig>` | `{}` | MCP 服务器配置 |
| `model` | `string` | CLI 的默认值 | 要使用的 Claude 模型 |
| `onElicitation` | `(request: ElicitationRequest, options: { signal: AbortSignal }) => Promise<ElicitationResult>` | `undefined` | 用于处理 MCP 引出请求的回调 |
| `outputFormat` | `{ type: 'json_schema', schema: JSONSchema }` | `undefined` | 为代理结果定义输出格式 |
| `pathToClaudeCodeExecutable` | `string` | 从捆绑的本地二进制文件自动解析 | Claude Code 可执行文件的路径 |
| `permissionMode` | `PermissionMode` | `'default'` | 会话的权限模式 |
| `permissionPromptToolName` | `string` | `undefined` | 权限提示的 MCP 工具名称 |
| `persistSession` | `boolean` | `true` | 当为 `false` 时，禁用会话持久化到磁盘 |
| `planModeInstructions` | `string` | `undefined` | Plan Mode 的自定义工作流说明 |
| `plugins` | `SdkPluginConfig[]` | `[]` | 从本地路径加载自定义 plugins |
| `promptSuggestions` | `boolean` | `false` | 启用提示建议 |
| `resume` | `string` | `undefined` | 要恢复的会话 ID |
| `resumeSessionAt` | `string` | `undefined` | 在特定消息 UUID 处恢复会话 |
| `sandbox` | `SandboxSettings` | `undefined` | 以编程方式配置 sandbox 行为 |
| `sessionId` | `string` | 自动生成 | 为会话使用特定的 UUID 而不是自动生成一个 |
| `sessionStore` | `SessionStore` | `undefined` | 将会话记录镜像到外部后端 |
| `sessionStoreFlush` | `'batched' \| 'eager'` | `'batched'` | *Alpha.* `sessionStore` 的刷新模式 |
| `settings` | `string \| Settings` | `undefined` | 内联设置对象或设置文件的路径 |
| `settingSources` | `SettingSource[]` | CLI 默认值（所有源） | 控制加载哪些文件系统设置 |
| `skills` | `string[] \| 'all'` | `undefined` | 会话可用的 skills |
| `spawnClaudeCodeProcess` | `(options: SpawnOptions) => SpawnedProcess` | `undefined` | 用于生成 Claude Code 进程的自定义函数 |
| `stderr` | `(data: string) => void` | `undefined` | stderr 输出的回调 |
| `strictMcpConfig` | `boolean` | `false` | 仅使用在 `mcpServers` 中传递的服务器 |
| `systemPrompt` | `string \| { type: 'preset'; preset: 'claude_code'; append?: string; excludeDynamicSections?: boolean }` | `undefined`（最小提示） | 系统提示配置 |
| `taskBudget` | `{ total: number }` | `undefined` | *Alpha.* API 端任务预算（以令牌为单位） |
| `thinking` | `ThinkingConfig` | 支持的模型为 `{ type: 'adaptive' }` | 控制 Claude 的思考/推理行为 |
| `title` | `string` | `undefined` | 会话的显示标题 |
| `toolAliases` | `Record<string, string>` | `undefined` | 将内置工具名称映射到 MCP 工具名称 |
| `toolConfig` | `ToolConfig` | `undefined` | 内置工具行为的配置 |
| `tools` | `string[] \| { type: 'preset'; preset: 'claude_code' }` | `undefined` | 工具配置 |

#### 处理缓慢或停滞的 API 响应

CLI 子进程读取多个环境变量，这些变量控制 API 超时和停滞检测。通过 `env` 选项传递它们：

```typescript
const result = query({
  prompt: "Analyze this code",
  options: {
    env: {
      ...process.env,
      API_TIMEOUT_MS: "120000",
      CLAUDE_CODE_MAX_RETRIES: "2",
      CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "120000",
    },
  },
});
```

- `API_TIMEOUT_MS`：Anthropic 客户端上的每个请求超时，以毫秒为单位。默认 `600000`。
- `CLAUDE_CODE_MAX_RETRIES`：最大 API 重试次数。默认 `10`。
- `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`：使用 `run_in_background` 启动的子代理的停滞监视程序。默认 `600000`。
- `CLAUDE_ENABLE_STREAM_WATCHDOG=1` 与 `CLAUDE_STREAM_IDLE_TIMEOUT_MS`：当标头已到达但响应正文停止流式传输时中止请求。默认关闭。

---

### `Query` 对象

由 `query()` 函数返回的接口。

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean }
  ): Promise<RewindFilesResult>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  applyFlagSettings(settings: { [K in keyof Settings]?: Settings[K] | null }): Promise<void>;
  initializationResult(): Promise<SDKControlInitializeResponse>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedAgents(): Promise<AgentInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
  reconnectMcpServer(serverName: string): Promise<void>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  close(): void;
}
```

#### 方法

| 方法 | 描述 |
| :--- | :--- |
| `interrupt()` | 中断查询（仅在流式输入模式下可用） |
| `rewindFiles(userMessageId, options?)` | 将文件恢复到指定用户消息时的状态（需要 `enableFileCheckpointing: true`） |
| `setPermissionMode()` | 更改权限模式（仅在流式输入模式下可用） |
| `setModel()` | 更改模型（仅在流式输入模式下可用） |
| `setMaxThinkingTokens()` | *已弃用：* 改用 `thinking` 选项 |
| `applyFlagSettings(settings)` | 在运行时将设置合并到会话的标志设置层中（仅在流式输入模式下可用） |
| `initializationResult()` | 返回完整的初始化结果 |
| `supportedCommands()` | 返回可用的 slash commands |
| `supportedModels()` | 返回具有显示信息的可用模型 |
| `supportedAgents()` | 返回可用的子代理作为 `AgentInfo[]` |
| `mcpServerStatus()` | 返回连接的 MCP 服务器的状态 |
| `accountInfo()` | 返回帐户信息 |
| `reconnectMcpServer(serverName)` | 按名称重新连接 MCP 服务器 |
| `toggleMcpServer(serverName, enabled)` | 按名称启用或禁用 MCP 服务器 |
| `setMcpServers(servers)` | 动态替换此会话的 MCP 服务器集 |
| `streamInput(stream)` | 将输入消息流式传输到查询以进行多轮对话 |
| `stopTask(taskId)` | 按 ID 停止运行的后台任务 |
| `close()` | 关闭查询并终止底层进程 |

#### `applyFlagSettings()`

在运行的会话上更改任何设置而无需重新启动查询。仅在流式输入模式下可用。

```typescript
const q = query({ prompt: messageStream });

// 覆盖会话其余部分的模型
await q.applyFlagSettings({ model: "claude-opus-4-6" });

// 稍后：清除覆盖并回退到较低优先级设置
await q.applyFlagSettings({ model: null });
```

**注意：** `applyFlagSettings()` 仅适用于 TypeScript。Python SDK 不公开等效方法。

---

### `WarmQuery`

由 `startup()` 返回的句柄。

```typescript
interface WarmQuery extends AsyncDisposable {
  query(prompt: string | AsyncIterable<SDKUserMessage>): Query;
  close(): void;
}
```

#### 方法

| 方法 | 描述 |
| :--- | :--- |
| `query(prompt)` | 向预热的子进程发送提示并返回 `Query`。每个 `WarmQuery` 只能调用一次 |
| `close()` | 关闭子进程而不发送提示 |

`WarmQuery` 实现 `AsyncDisposable`，因此可以与 `await using` 一起使用以进行自动清理。

---

### `SDKControlInitializeResponse`

`initializationResult()` 的返回类型。

```typescript
type SDKControlInitializeResponse = {
  commands: SlashCommand[];
  agents: AgentInfo[];
  output_style: string;
  available_output_styles: string[];
  models: ModelInfo[];
  account: AccountInfo;
  fast_mode_state?: "off" | "cooldown" | "on";
};
```

---

### `AgentDefinition`

以编程方式定义的子代理的配置。

```typescript
type AgentDefinition = {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  prompt: string;
  model?: string;
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  initialPrompt?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: "user" | "project" | "local";
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number;
  permissionMode?: PermissionMode;
  criticalSystemReminder_EXPERIMENTAL?: string;
};
```

| 字段 | 必需 | 描述 |
| :--- | :- | :--- |
| `description` | 是 | 何时使用此代理的自然语言描述 |
| `tools` | 否 | 允许的工具名称数组。如果省略，继承父级的所有工具 |
| `disallowedTools` | 否 | 要为此代理明确禁止的工具名称数组 |
| `prompt` | 是 | 代理的系统提示 |
| `model` | 否 | 此代理的模型覆盖。接受别名或完整模型 ID |
| `mcpServers` | 否 | 此代理的 MCP 服务器规范 |
| `skills` | 否 | 要预加载到代理上下文中的 skill 名称数组 |
| `initialPrompt` | 否 | 当此代理作为主线程代理运行时，自动提交为第一个用户轮次 |
| `maxTurns` | 否 | 停止前的最大代理轮次数（API 往返） |
| `background` | 否 | 调用时将此代理作为非阻塞后台任务运行 |
| `memory` | 否 | 此代理的内存源：`'user'`、`'project'` 或 `'local'` |
| `effort` | 否 | 此代理的推理努力级别 |
| `permissionMode` | 否 | 此代理内工具执行的权限模式 |
| `criticalSystemReminder_EXPERIMENTAL` | 否 | 实验性：添加到系统提示的关键提醒 |

---

### `AgentMcpServerSpec`

```typescript
type AgentMcpServerSpec = string | Record<string, McpServerConfigForProcessTransport>;
```

其中 `McpServerConfigForProcessTransport` 是 `McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig`。

---

### `SettingSource`

```typescript
type SettingSource = "user" | "project" | "local";
```

| 值 | 描述 | 位置 |
| :--- | :--- | :--- |
| `'user'` | 全局用户设置 | `~/.claude/settings.json` |
| `'project'` | 共享项目设置（版本控制） | `.claude/settings.json` |
| `'local'` | 本地项目设置（gitignored） | `.claude/settings.local.json` |

#### 默认行为

当 `settingSources` 被省略或 `undefined` 时，`query()` 加载与 Claude Code CLI 相同的文件系统设置：用户、项目和本地。在所有情况下都会加载托管策略设置。

#### 为什么使用 settingSources

**禁用文件系统设置：**

```typescript
const result = query({
  prompt: "Analyze this code",
  options: { settingSources: [] }
});
```

**显式加载所有文件系统设置：**

```typescript
const result = query({
  prompt: "Analyze this code",
  options: {
    settingSources: ["user", "project", "local"]
  }
});
```

**仅加载特定设置源：**

```typescript
const result = query({
  prompt: "Run CI checks",
  options: {
    settingSources: ["project"]
  }
});
```

**测试和 CI 环境：**

```typescript
const result = query({
  prompt: "Run tests",
  options: {
    settingSources: ["project"],
    permissionMode: "bypassPermissions"
  }
});
```

**仅 SDK 应用程序：**

```typescript
const result = query({
  prompt: "Review this PR",
  options: {
    settingSources: [],
    agents: { /* ... */ },
    mcpServers: { /* ... */ },
    allowedTools: ["Read", "Grep", "Glob"]
  }
});
```

**加载 CLAUDE.md 项目说明：**

```typescript
const result = query({
  prompt: "Add a new feature following project conventions",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code"
    },
    settingSources: ["project"],
    allowedTools: ["Read", "Write", "Edit"]
  }
});
```

#### 设置优先级

加载多个源时，设置按此优先级合并（从高到低）：

1. 本地设置（`.claude/settings.local.json`）
2. 项目设置（`.claude/settings.json`）
3. 用户设置（`~/.claude/settings.json`）

编程选项（如 `agents`、`allowedTools` 和 `settings`）覆盖用户、项目和本地文件系统设置。托管策略设置优先于编程选项。

---

### `PermissionMode`

```typescript
type PermissionMode =
  | "default" // 标准权限行为
  | "acceptEdits" // 自动接受文件编辑
  | "bypassPermissions" // 绕过所有权限检查
  | "plan" // Plan Mode - 仅读取工具
  | "dontAsk" // 不提示权限，如果未预先批准则拒绝
  | "auto"; // 使用模型分类器批准或拒绝每个工具调用
```

---

### `CanUseTool`

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;
```

| 选项 | 类型 | 描述 |
| :--- | :--- | :--- |
| `signal` | `AbortSignal` | 如果应中止操作，则发出信号 |
| `suggestions` | `PermissionUpdate[]` | 建议的权限更新 |
| `blockedPath` | `string` | 触发权限请求的文件路径（如果适用） |
| `decisionReason` | `string` | 解释为什么触发此权限请求 |
| `toolUseID` | `string` | 此特定工具调用在助手消息中的唯一标识符 |
| `agentID` | `string` | 如果在子代理中运行，子代理的 ID |

---

### `PermissionResult`

```typescript
type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };
```

---

### `ToolConfig`

```typescript
type ToolConfig = {
  askUserQuestion?: {
    previewFormat?: "markdown" | "html";
  };
};
```

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `askUserQuestion.previewFormat` | `'markdown' \| 'html'` | 选择加入 `AskUserQuestion` 选项上的 `preview` 字段并设置其内容格式 |

---

### `McpServerConfig`

```typescript
type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfigWithInstance;
```

#### `McpStdioServerConfig`

```typescript
type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};
```

#### `McpSSEServerConfig`

```typescript
type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};
```

#### `McpHttpServerConfig`

```typescript
type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};
```

#### `McpSdkServerConfigWithInstance`

```typescript
type McpSdkServerConfigWithInstance = {
  type: "sdk";
  name: string;
  instance: McpServer;
};
```

#### `McpClaudeAIProxyServerConfig`

```typescript
type McpClaudeAIProxyServerConfig = {
  type: "claudeai-proxy";
  url: string;
  id: string;
};
```

---

### `SdkPluginConfig`

```typescript
type SdkPluginConfig = {
  type: "local";
  path: string;
};
```

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `type` | `'local'` | 必须为 `'local'`（目前仅支持本地 plugins） |
| `path` | `string` | 插件目录的绝对或相对路径 |

**示例：**

```typescript
plugins: [
  { type: "local", path: "./my-plugin" },
  { type: "local", path: "/absolute/path/to/plugin" }
];
```

---

## 消息类型

### `SDKMessage`

```typescript
type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKLocalCommandOutputMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKPluginInstallMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKTaskUpdatedMessage
  | SDKSessionStateChangedMessage
  | SDKNotificationMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKMemoryRecallMessage
  | SDKRateLimitEvent
  | SDKElicitationCompleteMessage
  | SDKPermissionDeniedMessage
  | SDKPromptSuggestionMessage
  | SDKAPIRetryMessage
  | SDKMirrorErrorMessage;
```

### `SDKAssistantMessage`

```typescript
type SDKAssistantMessage = {
  type: "assistant";
  uuid: UUID;
  session_id: string;
  message: BetaMessage;
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
};
```

`SDKAssistantMessageError` 是以下之一：`'authentication_failed'`、`'oauth_org_not_allowed'`、`'billing_error'`、`'rate_limit'`、`'invalid_request'`、`'model_not_found'`、`'server_error'`、`'max_output_tokens'` 或 `'unknown'`。

### `SDKUserMessage`

```typescript
type SDKUserMessage = {
  type: "user";
  uuid?: UUID;
  session_id?: string;
  message: MessageParam;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  shouldQuery?: boolean;
  tool_use_result?: unknown;
  origin?: SDKMessageOrigin;
};
```

将 `shouldQuery` 设置为 `false` 以将消息附加到记录中而不触发助手轮次。

### `SDKUserMessageReplay`

```typescript
type SDKUserMessageReplay = {
  type: "user";
  uuid: UUID;
  session_id: string;
  message: MessageParam;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  origin?: SDKMessageOrigin;
  isReplay: true;
};
```

### `SDKResultMessage`

```typescript
type SDKResultMessage =
  | {
      type: "result";
      subtype: "success";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      api_error_status?: number | null;
      num_turns: number;
      result: string;
      stop_reason: string | null;
      ttft_ms?: number;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: { [modelName: string]: ModelUsage };
      permission_denials: SDKPermissionDenial[];
      structured_output?: unknown;
      deferred_tool_use?: { id: string; name: string; input: Record<string, unknown> };
      terminal_reason?: TerminalReason;
      fast_mode_state?: FastModeState;
      origin?: SDKMessageOrigin;
    }
  | {
      type: "result";
      subtype:
        | "error_max_turns"
        | "error_during_execution"
        | "error_max_budget_usd"
        | "error_max_structured_output_retries";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      stop_reason: string | null;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: { [modelName: string]: ModelUsage };
      permission_denials: SDKPermissionDenial[];
      errors: string[];
      terminal_reason?: TerminalReason;
      fast_mode_state?: FastModeState;
      origin?: SDKMessageOrigin;
    };
```

详情字段：
- `api_error_status`：终止对话的 API 错误的 HTTP 状态码
- `ttft_ms`：首个令牌的时间（毫秒），仅在成功分支上显示
- `terminal_reason`：循环结束的原因：`"completed"`、`"max_turns"`、`"tool_deferred"`、`"aborted_streaming"`、`"aborted_tools"`、`"hook_stopped"`、`"stop_hook_prevented"`、`"blocking_limit"`、`"rapid_refill_breaker"`、`"prompt_too_long"`、`"image_error"` 或 `"model_error"`
- `fast_mode_state`：`"on"`、`"off"` 或 `"cooldown"` 之一
- `origin`：转发触发此结果的用户消息的 `SDKMessageOrigin`

### `SDKSystemMessage`

```typescript
type SDKSystemMessage = {
  type: "system";
  subtype: "init";
  uuid: UUID;
  session_id: string;
  agents?: string[];
  apiKeySource: ApiKeySource;
  betas?: string[];
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: {
    name: string;
    status: string;
  }[];
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: { name: string; path: string }[];
};
```

### `SDKPartialAssistantMessage`

```typescript
type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: BetaRawMessageStreamEvent;
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
};
```

### `SDKCompactBoundaryMessage`

```typescript
type SDKCompactBoundaryMessage = {
  type: "system";
  subtype: "compact_boundary";
  uuid: UUID;
  session_id: string;
  compact_metadata: {
    trigger: "manual" | "auto";
    pre_tokens: number;
  };
};
```

### `SDKPluginInstallMessage`

```typescript
type SDKPluginInstallMessage = {
  type: "system";
  subtype: "plugin_install";
  status: "started" | "installed" | "failed" | "completed";
  name?: string;
  error?: string;
  uuid: UUID;
  session_id: string;
};
```

### `SDKPermissionDeniedMessage`

需要 Claude Code v2.1.136 或更高版本。

```typescript
type SDKPermissionDeniedMessage = {
  type: "system";
  subtype: "permission_denied";
  tool_name: string;
  tool_use_id: string;
  agent_id?: string;
  decision_reason_type?: string;
  decision_reason?: string;
  message: string;
  uuid: UUID;
  session_id: string;
};
```

| 字段 | 类型 | 描述 |
| :--- | :--- | :--- |
| `tool_name` | `string` | 被拒绝的工具的名称 |
| `tool_use_id` | `string` | 此拒绝回答的 `tool_use` 块的 ID |
| `agent_id` | `string` | 当拒绝的调用源自子代理内部时的子代理 ID |
| `decision_reason_type` | `string` | 决定组件的鉴别器 |
| `decision_reason` | `string` | 来自决定组件的人类可读原因（如果可用） |
| `message` | `string` | 在 `tool_result` 中返回给模型的拒绝消息 |

### `SDKPermissionDenial`

```typescript
type SDKPermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
};
```

### `SDKMessageOrigin`

```typescript
type SDKMessageOrigin =
  | { kind: "human" }
  | { kind: "channel"; server: string }
  | { kind: "peer"; from: string; name?: string }
  | { kind: "task-notification" }
  | { kind: "coordinator" };
```

| `kind` | 含义 |
| :--- | :--- |
| `human` | 来自最终用户的直接输入 |
| `channel` | 消息到达频道。`server` 是源 MCP 服务器名称 |
| `peer` | 来自另一个代理会话的消息 |
| `task-notification` | 后台任务完成后注入的合成轮次 |
| `coordinator` | 来自代理团队中的团队协调员的消息 |

---

## Hook 类型

### `HookEvent`

```typescript
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PostToolBatch"
  | "Notification"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PermissionRequest"
  | "Setup"
  | "TeammateIdle"
  | "TaskCompleted"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove";
```

### `HookCallback`

```typescript
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;
```

### `HookCallbackMatcher`

```typescript
interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}
```

### `HookInput`

```typescript
type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PostToolBatchHookInput
  | NotificationHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PermissionRequestHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCompletedHookInput
  | ConfigChangeHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput;
```

### `BaseHookInput`

```typescript
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  effort?: { level: string };
  agent_id?: string;
  agent_type?: string;
};
```

#### `PreToolUseHookInput`

```typescript
type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
};
```

#### `PostToolUseHookInput`

```typescript
type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id: string;
  duration_ms?: number;
};
```

#### `PostToolUseFailureHookInput`

```typescript
type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
  duration_ms?: number;
};
```

#### `PostToolBatchHookInput`

```typescript
type PostToolBatchHookInput = BaseHookInput & {
  hook_event_name: "PostToolBatch";
  tool_calls: PostToolBatchToolCall[];
};

type PostToolBatchToolCall = {
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  tool_response?: unknown;
};
```

#### `NotificationHookInput`

```typescript
type NotificationHookInput = BaseHookInput & {
  hook_event_name: "Notification";
  message: string;
  title?: string;
  notification_type: string;
};
```

#### `UserPromptSubmitHookInput`

```typescript
type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
};
```

#### `SessionStartHookInput`

```typescript
type SessionStartHookInput = BaseHookInput & {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
  agent_type?: string;
  model?: string;
};
```

#### `SessionEndHookInput`

```typescript
type SessionEndHookInput = BaseHookInput & {
  hook_event_name: "SessionEnd";
  reason: ExitReason;
};
```

#### `StopHookInput`

```typescript
type StopHookInput = BaseHookInput & {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  last_assistant_message?: string;
  background_tasks?: BackgroundTaskSummary[];
  session_crons?: SessionCronSummary[];
};
```

#### `SubagentStartHookInput`

```typescript
type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
};
```

#### `SubagentStopHookInput`

```typescript
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;
  agent_id: string;
  agent_transcript_path: string;
  agent_type: string;
  last_assistant_message?: string;
  background_tasks?: BackgroundTaskSummary[];
  session_crons?: SessionCronSummary[];
};

type BackgroundTaskSummary = {
  id: string;
  type: string;
  status: string;
  description: string;
  command?: string;
  agent_type?: string;
  server?: string;
  tool?: string;
  name?: string;
};

type SessionCronSummary = {
  id: string;
  schedule: string;
  recurring: boolean;
  prompt: string;
};
```

#### `PreCompactHookInput`

```typescript
type PreCompactHookInput = BaseHookInput & {
  hook_event_name: "PreCompact";
  trigger: "manual" | "auto";
  custom_instructions: string | null;
};
```

#### `PermissionRequestHookInput`

```typescript
type PermissionRequestHookInput = BaseHookInput & {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input: unknown;
  permission_suggestions?: PermissionUpdate[];
};
```

#### `SetupHookInput`

```typescript
type SetupHookInput = BaseHookInput & {
  hook_event_name: "Setup";
  trigger: "init" | "maintenance";
};
```

#### `TeammateIdleHookInput`

```typescript
type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: "TeammateIdle";
  teammate_name: string;
  team_name: string;
};
```

#### `TaskCompletedHookInput`

```typescript
type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: "TaskCompleted";
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
};
```

#### `ConfigChangeHookInput`

```typescript
type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: "ConfigChange";
  source:
    | "user_settings"
    | "project_settings"
    | "local_settings"
    | "policy_settings"
    | "skills";
  file_path?: string;
};
```

#### `WorktreeCreateHookInput`

```typescript
type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: "WorktreeCreate";
  name: string;
};
```

#### `WorktreeRemoveHookInput`

```typescript
type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: "WorktreeRemove";
  worktree_path: string;
};
```

### `HookJSONOutput`

```typescript
type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput;
```

#### `AsyncHookJSONOutput`

```typescript
type AsyncHookJSONOutput = {
  async: true;
  asyncTimeout?: number;
};
```

#### `SyncHookJSONOutput`

```typescript
type SyncHookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision?: "allow" | "deny" | "ask" | "defer";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  } | {
    hookEventName: "UserPromptSubmit";
    additionalContext?: string;
  } | {
    hookEventName: "SessionStart";
    additionalContext?: string;
  } | {
    hookEventName: "Setup";
    additionalContext?: string;
  } | {
    hookEventName: "SubagentStart";
    additionalContext?: string;
  } | {
    hookEventName: "PostToolUse";
    additionalContext?: string;
    updatedToolOutput?: unknown;
    /** @deprecated 使用 `updatedToolOutput` */
    updatedMCPToolOutput?: unknown;
  } | {
    hookEventName: "PostToolUseFailure";
    additionalContext?: string;
  } | {
    hookEventName: "PostToolBatch";
    additionalContext?: string;
  } | {
    hookEventName: "Notification";
    additionalContext?: string;
  } | {
    hookEventName: "PermissionRequest";
    decision:
      | {
          behavior: "allow";
          updatedInput?: Record<string, unknown>;
          updatedPermissions?: PermissionUpdate[];
        }
      | {
          behavior: "deny";
          message?: string;
          interrupt?: boolean;
        };
  };
};
```

---

## 工具输入类型

所有内置 Claude Code 工具的输入架构文档。这些类型从 `@anthropic-ai/claude-agent-sdk` 导出。

### `ToolInputSchemas`

```typescript
type ToolInputSchemas =
  | AgentInput
  | AskUserQuestionInput
  | BashInput
  | TaskOutputInput
  | EnterWorktreeInput
  | ExitPlanModeInput
  | FileEditInput
  | FileReadInput
  | FileWriteInput
  | GlobInput
  | GrepInput
  | ListMcpResourcesInput
  | McpInput
  | MonitorInput
  | NotebookEditInput
  | ReadMcpResourceInput
  | SubscribeMcpResourceInput
  | SubscribePollingInput
  | TaskCreateInput
  | TaskGetInput
  | TaskListInput
  | TaskStopInput
  | TaskUpdateInput
  | TodoWriteInput
  | UnsubscribeMcpResourceInput
  | UnsubscribePollingInput
  | WebFetchInput
  | WebSearchInput;
```

### Agent

**工具名称：** `Agent`（之前为 `Task`，仍然接受作为别名）

```typescript
type AgentInput = {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: "sonnet" | "opus" | "haiku";
  resume?: string;
  run_in_background?: boolean;
  max_turns?: number;
  name?: string;
  team_name?: string;
  mode?: "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan";
  isolation?: "worktree";
};
```

### AskUserQuestion

**工具名称：** `AskUserQuestion`

```typescript
type AskUserQuestionInput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string; preview?: string }>;
    multiSelect: boolean;
  }>;
};
```

### Bash

**工具名称：** `Bash`

```typescript
type BashInput = {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
  dangerouslyDisableSandbox?: boolean;
};
```

### Monitor

**工具名称：** `Monitor`

```typescript
type MonitorInput = {
  command: string;
  description: string;
  timeout_ms?: number;
  persistent?: boolean;
};
```

### TaskOutput

**工具名称：** `TaskOutput`

```typescript
type TaskOutputInput = {
  task_id: string;
  block: boolean;
  timeout: number;
};
```

### Edit

**工具名称：** `Edit`

```typescript
type FileEditInput = {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};
```

### Read

**工具名称：** `Read`

```typescript
type FileReadInput = {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string;
};
```

### Write

**工具名称：** `Write`

```typescript
type FileWriteInput = {
  file_path: string;
  content: string;
};
```

### Glob

**工具名称：** `Glob`

```typescript
type GlobInput = {
  pattern: string;
  path?: string;
};
```

### Grep

**工具名称：** `Grep`

```typescript
type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-i"?: boolean;
  "-n"?: boolean;
  "-B"?: number;
  "-A"?: number;
  "-C"?: number;
  context?: number;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
};
```

### TaskStop

**工具名称：** `TaskStop`

```typescript
type TaskStopInput = {
  task_id?: string;
  shell_id?: string; // 已弃用：使用 task_id
};
```

### NotebookEdit

**工具名称：** `NotebookEdit`

```typescript
type NotebookEditInput = {
  notebook_path: string;
  cell_id?: string;
  new_source: string;
  cell_type?: "code" | "markdown";
  edit_mode?: "replace" | "insert" | "delete";
};
```

### WebFetch

**工具名称：** `WebFetch`

```typescript
type WebFetchInput = {
  url: string;
  prompt: string;
};
```

### WebSearch

**工具名称：** `WebSearch`

```typescript
type WebSearchInput = {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
};
```

### TodoWrite

**工具名称：** `TodoWrite`

```typescript
type TodoWriteInput = {
  todos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>;
};
```

**注意：** 自 TypeScript Agent SDK 0.3.142 起，`TodoWrite` 默认被禁用。改用 `TaskCreate`、`TaskGet`、`TaskUpdate` 和 `TaskList`。

### TaskCreate

**工具名称：** `TaskCreate`

```typescript
type TaskCreateInput = {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
};
```

### TaskUpdate

**工具名称：** `TaskUpdate`

```typescript
type TaskUpdateInput = {
  taskId: string;
  status?: "pending" | "in_progress" | "completed" | "deleted";
  subject?: string;
  description?: string;
  activeForm?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
};
```

### TaskGet

**工具名称：** `TaskGet`

```typescript
type TaskGetInput = {
  taskId: string;
};
```

### TaskList

**工具名称：** `TaskList`

```typescript
type TaskListInput = {};
```

### ExitPlanMode

**工具名称：** `ExitPlanMode`

```typescript
type ExitPlanModeInput = {
  allowedPrompts?: Array<{
    tool: "Bash";
    prompt: string;
  }>;
};
```

### ListMcpResources

**工具名称：** `ListMcpResources`

```typescript
type ListMcpResourcesInput = {
  server?: string;
};
```

### ReadMcpResource

**工具名称：** `ReadMcpResource`

```typescript
type ReadMcpResourceInput = {
  server: string;
  uri: string;
};
```

### EnterWorktree

**工具名称：** `EnterWorktree`

```typescript
type EnterWorktreeInput = {
  name?: string;
  path?: string;
};
```

---

## 工具输出类型

### `ToolOutputSchemas`

```typescript
type ToolOutputSchemas =
  | AgentOutput
  | AskUserQuestionOutput
  | BashOutput
  | EnterWorktreeOutput
  | ExitPlanModeOutput
  | FileEditOutput
  | FileReadOutput
  | FileWriteOutput
  | GlobOutput
  | GrepOutput
  | ListMcpResourcesOutput
  | MonitorOutput
  | NotebookEditOutput
  | ReadMcpResourceOutput
  | TaskCreateOutput
  | TaskGetOutput
  | TaskListOutput
  | TaskStopOutput
  | TaskUpdateOutput
  | TodoWriteOutput
  | WebFetchOutput
  | WebSearchOutput;
```

### Agent

```typescript
type AgentOutput =
  | {
      status: "completed";
      agentId: string;
      content: Array<{ type: "text"; text: string }>;
      totalToolUseCount: number;
      totalDurationMs: number;
      totalTokens: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number | null;
        cache_read_input_tokens: number | null;
        server_tool_use: {
          web_search_requests: number;
          web_fetch_requests: number;
        } | null;
        service_tier: ("standard" | "priority" | "batch") | null;
        cache_creation: {
          ephemeral_1h_input_tokens: number;
          ephemeral_5m_input_tokens: number;
        } | null;
      };
      prompt: string;
    }
  | {
      status: "async_launched";
      agentId: string;
      description: string;
      prompt: string;
      outputFile: string;
      canReadOutputFile?: boolean;
    }
  | {
      status: "sub_agent_entered";
      description: string;
      message: string;
    };
```

### AskUserQuestion

```typescript
type AskUserQuestionOutput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string; preview?: string }>;
    multiSelect: boolean;
  }>;
  answers: Record<string, string>;
};
```

### Bash

```typescript
type BashOutput = {
  stdout: string;
  stderr: string;
  rawOutputPath?: string;
  interrupted: boolean;
  isImage?: boolean;
  backgroundTaskId?: string;
  backgroundedByUser?: boolean;
  dangerouslyDisableSandbox?: boolean;
  returnCodeInterpretation?: string;
  structuredContent?: unknown[];
  persistedOutputPath?: string;
  persistedOutputSize?: number;
};
```

### Monitor

```typescript
type MonitorOutput = {
  taskId: string;
  timeoutMs: number;
  persistent?: boolean;
};
```

### Edit

```typescript
type FileEditOutput = {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
  structuredPatch: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  userModified: boolean;
  replaceAll: boolean;
  gitDiff?: {
    filename: string;
    status: "modified" | "added";
    additions: number;
    deletions: number;
    changes: number;
    patch: string;
  };
};
```

### Read

```typescript
type FileReadOutput =
  | {
      type: "text";
      file: {
        filePath: string;
        content: string;
        numLines: number;
        startLine: number;
        totalLines: number;
      };
    }
  | {
      type: "image";
      file: {
        base64: string;
        type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        originalSize: number;
        dimensions?: {
          originalWidth?: number;
          originalHeight?: number;
          displayWidth?: number;
          displayHeight?: number;
        };
      };
    }
  | {
      type: "notebook";
      file: {
        filePath: string;
        cells: unknown[];
      };
    }
  | {
      type: "pdf";
      file: {
        filePath: string;
        base64: string;
        originalSize: number;
      };
    }
  | {
      type: "parts";
      file: {
        filePath: string;
        originalSize: number;
        count: number;
        outputDir: string;
      };
    };
```

### Write

```typescript
type FileWriteOutput = {
  type: "create" | "update";
  filePath: string;
  content: string;
  structuredPatch: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  originalFile: string | null;
  gitDiff?: {
    filename: string;
    status: "modified" | "added";
    additions: number;
    deletions: number;
    changes: number;
    patch: string;
  };
};
```

### Glob

```typescript
type GlobOutput = {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
};
```

### Grep

```typescript
type GrepOutput = {
  mode?: "content" | "files_with_matches" | "count";
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
  numMatches?: number;
  appliedLimit?: number;
  appliedOffset?: number;
};
```

### TaskStop

```typescript
type TaskStopOutput = {
  message: string;
  task_id: string;
  task_type: string;
  command?: string;
};
```

### NotebookEdit

```typescript
type NotebookEditOutput = {
  new_source: string;
  cell_id?: string;
  cell_type: "code" | "markdown";
  language: string;
  edit_mode: string;
  error?: string;
  notebook_path: string;
  original_file: string;
  updated_file: string;
};
```

### WebFetch

```typescript
type WebFetchOutput = {
  bytes: number;
  code: number;
  codeText: string;
  result: string;
  durationMs: number;
  url: string;
};
```

### WebSearch

```typescript
type WebSearchOutput = {
  query: string;
  results: Array<
    | {
        tool_use_id: string;
        content: Array<{ title: string; url: string }>;
      }
    | string
  >;
  durationSeconds: number;
};
```

### TodoWrite

```typescript
type TodoWriteOutput = {
  oldTodos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>;
  newTodos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>;
};
```

**注意：** 自 TypeScript Agent SDK 0.3.142 起，`TodoWrite` 默认被禁用。改用 `TaskCreate`、`TaskGet`、`TaskUpdate` 和 `TaskList`。

### TaskCreate

```typescript
type TaskCreateOutput = {
  task: {
    id: string;
    subject: string;
  };
};
```

### TaskUpdate

```typescript
type TaskUpdateOutput = {
  success: boolean;
  taskId: string;
  updatedFields: string[];
  error?: string;
  statusChange?: {
    from: string;
    to: string;
  };
};
```

### TaskGet

```typescript
type TaskGetOutput = {
  task: {
    id: string;
    subject: string;
    description: string;
    status: "pending" | "in_progress" | "completed";
    blocks: string[];
    blockedBy: string[];
  } | null;
};
```

### TaskList

```typescript
type TaskListOutput = {
  tasks: Array<{
    id: string;
    subject: string;
    status: "pending" | "in_progress" | "completed";
    owner?: string;
    blockedBy: string[];
  }>;
};
```

### ExitPlanMode

```typescript
type ExitPlanModeOutput = {
  plan: string | null;
  isAgent: boolean;
  filePath?: string;
  hasTaskTool?: boolean;
  awaitingLeaderApproval?: boolean;
  requestId?: string;
};
```

### ListMcpResources

```typescript
type ListMcpResourcesOutput = Array<{
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}>;
```

### ReadMcpResource

```typescript
type ReadMcpResourceOutput = {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
  }>;
};
```

### EnterWorktree

```typescript
type EnterWorktreeOutput = {
  worktreePath: string;
  worktreeBranch?: string;
  message: string;
};
```

---

## 权限类型

### `PermissionUpdate`

```typescript
type PermissionUpdate =
  | {
      type: "addRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "replaceRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "removeRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "setMode";
      mode: PermissionMode;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "addDirectories";
      directories: string[];
      destination: PermissionUpdateDestination;
    }
  | {
      type: "removeDirectories";
      directories: string[];
      destination: PermissionUpdateDestination;
    };
```

### `PermissionBehavior`

```typescript
type PermissionBehavior = "allow" | "deny" | "ask";
```

### `PermissionUpdateDestination`

```typescript
type PermissionUpdateDestination =
  | "userSettings"
  | "projectSettings"
  | "localSettings"
  | "session"
  | "cliArg";
```

### `PermissionRuleValue`

```typescript
type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};
```

---

## 其他类型

### `ApiKeySource`

```typescript
type ApiKeySource = "user" | "project" | "org" | "temporary" | "oauth";
```

### `SdkBeta`

```typescript
type SdkBeta = "context-1m-2025-08-07";
```

**警告：** `context-1m-2025-08-07` beta 自 2026 年 4 月 30 日起已停用。使用 Claude Sonnet 4.5 或 Sonnet 4 传递此值无效，超过标准 200k 令牌上下文窗口的请求返回错误。要使用 1M 令牌上下文窗口，请迁移到 Claude Sonnet 4.6、Claude Opus 4.6 或 Claude Opus 4.7，它们以标准定价包括 1M 上下文，无需 beta 标头。

### `SlashCommand`

```typescript
type SlashCommand = {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
};
```

### `ModelInfo`

```typescript
type ModelInfo = {
  value: string;
  displayName: string;
  description: string;
  // ... additional fields
};
```