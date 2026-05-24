# 待办事项列表

> 使用 Claude Agent SDK 跟踪和显示待办事项，实现有组织的任务管理

## 待办事项生命周期

1. **创建**为 `pending` 状态
2. **激活**为 `in_progress` 状态
3. **完成**当任务成功完成时
4. **移除**当组中的所有任务都完成时

## 何时使用待办事项

SDK 会自动为以下情况创建待办事项：
- 复杂的多步骤任务需要 3 个或更多不同的操作
- 用户提供的任务列表当提到多个项目时
- 非平凡的操作受益于进度跟踪
- 明确的请求当用户要求组织待办事项时

## 迁移到 Task 工具

Task 工具将单个 `TodoWrite` 调用分为 `TaskCreate`（用于每个新项目）和 `TaskUpdate`（用于每个状态更改）。

| 使用 `TodoWrite` | 使用 Task 工具 |
| --- | --- |
| 一个工具调用重写完整的 `todos` 数组 | `TaskCreate` 添加一个项目，`TaskUpdate` 按 `taskId` 修补一个项目 |
| 匹配 `block.name === "TodoWrite"` | 匹配 `block.name === "TaskCreate"` 或 `"TaskUpdate"` |
| 直接渲染 `block.input.todos` | 跨调用累积项目，或从 `TaskList` 工具结果读取快照 |

### 监控 Task 工具

TypeScript:
```typescript
for await (const message of query({ prompt: "Optimize my React app performance" })) {
  if (message.type !== "assistant") continue;
  for (const block of message.message.content) {
    if (block.type !== "tool_use") continue;
    if (block.name === "TaskCreate") {
      console.log(`+ ${block.input.subject}`);
    } else if (block.name === "TaskUpdate") {
      if (block.input.status) console.log(`  ${block.input.taskId} -> ${block.input.status}`);
    }
  }
}
```

Python:
```python
async for message in query(prompt="Optimize my React app performance"):
    if not isinstance(message, AssistantMessage):
        continue
    for block in message.content:
        if not isinstance(block, ToolUseBlock):
            continue
        if block.name == "TaskCreate":
            print(f"+ {block.input['subject']}")
        elif block.name == "TaskUpdate" and block.input.get("status"):
            print(f"  {block.input['taskId']} -> {block.input['status']}")
```
