# SDK 中的 slash commands

> 学习如何通过 SDK 使用 slash commands 来控制 Claude Code 会话

Slash commands 提供了一种方式来控制 Claude Code 会话，使用以 `/` 开头的特殊命令。这些命令可以通过 SDK 发送，以执行诸如压缩上下文、列出上下文使用情况或调用自定义命令等操作。只有在不需要交互式终端的情况下工作的命令才能通过 SDK 分派；`system/init` 消息列出了在您的会话中可用的命令。

<h2 id="discovering-available-slash-commands">
  发现可用的 Slash Commands
</h2>

Claude Agent SDK 在系统初始化消息中提供有关可用 slash commands 的信息。在您的会话开始时访问此信息：

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  for await (const message of query({
    prompt: "Hello Claude",
    options: { maxTurns: 1 }
  })) {
    if (message.type === "system" && message.subtype === "init") {
      console.log("Available slash commands:", message.slash_commands);
      // Example output: ["clear", "compact", "context", "usage"]
    }
  }
  ```

  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import query, ClaudeAgentOptions, SystemMessage


  async def main():
      async for message in query(prompt="Hello Claude", options=ClaudeAgentOptions(max_turns=1)):
          if isinstance(message, SystemMessage) and message.subtype == "init":
              print("Available slash commands:", message.data["slash_commands"])
              # Example output: ["clear", "compact", "context", "usage"]


  asyncio.run(main())
  ```
</CodeGroup>

<h2 id="sending-slash-commands">
  发送 Slash Commands
</h2>

通过在您的提示字符串中包含 slash commands 来发送它们，就像常规文本一样：

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  // Send a slash command
  for await (const message of query({
    prompt: "/compact",
    options: { maxTurns: 1 }
  })) {
    if (message.type === "result" && message.subtype === "success") {
      console.log("Command executed:", message.result);
    }
  }
  ```

  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage


  async def main():
      # Send a slash command
      async for message in query(prompt="/compact", options=ClaudeAgentOptions(max_turns=1)):
          if isinstance(message, ResultMessage):
              print("Command executed:", message.result)


  asyncio.run(main())
  ```
</CodeGroup>

<h2 id="common-slash-commands">
  常见的 Slash Commands
</h2>

<h3 id="/compact-compact-conversation-history">
  `/compact` - 压缩对话历史
</h3>

`/compact` 命令通过总结较早的消息同时保留重要上下文来减少您的对话历史的大小：

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  for await (const message of query({
    prompt: "/compact",
    options: { maxTurns: 1 }
  })) {
    if (message.type === "system" && message.subtype === "compact_boundary") {
      console.log("Compaction completed");
      console.log("Pre-compaction tokens:", message.compact_metadata.pre_tokens);
      console.log("Trigger:", message.compact_metadata.trigger);
    }
  }
  ```

  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import query, ClaudeAgentOptions, SystemMessage


  async def main():
      async for message in query(prompt="/compact", options=ClaudeAgentOptions(max_turns=1)):
          if isinstance(message, SystemMessage) and message.subtype == "compact_boundary":
              print("Compaction completed")
              print("Pre-compaction tokens:", message.data["compact_metadata"]["pre_tokens"])
              print("Trigger:", message.data["compact_metadata"]["trigger"])


  asyncio.run(main())
  ```
</CodeGroup>

<h3 id="/clear-reset-conversation-context">
  `/clear` - 重置对话上下文
</h3>

