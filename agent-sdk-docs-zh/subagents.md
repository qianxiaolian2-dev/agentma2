# SDK 中的子代理

> 定义和调用子代理以隔离上下文、并行运行任务，以及在 Claude Agent SDK 应用程序中应用专门的指令。

## 使用子代理的好处

### 上下文隔离
每个子代理在其自己的新对话中运行。中间工具调用和结果保留在子代理内部；只有其最终消息返回到父代理。

### 并行化
多个子代理可以并发运行，大大加快复杂工作流的速度。

### 专门的指令和知识
每个子代理都可以有定制的系统提示词，具有特定的专业知识、最佳实践和约束。

### 工具限制
子代理可以限制为特定工具，降低意外操作的风险。

## 创建子代理

### 以编程方式定义

Python:
```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

options = ClaudeAgentOptions(
    allowed_tools=["Read", "Grep", "Glob", "Agent"],
    agents={
        "code-reviewer": AgentDefinition(
            description="Expert code review specialist.",
            prompt="You are a code review specialist...",
            tools=["Read", "Grep", "Glob"],
            model="sonnet",
        ),
        "test-runner": AgentDefinition(
            description="Runs and analyzes test suites.",
            prompt="You are a test execution specialist...",
            tools=["Bash", "Read", "Grep"],
        ),
    },
)
```

TypeScript:
```typescript
const options = {
  allowedTools: ["Read", "Grep", "Glob", "Agent"],
  agents: {
    "code-reviewer": {
      description: "Expert code review specialist.",
      prompt: "You are a code review specialist...",
      tools: ["Read", "Grep", "Glob"],
      model: "sonnet"
    },
    "test-runner": {
      description: "Runs and analyzes test suites.",
      prompt: "You are a test execution specialist...",
      tools: ["Bash", "Read", "Grep"]
    }
  }
};
```

### AgentDefinition 配置

| 字段 | 类型 | 必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `description` | `string` | 是 | 何时使用此代理的自然语言描述 |
| `prompt` | `string` | 是 | 代理的系统提示词 |
| `tools` | `string[]` | 否 | 允许的工具名称数组 |
| `model` | `string` | 否 | 此代理的模型覆盖 |
| `skills` | `string[]` | 否 | 预加载的技能名称列表 |
| `maxTurns` | `number` | 否 | 代理停止前的最大代理轮数 |
| `background` | `boolean` | 否 | 作为非阻塞后台任务运行 |
| `effort` | 枚举 | 否 | 推理工作量级别 |
| `permissionMode` | `PermissionMode` | 否 | 权限模式 |

## 子代理继承的内容

| 子代理接收 | 子代理不接收 |
| :--- | :--- |
| 其自己的系统提示词和 Agent 工具的提示词 | 父代理的对话历史或工具结果 |
| 项目 CLAUDE.md（通过 `settingSources` 加载） | 预加载的技能内容（除非在 `skills` 中列出） |
| 工具定义（从父代理继承或子集） | 父代理的系统提示词 |

## 常见工具组合

| 用例 | 工具 | 描述 |
| :--- | :--- | :--- |
| 只读分析 | `Read`、`Grep`、`Glob` | 可以检查代码但不能修改或执行 |
| 测试执行 | `Bash`、`Read`、`Grep` | 可以运行命令并分析输出 |
| 代码修改 | `Read`、`Edit`、`Write`、`Grep`、`Glob` | 完整的读/写访问，无命令执行 |
| 完全访问 | 所有工具 | 从父代理继承所有工具 |
