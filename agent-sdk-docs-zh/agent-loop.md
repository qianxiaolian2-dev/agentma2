# 代理循环如何工作

> 了解消息生命周期、工具执行、上下文窗口和支持 SDK 代理的架构。

Agent SDK 让你能够在自己的应用程序中嵌入 Claude Code 的自主代理循环。

## 循环概览

每个代理会话都遵循相同的周期：

1. **接收提示。** Claude 接收你的提示，以及系统提示、工具定义和对话历史。SDK 产生一个 `SystemMessage`，子类型为 `"init"`。
2. **评估并响应。** Claude 评估当前状态并确定如何继续。SDK 产生一个 `AssistantMessage`。
3. **执行工具。** SDK 运行每个请求的工具并收集结果。你可以使用 hooks 在工具运行前拦截、修改或阻止工具调用。
4. **重复。** 步骤 2 和 3 作为一个循环重复。Claude 继续调用工具并处理结果，直到产生没有工具调用的响应。
5. **返回结果。** SDK 产生最终的 `AssistantMessage`，然后是 `ResultMessage`，包含最终文本、令牌使用、成本和会话 ID。

## 消息类型

- **`SystemMessage`**: 会话生命周期事件。`subtype` 字段区分它们：`"init"` 是第一条消息，`"compact_boundary"` 在压缩后触发。
- **`AssistantMessage`**: 在每个 Claude 响应后发出，包括最终仅包含文本的响应。
- **`UserMessage`**: 在每个工具执行后发出，包含发送回 Claude 的工具结果内容。
- **`StreamEvent`**: 仅在启用部分消息时发出。包含原始 API 流事件。
- **`ResultMessage`**: 标记代理循环的结束。包含最终文本结果、令牌使用、成本和会话 ID。

## 工具执行

### 内置工具

| 类别 | 工具 | 它们做什么 |
| :--- | :--- | :--- |
| **文件操作** | `Read`、`Edit`、`Write` | 读取、修改和创建文件 |
| **搜索** | `Glob`、`Grep` | 按模式查找文件，使用正则表达式搜索内容 |
| **执行** | `Bash` | 运行 shell 命令、脚本、git 操作 |
| **Web** | `WebSearch`、`WebFetch` | 搜索网络、获取和解析页面 |
| **发现** | `ToolSearch` | 动态查找和按需加载工具 |
| **编排** | `Agent`、`Skill`、`AskUserQuestion`、`TaskCreate`、`TaskUpdate` | 生成子代理、调用技能、询问用户、跟踪任务 |

## 控制循环如何运行

### 轮次和预算

| 选项 | 它控制什么 | 默认值 |
| :--- | :--- | :--- |
| 最大轮次 (`max_turns` / `maxTurns`) | 最大工具使用往返次数 | 无限制 |
| 最大预算 (`max_budget_usd` / `maxBudgetUsd`) | 停止前的最大成本 | 无限制 |

### 努力级别

| 级别 | 行为 | 适合 |
| :--- | :--- | :--- |
| `"low"` | 最小推理，快速响应 | 文件查找、列出目录 |
| `"medium"` | 平衡推理 | 常规编辑、标准任务 |
| `"high"` | 彻底分析 | 重构、调试 |
| `"xhigh"` | 扩展推理深度 | 编码和代理任务 |
| `"max"` | 最大推理深度 | 需要深度分析的多步骤问题 |

### 权限模式

| 模式 | 行为 |
| :--- | :--- |
| `"default"` | 不被允许规则覆盖的工具触发你的批准回调 |
| `"acceptEdits"` | 自动批准文件编辑和常见文件系统命令 |
| `"plan"` | 只读工具运行；Claude 探索并产生计划而不编辑源文件 |
| `"dontAsk"` | 从不提示。由权限规则预批准的工具运行，其他一切被拒绝 |
| `"auto"`（仅 TypeScript） | 使用模型分类器批准或拒绝每个工具调用 |
| `"bypassPermissions"` | 运行所有允许的工具而不询问 |

## 上下文窗口

上下文窗口是会话期间可用于 Claude 的信息总量。当上下文窗口接近其限制时，SDK 自动压缩对话。

### 处理结果

| 结果子类型 | 发生了什么 | `result` 字段可用？ |
| :--- | :--- | :---: |
| `success` | Claude 正常完成了任务 | 是 |
| `error_max_turns` | 在完成前达到 `maxTurns` 限制 | 否 |
| `error_max_budget_usd` | 在完成前达到 `maxBudgetUsd` 限制 | 否 |
| `error_during_execution` | 错误中断了循环 | 否 |
| `error_max_structured_output_retries` | 结构化输出验证在配置的重试限制后失败 | 否 |
