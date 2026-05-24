# 使用会话

> 会话如何保持代理对话历史记录，以及何时使用 continue、resume 和 fork 返回到之前的运行。

## 选择一种方法

| 您正在构建的内容 | 使用什么 |
| :--- | :--- |
| 一次性任务：单个提示，无后续 | 无需额外操作。一个 `query()` 调用可以处理它 |
| 在一个进程中进行多轮聊天 | `ClaudeSDKClient`（Python）或 `continue: true`（TypeScript） |
| 在进程重启后从中断处继续 | `continue_conversation=True` / `continue: true` |
| 恢复特定的过去会话 | 捕获会话 ID 并将其传递给 `resume` |
| 尝试替代方法而不丢失原始方法 | Fork 会话 |
| 无状态任务 | 设置 `persistSession: false`（仅 TypeScript） |

### Continue、resume 和 fork

- **Continue**: 在当前目录中查找最近的会话。无需跟踪 ID。
- **Resume**: 采用特定的会话 ID。用于多个会话或返回到不是最近的会话。
- **Fork**: 创建一个新会话，从原始会话历史记录的副本开始。

## 自动会话管理

### Python: `ClaudeSDKClient`

```python
async with ClaudeSDKClient(options=options) as client:
    await client.query("Analyze the auth module")
    async for message in client.receive_response():
        print_response(message)

    await client.query("Now refactor it to use JWT")
    async for message in client.receive_response():
        print_response(message)
```

### TypeScript: `continue: true`

```typescript
// First query
for await (const message of query({ prompt: "Analyze the auth module", options })) { ... }

// Second query: continue: true resumes the most recent session
for await (const message of query({ prompt: "Now refactor it", options: { continue: true, ...options } })) { ... }
```

## 捕获会话 ID

从结果消息上的 `session_id` 字段读取它（Python 中的 `ResultMessage`，TypeScript 中的 `SDKResultMessage`）。

## 按 ID 恢复

```python
async for message in query(
    prompt="Now implement the refactoring you suggested",
    options=ClaudeAgentOptions(resume=session_id, ...),
):
    ...
```

## Fork 以探索替代方案

```python
async for message in query(
    prompt="Instead of JWT, implement OAuth2",
    options=ClaudeAgentOptions(resume=session_id, fork_session=True),
):
    ...
```
