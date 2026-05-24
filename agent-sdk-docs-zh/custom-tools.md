# 为 Claude 提供自定义工具

> 使用 Claude Agent SDK 的进程内 MCP 服务器定义自定义工具。

## 快速参考

| 如果您想... | 执行此操作 |
| :--- | :--- |
| 定义工具 | 使用 `@tool`（Python）或 `tool()`（TypeScript），包含名称、描述、架构和处理程序 |
| 向 Claude 注册工具 | 在 `create_sdk_mcp_server` / `createSdkMcpServer` 中包装并传递给 `query()` |
| 预先批准工具 | 添加到您的允许工具列表 |
| 让 Claude 并行调用工具 | 在没有副作用的工具上设置 `readOnlyHint: true` |
| 处理错误而不停止循环 | 返回 `isError: true` 而不是抛出异常 |
| 返回图像或文件 | 在内容数组中使用 `image` 或 `resource` 块 |

## 创建自定义工具

工具由四个部分定义：

- **名称**: Claude 用来调用工具的唯一标识符
- **描述**: 工具的功能。Claude 读取此内容以决定何时调用它
- **输入架构**: Claude 必须提供的参数（TypeScript 中用 Zod，Python 中用 dict 或 JSON Schema）
- **处理程序**: 当 Claude 调用工具时运行的异步函数

### 天气工具示例

Python:
```python
from typing import Any
import httpx
from claude_agent_sdk import tool, create_sdk_mcp_server

@tool("get_temperature", "Get the current temperature at a location", {"latitude": float, "longitude": float})
async def get_temperature(args: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={"latitude": args["latitude"], "longitude": args["longitude"], "current": "temperature_2m"},
        )
        data = response.json()
    return {"content": [{"type": "text", "text": f"Temperature: {data['current']['temperature_2m']}°F"}]}

weather_server = create_sdk_mcp_server(name="weather", version="1.0.0", tools=[get_temperature])
```

TypeScript:
```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const getTemperature = tool(
  "get_temperature", "Get the current temperature at a location",
  { latitude: z.number(), longitude: z.number() },
  async (args) => {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m`);
    const data = await response.json();
    return { content: [{ type: "text", text: `Temperature: ${data.current.temperature_2m}°F` }] };
  }
);

const weatherServer = createSdkMcpServer({ name: "weather", version: "1.0.0", tools: [getTemperature] });
```

## 调用自定义工具

通过 `mcpServers` 选项将 MCP 服务器传递给 `query`。工具名称格式：`mcp__{server_name}__{tool_name}`。

## 工具注释

| 字段 | 默认值 | 含义 |
| :--- | :--- | :--- |
| `readOnlyHint` | `false` | 工具不修改其环境 |
| `destructiveHint` | `true` | 工具可能执行破坏性更新 |
| `idempotentHint` | `false` | 重复调用没有额外效果 |
| `openWorldHint` | `true` | 工具到达流程外的系统 |

## 处理错误

| 发生的情况 | 结果 |
| :--- | :--- |
| 处理程序抛出未捕获的异常 | 代理循环停止 |
| 处理程序捕获错误并返回 `isError: true` | 代理循环继续，Claude 可以重试 |

## 返回图像和资源

图像块以 base64 编码的方式内联携带图像字节。资源块嵌入由 URI 标识的内容片段。

## 返回结构化数据

`structuredContent` 是结果上的可选 JSON 对象，与 `content` 数组分开。使用它返回原始值。
