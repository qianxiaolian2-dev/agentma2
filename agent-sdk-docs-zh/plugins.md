# SDK 中的 Plugins

> 通过 Agent SDK 加载自定义 plugins，使用命令、agents、skills 和 hooks 扩展 Claude Code

## 什么是 plugins？

Plugins 是 Claude Code 扩展的包，可以包括：
- **Skills**: Claude 自主使用的模型调用功能
- **Agents**: 用于特定任务的专门子 agents
- **Hooks**: 响应工具使用和其他事件的事件处理程序
- **MCP servers**: 通过 Model Context Protocol 的外部工具集成

## 加载 plugins

```python
options = ClaudeAgentOptions(
    plugins=[
        {"type": "local", "path": "./my-plugin"},
        {"type": "local", "path": "/absolute/path/to/another-plugin"},
    ]
)
```

```typescript
options: {
  plugins: [
    { type: "local", path: "./my-plugin" },
    { type: "local", path: "/absolute/path/to/another-plugin" }
  ]
}
```

### 路径规范

Plugin 路径可以是：
- **相对路径**: 相对于你的当前工作目录解析
- **绝对路径**: 完整文件系统路径

路径应指向 plugin 的根目录（包含 `.claude-plugin/plugin.json` 的目录）。

## 使用 plugin skills

来自 plugins 的 skills 会自动使用 plugin 名称进行命名空间划分。格式为 `plugin-name:skill-name`。

## Plugin 结构参考

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Required: plugin manifest
├── skills/                   # Agent Skills
│   └── my-skill/
│       └── SKILL.md
├── commands/                 # Legacy: use skills/ instead
│   └── custom-cmd.md
├── agents/                   # Custom agents
│   └── specialist.md
├── hooks/                    # Event handlers
│   └── hooks.json
└── .mcp.json                # MCP server definitions
```
