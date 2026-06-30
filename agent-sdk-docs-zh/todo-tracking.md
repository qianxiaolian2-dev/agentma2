# 待办事项列表

> 使用 Claude Agent SDK 跟踪和显示待办事项，实现有组织的任务管理

待办事项跟踪提供了一种结构化的方式来管理任务并向用户显示进度。Claude Agent SDK 包含内置的待办事项功能，可帮助组织复杂的工作流程并让用户了解任务进度。

<Note>
  截至 TypeScript Agent SDK 0.3.142 和 Claude Code v2.1.142，会话使用结构化的 Task 工具 `TaskCreate`、`TaskUpdate`、`TaskGet` 和 `TaskList`，而不是 `TodoWrite`。请参阅[迁移到 Task 工具](#migrate-to-task-tools)了解监控代码如何变化。本页面上的示例设置 `CLAUDE_CODE_ENABLE_TASKS=0` 以继续为尚未迁移的会话显示 `TodoWrite`。
</Note>

<h3 id="todo-lifecycle">
  待办事项生命周期
</h3>

待办事项遵循可预测的生命周期：

1. **创建**为 `pending` 状态，当任务被识别时
2. **激活**为 `in_progress` 状态，当工作开始时
3. **完成**当任务成功完成时
4. **移除**当组中的所有任务都完成时

<h3 id="when-todos-are-used">
  何时使用待办事项
</h3>

SDK 会自动为以下情况创建待办事项：

* **复杂的多步骤任务**需要 3 个或更多不同的操作
* **用户提供的任务列表**当提到多个项目时
* **非平凡的操作**受益于进度跟踪
* **明确的请求**当用户要求组织待办事项时

<h2 id="examples">
  示例
</h2>

<h3 id="monitoring-todo-changes">
  监控待办事项变化
</h3>

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  for await (const message of query({
    prompt: "Optimize my React app performance and track progress with todos",
    // Re-enable TodoWrite, which this example monitors. Without it, the SDK uses
    // Task tools instead and these tool_use blocks never appear.
    options: { maxTurns: 15, env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: "0" } }
  })) {
    // Todo updates are reflected in the message stream
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use" && block.name === "TodoWrite") {
          const todos = block.input.todos;

          console.log("Todo Status Update:");
          todos.forEach((todo, index) => {
            const status =
              todo.status === "completed" ? "✅" : todo.status === "in_progress" ? "🔧" : "❌";
            console.log(`${index + 1}. ${status} ${todo.content}`);
          });
        }
      }
    }
  }
  ```

  ```python Python theme={null}
  from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ToolUseBlock

  async for message in query(
      prompt="Optimize my React app performance and track progress with todos",
      # Re-enable TodoWrite, which this example monitors. Without it, the SDK uses
      # Task tools instead and these tool_use blocks never appear.
      options=ClaudeAgentOptions(max_turns=15, env={"CLAUDE_CODE_ENABLE_TASKS": "0"}),
  ):
      # Todo updates are reflected in the message stream
      if isinstance(message, AssistantMessage):
          for block in message.content:
              if isinstance(block, ToolUseBlock) and block.name == "TodoWrite":
                  todos = block.input["todos"]

                  print("Todo Status Update:")
                  for i, todo in enumerate(todos):
                      status = (
                          "✅"
                          if todo["status"] == "completed"
                          else "🔧"
                          if todo["status"] == "in_progress"
                          else "❌"
                      )
                      print(f"{i + 1}. {status} {todo['content']}")
  ```
</CodeGroup>

<h3 id="real-time-progress-display">
  实时进度显示
</h3>

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  class TodoTracker {
    private todos: any[] = [];

    displayProgress() {
      if (this.todos.length === 0) return;

      const completed = this.todos.filter((t) => t.status === "completed").length;
      const inProgress = this.todos.filter((t) => t.status === "in_progress").length;
      const total = this.todos.length;

      console.log(`\nProgress: ${completed}/${total} completed`);
      console.log(`Currently working on: ${inProgress} task(s)\n`);

      this.todos.forEach((todo, index) => {
        const icon =
          todo.status === "completed" ? "✅" : todo.status === "in_progress" ? "🔧" : "❌";
        const text = todo.status === "in_progress" ? todo.activeForm : todo.content;
        console.log(`${index + 1}. ${icon} ${text}`);
      });
    }

    async trackQuery(prompt: string) {
      for await (const message of query({
        prompt,
        // Re-enable TodoWrite, which this tracker watches for.
        options: { maxTurns: 20, env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: "0" } }
      })) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use" && block.name === "TodoWrite") {
              this.todos = block.input.todos;
              this.displayProgress();
            }
          }
        }
      }
    }
  }

  // Usage
  const tracker = new TodoTracker();
  await tracker.trackQuery("Build a complete authentication system with todos");
  ```

  ```python Python theme={null}
  from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ToolUseBlock
  from typing import List, Dict


  class TodoTracker:
      def __init__(self):
          self.todos: List[Dict] = []

      def display_progress(self):
          if not self.todos:
              return

          completed = len([t for t in self.todos if t["status"] == "completed"])
          in_progress = len([t for t in self.todos if t["status"] == "in_progress"])
          total = len(self.todos)

          print(f"\nProgress: {completed}/{total} completed")
          print(f"Currently working on: {in_progress} task(s)\n")

          for i, todo in enumerate(self.todos):
              icon = (
                  "✅"
                  if todo["status"] == "completed"
                  else "🔧"
                  if todo["status"] == "in_progress"
                  else "❌"
              )
              text = (
                  todo["activeForm"]
                  if todo["status"] == "in_progress"
                  else todo["content"]
              )
              print(f"{i + 1}. {icon} {text}")

      async def track_query(self, prompt: str):
          async for message in query(
              prompt=prompt,
              # Re-enable TodoWrite, which this tracker watches for.
              options=ClaudeAgentOptions(max_turns=20, env={"CLAUDE_CODE_ENABLE_TASKS": "0"}),
          ):
              if isinstance(message, AssistantMessage):
                  for block in message.content:
                      if isinstance(block, ToolUseBlock) and block.name == "TodoWrite":
                          self.todos = block.input["todos"]
                          self.display_progress()


  # Usage
  tracker = TodoTracker()
  await tracker.track_query("Build a complete authentication system with todos")
  ```
