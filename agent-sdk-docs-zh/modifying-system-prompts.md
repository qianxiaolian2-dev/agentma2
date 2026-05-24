# 修改系统提示词

> 在 `claude_code` 预设和自定义系统提示词之间进行选择，并通过 CLAUDE.md、输出样式、追加或完全自定义提示词来自定义行为。

## 系统提示词的工作原理

Agent SDK 有三个起点：

- **最小默认值**: 当不设置 `systemPrompt`/`system_prompt` 时，SDK 使用最小提示词
- **`claude_code` 预设**: Claude Code CLI 使用的完整系统提示词
- **自定义字符串**: 你自己编写的提示词

### 决定起点

| 你正在构建 | 使用 | 你获得的内容 |
| :--- | :--- | :--- |
| CLI 或类似 IDE 的编码工具 | `claude_code` 预设 | 完整的 Claude Code 提示词 |
| 相同类型的工具，加上产品特定的规则 | `claude_code` 预设加 `append` | 上述所有内容，加上你的指令 |
| 具有不同表面、身份或权限模型的代理 | 自定义提示词字符串 | 仅你编写的内容 |
| 薄工具调用循环，没有代理角色 | 无 `systemPrompt` 选项 | 最小默认值 |

## 自定义 agent 行为

### CLAUDE.md 文件用于项目级指令

CLAUDE.md 文件为 Claude 提供持久的项目上下文和指令。

### 输出样式用于持久配置

输出样式是保存的配置，可以修改 Claude 的系统提示词。存储为 markdown 文件。

### 追加到 `claude_code` 预设

```python
system_prompt={
    "type": "preset",
    "preset": "claude_code",
    "append": "Always include detailed docstrings and type hints in Python code.",
}
```

### 自定义系统提示词

```python
options = ClaudeAgentOptions(system_prompt="You are a Python coding specialist...")
```

## 比较四种方法

| 功能 | CLAUDE.md | 输出样式 | 带有追加的 systemPrompt | 自定义 systemPrompt |
| --- | --- | --- | --- | --- |
| **持久性** | 每个项目文件 | 保存为文件 | 仅会话 | 仅会话 |
| **可重用性** | 每个项目 | 跨项目 | 代码重复 | 代码重复 |
| **默认工具** | 保留 | 保留 | 保留 | 丢失 |
| **内置安全** | 维护 | 维护 | 维护 | 必须添加 |
| **自定义级别** | 仅添加 | 替换或扩展默认 | 仅添加 | 完全控制 |
