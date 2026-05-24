# SDK 中的 slash commands

> 学习如何通过 SDK 使用 slash commands 来控制 Claude Code 会话

## 发现可用的 Slash Commands

```python
async for message in query(prompt="Hello Claude", options=ClaudeAgentOptions(max_turns=1)):
    if isinstance(message, SystemMessage) and message.subtype == "init":
        print("Available slash commands:", message.data["slash_commands"])
```

```typescript
if (message.type === "system" && message.subtype === "init") {
  console.log("Available slash commands:", message.slash_commands);
}
```

## 发送 Slash Commands

通过在您的提示字符串中包含 slash commands 来发送它们：

```python
async for message in query(prompt="/compact", options=ClaudeAgentOptions(max_turns=1)):
    ...
```

## 常见的 Slash Commands

### `/compact` - 压缩对话历史

通过总结较早的消息同时保留重要上下文来减少对话历史的大小。

### 清除对话

交互式 `/clear` 命令在 SDK 中不可用。每个 `query()` 调用已经开始一个新的对话。要清除上下文，请结束当前的 `query()` 并开始一个新的。

## 创建自定义 Slash Commands

### 文件位置

- **项目命令**: `.claude/commands/`（旧版；优先使用 `.claude/skills/`）
- **个人命令**: `~/.claude/commands/`（旧版；优先使用 `~/.claude/skills/`）

### 文件格式

每个自定义命令是一个 markdown 文件。文件名（不带 `.md` 扩展名）成为命令名称。

#### 基本示例

创建 `.claude/commands/refactor.md`:
```markdown
Refactor the selected code to improve readability and maintainability.
Focus on clean code principles and best practices.
```

#### 带有 Frontmatter

```markdown
---
allowed-tools: Read, Grep, Glob
description: Run security vulnerability scan
model: claude-opus-4-7
---

Analyze the codebase for security vulnerabilities...
```

### 高级功能

- **参数和占位符**: 使用 `$1`、`$2` 等动态参数
- **Bash 命令执行**: 使用 `!` 前缀包含命令输出
- **文件引用**: 使用 `@` 前缀包含文件内容
