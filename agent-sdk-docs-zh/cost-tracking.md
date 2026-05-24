# 跟踪成本和使用情况

> 了解如何跟踪令牌使用情况、估计成本，以及使用 Claude Agent SDK 配置提示缓存。

## 理解令牌使用情况

TypeScript 和 Python SDK 使用不同的字段名称公开相同的使用数据：

- **TypeScript** 在每个助手消息上提供每步令牌细分，通过结果消息上的 `modelUsage` 提供每个模型的成本，以及结果消息上的累积总计。
- **Python** 在每个助手消息上提供每步令牌细分，通过结果消息上的 `model_usage` 提供每个模型的成本，以及结果消息上的累积总计。

### 获取查询的总成本

TypeScript:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt: "Summarize this project" })) {
  if (message.type === "result") {
    console.log(`Total cost: $${message.total_cost_usd}`);
  }
}
```

Python:
```python
from claude_agent_sdk import query, ResultMessage
import asyncio

async def main():
    async for message in query(prompt="Summarize this project"):
        if isinstance(message, ResultMessage):
            print(f"Total cost: ${message.total_cost_usd or 0}")

asyncio.run(main())
```

### 跟踪每步使用情况

每条助手消息包含 `usage` 对象，其中包含令牌计数。当 Claude 并行使用工具时，多条消息共享相同的 ID 和相同的使用数据。始终按 ID 去重。

### 按模型细分使用情况

结果消息包括 `modelUsage`/`model_usage`，一个模型名称到每个模型令牌计数和成本的映射。

### 累积多个调用的成本

每个 `query()` 调用返回其自己的 `total_cost_usd`。SDK 不提供会话级别的总计，需要自己累积。

### 跟踪缓存令牌

Agent SDK 自动使用提示缓存来减少重复内容的成本。使用对象包括：
- `cache_creation_input_tokens`: 用于创建新缓存条目的令牌
- `cache_read_input_tokens`: 从现有缓存条目读取的令牌

### 将提示缓存 TTL 扩展到一小时

设置 `ENABLE_PROMPT_CACHING_1H` 环境变量以请求缓存写入的 1 小时 TTL。
