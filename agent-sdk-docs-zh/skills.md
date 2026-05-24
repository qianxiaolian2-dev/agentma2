# SDK 中的 Agent Skills

> 使用 Claude Agent SDK 中的 Agent Skills 扩展 Claude 的专业能力

## Skills 如何与 SDK 配合使用

1. **定义为文件系统工件**: 在 `.claude/skills/` 中创建为 `SKILL.md` 文件
2. **从文件系统加载**: Skills 从由 `settingSources`/`setting_sources` 管理的文件系统位置加载
3. **自动发现**: 加载文件系统设置后，在启动时从用户和项目目录发现 Skill 元数据
4. **由模型调用**: Claude 根据上下文自动选择何时使用它们
5. **通过 `skills` 选项过滤**: 传递 Skill 名称列表、`"all"` 或 `[]` 来控制可用的 Skills

## 在 SDK 中使用 Skills

```python
options = ClaudeAgentOptions(
    cwd="/path/to/project",
    setting_sources=["user", "project"],
    skills="all",
    allowed_tools=["Read", "Write", "Bash"],
)
```

```typescript
const options = {
  cwd: "/path/to/project",
  settingSources: ["user", "project"],
  skills: "all",
  allowedTools: ["Read", "Write", "Bash"]
};
```

要仅启用特定 Skills:
```python
options = ClaudeAgentOptions(skills=["pdf", "docx"])
```

## Skill 位置

- **项目 Skills** (`.claude/skills/`): 通过 git 与团队共享
- **用户 Skills** (`~/.claude/skills/`): 跨所有项目的个人 Skills
- **插件 Skills**: 与已安装的 Claude Code 插件捆绑

## 创建 Skills

Skills 定义为包含带有 YAML frontmatter 和 Markdown 内容的 `SKILL.md` 文件的目录。

```
.claude/skills/processing-pdfs/
└── SKILL.md
```

## 工具限制

SKILL.md 中的 `allowed-tools` frontmatter 字段仅在直接使用 Claude Code CLI 时受支持。通过 SDK 使用 Skills 时不适用。使用 SDK 时，通过查询配置中的主 `allowedTools` 选项控制工具访问。
