# 在 SDK 中使用 Claude Code 功能

> 将项目说明、skills、hooks 和其他 Claude Code 功能加载到您的 SDK 代理中。

## 使用 settingSources 控制文件系统设置

设置源选项（Python 中的 `setting_sources`、TypeScript 中的 `settingSources`）控制 SDK 加载哪些基于文件系统的设置。

| 源 | 加载的内容 | 位置 |
| :--- | :--- | :--- |
| `"project"` | 项目 CLAUDE.md、`.claude/rules/*.md`、项目 skills、项目 hooks、项目 `settings.json` | `<cwd>/.claude/` |
| `"user"` | 用户 CLAUDE.md、用户 skills、用户设置 | `~/.claude/` |
| `"local"` | CLAUDE.local.md、`.claude/settings.local.json` | `<cwd>/.claude/` |

省略 `settingSources` 等同于 `["user", "project", "local"]`。

### settingSources 不控制的内容

- 托管策略设置：主机上存在时始终加载
- `~/.claude.json` 全局配置：始终读取
- 自动内存：默认加载到系统提示中

## 项目说明（CLAUDE.md 和规则）

### CLAUDE.md 加载位置

| 级别 | 位置 | 加载时间 |
| :--- | :--- | :--- |
| 项目（根） | `<cwd>/CLAUDE.md` 或 `<cwd>/.claude/CLAUDE.md` | `settingSources` 包含 `"project"` |
| 项目规则 | `<cwd>/.claude/rules/*.md` | `settingSources` 包含 `"project"` |
| 本地 | `<cwd>/CLAUDE.local.md` | `settingSources` 包含 `"local"` |
| 用户 | `~/.claude/CLAUDE.md` | `settingSources` 包含 `"user"` |
| 用户规则 | `~/.claude/rules/*.md` | `settingSources` 包含 `"user"` |

## Skills

Skills 通过 `settingSources` 从文件系统中发现。当 `query()` 上的 `skills` 选项被省略时，发现的用户和项目 skills 会被启用。

## Hooks

SDK 支持两种定义 hooks 的方式：

- **文件系统 hooks**: 在 `settings.json` 中定义的 shell 命令，当 `settingSources` 包含相关源时加载。
- **编程 hooks**: 直接传递给 `query()` 的回调函数。

### 何时使用哪种 hook 类型

| Hook 类型 | 最适合 |
| :--- | :--- |
| **文件系统**（`settings.json`） | 在 CLI 和 SDK 会话之间共享 hooks |
| **编程**（`query()` 中的回调） | 应用程序特定的逻辑；返回结构化决策；进程内集成 |

## 选择正确的功能

| 您想要... | 使用 | SDK 表面 |
| :--- | :--- | :--- |
| 设置代理始终遵循的项目约定 | CLAUDE.md | `settingSources: ["project"]` |
| 为代理提供参考材料 | Skills | `settingSources` + `skills` 选项 |
| 运行可重用的工作流 | 用户可调用的 skills | `settingSources` + `skills` 选项 |
| 将隔离的子任务委托给新的上下文 | 子代理 | `agents` 参数 + `allowedTools: ["Agent"]` |
| 在工具调用上运行确定性逻辑 | Hooks | `hooks` 参数 |
| 为 Claude 提供对外部服务的结构化工具访问 | MCP | `mcpServers` 参数 |
