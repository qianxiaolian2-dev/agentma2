# 快速开始

> 使用 Python 或 TypeScript Agent SDK 开始构建能够自主工作的 AI 代理

使用 Agent SDK 构建一个 AI 代理，它可以读取你的代码、发现错误并修复它们，所有这一切都无需手动干预。

## 前置条件

- **Node.js 18+** 或 **Python 3.10+**
- 一个 **Anthropic 账户**（在 platform.claude.com 注册）

## 设置

### 1. 创建项目文件夹

```bash
mkdir my-agent && cd my-agent
```

### 2. 安装 SDK

TypeScript:
```bash
npm install @anthropic-ai/claude-agent-sdk
```

Python (uv):
```bash
uv init && uv add claude-agent-sdk
```

Python (pip):
```bash
python3 -m venv .venv && source .venv/bin/activate
pip3 install claude-agent-sdk
```

### 3. 设置你的 API 密钥

在项目目录中创建一个 `.env` 文件：

```bash
ANTHROPIC_API_KEY=your-api-key
```

## 创建一个有缺陷的文件

创建 `utils.py`:

```python
def calculate_average(numbers):
    total = 0
    for num in numbers:
        total += num
    return total / len(numbers)

def get_user_name(user):
    return user["name"].upper()
```

此代码有两个错误：
1. `calculate_average([])` 会因除以零而崩溃
2. `get_user_name(None)` 会因 TypeError 而崩溃

## 构建一个查找和修复错误的代理

Python (`agent.py`):
```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ResultMessage

async def main():
    async for message in query(
        prompt="Review utils.py for bugs that would cause crashes. Fix any issues you find.",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Glob"],
            permission_mode="acceptEdits",
        ),
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if hasattr(block, "text"):
                    print(block.text)
                elif hasattr(block, "name"):
                    print(f"Tool: {block.name}")
        elif isinstance(message, ResultMessage):
            print(f"Done: {message.subtype}")

asyncio.run(main())
```

TypeScript (`agent.ts`):
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Review utils.py for bugs that would cause crashes. Fix any issues you find.",
  options: {
    allowedTools: ["Read", "Edit", "Glob"],
    permissionMode: "acceptEdits"
  }
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) console.log(block.text);
      else if ("name" in block) console.log(`Tool: ${block.name}`);
    }
  } else if (message.type === "result") {
    console.log(`Done: ${message.subtype}`);
  }
}
```

### 运行你的代理

Python:
```bash
python3 agent.py
```

TypeScript:
```bash
npx tsx agent.ts
```

## 关键概念

**工具**控制你的代理可以做什么：

| 工具 | 代理可以做什么 |
| --- | --- |
| `Read`、`Glob`、`Grep` | 只读分析 |
| `Read`、`Edit`、`Glob` | 分析和修改代码 |
| `Read`、`Edit`、`Bash`、`Glob`、`Grep` | 完全自动化 |

**权限模式**控制你想要多少人工监督：

| 模式 | 行为 | 用例 |
| --- | --- | --- |
| `acceptEdits` | 自动批准文件编辑和常见文件系统命令 | 受信任的开发工作流 |
| `dontAsk` | 拒绝不在 `allowedTools` 中的任何内容 | 锁定的无头代理 |
| `auto`（仅 TypeScript） | 模型分类器批准或拒绝每个工具调用 | 具有安全防护的自主代理 |
| `bypassPermissions` | 运行每个工具而不提示 | 沙箱 CI、完全受信任的环境 |
| `default` | 需要 `canUseTool` 回调来处理批准 | 自定义批准流程 |

## 故障排除

### API 错误 `thinking.type.enabled` 不支持此模型

Claude Opus 4.7 用 `thinking.type.adaptive` 替换了 `thinking.type.enabled`。升级到 Agent SDK v0.2.111 或更高版本以使用 Opus 4.7。
