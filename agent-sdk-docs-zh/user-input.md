# 处理批准和用户输入

> 向用户显示 Claude 的批准请求和澄清问题，然后将他们的决定返回给 SDK。

## 检测 Claude 何时需要输入

在您的查询选项中传递 `canUseTool` 回调。回调在两种情况下触发：

1. **工具需要批准**: Claude 想要使用不被权限规则自动批准的工具
2. **Claude 提出问题**: Claude 调用 `AskUserQuestion` 工具

## 处理工具批准请求

回调接收三个参数：
- `toolName`: Claude 想要使用的工具的名称
- `input`: Claude 传递给工具的参数
- `options`/`context`: 附加上下文，包括取消信号

常见输入字段：

| 工具 | 输入字段 |
| --- | --- |
| `Bash` | `command`、`description`、`timeout` |
| `Write` | `file_path`、`content` |
| `Edit` | `file_path`、`old_string`、`new_string` |
| `Read` | `file_path`、`offset`、`limit` |

### 响应工具请求

| 响应 | Python | TypeScript |
| --- | --- | --- |
| **允许** | `PermissionResultAllow(updated_input=...)` | `{ behavior: "allow", updatedInput }` |
| **拒绝** | `PermissionResultDeny(message=...)` | `{ behavior: "deny", message }` |

## 处理澄清问题

当 Claude 调用 `AskUserQuestion` 工具时，触发您的 `canUseTool` 回调。

### 问题格式

每个问题都有这些字段：
- `question`: 要显示的完整问题文本
- `header`: 问题的短标签（最多 12 个字符）
- `options`: 2-4 个选择的数组
- `multiSelect`: 如果为 true，用户可以选择多个选项

### 响应格式

返回 `answers` 对象，将每个问题的 `question` 字段映射到所选选项的 `label`：

```json
{
  "questions": [...],
  "answers": {
    "How should I format the output?": "Summary"
  }
}
```

### 支持自由文本输入

Claude 的预定义选项并不总是涵盖用户想要的内容。显示额外的"其他"选择，接受文本输入，使用用户的自定义文本作为答案值。

## 获取用户输入的其他方式

- **流输入**: 在任务中断代理、提供额外上下文、构建聊天界面
- **自定义工具**: 收集结构化输入、集成外部批准系统、实现特定领域的交互
