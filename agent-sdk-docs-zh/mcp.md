# 使用 MCP 连接外部工具

> 配置 MCP 服务器以扩展您的代理的外部工具。

## 添加 MCP 服务器

### 在代码中

TypeScript:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "List files in my project",
  options: {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
      }
    },
    allowedTools: ["mcp__filesystem__*"]
  }
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

Python:
```python
options = ClaudeAgentOptions(
    mcp_servers={
        "filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"],
        }
    },
    allowed_tools=["mcp__filesystem__*"],
)
```

### 从配置文件

在项目根目录创建 `.mcp.json` 文件。当启用 `project` 设置源时，该文件会被选中。

## 允许 MCP 工具

MCP 工具遵循命名模式 `mcp__<server-name>__<tool-name>`。

使用通配符 (`*`) 允许来自服务器的所有工具。

## 传输类型

### stdio 服务器
通过 stdin/stdout 通信的本地进程。

### HTTP/SSE 服务器
对于云托管的 MCP 服务器和远程 API。

### SDK MCP 服务器
直接在应用程序代码中定义自定义工具。

## MCP 工具搜索

工具搜索通过从上下文中隐藏工具定义并仅加载 Claude 每轮需要的工具来解决上下文窗口消耗问题。工具搜索默认启用。

## 身份验证

### 通过环境变量传递凭据

```typescript
mcpServers: {
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  }
}
```

### 远程服务器的 HTTP 标头

```typescript
mcpServers: {
  "secure-api": {
    type: "http",
    url: "https://api.example.com/mcp",
    headers: { Authorization: `Bearer ${process.env.API_TOKEN}` }
  }
}
```

## 错误处理

SDK 在每个查询开始时发出一个 `system` 消息，子类型为 `init`。此消息包括每个 MCP 服务器的连接状态。检查 `status` 字段以在代理开始工作之前检测连接失败。