</CodeGroup>

<h2 id="migrate-to-task-tools">
  迁移到 Task 工具
</h2>

Task 工具将单个 `TodoWrite` 调用分为 `TaskCreate`（用于每个新项目）和 `TaskUpdate`（用于每个状态更改），`TaskList` 和 `TaskGet` 可供模型读取当前列表。您的监控代码仍然检查助手流中的 `tool_use` 块，但维护一个由任务 ID 键入的映射，而不是在每次调用时替换整个列表。{/* min-version: 2.1.142 */}Task 工具是 TypeScript Agent SDK 0.3.142 和 Claude Code v2.1.142 的默认工具，因此不需要更改 `options.env`。

| 使用 `TodoWrite`                         | 使用 Task 工具                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一个工具调用重写完整的 `todos` 数组                 | `TaskCreate` 添加一个项目，`TaskUpdate` 按 `taskId` 修补一个项目                                                                                                                                                                                                                            |
| 匹配 `block.name === "TodoWrite"`        | 匹配 `block.name === "TaskCreate"` 或 `"TaskUpdate"`                                                                                                                                                                                                                             |
| 项目形状：`{ content, status, activeForm }` | `TaskCreate` 输入：`{ subject, description, activeForm?, metadata? }`。`TaskUpdate` 输入：`{ taskId, status?, subject?, description?, activeForm?, addBlocks?, addBlockedBy?, owner?, metadata? }`。`status` 是 `"pending"`、`"in_progress"` 或 `"completed"`；设置 `status: "deleted"` 以删除 |
| 直接渲染 `block.input.todos`               | 跨调用累积项目，或从 `TaskList` 工具结果读取快照                                                                                                                                                                                                                                                |

分配的任务 ID 不在 `TaskCreate` 输入中。它在匹配的 `tool_result` 中返回为 `{ task: { id, subject } }`，因此从结果块捕获它以键入您的映射。以下示例显示了对[监控待办事项变化](#monitoring-todo-changes)循环的最小更改。要渲染完整列表，请在流中监视 `TaskList` 工具结果或将 `TaskCreate` 结果和 `TaskUpdate` 输入累积到映射中。

流式传输的 `tool_use` 输入是模型发出的原始形状。Claude Code 在执行前修复一些接近但不正确的键名，将 `id` 或 `task_id` 映射到 `taskId`，将 `active_form` 映射到 `activeForm`，但该修复不会反映在流中。防御性地读取 `TaskUpdate` 输入字段，如下面的示例所示，而不是假设规范名称始终存在。

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  for await (const message of query({
    prompt: "Optimize my React app performance",
  })) {
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "TaskCreate") {
        const input = block.input as { subject: string };
        console.log(`+ ${input.subject}`);
      } else if (block.name === "TaskUpdate") {
        const input = block.input as {
          taskId?: string;
          id?: string;
          task_id?: string;
          status?: string;
        };
        const taskId = input.taskId ?? input.id ?? input.task_id;
        if (taskId && input.status) console.log(`  ${taskId} -> ${input.status}`);
      }
    }
  }
  ```

  ```python Python theme={null}
  from claude_agent_sdk import query, AssistantMessage, ToolUseBlock

  async for message in query(
      prompt="Optimize my React app performance",
  ):
      if not isinstance(message, AssistantMessage):
          continue
      for block in message.content:
          if not isinstance(block, ToolUseBlock):
              continue
          if block.name == "TaskCreate":
              print(f"+ {block.input['subject']}")
          elif block.name == "TaskUpdate" and block.input.get("status"):
              task_id = (
                  block.input.get("taskId")
                  or block.input.get("id")
                  or block.input.get("task_id")
              )
              if task_id:
                  print(f"  {task_id} -> {block.input['status']}")
  ```
</CodeGroup>

<h2 id="related-documentation">
  相关文档
</h2>

* [TypeScript SDK 参考](/zh-CN/agent-sdk/typescript)
* [Python SDK 参考](/zh-CN/agent-sdk/python)
* [流式模式与单一模式](/zh-CN/agent-sdk/streaming-vs-single-mode)
* [自定义工具](/zh-CN/agent-sdk/custom-tools)
