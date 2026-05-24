# Agent SDK 概览

> 使用 Claude Code 作为库构建生产级 AI 代理

构建能够自主读取文件、运行命令、搜索网络、编辑代码等的 AI 代理。Agent SDK 为您提供了与 Claude Code 相同的工具、代理循环和上下文管理，可在 Python 和 TypeScript 中编程。

## 开始使用

### 安装 SDK

TypeScript:
```bash
npm install @anthropic-ai/claude-agent-sdk
```

Python:
```bash
pip install claude-agent-sdk
```

### 设置您的 API 密钥

从控制台获取 API 密钥，然后将其设置为环境变量：

```bash
export ANTHROPIC_API_KEY=your-api-key
```

SDK 还支持通过第三方 API 提供商进行身份验证：

- **Amazon Bedrock**: 设置 `CLAUDE_CODE_USE_BEDROCK=1` 环境变量并配置 AWS 凭证
- **Claude Platform on AWS**: 设置 `CLAUDE_CODE_USE_ANTHROPIC_AWS=1` 和 `ANTHROPIC_AWS_WORKSPACE_ID`，然后配置 AWS 凭证
- **Google Vertex AI**: 设置 `CLAUDE_CODE_USE_VERTEX=1` 环境变量并配置 Google Cloud 凭证
- **Microsoft Azure**: 设置 `CLAUDE_CODE_USE_FOUNDRY=1` 环境变量并配置 Azure 凭证

## 功能

使 Claude Code 强大的一切都可在 SDK 中使用：

### 内置工具

| 工具 | 功能 |
| --- | --- |
| **Read** | 读取工作目录中的任何文件 |
| **Write** | 创建新文件 |
| **Edit** | 对现有文件进行精确编辑 |
| **Bash** | 运行终端命令、脚本、git 操作 |
| **Monitor** | 监视后台脚本并对每个输出行作为事件做出反应 |
| **Glob** | 按模式查找文件 |
| **Grep** | 使用正则表达式搜索文件内容 |
| **WebSearch** | 搜索网络以获取当前信息 |
| **WebFetch** | 获取并解析网页内容 |
| **AskUserQuestion** | 向用户提出带有多选选项的澄清问题 |

### Hooks

在代理生命周期的关键点运行自定义代码。可用 hooks: `PreToolUse`、`PostToolUse`、`Stop`、`SessionStart`、`SessionEnd`、`UserPromptSubmit` 等。

### 子代理

生成专门的代理来处理专注的子任务。您的主代理委派工作，子代理报告结果。

### MCP

通过 Model Context Protocol 连接到外部系统：数据库、浏览器、API 等。

### 权限

精确控制您的代理可以使用哪些工具。允许安全操作、阻止危险操作或要求对敏感操作进行批准。

### 会话

在多次交换中保持上下文。Claude 记住读取的文件、完成的分析和对话历史。

### Claude Code 功能

| 功能 | 描述 | 位置 |
| --- | --- | --- |
| Skills | 在 Markdown 中定义的专门功能 | `.claude/skills/*/SKILL.md` |
| Slash commands | 用于常见任务的自定义命令 | `.claude/commands/*.md` |
| Memory | 项目上下文和说明 | `CLAUDE.md` 或 `.claude/CLAUDE.md` |
| Plugins | 使用自定义命令、代理和 MCP 服务器扩展 | 通过 `plugins` 选项编程 |

## 将 Agent SDK 与其他 Claude 工具进行比较

### Agent SDK vs Client SDK

Anthropic Client SDK 为您提供直接 API 访问：您发送提示并自己实现工具执行。Agent SDK 为您提供具有内置工具执行的 Claude。

### Agent SDK vs Claude Code CLI

相同的功能，不同的界面：

| 用例 | 最佳选择 |
| --- | --- |
| 交互式开发 | CLI |
| CI/CD 管道 | SDK |
| 自定义应用程序 | SDK |
| 一次性任务 | CLI |
| 生产自动化 | SDK |

### Agent SDK vs Managed Agents

|  | Agent SDK | Managed Agents |
| --- | --- | --- |
| **运行位置** | 您的进程，您的基础设施 | Anthropic 管理的基础设施 |
| **界面** | Python 或 TypeScript 库 | REST API |
| **代理工作于** | 您的基础设施上的文件 | 每个会话的托管沙箱 |
| **会话状态** | 您的文件系统上的 JSONL | Anthropic 托管的事件日志 |
| **自定义工具** | 进程内 Python 或 TypeScript 函数 | Claude 触发工具；您执行并返回结果 |
| **最适合** | 本地原型设计 | 生产代理 |

## 品牌指南

**允许：**
- "Claude Agent"（首选用于下拉菜单）
- "Claude"（当已在标记为"Agents"的菜单中时）
- "{YourAgentName} Powered by Claude"

**不允许：**
- "Claude Code" 或 "Claude Code Agent"
- Claude Code 品牌的 ASCII 艺术或模仿 Claude Code 的视觉元素

## 许可证和条款

Claude Agent SDK 的使用受 Anthropic 商业服务条款管制。