`/clear` 命令将对话重置为空上下文，因此后续提示将从没有先前对话历史的状态开始。之前的对话保留在磁盘上，可以通过将其会话 ID 传递给 [`resume` 选项](/zh-CN/agent-sdk/sessions#resume-by-id) 来返回。

这在[流式输入模式](/zh-CN/agent-sdk/streaming-vs-single-mode)中很有用，在该模式下您通过单个连接发送多个提示。对于一次性 `query()` 调用，每个调用已经以空上下文开始，因此发送 `/clear` 没有实际效果；请改为启动一个新的 `query()`。

<Note>
  SDK 中的 `/clear` 需要 Claude Code v2.1.117 或更高版本。在早期版本中，它从 `slash_commands` 中被省略。
</Note>

<h2 id="creating-custom-slash-commands">
  创建自定义 Slash Commands
</h2>

除了使用内置 slash commands 外，您还可以创建自己的自定义命令，这些命令可通过 SDK 使用。自定义命令定义为特定目录中的 markdown 文件，类似于 subagents 的配置方式。

<Note>
  `.claude/commands/` 目录是旧版格式。推荐的格式是 `.claude/skills/<name>/SKILL.md`，它支持相同的 slash command 调用（`/name`）加上 Claude 的自主调用。有关当前格式，请参阅 [Skills](/zh-CN/agent-sdk/skills)。CLI 继续支持两种格式，下面的示例对于 `.claude/commands/` 仍然准确。
</Note>

<h3 id="file-locations">
  文件位置
</h3>

自定义 slash commands 根据其范围存储在指定的目录中：

* **项目命令**：`.claude/commands/` - 仅在当前项目中可用（旧版；优先使用 `.claude/skills/`）
* **个人命令**：`~/.claude/commands/` - 在您的所有项目中可用（旧版；优先使用 `~/.claude/skills/`）

<h3 id="file-format">
  文件格式
</h3>

每个自定义命令都是一个 markdown 文件，其中：

* 文件名（不带 `.md` 扩展名）成为命令名称
* 文件内容定义命令的功能
* 可选的 YAML frontmatter 提供配置

<h4 id="basic-example">
  基本示例
</h4>

创建 `.claude/commands/refactor.md`：

```markdown theme={null}
Refactor the selected code to improve readability and maintainability.
Focus on clean code principles and best practices.
```

这创建了 `/refactor` 命令，您可以通过 SDK 使用它。

<h4 id="with-frontmatter">
  带有 Frontmatter
</h4>

创建 `.claude/commands/security-check.md`：

```markdown theme={null}
---
allowed-tools: Read, Grep, Glob
description: Run security vulnerability scan
model: claude-opus-4-7
---

Analyze the codebase for security vulnerabilities including:
- SQL injection risks
- XSS vulnerabilities
- Exposed credentials
- Insecure configurations
```

<h3 id="using-custom-commands-in-the-sdk">
  在 SDK 中使用自定义命令
</h3>

一旦在文件系统中定义，自定义命令就会自动通过 SDK 可用：

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  // Use a custom command
  for await (const message of query({
    prompt: "/refactor src/auth/login.ts",
    options: { maxTurns: 3 }
  })) {
    if (message.type === "assistant") {
      console.log("Refactoring suggestions:", message.message);
    }
  }

  // Custom commands appear in the slash_commands list
  for await (const message of query({
    prompt: "Hello",
    options: { maxTurns: 1 }
  })) {
    if (message.type === "system" && message.subtype === "init") {
      // Will include both built-in and custom commands
      console.log("Available commands:", message.slash_commands);
      // Example: ["clear", "compact", "context", "usage", "refactor", "security-check"]
    }
  }
  ```

  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, SystemMessage


  async def main():
      # Use a custom command
      async for message in query(
          prompt="/refactor src/auth/login.py", options=ClaudeAgentOptions(max_turns=3)
      ):
          if isinstance(message, AssistantMessage):
              for block in message.content:
                  if hasattr(block, "text"):
                      print("Refactoring suggestions:", block.text)

      # Custom commands appear in the slash_commands list
      async for message in query(prompt="Hello", options=ClaudeAgentOptions(max_turns=1)):
          if isinstance(message, SystemMessage) and message.subtype == "init":
              # Will include both built-in and custom commands
              print("Available commands:", message.data["slash_commands"])
              # Example: ["clear", "compact", "context", "usage", "refactor", "security-check"]


  asyncio.run(main())
  ```
</CodeGroup>

<h3 id="advanced-features">
  高级功能
</h3>

<h4 id="arguments-and-placeholders">
  参数和占位符
</h4>

自定义命令支持使用占位符的动态参数：

创建 `.claude/commands/fix-issue.md`：

```markdown theme={null}
---
argument-hint: [issue-number] [priority]
description: Fix a GitHub issue
---

Fix issue #$0 with priority $1.
Check the issue description and implement the necessary changes.
```

在 SDK 中使用：

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  // Pass arguments to custom command
  for await (const message of query({
    prompt: "/fix-issue 123 high",
    options: { maxTurns: 5 }
  })) {
    // Command will process with $0="123" and $1="high"
    if (message.type === "result" && message.subtype === "success") {
      console.log("Issue fixed:", message.result);
    }
  }
  ```

  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage


  async def main():
      # Pass arguments to custom command
      async for message in query(prompt="/fix-issue 123 high", options=ClaudeAgentOptions(max_turns=5)):
          # Command will process with $0="123" and $1="high"
          if isinstance(message, ResultMessage):
              print("Issue fixed:", message.result)


  asyncio.run(main())
  ```
</CodeGroup>

<h4 id="bash-command-execution">
  Bash 命令执行
</h4>

自定义命令可以执行 bash 命令并包含其输出：

创建 `.claude/commands/git-commit.md`：

```markdown theme={null}
---
allowed-tools: Bash(git add *), Bash(git status *), Bash(git commit *)
description: Create a git commit
---

## Context

- Current status: !`git status`
- Current diff: !`git diff HEAD`

## Task

Create a git commit with appropriate message based on the changes.
```

<h4 id="file-references">
  文件引用
</h4>

使用 `@` 前缀包含文件内容：

创建 `.claude/commands/review-config.md`：

```markdown theme={null}
---
description: Review configuration files
---

Review the following configuration files for issues:
- Package config: @package.json
- TypeScript config: @tsconfig.json
- Environment config: @.env

Check for security issues, outdated dependencies, and misconfigurations.
```

<h3 id="organization-with-namespacing">
  使用命名空间进行组织
</h3>

在子目录中组织命令以获得更好的结构：

```bash theme={null}
.claude/commands/
├── frontend/
│   ├── component.md      # Creates /component (project:frontend)
│   └── style-check.md     # Creates /style-check (project:frontend)
├── backend/
│   ├── api-test.md        # Creates /api-test (project:backend)
│   └── db-migrate.md      # Creates /db-migrate (project:backend)
└── review.md              # Creates /review (project)
```

子目录出现在命令描述中，但不影响命令名称本身。

<h3 id="practical-examples">
  实际示例
</h3>

<h4 id="code-review-command">
  代码审查命令
</h4>

创建 `.claude/commands/code-review.md`：

```markdown theme={null}
---
allowed-tools: Read, Grep, Glob, Bash(git diff *)
description: Comprehensive code review
---

## Changed Files
!`git diff --name-only HEAD~1`

## Detailed Changes
!`git diff HEAD~1`

## Review Checklist

Review the above changes for:
1. Code quality and readability
2. Security vulnerabilities
3. Performance implications
4. Test coverage
5. Documentation completeness

Provide specific, actionable feedback organized by priority.
```

<h4 id="test-runner-command">
  测试运行器命令
</h4>

创建 `.claude/commands/test.md`：

```markdown theme={null}
---
allowed-tools: Bash, Read, Edit
argument-hint: [test-pattern]
description: Run tests with optional pattern
---

Run tests matching pattern: $ARGUMENTS

1. Detect the test framework (Jest, pytest, etc.)
2. Run tests with the provided pattern
3. If tests fail, analyze and fix them
4. Re-run to verify fixes
```

通过 SDK 使用这些命令：

<CodeGroup>
  ```typescript TypeScript theme={null}
  import { query } from "@anthropic-ai/claude-agent-sdk";

  // Run code review
  for await (const message of query({
    prompt: "/code-review",
    options: { maxTurns: 3 }
  })) {
    // Process review feedback
  }

  // Run specific tests
  for await (const message of query({
    prompt: "/test auth",
    options: { maxTurns: 5 }
  })) {
    // Handle test results
  }
  ```

  ```python Python theme={null}
  import asyncio
  from claude_agent_sdk import query, ClaudeAgentOptions


  async def main():
      # Run code review
      async for message in query(prompt="/code-review", options=ClaudeAgentOptions(max_turns=3)):
          # Process review feedback
          pass

      # Run specific tests
      async for message in query(prompt="/test auth", options=ClaudeAgentOptions(max_turns=5)):
          # Handle test results
          pass


  asyncio.run(main())
  ```
</CodeGroup>

<h2 id="see-also">
  另请参阅
</h2>

* [Slash Commands](/zh-CN/skills) - 完整的 slash command 文档
* [SDK 中的 Subagents](/zh-CN/agent-sdk/subagents) - 类似的基于文件系统的 subagents 配置
* [TypeScript SDK 参考](/zh-CN/agent-sdk/typescript) - 完整的 API 文档
* [SDK 概述](/zh-CN/agent-sdk/overview) - 一般 SDK 概念
* [CLI 参考](/zh-CN/cli-reference) - 命令行界面
