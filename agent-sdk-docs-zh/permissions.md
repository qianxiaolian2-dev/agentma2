# 配置权限

> 使用权限模式、hooks 和声明式允许/拒绝规则来控制您的代理如何使用工具。

## 权限如何被评估

当 Claude 请求一个工具时，SDK 按以下顺序检查权限：

1. **Hooks**: 首先运行 hooks。一个 hook 可以直接拒绝调用或将其传递下去。
2. **拒绝规则**: 检查 `deny` 规则。如果拒绝规则匹配，工具被阻止。
3. **权限模式**: 应用活跃的权限模式。
4. **允许规则**: 检查 `allow` 规则。如果规则匹配，工具被批准。
5. **canUseTool 回调**: 如果上述任何步骤都未解决，调用您的 `canUseTool` 回调。

## 允许和拒绝规则

| 选项 | 效果 |
| :--- | :--- |
| `allowed_tools=["Read", "Grep"]` | `Read` 和 `Grep` 被自动批准 |
| `disallowed_tools=["Bash"]` | `Bash` 工具定义从请求中移除 |
| `disallowed_tools=["Bash(rm *)"]` | `Bash` 保持可用，与 `rm *` 匹配的调用被拒绝 |

## 权限模式

| 模式 | 描述 | 工具行为 |
| :--- | :--- | :--- |
| `default` | 标准权限行为 | 无自动批准；触发 `canUseTool` 回调 |
| `dontAsk` | 拒绝而不是提示 | 未被预批准的内容都被拒绝 |
| `acceptEdits` | 自动接受文件编辑 | 文件编辑和文件系统操作被自动批准 |
| `bypassPermissions` | 绕过所有权限检查 | 所有工具运行而无需权限提示 |
| `plan` | 规划模式 | 只读工具运行；分析和规划而不编辑 |
| `auto`（仅 TypeScript） | 模型分类批准 | 模型分类器批准或拒绝每个工具调用 |

### 设置权限模式

在查询时:
```python
options = ClaudeAgentOptions(permission_mode="default")
```

在流式传输期间动态更改:
```python
await client.set_permission_mode("acceptEdits")
```
