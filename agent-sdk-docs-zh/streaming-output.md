# 实时流式传输响应

> 当文本和工具调用流入时，从 Agent SDK 获取实时响应

## 启用流式输出

在选项中将 `include_partial_messages`（Python）或 `includePartialMessages`（TypeScript）设置为 `true`。

Python:
```python
from claude_agent_sdk import query, ClaudeAgentOptions
from claude_agent_sdk.types import StreamEvent
import asyncio

async def stream_response():
    options = ClaudeAgentOptions(
        include_partial_messages=True,
        allowed_tools=["Bash", "Read"],
    )

    async for message in query(prompt="List the files in my project", options=options):
        if isinstance(message, StreamEvent):
            event = message.event
            if event.get("type") == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    print(delta.get("text", ""), end="", flush=True)

asyncio.run(stream_response())
```

TypeScript:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "List the files in my project",
  options: { includePartialMessages: true, allowedTools: ["Bash", "Read"] }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        process.stdout.write(event.delta.text);
      }
    }
  }
}
```

## StreamEvent 参考

- **Python**: `StreamEvent`（从 `claude_agent_sdk.types` 导入）
- **TypeScript**: `SDKPartialAssistantMessage`，其中 `type: 'stream_event'`

常见的事件类型：

| 事件类型 | 描述 |
| :--- | :--- |
| `message_start` | 新消息的开始 |
| `content_block_start` | 新内容块的开始（文本或工具使用） |
| `content_block_delta` | 内容的增量更新 |
| `content_block_stop` | 内容块的结束 |
| `message_delta` | 消息级别的更新（停止原因、使用情况） |
| `message_stop` | 消息的结束 |

## 消息流

启用部分消息后，按以下顺序接收消息：

```
StreamEvent (message_start)
StreamEvent (content_block_start) - 文本块
StreamEvent (content_block_delta) - 文本块...
StreamEvent (content_block_stop)
StreamEvent (content_block_start) - tool_use 块
StreamEvent (content_block_delta) - 工具输入块...
StreamEvent (content_block_stop)
StreamEvent (message_delta)
StreamEvent (message_stop)
AssistantMessage - 包含所有内容的完整消息
... 工具执行 ...
ResultMessage - 最终结果
```

## 已知限制

- **扩展思考**: 当设置 `max_thinking_tokens`/`maxThinkingTokens` 时，不会发出 `StreamEvent` 消息
- **结构化输出**: JSON 结果仅出现在最终 `ResultMessage.structured_output` 中
