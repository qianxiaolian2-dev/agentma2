# 迁移到 Claude Agent SDK

> 将 Claude Code TypeScript 和 Python SDK 迁移到 Claude Agent SDK 的指南

## 变更内容

| 方面 | 旧版本 | 新版本 |
| :--- | :--- | :--- |
| **包名称 (TS/JS)** | `@anthropic-ai/claude-code` | `@anthropic-ai/claude-agent-sdk` |
| **Python 包** | `claude-code-sdk` | `claude-agent-sdk` |

## 迁移步骤

### TypeScript/JavaScript

1. 卸载旧包: `npm uninstall @anthropic-ai/claude-code`
2. 安装新包: `npm install @anthropic-ai/claude-agent-sdk`
3. 更新导入: `@anthropic-ai/claude-code` → `@anthropic-ai/claude-agent-sdk`

### Python

1. 卸载旧包: `pip uninstall claude-code-sdk`
2. 安装新包: `pip install claude-agent-sdk`
3. 更新导入: `claude_code_sdk` → `claude_agent_sdk`
4. 更新类型名称: `ClaudeCodeOptions` → `ClaudeAgentOptions`

## 破坏性变更

### Python: ClaudeCodeOptions 重命名为 ClaudeAgentOptions

```python
# 之前
from claude_code_sdk import query, ClaudeCodeOptions
options = ClaudeCodeOptions(model="claude-opus-4-7", permission_mode="acceptEdits")

# 之后
from claude_agent_sdk import query, ClaudeAgentOptions
options = ClaudeAgentOptions(model="claude-opus-4-7", permission_mode="acceptEdits")
```

### 系统提示不再是默认值

SDK 不再默认使用 Claude Code 的系统提示。要获得旧行为，请显式请求 Claude Code 的预设：

```python
options = ClaudeAgentOptions(
    system_prompt={"type": "preset", "preset": "claude_code"}
)
```

```typescript
const options = {
  systemPrompt: { type: "preset", preset: "claude_code" }
};
```

### 设置源默认值

在 `query()` 上省略 `settingSources` 会加载用户、项目和本地文件系统设置。要从文件系统设置中隔离运行，请传递空数组：

```python
options = ClaudeAgentOptions(setting_sources=[])
```

```typescript
const options = { settingSources: [] };
```
