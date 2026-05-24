# 使用 hooks 拦截和控制代理行为

> 在代理执行的关键点使用 hooks 拦截和自定义代理行为

## 可用的 hooks

| Hook 事件 | Python SDK | TypeScript SDK | 触发条件 | 示例用例 |
| --- | --- | --- | --- | --- |
| `PreToolUse` | 是 | 是 | 工具调用请求（可以阻止或修改） | 阻止危险的 shell 命令 |
| `PostToolUse` | 是 | 是 | 工具执行结果 | 将所有文件更改记录到审计跟踪 |
| `PostToolUseFailure` | 是 | 是 | 工具执行失败 | 处理或记录工具错误 |
| `PostToolBatch` | 否 | 是 | 一整批工具调用解决 | 为整个批次注入约定 |
| `UserPromptSubmit` | 是 | 是 | 用户提示提交 | 将额外上下文注入到提示中 |
| `Stop` | 是 | 是 | 代理执行停止 | 在退出前保存会话状态 |
| `SubagentStart` | 是 | 是 | 子代理初始化 | 跟踪并行任务生成 |
| `SubagentStop` | 是 | 是 | 子代理完成 | 聚合来自并行任务的结果 |
| `PreCompact` | 是 | 是 | 对话压缩请求 | 在总结前存档完整记录 |
| `PermissionRequest` | 是 | 是 | 权限对话将显示 | 自定义权限处理 |
| `SessionStart` | 否 | 是 | 会话初始化 | 初始化日志记录和遥测 |
| `SessionEnd` | 否 | 是 | 会话终止 | 清理临时资源 |
| `Notification` | 是 | 是 | 代理状态消息 | 将代理状态更新发送到 Slack |
| `TeammateIdle` | 否 | 是 | 队友变为空闲 | 重新分配工作或通知 |
| `TaskCompleted` | 否 | 是 | 后台任务完成 | 聚合来自并行任务的结果 |

## 配置 hooks

### 匹配器

| 选项 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `matcher` | `string` | `undefined` | 针对事件的过滤字段匹配的正则表达式模式 |
| `hooks` | `HookCallback[]` | - | 当模式匹配时执行的回调函数数组 |
| `timeout` | `number` | `60` | 超时时间（秒） |

### 回调函数

每个 hook 回调接收三个参数：
- **输入数据**: 包含事件详细信息的类型化对象
- **工具使用 ID**: 关联同一工具调用的 PreToolUse 和 PostToolUse 事件
- **上下文**: 包含用于取消的 `signal` 属性

### 输出

返回 `{}` 以允许操作而不进行更改。返回 `{"decision": "block", "reason": "..."}` 阻止执行。

### 异步输出

返回 `{"async": true, "asyncTimeout": 30000}` 让代理立即继续而不等待 hook 完成。

## 示例

### 修改工具输入

拦截 Write 工具调用并重写 `file_path` 参数以添加 `/sandbox` 前缀。

### 添加上下文并阻止工具

阻止写入 `/etc` 目录的操作，并向模型和用户解释原因。

### 自动批准特定工具

自动批准只读文件系统工具（Read、Glob、Grep）。

### 将通知转发到 Slack

使用 `Notification` hooks 从代理接收系统通知并将其转发到外部服务。
