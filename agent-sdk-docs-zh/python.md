# Agent SDK 参考 - Python

> Python Agent SDK 的完整 API 参考，包括所有函数、类型和类。

## 安装

```bash
pip install claude-agent-sdk
```

## 在 `query()` 和 `ClaudeSDKClient` 之间选择

Python SDK 提供了两种与 Claude Code 交互的方式：

### 快速比较

| 功能        | `query()`                                  | `ClaudeSDKClient` |
| :-------- | :----------------------------------------- | :---------------- |
| **会话**    | 默认创建新会话                                    | 重用同一会话            |
| **对话**    | 单次交换                                       | 同一上下文中的多次交换       |
| **连接**    | 自动管理                                       | 手动控制              |
| **流式输入**  | ✅ 支持                                       | ✅ 支持              |
| **中断**    | ❌ 不支持                                      | ✅ 支持              |
| **hooks** | ✅ 支持                                       | ✅ 支持              |
| **自定义工具** | ✅ 支持                                       | ✅ 支持              |
| **继续聊天**  | 通过 `continue_conversation` 或 `resume` 手动进行 | ✅ 自动              |
| **用例**    | 一次性任务                                      | 持续对话              |

### 何时使用 `query()`（一次性任务）

**最适合：**

* 不需要对话历史的一次性问题
* 不需要来自之前交换的上下文的独立任务
* 简单的自动化脚本
* 当你想每次都重新开始时

### 何时使用 `ClaudeSDKClient`（持续对话）

**最适合：**

* **继续对话** - 当你需要 Claude 记住上下文时
* **后续问题** - 基于之前的响应进行构建
* **交互式应用程序** - 聊天界面、REPL
* **响应驱动的逻辑** - 当下一步操作取决于 Claude 的响应时
* **会话控制** - 显式管理对话生命周期

## 函数

### `query()`

为每次与 Claude Code 的交互创建一个新会话。默认情况下返回一个异步迭代器，当消息到达时产生消息。每次调用 `query()` 都会重新开始，不记得之前的交互，除非你传递 `continue_conversation=True` 或在 [`ClaudeAgentOptions`](#claudeagentoptions) 中传递 `resume`。参见 [Sessions](/zh-CN/agent-sdk/sessions)。

```python
async def query(
    *,
    prompt: str | AsyncIterable[dict[str, Any]],
    options: ClaudeAgentOptions | None = None,
    transport: Transport | None = None
) -> AsyncIterator[Message]
```

#### 参数

| 参数          | 类型                           | 描述                                          |
| :---------- | :--------------------------- | :------------------------------------------ |
| `prompt`    | `str \| AsyncIterable[dict]` | 输入提示，可以是字符串或用于流式模式的异步可迭代对象                  |
| `options`   | `ClaudeAgentOptions \| None` | 可选配置对象（如果为 None，默认为 `ClaudeAgentOptions()`） |
| `transport` | `Transport \| None`          | 用于与 CLI 进程通信的可选自定义传输                        |

#### 返回

返回一个 `AsyncIterator[Message]`，从对话中产生消息。

#### 示例 - 带选项

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions


async def main():
    options = ClaudeAgentOptions(
        system_prompt="You are an expert Python developer",
        permission_mode="acceptEdits",
        cwd="/home/user/project",
    )

    async for message in query(prompt="Create a Python web server", options=options):
        print(message)


asyncio.run(main())
```

### `tool()`

用于定义具有类型安全的 MCP 工具的装饰器。

```python
def tool(
    name: str,
    description: str,
    input_schema: type | dict[str, Any],
    annotations: ToolAnnotations | None = None
) -> Callable[[Callable[[Any], Awaitable[dict[str, Any]]]], SdkMcpTool[Any]]
```

#### 参数

| 参数             | 类型                                              | 描述                      |
| :------------- | :---------------------------------------------- | :---------------------- |
| `name`         | `str`                                           | 工具的唯一标识符                |
| `description`  | `str`                                           | 工具功能的人类可读描述             |
| `input_schema` | `type \| dict[str, Any]`                        | 定义工具输入参数的模式（见下文）        |
| `annotations`  | [`ToolAnnotations`](#toolannotations)` \| None` | 可选的 MCP 工具注解，为客户端提供行为提示 |

#### 输入模式选项

1. **简单类型映射**（推荐）：

   ```python
   {"text": str, "count": int, "enabled": bool}
   ```

2. **JSON Schema 格式**（用于复杂验证）：

   ```python
   {
       "type": "object",
       "properties": {
           "text": {"type": "string"},
           "count": {"type": "integer", "minimum": 0},
       },
       "required": ["text"],
   }
   ```

#### 返回

一个装饰器函数，包装工具实现并返回一个 `SdkMcpTool` 实例。

#### 示例

```python
from claude_agent_sdk import tool
from typing import Any


@tool("greet", "Greet a user", {"name": str})
async def greet(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": f"Hello, {args['name']}!"}]}
```

#### `ToolAnnotations`

从 `mcp.types` 重新导出（也可以从 `claude_agent_sdk` 导入为 `from claude_agent_sdk import ToolAnnotations`）。所有字段都是可选的提示；客户端不应依赖它们做出安全决策。

| 字段                | 类型             | 默认值     | 描述                                                             |
| :---------------- | :------------- | :------ | :------------------------------------------------------------- |
| `title`           | `str \| None`  | `None`  | 工具的人类可读标题                                                      |
| `readOnlyHint`    | `bool \| None` | `False` | 如果为 `True`，工具不修改其环境                                            |
| `destructiveHint` | `bool \| None` | `True`  | 如果为 `True`，工具可能执行破坏性更新（仅当 `readOnlyHint` 为 `False` 时有意义）       |
| `idempotentHint`  | `bool \| None` | `False` | 如果为 `True`，使用相同参数的重复调用没有额外效果（仅当 `readOnlyHint` 为 `False` 时有意义） |
| `openWorldHint`   | `bool \| None` | `True`  | 如果为 `True`，工具与外部实体交互（例如网络搜索）。如果为 `False`，工具的域是封闭的（例如内存工具）      |

```python
from claude_agent_sdk import tool, ToolAnnotations
from typing import Any


@tool(
    "search",
    "Search the web",
    {"query": str},
    annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
)
async def search(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": f"Results for: {args['query']}"}]}
```

### `create_sdk_mcp_server()`

创建在 Python 应用程序中运行的进程内 MCP 服务器。

```python
def create_sdk_mcp_server(
    name: str,
    version: str = "1.0.0",
    tools: list[SdkMcpTool[Any]] | None = None
) -> McpSdkServerConfig
```

#### 参数

| 参数        | 类型                              | 默认值       | 描述                      |
| :-------- | :------------------------------ | :-------- | :---------------------- |
| `name`    | `str`                           | -         | 服务器的唯一标识符               |
| `version` | `str`                           | `"1.0.0"` | 服务器版本字符串                |
| `tools`   | `list[SdkMcpTool[Any]] \| None` | `None`    | 使用 `@tool` 装饰器创建的工具函数列表 |

#### 返回

返回一个 `McpSdkServerConfig` 对象，可以传递给 `ClaudeAgentOptions.mcp_servers`。

#### 示例

```python
from claude_agent_sdk import tool, create_sdk_mcp_server


@tool("add", "Add two numbers", {"a": float, "b": float})
async def add(args):
    return {"content": [{"type": "text", "text": f"Sum: {args['a'] + args['b']}"}]}


@tool("multiply", "Multiply two numbers", {"a": float, "b": float})
async def multiply(args):
    return {"content": [{"type": "text", "text": f"Product: {args['a'] * args['b']}"}]}


calculator = create_sdk_mcp_server(
    name="calculator",
    version="2.0.0",
    tools=[add, multiply],
)

# Use with Claude
options = ClaudeAgentOptions(
    mcp_servers={"calc": calculator},
    allowed_tools=["mcp__calc__add", "mcp__calc__multiply"],
)
```

### `list_sessions()`

列出带有元数据的过去会话。按项目目录过滤或列出所有项目中的会话。同步；立即返回。

```python
def list_sessions(
    directory: str | None = None,
    limit: int | None = None,
    include_worktrees: bool = True
) -> list[SDKSessionInfo]
```

#### 参数

| 参数                  | 类型            | 默认值    | 描述                                             |
| :------------------ | :------------ | :----- | :--------------------------------------------- |
| `directory`         | `str \| None` | `None` | 列出会话的目录。省略时，返回所有项目中的会话                         |
| `limit`             | `int \| None` | `None` | 返回的最大会话数                                       |
| `include_worktrees` | `bool`        | `True` | 当 `directory` 在 git 仓库内时，包括所有 worktrees 路径中的会话 |

#### 返回类型：`SDKSessionInfo`

| 属性              | 类型            | 描述                                           |
| :-------------- | :------------ | :------------------------------------------- |
| `session_id`    | `str`         | 唯一会话标识符                                      |
| `summary`       | `str`         | 显示标题：自定义标题、自动生成的摘要或第一个提示                     |
| `last_modified` | `int`         | 上次修改时间（自纪元以来的毫秒数）                            |
| `file_size`     | `int \| None` | 会话文件大小（字节）（远程存储后端为 `None`）                   |
| `custom_title`  | `str \| None` | 用户设置的会话标题                                    |
| `first_prompt`  | `str \| None` | 会话中的第一个有意义的用户提示                              |
| `git_branch`    | `str \| None` | 会话结束时的 Git 分支                                |
| `cwd`           | `str \| None` | 会话的工作目录                                      |
| `tag`           | `str \| None` | 用户设置的会话标签（见 [`tag_session()`](#tag_session)） |
| `created_at`    | `int \| None` | 会话创建时间（自纪元以来的毫秒数）                            |

#### 示例

```python
from claude_agent_sdk import list_sessions

for session in list_sessions(directory="/path/to/project", limit=10):
    print(f"{session.summary} ({session.session_id})")
```

### `get_session_messages()`

从过去的会话中检索消息。同步；立即返回。

```python
def get_session_messages(
    session_id: str,
    directory: str | None = None,
    limit: int | None = None,
    offset: int = 0
) -> list[SessionMessage]
```

#### 参数

| 参数           | 类型            | 默认值    | 描述                  |
| :----------- | :------------ | :----- | :------------------ |
| `session_id` | `str`         | 必需     | 要检索消息的会话 ID         |
| `directory`  | `str \| None` | `None` | 要查看的项目目录。省略时，搜索所有项目 |
| `limit`      | `int \| None` | `None` | 返回的最大消息数            |
| `offset`     | `int`         | `0`    | 从开始跳过的消息数           |

#### 返回类型：`SessionMessage`

| 属性                   | 类型                             | 描述      |
| :------------------- | :----------------------------- | :------ |
| `type`               | `Literal["user", "assistant"]` | 消息角色    |
| `uuid`               | `str`                          | 唯一消息标识符 |
| `session_id`         | `str`                          | 会话标识符   |
| `message`            | `Any`                          | 原始消息内容  |
| `parent_tool_use_id` | `None`                         | 保留供将来使用 |

#### 示例

```python
from claude_agent_sdk import list_sessions, get_session_messages

sessions = list_sessions(limit=1)
if sessions:
    messages = get_session_messages(sessions[0].session_id)
    for msg in messages:
        print(f"[{msg.type}] {msg.uuid}")
```

### `get_session_info()`

按 ID 读取单个会话的元数据，无需扫描完整项目目录。同步；立即返回。

```python
def get_session_info(
    session_id: str,
    directory: str | None = None,
) -> SDKSessionInfo | None
```

#### 参数

| 参数           | 类型            | 默认值    | 描述                  |
| :----------- | :------------ | :----- | :------------------ |
| `session_id` | `str`         | 必需     | 要查找的会话的 UUID        |
| `directory`  | `str \| None` | `None` | 项目目录路径。省略时，搜索所有项目目录 |

返回 [`SDKSessionInfo`](#return-type-sdksessioninfo)，如果找不到会话则返回 `None`。

#### 示例

```python
from claude_agent_sdk import get_session_info

info = get_session_info("550e8400-e29b-41d4-a716-446655440000")
if info:
    print(f"{info.summary} (branch: {info.git_branch}, tag: {info.tag})")
```

### `rename_session()`

通过追加自定义标题条目来重命名会话。重复调用是安全的；最新的标题获胜。同步。

```python
def rename_session(
    session_id: str,
    title: str,
    directory: str | None = None,
) -> None
```

#### 参数

| 参数           | 类型            | 默认值    | 描述                  |
| :----------- | :------------ | :----- | :------------------ |
| `session_id` | `str`         | 必需     | 要重命名的会话的 UUID       |
| `title`      | `str`         | 必需     | 新标题。去除空格后必须非空       |
| `directory`  | `str \| None` | `None` | 项目目录路径。省略时，搜索所有项目目录 |

如果 `session_id` 不是有效的 UUID 或 `title` 为空，则抛出 `ValueError`；如果找不到会话，则抛出 `FileNotFoundError`。

#### 示例

```python
from claude_agent_sdk import list_sessions, rename_session

sessions = list_sessions(directory="/path/to/project", limit=1)
if sessions:
    rename_session(sessions[0].session_id, "Refactor auth module")
```

### `tag_session()`

标记会话。传递 `None` 以清除标签。重复调用是安全的；最新的标签获胜。同步。

```python
def tag_session(
    session_id: str,
    tag: str | None,
    directory: str | None = None,
) -> None
```

#### 参数

| 参数           | 类型            | 默认值    | 描述                                  |
| :----------- | :------------ | :----- | :---------------------------------- |
| `session_id` | `str`         | 必需     | 要标记的会话的 UUID                        |
| `tag`        | `str \| None` | 必需     | 标签字符串，或 `None` 以清除。存储前进行 Unicode 清理 |
| `directory`  | `str \| None` | `None` | 项目目录路径。省略时，搜索所有项目目录                 |

如果 `session_id` 不是有效的 UUID 或 `tag` 在清理后为空，则抛出 `ValueError`；如果找不到会话，则抛出 `FileNotFoundError`。

#### 示例

```python
from claude_agent_sdk import list_sessions, tag_session

# Tag a session
tag_session("550e8400-e29b-41d4-a716-446655440000", "needs-review")

# Later: find all sessions with that tag
for session in list_sessions(directory="/path/to/project"):
    if session.tag == "needs-review":
        print(session.summary)
```

## 类

### `ClaudeSDKClient`

**在多次交换中维持对话会话。** 这是 TypeScript SDK 的 `query()` 函数内部工作方式的 Python 等价物 - 它创建一个可以继续对话的客户端对象。

#### 关键特性

* **会话连续性**：在多个 `query()` 调用中维持对话上下文
* **同一对话**：会话保留之前的消息
* **中断支持**：可以在任务中途停止执行
* **显式生命周期**：你控制会话何时开始和结束
* **响应驱动的流程**：可以对响应做出反应并发送后续消息
* **自定义工具和 hooks**：支持自定义工具（使用 `@tool` 装饰器创建）和 hooks

```python
class ClaudeSDKClient:
    def __init__(self, options: ClaudeAgentOptions | None = None, transport: Transport | None = None)
    async def connect(self, prompt: str | AsyncIterable[dict] | None = None) -> None
    async def query(self, prompt: str | AsyncIterable[dict], session_id: str = "default") -> None
    async def receive_messages(self) -> AsyncIterator[Message]
    async def receive_response(self) -> AsyncIterator[Message]
    async def interrupt(self) -> None
    async def set_permission_mode(self, mode: str) -> None
    async def set_model(self, model: str | None = None) -> None
    async def rewind_files(self, user_message_id: str) -> None
    async def get_mcp_status(self) -> McpStatusResponse
    async def reconnect_mcp_server(self, server_name: str) -> None
    async def toggle_mcp_server(self, server_name: str, enabled: bool) -> None
    async def stop_task(self, task_id: str) -> None
    async def get_server_info(self) -> dict[str, Any] | None
    async def disconnect(self) -> None
```

#### 方法

| 方法                                        | 描述                                                                                                  |
| :---------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `__init__(options)`                       | 使用可选配置初始化客户端                                                                                        |
| `connect(prompt)`                         | 连接到 Claude，可选初始提示或消息流                                                                               |
| `query(prompt, session_id)`               | 以流式模式发送新请求                                                                                          |
| `receive_messages()`                      | 以异步迭代器形式接收来自 Claude 的所有消息                                                                           |
| `receive_response()`                      | 接收消息直到并包括 ResultMessage                                                                             |
| `interrupt()`                             | 发送中断信号（仅在流式模式下工作）                                                                                   |
| `set_permission_mode(mode)`               | 更改当前会话的权限模式                                                                                         |
| `set_model(model)`                        | 更改当前会话的模型。传递 `None` 以重置为默认值                                                                         |
| `rewind_files(user_message_id)`           | 将文件恢复到指定用户消息时的状态。需要 `enable_file_checkpointing=True`                                                     |
| `get_mcp_status()`                        | 获取所有配置的 MCP 服务器的状态。返回 [`McpStatusResponse`](#mcpstatusresponse)                                     |
| `reconnect_mcp_server(server_name)`       | 重试连接到失败或断开连接的 MCP 服务器                                                                               |
| `toggle_mcp_server(server_name, enabled)` | 在会话中启用或禁用 MCP 服务器。禁用会移除其工具                                                                          |
| `stop_task(task_id)`                      | 停止运行的后台任务。一个状态为 `"stopped"` 的 [`TaskNotificationMessage`](#tasknotificationmessage) 随后在消息流中出现       |
| `get_server_info()`                       | 获取服务器信息，包括会话 ID 和功能                                                                                 |
| `disconnect()`                            | 从 Claude 断开连接                                                                                       |

#### 上下文管理器支持

客户端可以用作异步上下文管理器以自动管理连接：

```python
async with ClaudeSDKClient() as client:
    await client.query("Hello Claude")
    async for message in client.receive_response():
        print(message)
```

> **重要：** 迭代消息时，避免使用 `break` 提前退出，因为这可能导致 asyncio 清理问题。相反，让迭代自然完成或使用标志来跟踪何时找到了你需要的内容。

#### 示例 - 继续对话

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient, AssistantMessage, TextBlock, ResultMessage


async def main():
    async with ClaudeSDKClient() as client:
        # First question
        await client.query("What's the capital of France?")

        # Process response
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(f"Claude: {block.text}")

        # Follow-up question
        await client.query("What's the population of that city?")

        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(f"Claude: {block.text}")

        # Another follow-up
        await client.query("What are some famous landmarks there?")

        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(f"Claude: {block.text}")


asyncio.run(main())
```

#### 示例 - 使用 ClaudeSDKClient 进行流式输入

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient


async def message_stream():
    """Generate messages dynamically."""
    yield {
        "type": "user",
        "message": {"role": "user", "content": "Analyze the following data:"},
    }
    await asyncio.sleep(0.5)
    yield {
        "type": "user",
        "message": {"role": "user", "content": "Temperature: 25°C, Humidity: 60%"},
    }
    await asyncio.sleep(0.5)
    yield {
        "type": "user",
        "message": {"role": "user", "content": "What patterns do you see?"},
    }


async def main():
    async with ClaudeSDKClient() as client:
        # Stream input to Claude
        await client.query(message_stream())

        # Process response
        async for message in client.receive_response():
            print(message)

        # Follow-up in same session
        await client.query("Should we be concerned about these readings?")

        async for message in client.receive_response():
            print(message)


asyncio.run(main())
```

#### 示例 - 使用中断

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, ResultMessage


async def interruptible_task():
    options = ClaudeAgentOptions(allowed_tools=["Bash"], permission_mode="acceptEdits")

    async with ClaudeSDKClient(options=options) as client:
        # Start a long-running task
        await client.query("Count from 1 to 100 slowly, using the bash sleep command")

        # Let it run for a bit
        await asyncio.sleep(2)

        # Interrupt the task
        await client.interrupt()
        print("Task interrupted!")

        # Drain the interrupted task's messages
        async for message in client.receive_response():
            if isinstance(message, ResultMessage):
                print(f"Interrupted task finished with subtype={message.subtype!r}")

        # Send a new command
        await client.query("Just say hello instead")

        # Now receive the new response
        async for message in client.receive_response():
            if isinstance(message, ResultMessage) and message.subtype == "success":
                print(f"New result: {message.result}")


asyncio.run(interruptible_task())
```

<Note>
  **中断后的缓冲行为：** `interrupt()` 发送停止信号但不清除消息缓冲区。被中断任务已产生的消息，包括其 `ResultMessage`（带 `subtype="error_during_execution"`），保留在流中。你必须在读取新查询的响应之前用 `receive_response()` 清空它们。
</Note>

#### 示例 - 高级权限控制

```python
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk.types import (
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)


async def custom_permission_handler(
    tool_name: str, input_data: dict, context: ToolPermissionContext
) -> PermissionResultAllow | PermissionResultDeny:
    """Custom logic for tool permissions."""

    # Block writes to system directories
    if tool_name == "Write" and input_data.get("file_path", "").startswith("/system/"):
        return PermissionResultDeny(
            message="System directory write not allowed", interrupt=True
        )

    # Redirect sensitive file operations
    if tool_name in ["Write", "Edit"] and "config" in input_data.get("file_path", ""):
        safe_path = f"./sandbox/{input_data['file_path']}"
        return PermissionResultAllow(
            updated_input={**input_data, "file_path": safe_path}
        )

    # Allow everything else
    return PermissionResultAllow(updated_input=input_data)


async def main():
    options = ClaudeAgentOptions(
        can_use_tool=custom_permission_handler, allowed_tools=["Read", "Write", "Edit"]
    )

    async with ClaudeSDKClient(options=options) as client:
        await client.query("Update the system config file")

        async for message in client.receive_response():
            print(message)


asyncio.run(main())
```

## 类型

<Note>
  **`@dataclass` vs `TypedDict`：** 此 SDK 使用两种类型。用 `@dataclass` 装饰的类（如 `ResultMessage`、`AgentDefinition`、`TextBlock`）在运行时是对象实例，支持属性访问：`msg.result`。用 `TypedDict` 定义的类（如 `ThinkingConfigEnabled`、`McpStdioServerConfig`、`SyncHookJSONOutput`）在运行时是**普通字典**，需要键访问：`config["budget_tokens"]`，而不是 `config.budget_tokens`。`ClassName(field=value)` 调用语法对两者都有效，但只有数据类产生具有属性的对象。
</Note>

### `SdkMcpTool`

使用 `@tool` 装饰器创建的 SDK MCP 工具的定义。

```python
@dataclass
class SdkMcpTool(Generic[T]):
    name: str
    description: str
    input_schema: type[T] | dict[str, Any]
    handler: Callable[[T], Awaitable[dict[str, Any]]]
    annotations: ToolAnnotations | None = None
```

| 属性             | 类型                                         | 描述                                                                               |
| :------------- | :----------------------------------------- | :------------------------------------------------------------------------------- |
| `name`         | `str`                                      | 工具的唯一标识符                                                                         |
| `description`  | `str`                                      | 人类可读的描述                                                                          |
| `input_schema` | `type[T] \| dict[str, Any]`                | 输入验证的模式                                                                          |
| `handler`      | `Callable[[T], Awaitable[dict[str, Any]]]` | 处理工具执行的异步函数                                                                      |
| `annotations`  | `ToolAnnotations \| None`                  | 可选的 MCP 工具注解（例如 `readOnlyHint`、`destructiveHint`、`openWorldHint`）。来自 `mcp.types` |

### `Transport`

自定义传输实现的抽象基类。使用此类通过自定义通道与 Claude 进程通信（例如，远程连接而不是本地子进程）。

<Warning>
  这是一个低级内部 API。接口可能在未来版本中更改。自定义实现必须更新以匹配任何接口更改。
</Warning>

```python
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any


class Transport(ABC):
    @abstractmethod
    async def connect(self) -> None: ...
    @abstractmethod
    async def write(self, data: str) -> None: ...
    @abstractmethod
    def read_messages(self) -> AsyncIterator[dict[str, Any]]: ...
    @abstractmethod
    async def close(self) -> None: ...
    @abstractmethod
    def is_ready(self) -> bool: ...
    @abstractmethod
    async def end_input(self) -> None: ...
```

| 方法                | 描述                       |
| :---------------- | :----------------------- |
| `connect()`       | 连接传输并准备通信                |
| `write(data)`     | 将原始数据（JSON + 换行符）写入传输    |
| `read_messages()` | 异步迭代器，产生解析的 JSON 消息      |
| `close()`         | 关闭连接并清理资源                |
| `is_ready()`      | 如果传输可以发送和接收，返回 `True`    |
| `end_input()`     | 关闭输入流（例如，为子进程传输关闭 stdin） |

导入：`from claude_agent_sdk import Transport`

### `ClaudeAgentOptions`

Claude Code 查询的配置数据类。

```python
@dataclass
class ClaudeAgentOptions:
    tools: list[str] | ToolsPreset | None = None
    allowed_tools: list[str] = field(default_factory=list)
    system_prompt: str | SystemPromptPreset | None = None
    mcp_servers: dict[str, McpServerConfig] | str | Path = field(default_factory=dict)
    strict_mcp_config: bool = False
    permission_mode: PermissionMode | None = None
    continue_conversation: bool = False
    resume: str | None = None
    max_turns: int | None = None
    max_budget_usd: float | None = None
    disallowed_tools: list[str] = field(default_factory=list)
    model: str | None = None
    fallback_model: str | None = None
    betas: list[SdkBeta] = field(default_factory=list)
    output_format: dict[str, Any] | None = None
    permission_prompt_tool_name: str | None = None
    cwd: str | Path | None = None
    cli_path: str | Path | None = None
    settings: str | None = None
    add_dirs: list[str | Path] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    extra_args: dict[str, str | None] = field(default_factory=dict)
    max_buffer_size: int | None = None
    debug_stderr: Any = sys.stderr  # Deprecated
    stderr: Callable[[str], None] | None = None
    can_use_tool: CanUseTool | None = None
    hooks: dict[HookEvent, list[HookMatcher]] | None = None
    user: str | None = None
    include_partial_messages: bool = False
    include_hook_events: bool = False
    fork_session: bool = False
    agents: dict[str, AgentDefinition] | None = None
    setting_sources: list[SettingSource] | None = None
    sandbox: SandboxSettings | None = None
    plugins: list[SdkPluginConfig] = field(default_factory=list)
    max_thinking_tokens: int | None = None  # Deprecated: use thinking instead
    thinking: ThinkingConfig | None = None
    effort: EffortLevel | None = None
    enable_file_checkpointing: bool = False
    session_store: SessionStore | None = None
    session_store_flush: SessionStoreFlushMode = "batched"
```

| 属性                            | 类型                                                                                       | 默认值                 | 描述                                                                                                                                                                      |
| :---------------------------- | :--------------------------------------------------------------------------------------- | :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools`                       | `list[str] \| ToolsPreset \| None`                                                       | `None`              | 工具配置。使用 `{"type": "preset", "preset": "claude_code"}` 获取 Claude Code 的默认工具                                                                                              |
| `allowed_tools`               | `list[str]`                                                                              | `[]`                | 无需提示即可自动批准的工具。这不会限制 Claude 仅使用这些工具；未列出的工具会通过 `permission_mode` 和 `can_use_tool` 处理。使用 `disallowed_tools` 阻止工具。                                                     |
| `system_prompt`               | `str \| SystemPromptPreset \| None`                                                      | `None`              | 系统提示配置。传递字符串以获取自定义提示，或使用 `{"type": "preset", "preset": "claude_code"}` 获取 Claude Code 的系统提示。添加 `"append"` 以扩展预设                                                         |
| `mcp_servers`                 | `dict[str, McpServerConfig] \| str \| Path`                                              | `{}`                | MCP 服务器配置或配置文件路径                                                                                                                                                        |
| `strict_mcp_config`           | `bool`                                                                                   | `False`             | 当为 `True` 时，仅使用在 `mcp_servers` 中传递的服务器，忽略项目 `.mcp.json`、用户设置和插件提供的 MCP 服务器。                                                                                             |
| `permission_mode`             | `PermissionMode \| None`                                                                 | `None`              | 工具使用的权限模式                                                                                                                                                               |
| `continue_conversation`       | `bool`                                                                                   | `False`             | 继续最近的对话                                                                                                                                                                 |
| `resume`                      | `str \| None`                                                                            | `None`              | 要恢复的会话 ID                                                                                                                                                               |
| `max_turns`                   | `int \| None`                                                                            | `None`              | 最大代理轮次（工具使用往返）                                                                                                                                                          |
| `max_budget_usd`              | `float \| None`                                                                          | `None`              | 当客户端成本估计达到此 USD 值时停止查询。                                                                                                                                                  |
| `disallowed_tools`            | `list[str]`                                                                              | `[]`                | 要拒绝的工具。裸名称如 `"Bash"` 从 Claude 的上下文中移除工具。作用域规则如 `"Bash(rm *)"` 保持工具可用，并在每个权限模式（包括 `bypassPermissions`）中拒绝匹配的调用。                                                   |
| `enable_file_checkpointing`   | `bool`                                                                                   | `False`             | 启用文件更改跟踪以进行回滚。                                                                                                                                                          |
| `model`                       | `str \| None`                                                                            | `None`              | 要使用的 Claude 模型                                                                                                                                                          |
| `fallback_model`              | `str \| None`                                                                            | `None`              | 主模型失败时使用的备用模型                                                                                                                                                           |
| `betas`                       | `list[SdkBeta]`                                                                          | `[]`                | 要启用的测试功能。                                                                                                                                                               |
| `output_format`               | `dict[str, Any] \| None`                                                                 | `None`              | 结构化响应的输出格式（例如 `{"type": "json_schema", "schema": {...}}`）。                                                                                                            |
| `permission_prompt_tool_name` | `str \| None`                                                                            | `None`              | 权限提示的 MCP 工具名称                                                                                                                                                          |
| `cwd`                         | `str \| Path \| None`                                                                    | `None`              | 当前工作目录                                                                                                                                                                  |
| `cli_path`                    | `str \| Path \| None`                                                                    | `None`              | Claude Code CLI 可执行文件的自定义路径                                                                                                                                             |
| `settings`                    | `str \| None`                                                                            | `None`              | 设置文件的路径                                                                                                                                                                 |
| `add_dirs`                    | `list[str \| Path]`                                                                      | `[]`                | Claude 可以访问的其他目录                                                                                                                                                        |
| `env`                         | `dict[str, str]`                                                                         | `{}`                | 环境变量合并到继承的进程环境之上。                                                                                                                                                       |
| `extra_args`                  | `dict[str, str \| None]`                                                                 | `{}`                | 直接传递给 CLI 的其他 CLI 参数                                                                                                                                                    |
| `max_buffer_size`             | `int \| None`                                                                            | `None`              | 缓冲 CLI stdout 时的最大字节数                                                                                                                                                   |
| `debug_stderr`                | `Any`                                                                                    | `sys.stderr`        | *已弃用* - 改用 `stderr` 回调                                                                                                                                                     |
| `stderr`                      | `Callable[[str], None] \| None`                                                          | `None`              | CLI 中 stderr 输出的回调函数                                                                                                                                                    |
| `can_use_tool`                | [`CanUseTool`](#canusetool) ` \| None`                                                   | `None`              | 工具权限回调函数。                                                                                                                                                                |
| `hooks`                       | `dict[HookEvent, list[HookMatcher]] \| None`                                             | `None`              | 用于拦截事件的 hooks 配置                                                                                                                                                        |
| `user`                        | `str \| None`                                                                            | `None`              | 用户标识符                                                                                                                                                                   |
| `include_partial_messages`    | `bool`                                                                                   | `False`             | 包括部分消息流式事件。启用时，会产生 [`StreamEvent`](#streamevent) 消息                                                                                                                     |
| `include_hook_events`         | `bool`                                                                                   | `False`             | 在消息流中包括 hooks 生命周期事件作为 `HookEventMessage` 对象                                                                                                                            |
| `fork_session`                | `bool`                                                                                   | `False`             | 使用 `resume` 恢复时，分叉到新会话 ID 而不是继续原始会话                                                                                                                                     |
| `agents`                      | `dict[str, AgentDefinition] \| None`                                                     | `None`              | 以编程方式定义的子代理                                                                                                                                                             |
| `plugins`                     | `list[SdkPluginConfig]`                                                                  | `[]`                | 从本地路径加载自定义插件。                                                                                                                                                           |
| `sandbox`                     | [`SandboxSettings`](#sandboxsettings) ` \| None`                                         | `None`              | 以编程方式配置沙箱行为。                                                                                                                                                             |
| `setting_sources`             | `list[SettingSource] \| None`                                                            | `None`（CLI 默认值：所有源） | 控制加载哪些文件系统设置。传递 `[]` 以禁用用户、项目和本地设置。                                                                                                                                     |
| `skills`                      | `list[str] \| Literal["all"] \| None`                                                    | `None`              | 会话可用的技能。传递 `"all"` 以启用每个发现的技能，或传递技能名称列表。                                                                                                                                |
| `max_thinking_tokens`         | `int \| None`                                                                            | `None`              | *已弃用* - 改用 `thinking`                                                                                                                                                     |
| `thinking`                    | [`ThinkingConfig`](#thinkingconfig) ` \| None`                                           | `None`              | 控制扩展思考行为。优先于 `max_thinking_tokens`                                                                                                                                      |
| `effort`                      | [`EffortLevel`](#effortlevel) ` \| None`                                                 | `None`              | 思考深度的努力级别                                                                                                                                                               |
| `session_store`               | [`SessionStore`](/zh-CN/agent-sdk/session-storage#the-sessionstore-interface) ` \| None` | `None`              | 将会话记录镜像到外部后端，以便任何主机都可以恢复它们。                                                                                                                                             |
| `session_store_flush`         | `Literal["batched", "eager"]`                                                            | `"batched"`         | 何时将镜像的记录条目刷新到 `session_store`。                                                                                                                                           |

#### 处理缓慢或停滞的 API 响应

```python
options = ClaudeAgentOptions(
    env={
        "API_TIMEOUT_MS": "120000",
        "CLAUDE_CODE_MAX_RETRIES": "2",
        "CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS": "120000",
    },
)
```

* `API_TIMEOUT_MS`：Anthropic 客户端上的每个请求超时，以毫秒为单位。默认 `600000`。
* `CLAUDE_CODE_MAX_RETRIES`：最大 API 重试次数。默认 `10`。
* `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`：使用 `run_in_background` 启动的子代理的停滞监视器。默认 `600000`。
* `CLAUDE_ENABLE_STREAM_WATCHDOG=1` 与 `CLAUDE_STREAM_IDLE_TIMEOUT_MS`：当标头已到达但响应体停止流式传输时中止请求。默认关闭。

### `OutputFormat`

```python
# Expected dict shape for output_format
{
    "type": "json_schema",
    "schema": {...},  # Your JSON Schema definition
}
```

| 字段       | 必需 | 描述                                    |
| :------- | :- | :------------------------------------ |
| `type`   | 是  | 必须是 `"json_schema"` 用于 JSON Schema 验证 |
| `schema` | 是  | 用于输出验证的 JSON Schema 定义                |

### `SystemPromptPreset`

```python
class SystemPromptPreset(TypedDict):
    type: Literal["preset"]
    preset: Literal["claude_code"]
    append: NotRequired[str]
    exclude_dynamic_sections: NotRequired[bool]
```

| 字段                         | 必需 | 描述                                                                                                                                                                |
| :------------------------- | :- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                     | 是  | 必须是 `"preset"` 以使用预设系统提示                                                                                                                                          |
| `preset`                   | 是  | 必须是 `"claude_code"` 以使用 Claude Code 的系统提示                                                                                                                         |
| `append`                   | 否  | 要追加到预设系统提示的其他说明                                                                                                                                                   |
| `exclude_dynamic_sections` | 否  | 将每个会话的上下文（如工作目录、git 状态和内存路径）从系统提示移到第一条用户消息。                                                                                                                 |

### `SettingSource`

```python
SettingSource = Literal["user", "project", "local"]
```

| 值           | 描述                 | 位置                            |
| :---------- | :----------------- | :---------------------------- |
| `"user"`    | 全局用户设置             | `~/.claude/settings.json`     |
| `"project"` | 共享项目设置（版本控制）       | `.claude/settings.json`       |
| `"local"`   | 本地项目设置（gitignored） | `.claude/settings.local.json` |

#### 为什么使用 setting_sources

**禁用文件系统设置：**

```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Analyze this code",
    options=ClaudeAgentOptions(setting_sources=[]),
):
    print(message)
```

**加载 CLAUDE.md 项目说明：**

```python
async for message in query(
    prompt="Add a new feature following project conventions",
    options=ClaudeAgentOptions(
        system_prompt={
            "type": "preset",
            "preset": "claude_code",
        },
        setting_sources=["project"],
        allowed_tools=["Read", "Write", "Edit"],
    ),
):
    print(message)
```

#### 设置优先级

1. 本地设置（`.claude/settings.local.json`）
2. 项目设置（`.claude/settings.json`）
3. 用户设置（`~/.claude/settings.json`）

### `AgentDefinition`

```python
@dataclass
class AgentDefinition:
    description: str
    prompt: str
    tools: list[str] | None = None
    disallowedTools: list[str] | None = None
    model: str | None = None
    skills: list[str] | None = None
    memory: Literal["user", "project", "local"] | None = None
    mcpServers: list[str | dict[str, Any]] | None = None
    initialPrompt: str | None = None
    maxTurns: int | None = None
    background: bool | None = None
    effort: EffortLevel | int | None = None
    permissionMode: PermissionMode | None = None
```

| 字段                | 必需 | 描述                                                                             |
| :---------------- | :- | :----------------------------------------------------------------------------- |
| `description`     | 是  | 何时使用此代理的自然语言描述                                                                 |
| `prompt`          | 是  | 代理的系统提示                                                                        |
| `tools`           | 否  | 允许的工具名称数组。如果省略，继承所有工具                                                          |
| `disallowedTools` | 否  | 要从代理的工具集中移除的工具名称数组                                                             |
| `model`           | 否  | 此代理的模型覆盖。接受别名如 `"sonnet"`、`"opus"`、`"haiku"` 或 `"inherit"`，或完整模型 ID。      |
| `skills`          | 否  | 此代理可用的技能名称列表                                                                   |
| `memory`          | 否  | 此代理的内存源：`"user"`、`"project"` 或 `"local"`                                       |
| `mcpServers`      | 否  | 此代理可用的 MCP 服务器。每个条目是服务器名称或内联 `{name: config}` 字典                               |
| `initialPrompt`   | 否  | 当此代理作为主线程代理运行时自动提交为第一个用户轮次                                                     |
| `maxTurns`        | 否  | 代理停止前的最大代理轮次数                                                                  |
| `background`      | 否  | 调用时将此代理作为非阻塞后台任务运行                                                             |
| `effort`          | 否  | 此代理的推理努力级别。接受命名级别或整数。                                                           |
| `permissionMode`  | 否  | 此代理内工具执行的权限模式。                                                                 |

<Note>
  `AgentDefinition` 字段名称使用 camelCase，如 `disallowedTools`、`permissionMode` 和 `maxTurns`。这些名称直接映射到与 TypeScript SDK 共享的线路格式。
</Note>

### `PermissionMode`

```python
PermissionMode = Literal[
    "default",
    "acceptEdits",
    "plan",
    "dontAsk",
    "bypassPermissions",
]
```

### `EffortLevel`

```python
EffortLevel = Literal[
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]
```

### `CanUseTool`

```python
CanUseTool = Callable[
    [str, dict[str, Any], ToolPermissionContext], Awaitable[PermissionResult]
]
```

### `ToolPermissionContext`

```python
@dataclass
class ToolPermissionContext:
    signal: Any | None = None
    suggestions: list[PermissionUpdate] = field(default_factory=list)
    blocked_path: str | None = None
    decision_reason: str | None = None
    title: str | None = None
    display_name: str | None = None
    description: str | None = None
```

### `PermissionResult`

```python
PermissionResult = PermissionResultAllow | PermissionResultDeny
```

### `PermissionResultAllow`

```python
@dataclass
class PermissionResultAllow:
    behavior: Literal["allow"] = "allow"
    updated_input: dict[str, Any] | None = None
    updated_permissions: list[PermissionUpdate] | None = None
```

### `PermissionResultDeny`

```python
@dataclass
class PermissionResultDeny:
    behavior: Literal["deny"] = "deny"
    message: str = ""
    interrupt: bool = False
```

### `PermissionUpdate`

```python
@dataclass
class PermissionUpdate:
    type: Literal[
        "addRules",
        "replaceRules",
        "removeRules",
        "setMode",
        "addDirectories",
        "removeDirectories",
    ]
    rules: list[PermissionRuleValue] | None = None
    behavior: Literal["allow", "deny", "ask"] | None = None
    mode: PermissionMode | None = None
    directories: list[str] | None = None
    destination: (
        Literal["userSettings", "projectSettings", "localSettings", "session"] | None
    ) = None
```

### `PermissionRuleValue`

```python
@dataclass
class PermissionRuleValue:
    tool_name: str
    rule_content: str | None = None
```

### `ToolsPreset`

```python
class ToolsPreset(TypedDict):
    type: Literal["preset"]
    preset: Literal["claude_code"]
```

### `ThinkingConfig`

```python
ThinkingDisplay = Literal["summarized", "omitted"]

class ThinkingConfigAdaptive(TypedDict):
    type: Literal["adaptive"]
    display: NotRequired[ThinkingDisplay]

class ThinkingConfigEnabled(TypedDict):
    type: Literal["enabled"]
    budget_tokens: int
    display: NotRequired[ThinkingDisplay]

class ThinkingConfigDisabled(TypedDict):
    type: Literal["disabled"]

ThinkingConfig = ThinkingConfigAdaptive | ThinkingConfigEnabled | ThinkingConfigDisabled
```

```python
from claude_agent_sdk import ClaudeAgentOptions, ThinkingConfigEnabled

# Option 1: dict literal (recommended, no import needed)
options = ClaudeAgentOptions(thinking={"type": "enabled", "budget_tokens": 20000})

# Option 2: constructor-style (returns a plain dict)
config = ThinkingConfigEnabled(type="enabled", budget_tokens=20000)
print(config["budget_tokens"])  # 20000
```

### `SdkBeta`

```python
SdkBeta = Literal["context-1m-2025-08-07"]
```

<Warning>
  `context-1m-2025-08-07` 测试版自 2026 年 4 月 30 日起已停用。使用 Claude Sonnet 4.5 或 Sonnet 4 传递此标头无效。要使用 1M 令牌上下文窗口，请迁移到 [Claude Sonnet 4.6、Claude Opus 4.6 或 Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/overview)。
</Warning>

### `McpSdkServerConfig`

```python
class McpSdkServerConfig(TypedDict):
    type: Literal["sdk"]
    name: str
    instance: Any  # MCP Server instance
```

### `McpServerConfig`

```python
McpServerConfig = (
    McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig
)
```

#### `McpStdioServerConfig`

```python
class McpStdioServerConfig(TypedDict):
    type: NotRequired[Literal["stdio"]]
    command: str
    args: NotRequired[list[str]]
    env: NotRequired[dict[str, str]]
```

#### `McpSSEServerConfig`

```python
class McpSSEServerConfig(TypedDict):
    type: Literal["sse"]
    url: str
    headers: NotRequired[dict[str, str]]
```

#### `McpHttpServerConfig`

```python
class McpHttpServerConfig(TypedDict):
    type: Literal["http"]
    url: str
    headers: NotRequired[dict[str, str]]
```

### `McpServerStatusConfig`

```python
McpServerStatusConfig = (
    McpStdioServerConfig
    | McpSSEServerConfig
    | McpHttpServerConfig
    | McpSdkServerConfigStatus
    | McpClaudeAIProxyServerConfig
)
```

### `McpStatusResponse`

```python
class McpStatusResponse(TypedDict):
    mcpServers: list[McpServerStatus]
```

### `McpServerStatus`

```python
class McpServerStatus(TypedDict):
    name: str
    status: McpServerConnectionStatus  # "connected" | "failed" | "needs-auth" | "pending" | "disabled"
    serverInfo: NotRequired[McpServerInfo]
    error: NotRequired[str]
    config: NotRequired[McpServerStatusConfig]
    scope: NotRequired[str]
    tools: NotRequired[list[McpToolInfo]]
```

### `SdkPluginConfig`

```python
class SdkPluginConfig(TypedDict):
    type: Literal["local"]
    path: str
```

**示例：**

```python
plugins = [
    {"type": "local", "path": "./my-plugin"},
    {"type": "local", "path": "/absolute/path/to/plugin"},
]
```

## 消息类型

### `Message`

```python
Message = (
    UserMessage
    | AssistantMessage
    | SystemMessage
    | ResultMessage
    | StreamEvent
    | RateLimitEvent
)
```

### `UserMessage`

```python
@dataclass
class UserMessage:
    content: str | list[ContentBlock]
    uuid: str | None = None
    parent_tool_use_id: str | None = None
    tool_use_result: dict[str, Any] | None = None
```

### `AssistantMessage`

```python
@dataclass
class AssistantMessage:
    content: list[ContentBlock]
    model: str
    parent_tool_use_id: str | None = None
    error: AssistantMessageError | None = None
    usage: dict[str, Any] | None = None
    message_id: str | None = None
```

### `AssistantMessageError`

```python
AssistantMessageError = Literal[
    "authentication_failed",
    "billing_error",
    "rate_limit",
    "invalid_request",
    "server_error",
    "max_output_tokens",
    "unknown",
]
```

### `SystemMessage`

```python
@dataclass
class SystemMessage:
    subtype: str
    data: dict[str, Any]
```

### `ResultMessage`

```python
@dataclass
class ResultMessage:
    subtype: str
    duration_ms: int
    duration_api_ms: int
    is_error: bool
    num_turns: int
    session_id: str
    stop_reason: str | None = None
    total_cost_usd: float | None = None
    usage: dict[str, Any] | None = None
    result: str | None = None
    structured_output: Any = None
    model_usage: dict[str, Any] | None = None
    permission_denials: list[Any] | None = None
    deferred_tool_use: DeferredToolUse | None = None
    errors: list[str] | None = None
    api_error_status: int | None = None
    uuid: str | None = None
```

`usage` 字典键：

| 键                             | 类型    | 描述            |
| ----------------------------- | ----- | ------------- |
| `input_tokens`                | `int` | 消耗的总输入令牌。     |
| `output_tokens`               | `int` | 生成的总输出令牌。     |
| `cache_creation_input_tokens` | `int` | 用于创建新缓存条目的令牌。 |
| `cache_read_input_tokens`     | `int` | 从现有缓存条目读取的令牌。 |

`model_usage` 字典键（camelCase）：

| 键                          | 类型      | 描述                                       |
| -------------------------- | ------- | ---------------------------------------- |
| `inputTokens`              | `int`   | 此模型的输入令牌。                                |
| `outputTokens`             | `int`   | 此模型的输出令牌。                                |
| `cacheReadInputTokens`     | `int`   | 此模型的缓存读取令牌。                              |
| `cacheCreationInputTokens` | `int`   | 此模型的缓存创建令牌。                              |
| `webSearchRequests`        | `int`   | 此模型进行的网络搜索请求。                            |
| `costUSD`                  | `float` | 此模型的估计成本（美元）。                            |
| `contextWindow`            | `int`   | 此模型的上下文窗口大小。                             |
| `maxOutputTokens`          | `int`   | 此模型的最大输出令牌限制。                            |

### `StreamEvent`

```python
@dataclass
class StreamEvent:
    uuid: str
    session_id: str
    event: dict[str, Any]
    parent_tool_use_id: str | None = None
```

### `RateLimitEvent`

```python
@dataclass
class RateLimitEvent:
    rate_limit_info: RateLimitInfo
    uuid: str
    session_id: str
```

### `RateLimitInfo`

```python
RateLimitStatus = Literal["allowed", "allowed_warning", "rejected"]
RateLimitType = Literal[
    "five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "overage"
]

@dataclass
class RateLimitInfo:
    status: RateLimitStatus
    resets_at: int | None = None
    rate_limit_type: RateLimitType | None = None
    utilization: float | None = None
    overage_status: RateLimitStatus | None = None
    overage_resets_at: int | None = None
    overage_disabled_reason: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)
```

### `TaskStartedMessage`

```python
@dataclass
class TaskStartedMessage(SystemMessage):
    task_id: str
    description: str
    uuid: str
    session_id: str
    tool_use_id: str | None = None
    task_type: str | None = None
```

| 字段            | 类型            | 描述                                                                              |
| :------------ | :------------ | :------------------------------------------------------------------------------ |
| `task_id`     | `str`         | 任务的唯一标识符                                                                        |
| `description` | `str`         | 任务的描述                                                                           |
| `uuid`        | `str`         | 唯一消息标识符                                                                         |
| `session_id`  | `str`         | 会话标识符                                                                           |
| `tool_use_id` | `str \| None` | 关联的工具使用 ID                                                                      |
| `task_type`   | `str \| None` | 哪种后台任务：`"local_bash"`、`"local_agent"` 或 `"remote_agent"` |

### `TaskUsage`

```python
class TaskUsage(TypedDict):
    total_tokens: int
    tool_uses: int
    duration_ms: int
```

### `TaskProgressMessage`

```python
@dataclass
class TaskProgressMessage(SystemMessage):
    task_id: str
    description: str
    usage: TaskUsage
    uuid: str
    session_id: str
    tool_use_id: str | None = None
    last_tool_name: str | None = None
```

### `TaskNotificationMessage`

```python
@dataclass
class TaskNotificationMessage(SystemMessage):
    task_id: str
    status: TaskNotificationStatus  # "completed" | "failed" | "stopped"
    output_file: str
    summary: str
    uuid: str
    session_id: str
    tool_use_id: str | None = None
    usage: TaskUsage | None = None
```

## 内容块类型

### `ContentBlock`

```python
ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock
```

### `TextBlock`

```python
@dataclass
class TextBlock:
    text: str
```

### `ThinkingBlock`

```python
@dataclass
class ThinkingBlock:
    thinking: str
    signature: str
```

### `ToolUseBlock`

```python
@dataclass
class ToolUseBlock:
    id: str
    name: str
    input: dict[str, Any]
```

### `ToolResultBlock`

```python
@dataclass
class ToolResultBlock:
    tool_use_id: str
    content: str | list[dict[str, Any]] | None = None
    is_error: bool | None = None
```

## 错误类型

### `ClaudeSDKError`

```python
class ClaudeSDKError(Exception):
    """Base error for Claude SDK."""
```

### `CLINotFoundError`

```python
class CLINotFoundError(CLIConnectionError):
    def __init__(
        self, message: str = "Claude Code not found", cli_path: str | None = None
    ): ...
```

### `CLIConnectionError`

```python
class CLIConnectionError(ClaudeSDKError):
    """Failed to connect to Claude Code."""
```

### `ProcessError`

```python
class ProcessError(ClaudeSDKError):
    def __init__(
        self, message: str, exit_code: int | None = None, stderr: str | None = None
    ): ...
```

### `CLIJSONDecodeError`

```python
class CLIJSONDecodeError(ClaudeSDKError):
    def __init__(self, line: str, original_error: Exception): ...
```

## Hook 类型

### `HookEvent`

```python
HookEvent = Literal[
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "Stop",
    "SubagentStop",
    "PreCompact",
    "Notification",
    "SubagentStart",
    "PermissionRequest",
]
```

### `HookCallback`

```python
HookCallback = Callable[[HookInput, str | None, HookContext], Awaitable[HookJSONOutput]]
```

### `HookContext`

```python
class HookContext(TypedDict):
    signal: Any | None
```

### `HookMatcher`

```python
@dataclass
class HookMatcher:
    matcher: str | None = None
    hooks: list[HookCallback] = field(default_factory=list)
    timeout: float | None = None  # Default: 60
```

### `HookInput`

```python
HookInput = (
    PreToolUseHookInput
    | PostToolUseHookInput
    | PostToolUseFailureHookInput
    | UserPromptSubmitHookInput
    | StopHookInput
    | SubagentStopHookInput
    | PreCompactHookInput
    | NotificationHookInput
    | SubagentStartHookInput
    | PermissionRequestHookInput
)
```

### `BaseHookInput`

```python
class BaseHookInput(TypedDict):
    session_id: str
    transcript_path: str
    cwd: str
    permission_mode: NotRequired[str]
```

### `PreToolUseHookInput`

```python
class PreToolUseHookInput(BaseHookInput):
    hook_event_name: Literal["PreToolUse"]
    tool_name: str
    tool_input: dict[str, Any]
    tool_use_id: str
    agent_id: NotRequired[str]
    agent_type: NotRequired[str]
```

### `PostToolUseHookInput`

```python
class PostToolUseHookInput(BaseHookInput):
    hook_event_name: Literal["PostToolUse"]
    tool_name: str
    tool_input: dict[str, Any]
    tool_response: Any
    tool_use_id: str
    agent_id: NotRequired[str]
    agent_type: NotRequired[str]
```

### `PostToolUseFailureHookInput`

```python
class PostToolUseFailureHookInput(BaseHookInput):
    hook_event_name: Literal["PostToolUseFailure"]
    tool_name: str
    tool_input: dict[str, Any]
    tool_use_id: str
    error: str
    is_interrupt: NotRequired[bool]
    agent_id: NotRequired[str]
    agent_type: NotRequired[str]
```

### `UserPromptSubmitHookInput`

```python
class UserPromptSubmitHookInput(BaseHookInput):
    hook_event_name: Literal["UserPromptSubmit"]
    prompt: str
```

### `StopHookInput`

```python
class StopHookInput(BaseHookInput):
    hook_event_name: Literal["Stop"]
    stop_hook_active: bool
```

### `SubagentStopHookInput`

```python
class SubagentStopHookInput(BaseHookInput):
    hook_event_name: Literal["SubagentStop"]
    stop_hook_active: bool
    agent_id: str
    agent_transcript_path: str
    agent_type: str
```

### `PreCompactHookInput`

```python
class PreCompactHookInput(BaseHookInput):
    hook_event_name: Literal["PreCompact"]
    trigger: Literal["manual", "auto"]
    custom_instructions: str | None
```

### `NotificationHookInput`

```python
class NotificationHookInput(BaseHookInput):
    hook_event_name: Literal["Notification"]
    message: str
    title: NotRequired[str]
    notification_type: str
```

### `SubagentStartHookInput`

```python
class SubagentStartHookInput(BaseHookInput):
    hook_event_name: Literal["SubagentStart"]
    agent_id: str
    agent_type: str
```

### `PermissionRequestHookInput`

```python
class PermissionRequestHookInput(BaseHookInput):
    hook_event_name: Literal["PermissionRequest"]
    tool_name: str
    tool_input: dict[str, Any]
    permission_suggestions: NotRequired[list[Any]]
```

### `HookJSONOutput`

```python
HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput
```

#### `SyncHookJSONOutput`

```python
class SyncHookJSONOutput(TypedDict):
    continue_: NotRequired[bool]
    suppressOutput: NotRequired[bool]
    stopReason: NotRequired[str]
    decision: NotRequired[Literal["block"]]
    systemMessage: NotRequired[str]
    reason: NotRequired[str]
    hookSpecificOutput: NotRequired[HookSpecificOutput]
```

#### `HookSpecificOutput`

```python
class PreToolUseHookSpecificOutput(TypedDict):
    hookEventName: Literal["PreToolUse"]
    permissionDecision: NotRequired[Literal["allow", "deny", "ask", "defer"]]
    permissionDecisionReason: NotRequired[str]
    updatedInput: NotRequired[dict[str, Any]]
    additionalContext: NotRequired[str]

class PostToolUseHookSpecificOutput(TypedDict):
    hookEventName: Literal["PostToolUse"]
    additionalContext: NotRequired[str]
    updatedToolOutput: NotRequired[Any]
    updatedMCPToolOutput: NotRequired[Any]  # Deprecated

class PostToolUseFailureHookSpecificOutput(TypedDict):
    hookEventName: Literal["PostToolUseFailure"]
    additionalContext: NotRequired[str]

class UserPromptSubmitHookSpecificOutput(TypedDict):
    hookEventName: Literal["UserPromptSubmit"]
    additionalContext: NotRequired[str]

class NotificationHookSpecificOutput(TypedDict):
    hookEventName: Literal["Notification"]
    additionalContext: NotRequired[str]

class SubagentStartHookSpecificOutput(TypedDict):
    hookEventName: Literal["SubagentStart"]
    additionalContext: NotRequired[str]

class PermissionRequestHookSpecificOutput(TypedDict):
    hookEventName: Literal["PermissionRequest"]
    decision: dict[str, Any]

HookSpecificOutput = (
    PreToolUseHookSpecificOutput
    | PostToolUseHookSpecificOutput
    | PostToolUseFailureHookSpecificOutput
    | UserPromptSubmitHookSpecificOutput
    | NotificationHookSpecificOutput
    | SubagentStartHookSpecificOutput
    | PermissionRequestHookSpecificOutput
)
```

#### `AsyncHookJSONOutput`

```python
class AsyncHookJSONOutput(TypedDict):
    async_: Literal[True]
    asyncTimeout: NotRequired[int]
```

### Hook 使用示例

```python
from claude_agent_sdk import query, ClaudeAgentOptions, HookMatcher, HookContext
from typing import Any


async def validate_bash_command(
    input_data: dict[str, Any], tool_use_id: str | None, context: HookContext
) -> dict[str, Any]:
    """Validate and potentially block dangerous bash commands."""
    if input_data["tool_name"] == "Bash":
        command = input_data["tool_input"].get("command", "")
        if "rm -rf /" in command:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "Dangerous command blocked",
                }
            }
    return {}


async def log_tool_use(
    input_data: dict[str, Any], tool_use_id: str | None, context: HookContext
) -> dict[str, Any]:
    """Log all tool usage for auditing."""
    print(f"Tool used: {input_data.get('tool_name')}")
    return {}


options = ClaudeAgentOptions(
    hooks={
        "PreToolUse": [
            HookMatcher(matcher="Bash", hooks=[validate_bash_command], timeout=120),
            HookMatcher(hooks=[log_tool_use]),
        ],
        "PostToolUse": [HookMatcher(hooks=[log_tool_use])],
    }
)

async for message in query(prompt="Analyze this codebase", options=options):
    print(message)
```

## 工具输入/输出类型

### Agent

**工具名称：** `Agent`（之前为 `Task`，仍然接受作为别名）

**输入：**

```python
{
    "description": str,
    "prompt": str,
    "subagent_type": str,
}
```

**输出：**

```python
{
    "result": str,
    "usage": dict | None,
    "total_cost_usd": float | None,
    "duration_ms": int | None,
}
```

### AskUserQuestion

**工具名称：** `AskUserQuestion`

**输入：**

```python
{
    "questions": [
        {
            "question": str,
            "header": str,
            "options": [
                {"label": str, "description": str}
            ],
            "multiSelect": bool,
        }
    ],
    "answers": dict[str, str | list[str]] | None,
}
```

**输出：**

```python
{
    "questions": [
        {
            "question": str,
            "header": str,
            "options": [{"label": str, "description": str}],
            "multiSelect": bool,
        }
    ],
    "answers": dict[str, str],
}
```

### Bash

**工具名称：** `Bash`

**输入：**

```python
{
    "command": str,
    "timeout": int | None,
    "description": str | None,
    "run_in_background": bool | None,
}
```

**输出：**

```python
{
    "output": str,
    "exitCode": int,
    "killed": bool | None,
    "shellId": str | None,
}
```

### Monitor

**工具名称：** `Monitor`

**输入：**

```python
{
    "command": str,
    "description": str,
    "timeout_ms": int | None,
    "persistent": bool | None,
}
```

**输出：**

```python
{
    "taskId": str,
    "timeoutMs": int,
    "persistent": bool | None,
}
```

### Edit

**工具名称：** `Edit`

**输入：**

```python
{
    "file_path": str,
    "old_string": str,
    "new_string": str,
    "replace_all": bool | None,
}
```

**输出：**

```python
{
    "message": str,
    "replacements": int,
    "file_path": str,
}
```

### Read

**工具名称：** `Read`

**输入：**

```python
{
    "file_path": str,
    "offset": int | None,
    "limit": int | None,
}
```

**输出（文本文件）：**

```python
{
    "content": str,
    "total_lines": int,
    "lines_returned": int,
}
```

**输出（图像）：**

```python
{
    "image": str,
    "mime_type": str,
    "file_size": int,
}
```

### Write

**工具名称：** `Write`

**输入：**

```python
{
    "file_path": str,
    "content": str,
}
```

**输出：**

```python
{
    "message": str,
    "bytes_written": int,
    "file_path": str,
}
```

### Glob

**工具名称：** `Glob`

**输入：**

```python
{
    "pattern": str,
    "path": str | None,
}
```

**输出：**

```python
{
    "matches": list[str],
    "count": int,
    "search_path": str,
}
```

### Grep

**工具名称：** `Grep`

**输入：**

```python
{
    "pattern": str,
    "path": str | None,
    "glob": str | None,
    "type": str | None,
    "output_mode": str | None,
    "-i": bool | None,
    "-n": bool | None,
    "-B": int | None,
    "-A": int | None,
    "-C": int | None,
    "head_limit": int | None,
    "multiline": bool | None,
}
```

**输出（content 模式）：**

```python
{
    "matches": [
        {
            "file": str,
            "line_number": int | None,
            "line": str,
            "before_context": list[str] | None,
            "after_context": list[str] | None,
        }
    ],
    "total_matches": int,
}
```

**输出（files_with_matches 模式）：**

```python
{
    "files": list[str],
    "count": int,
}
```

### NotebookEdit

**工具名称：** `NotebookEdit`

**输入：**

```python
{
    "notebook_path": str,
    "cell_id": str | None,
    "new_source": str,
    "cell_type": "code" | "markdown" | None,
    "edit_mode": "replace" | "insert" | "delete" | None,
}
```

**输出：**

```python
{
    "message": str,
    "edit_type": "replaced" | "inserted" | "deleted",
    "cell_id": str | None,
    "total_cells": int,
}
```

### WebFetch

**工具名称：** `WebFetch`

**输入：**

```python
{
    "url": str,
    "prompt": str,
}
```

**输出：**

```python
{
    "bytes": int,
    "code": int,
    "codeText": str,
    "result": str,
    "durationMs": int,
    "url": str,
}
```

### WebSearch

**工具名称：** `WebSearch`

**输入：**

```python
{
    "query": str,
    "allowed_domains": list[str] | None,
    "blocked_domains": list[str] | None,
}
```

**输出：**

```python
{
    "query": str,
    "results": list[str | {"tool_use_id": str, "content": list[{"title": str, "url": str}]}],
    "durationSeconds": float,
}
```

### TodoWrite

**工具名称：** `TodoWrite`

<Note>
  自 Claude Code v2.1.142 起，`TodoWrite` 默认被禁用。改用 `TaskCreate`、`TaskGet`、`TaskUpdate` 和 `TaskList`。
</Note>

**输入：**

```python
{
    "todos": [
        {
            "content": str,
            "status": "pending" | "in_progress" | "completed",
            "activeForm": str,
        }
    ]
}
```

**输出：**

```python
{
    "message": str,
    "stats": {"total": int, "pending": int, "in_progress": int, "completed": int},
}
```

### TaskCreate

**工具名称：** `TaskCreate`

**输入：**

```python
{
    "subject": str,
    "description": str,
    "activeForm": str | None,
    "metadata": dict | None,
}
```

**输出：**

```python
{
    "task": {"id": str, "subject": str},
}
```

### TaskUpdate

**工具名称：** `TaskUpdate`

**输入：**

```python
{
    "taskId": str,
    "status": Literal["pending", "in_progress", "completed", "deleted"] | None,
    "subject": str | None,
    "description": str | None,
    "activeForm": str | None,
}
```

**输出：**

```python
{
    "task": {"id": str, "subject": str, "status": str},
}
```

### TaskGet

**工具名称：** `TaskGet`

**输入：**

```python
{
    "taskId": str,
}
```

**输出：**

```python
{
    "task": {...},  # Full task with all fields
}
```

### TaskList

**工具名称：** `TaskList`

**输入：**

```python
{
    "status": Literal["pending", "in_progress", "completed", "deleted"] | None,
    "limit": int | None,
    "offset": int | None,
}
```

**输出：**

```python
{
    "tasks": list[...],
    "total": int,
}
```

### TaskDelete

**工具名称：** `TaskDelete`

**输入：**

```python
{
    "taskId": str,
}
```

**输出：**

```python
{
    "message": str,
}
```

### HuggingFace

**工具名称：** `HuggingFace`

**输入：**

```python
{
    "query": str,
}
```

**输出：**

```python
{
    "result": str,
}
```

### StackOverflow

**工具名称：** `StackOverflow`

**输入：**

```python
{
    "query": str,
}
```

**输出：**

```python
{
    "result": str,
}
```

### GoogleSearch

**工具名称：** `GoogleSearch`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "content": str}],
    "total": int,
}
```

### GoogleImageSearch

**工具名称：** `GoogleImageSearch`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "thumbnail": str}],
    "total": int,
}
```

### GoogleNews

**工具名称：** `GoogleNews`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "freshness": Literal["1d", "7d", "30d"] | None,
    "region": str | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "source": str, "date": str}],
    "total": int,
}
```

### GoogleVideo

**工具名称：** `GoogleVideo`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "freshness": Literal["1d", "7d", "30d"] | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "source": str, "date": str}],
    "total": int,
}
```

### GoogleJobs

**工具名称：** `GoogleJobs`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "employment_types": list[str] | None,
    "date_posted": Literal["1d", "3d", "7d", "30d"] | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "company": str, "location": str, "source": str, "url": str}],
    "total": int,
}
```

### GoogleShopping

**工具名称：** `GoogleShopping`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "country": str | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "price": str, "source": str, "url": str, "rating": str | None}],
    "total": int,
}
```

### GoogleTrends

**工具名称：** `GoogleTrends`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "time_range": Literal["today 1-m", "today 3-m", "today 12-m", "today 5-y"] | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "value": int}],
    "total": int,
}
```

### GoogleLocal

**工具名称：** `GoogleLocal`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "address": str, "rating": str | None, "phone": str | None, "url": str | None}],
    "total": int,
}
```

### GoogleFlights

**工具名称：** `GoogleFlights`

**输入：**

```python
{
    "origin": str,
    "destination": str,
    "departure_date": str | None,
    "return_date": str | None,
    "passengers": int | None,
}
```

**输出：**

```python
{
    "results": list[{"airline": str, "price": str, "departure": str, "arrival": str, "duration": str}],
    "total": int,
}
```

### GoogleBooks

**工具名称：** `GoogleBooks`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "author": str, "year": str | None, "url": str}],
    "total": int,
}
```

### GoogleScholar

**工具名称：** `GoogleScholar`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "authors": str, "year": str | None, "url": str}],
    "total": int,
}
```

### GoogleMaps

**工具名称：** `GoogleMaps`

**输入：**

```python
{
    "query": str,
}
```

**输出：**

```python
{
    "results": list[{"name": str, "address": str, "rating": str | None, "url": str | None}],
    "total": int,
}
```

### YouTubeSearch

**工具名称：** `YouTubeSearch`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "channel": str, "duration": str | None}],
    "total": int,
}
```

### YouTubeTranscript

**工具名称：** `YouTubeTranscript`

**输入：**

```python
{
    "video_id": str,
    "language": str | None,
}
```

**输出：**

```python
{
    "transcript": list[{"text": str, "start": float, "duration": float}],
    "video_id": str,
}
```

### RedditSearch

**工具名称：** `RedditSearch`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "subreddit": str | None,
    "sort": Literal["relevance", "hot", "top", "new"] | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "subreddit": str, "score": int, "comments": int}],
    "total": int,
}
```

### HackerNews

**工具名称：** `HackerNews`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "score": int, "by": str}],
    "total": int,
}
```

### WolframAlpha

**工具名称：** `WolframAlpha`

**输入：**

```python
{
    "input": str,
}
```

**输出：**

```python
{
    "result": str,
}
```

### PubMed

**工具名称：** `PubMed`

**输入：**

```python
{
    "query": str,
    "count": int | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "authors": str, "journal": str, "year": str | None, "url": str}],
    "total": int,
}
```

### Arxiv

**工具名称：** `Arxiv`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "sort_by": Literal["relevance", "submitted_date"] | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "authors": str, "summary": str, "url": str}],
    "total": int,
}
```

### Wikipedia

**工具名称：** `Wikipedia`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "language": str | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "summary": str, "url": str}],
    "total": int,
}
```

### Weather

**工具名称：** `Weather`

**输入：**

```python
{
    "location": str,
    "units": Literal["metric", "imperial"] | None,
}
```

**输出：**

```python
{
    "location": str,
    "temperature": float,
    "conditions": str,
    "humidity": float,
    "wind_speed": float,
}
```

### FileSurfer

**工具名称：** `FileSurfer`

**输入：**

```python
{
    "path": str,
    "pattern": str | None,
}
```

**输出：**

```python
{
    "files": list[{"path": str, "type": str, "size": int}],
    "total": int,
}
```

### DockerExec

**工具名称：** `DockerExec`

**输入：**

```python
{
    "container": str,
    "command": str,
    "timeout": int | None,
}
```

**输出：**

```python
{
    "output": str,
    "exitCode": int,
}
```

### DockerListContainers

**工具名称：** `DockerListContainers`

**输入：**

```python
{
    "all": bool | None,
}
```

**输出：**

```python
{
    "containers": list[{"id": str, "name": str, "status": str, "image": str}],
}
```

### DockerListImages

**工具名称：** `DockerListImages`

**输入：**

```python
{}  # No input parameters
```

**输出：**

```python
{
    "images": list[{"id": str, "repository": str, "tag": str, "size": str}],
}
```

### DockerListVolumes

**工具名称：** `DockerListVolumes`

**输入：**

```python
{}  # No input parameters
```

**输出：**

```python
{
    "volumes": list[{"name": str, "mountpoint": str}],
}
```

### UAIDesigner

**工具名称：** `UAIDesigner`

**输入：**

```python
{
    "prompt": str,
}
```

**输出：**

```python
{
    "result": str,
}
```

### Nuclia

**工具名称：** `Nuclia`

**输入：**

```python
{
    "query": str,
    "knowledge_box": str,
}
```

**输出：**

```python
{
    "results": list[{"text": str, "score": float, "source": str}],
    "total": int,
}
```

### Tavily

**工具名称：** `Tavily`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "include_answer": bool | None,
    "include_raw_content": bool | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "content": str}],
    "answer": str | None,
    "total": int,
}
```

### Vercel

**工具名称：** `Vercel`

**输入：**

```python
{
    "method": Literal["GET", "POST", "PUT", "PATCH", "DELETE"],
    "path": str,
    "body": dict | None,
}
```

**输出：**

```python
{
    "status": int,
    "data": dict | list | str,
}
```

### GitHub

**工具名称：** `GitHub`

**输入：**

```python
{
    "owner": str,
    "repo": str,
    "action": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Slack

**工具名称：** `Slack`

**输入：**

```python
{
    "action": Literal["send_message", "list_channels", "get_channel_history"],
    "channel": str,
    "message": str | None,
    "limit": int | None,
}
```

**输出：**

```python
{
    "result": str | dict | list,
}
```

### Jira

**工具名称：** `Jira`

**输入：**

```python
{
    "action": Literal["search_issues", "get_issue", "create_issue", "add_comment"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Linear

**工具名称：** `Linear`

**输入：**

```python
{
    "action": Literal["search_issues", "get_issue", "create_issue", "update_issue", "add_comment"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Notion

**工具名称：** `Notion`

**输入：**

```python
{
    "action": Literal["search", "get_page", "create_page", "update_page", "append_blocks"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Confluence

**工具名称：** `Confluence`

**输入：**

```python
{
    "action": Literal["search", "get_page", "create_page", "update_page"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### GitLab

**工具名称：** `GitLab`

**输入：**

```python
{
    "action": str,
    "project": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Bitbucket

**工具名称：** `Bitbucket`

**输入：**

```python
{
    "action": str,
    "workspace": str,
    "repo_slug": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Discord

**工具名称：** `Discord`

**输入：**

```python
{
    "action": Literal["send_message", "get_channel_history", "list_channels"],
    "channel_id": str,
    "message": str | None,
    "limit": int | None,
}
```

**输出：**

```python
{
    "result": str | dict | list,
}
```

### Telegram

**工具名称：** `Telegram`

**输入：**

```python
{
    "action": Literal["send_message", "get_chat_history"],
    "chat_id": str,
    "message": str | None,
    "limit": int | None,
}
```

**输出：**

```python
{
    "result": str | dict | list,
}
```

### Email

**工具名称：** `Email`

**输入：**

```python
{
    "action": Literal["send_email", "list_inbox", "get_email"],
    "to": str | None,
    "subject": str | None,
    "body": str | None,
    "limit": int | None,
    "email_id": str | None,
}
```

**输出：**

```python
{
    "result": str | dict | list,
}
```

### Calendar

**工具名称：** `Calendar`

**输入：**

```python
{
    "action": Literal["list_events", "create_event", "update_event", "delete_event"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### GoogleDrive

**工具名称：** `GoogleDrive`

**输入：**

```python
{
    "action": Literal["list_files", "get_file", "search_files", "upload_file", "create_folder"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Dropbox

**工具名称：** `Dropbox`

**输入：**

```python
{
    "action": Literal["list_files", "get_file", "search_files", "upload_file"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### OneDrive

**工具名称：** `OneDrive`

**输入：**

```python
{
    "action": Literal["list_files", "get_file", "search_files", "upload_file"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Salesforce

**工具名称：** `Salesforce`

**输入：**

```python
{
    "action": Literal["query", "get_object", "create_object", "update_object"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### HubSpot

**工具名称：** `HubSpot`

**输入：**

```python
{
    "action": Literal["search_contacts", "get_contact", "create_contact", "update_contact"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Shopify

**工具名称：** `Shopify`

**输入：**

```python
{
    "action": Literal["get_products", "get_orders", "get_customers", "create_product", "update_product"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### WordPress

**工具名称：** `WordPress`

**输入：**

```python
{
    "action": Literal["get_posts", "create_post", "update_post", "delete_post"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Stripe

**工具名称：** `Stripe`

**输入：**

```python
{
    "action": Literal["list_charges", "list_customers", "list_invoices", "create_charge", "create_customer"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### PagerDuty

**工具名称：** `PagerDuty`

**输入：**

```python
{
    "action": Literal["list_incidents", "get_incident", "acknowledge_incident", "resolve_incident"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Datadog

**工具名称：** `Datadog`

**输入：**

```python
{
    "action": Literal["query_metrics", "list_monitors", "get_monitor", "search_logs"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Sentry

**工具名称：** `Sentry`

**输入：**

```python
{
    "action": Literal["list_issues", "get_issue", "search_events"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Cloudflare

**工具名称：** `Cloudflare`

**输入：**

```python
{
    "action": Literal["list_zones", "purge_cache", "list_dns_records", "create_dns_record"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### AWS

**工具名称：** `AWS`

**输入：**

```python
{
    "service": str,
    "action": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### GCP

**工具名称：** `GCP`

**输入：**

```python
{
    "service": str,
    "action": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Azure

**工具名称：** `Azure`

**输入：**

```python
{
    "service": str,
    "action": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Kubernetes

**工具名称：** `Kubernetes`

**输入：**

```python
{
    "action": Literal["get_pods", "get_deployments", "get_services", "get_namespaces", "describe_resource", "apply_manifest"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Terraform

**工具名称：** `Terraform`

**输入：**

```python
{
    "action": Literal["init", "plan", "apply", "destroy", "output", "validate"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": str,
}
```

### Databricks

**工具名称：** `Databricks`

**输入：**

```python
{
    "action": Literal["list_clusters", "list_jobs", "run_job", "list_notebooks"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Snowflake

**工具名称：** `Snowflake`

**输入：**

```python
{
    "action": Literal["execute_query", "list_databases", "list_schemas", "list_tables"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### BigQuery

**工具名称：** `BigQuery`

**输入：**

```python
{
    "action": Literal["execute_query", "list_datasets", "list_tables", "get_schema"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Postgres

**工具名称：** `Postgres`

**输入：**

```python
{
    "action": Literal["execute_query", "list_tables", "get_schema", "list_databases"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### MySQL

**工具名称：** `MySQL`

**输入：**

```python
{
    "action": Literal["execute_query", "list_tables", "get_schema", "list_databases"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### SQLite

**工具名称：** `SQLite`

**输入：**

```python
{
    "action": Literal["execute_query", "list_tables", "get_schema"],
    "database": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### MSSQL

**工具名称：** `MSSQL`

**输入：**

```python
{
    "action": Literal["execute_query", "list_tables", "get_schema", "list_databases"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### MongoDB

**工具名称：** `MongoDB`

**输入：**

```python
{
    "action": Literal["find", "aggregate", "insert_one", "update_one", "delete_one", "list_collections"],
    "connection_string": str,
    "database": str,
    "collection": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Redis

**工具名称：** `Redis`

**输入：**

```python
{
    "action": Literal["get", "set", "del", "keys", "exists", "expire"],
    "key": str | None,
    "value": str | None,
    "pattern": str | None,
}
```

**输出：**

```python
{
    "result": str | int | list | None,
}
```

### Elasticsearch

**工具名称：** `Elasticsearch`

**输入：**

```python
{
    "action": Literal["search", "index", "delete", "get", "list_indices"],
    "index": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Pinecone

**工具名称：** `Pinecone`

**输入：**

```python
{
    "action": Literal["query", "upsert", "delete", "list_indexes"],
    "index": str | None,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Weaviate

**工具名称：** `Weaviate`

**输入：**

```python
{
    "action": Literal["query", "get", "create", "update", "delete"],
    "class": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Qdrant

**工具名称：** `Qdrant`

**输入：**

```python
{
    "action": Literal["search", "upsert", "delete", "list_collections"],
    "collection": str | None,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Milvus

**工具名称：** `Milvus`

**输入：**

```python
{
    "action": Literal["search", "insert", "delete", "list_collections"],
    "collection": str | None,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Chroma

**工具名称：** `Chroma`

**输入：**

```python
{
    "action": Literal["query", "add", "delete", "list_collections"],
    "collection": str | None,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### OpenAI

**工具名称：** `OpenAI`

**输入：**

```python
{
    "action": Literal["chat_completion", "embedding", "list_models"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Anthropic

**工具名称：** `Anthropic`

**输入：**

```python
{
    "action": Literal["messages", "list_models"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Gemini

**工具名称：** `Gemini`

**输入：**

```python
{
    "action": Literal["generate", "embed", "list_models"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Cohere

**工具名称：** `Cohere`

**输入：**

```python
{
    "action": Literal["generate", "embed", "rerank"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Perplexity

**工具名称：** `Perplexity`

**输入：**

```python
{
    "query": str,
}
```

**输出：**

```python
{
    "result": str,
}
```

### ElevenLabs

**工具名称：** `ElevenLabs`

**输入：**

```python
{
    "text": str,
    "voice": str | None,
    "model": str | None,
}
```

**输出：**

```python
{
    "audio": str,  # Base64 encoded audio
    "duration_ms": int,
}
```

### Replicate

**工具名称：** `Replicate`

**输入：**

```python
{
    "model": str,
    "input": dict,
    "version": str | None,
}
```

**输出：**

```python
{
    "output": list | str | dict,
}
```

### StabilityAI

**工具名称：** `StabilityAI`

**输入：**

```python
{
    "prompt": str,
    "negative_prompt": str | None,
    "width": int | None,
    "height": int | None,
    "samples": int | None,
}
```

**输出：**

```python
{
    "images": list[str],  # Base64 encoded images
    "seed": int,
}
```

### Midjourney

**工具名称：** `Midjourney`

**输入：**

```python
{
    "prompt": str,
    "aspect_ratio": str | None,
    "style": str | None,
}
```

**输出：**

```python
{
    "image_url": str,
    "seed": int,
}
```

### DALL·E

**工具名称：** `DALL·E`

**输入：**

```python
{
    "prompt": str,
    "size": Literal["256x256", "512x512", "1024x1024"] | None,
    "n": int | None,
}
```

**输出：**

```python
{
    "images": list[str],  # Base64 encoded images
}
```

### Figma

**工具名称：** `Figma`

**输入：**

```python
{
    "action": Literal["get_file", "get_node", "get_images", "get_styles"],
    "file_key": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Canva

**工具名称：** `Canva`

**输入：**

```python
{
    "action": Literal["create_design", "get_design", "list_templates", "upload_asset"],
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Airtable

**工具名称：** `Airtable`

**输入：**

```python
{
    "action": Literal["list_records", "get_record", "create_record", "update_record", "delete_record"],
    "base_id": str,
    "table_name": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Supabase

**工具名称：** `Supabase`

**输入：**

```python
{
    "action": Literal["select", "insert", "update", "delete", "rpc"],
    "table": str | None,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### Firebase

**工具名称：** `Firebase`

**输入：**

```python
{
    "action": Literal["get", "set", "update", "push", "delete", "query"],
    "path": str,
    "data": dict | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": dict | list | str | None,
}
```

### VercelAI

**工具名称：** `VercelAI`

**输入：**

```python
{
    "provider": str,
    "model": str,
    "messages": list[dict],
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": str | dict,
}
```

### LangChain

**工具名称：** `LangChain`

**输入：**

```python
{
    "action": Literal["invoke", "stream", "get_schema"],
    "agent_id": str,
    "input": dict,
}
```

**输出：**

```python
{
    "output": str | dict,
}
```

### Haystack

**工具名称：** `Haystack`

**输入：**

```python
{
    "query": str,
    "pipeline": str,
    "params": dict | None,
}
```

**输出：**

```python
{
    "results": list[dict],
    "total": int,
}
```

### LlamaIndex

**工具名称：** `LlamaIndex`

**输入：**

```python
{
    "query": str,
    "index": str,
    "params": dict | None,
}
```

**输出：**

```python
{
    "response": str,
    "source_nodes": list[dict],
}
```

### Composio

**工具名称：** `Composio`

**输入：**

```python
{
    "action": str,
    "app": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Zapier

**工具名称：** `Zapier`

**输入：**

```python
{
    "action": Literal["execute_zap", "list_zaps", "get_zap"],
    "zap_id": str | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Make

**工具名称：** `Make`

**输入：**

```python
{
    "action": Literal["execute_scenario", "list_scenarios", "get_scenario"],
    "scenario_id": str | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### n8n

**工具名称：** `n8n`

**输入：**

```python
{
    "action": Literal["execute_workflow", "list_workflows", "get_workflow"],
    "workflow_id": str | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### Obsidian

**工具名称：** `Obsidian`

**输入：**

```python
{
    "action": Literal["search_notes", "get_note", "create_note", "update_note"],
    "vault": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list | str,
}
```

### NotionDB

**工具名称：** `NotionDB`

**输入：**

```python
{
    "action": Literal["query_database", "get_database", "create_database_item", "update_database_item"],
    "database_id": str,
    "params": dict,
}
```

**输出：**

```python
{
    "result": dict | list,
}
```

### ExaSearch

**工具名称：** `ExaSearch`

**输入：**

```python
{
    "query": str,
    "count": int | None,
    "type": Literal["keyword", "neural", "auto"] | None,
    "include_domains": list[str] | None,
    "exclude_domains": list[str] | None,
}
```

**输出：**

```python
{
    "results": list[{"title": str, "url": str, "content": str}],
    "total": int,
}
```

### Firecrawl

**工具名称：** `Firecrawl`

**输入：**

```python
{
    "url": str,
    "formats": list[Literal["markdown", "html", "screenshot", "links"]] | None,
    "only_main_content": bool | None,
}
```

**输出：**

```python
{
    "content": str,
    "metadata": dict,
    "screenshot": str | None,
}
```

### Apify

**工具名称：** `Apify`

**输入：**

```python
{
    "actor_id": str,
    "run_input": dict,
    "memory_mbytes": int | None,
    "build": str | None,
}
```

**输出：**

```python
{
    "results": list[dict],
    "total": int,
}
```

### BrightData

**工具名称：** `BrightData`

**输入：**

```python
{
    "dataset_id": str,
    "input": dict,
}
```

**输出：**

```python
{
    "results": list[dict],
    "total": int,
}
```

### ScrapingBee

**工具名称：** `ScrapingBee`

**输入：**

```python
{
    "url": str,
    "params": dict | None,
}
```

**输出：**

```python
{
    "content": str,
    "status_code": int,
}
```

### ScrapingFish

**工具名称：** `ScrapingFish`

**输入：**

```python
{
    "url": str,
    "params": dict | None,
}
```

**输出：**

```python
{
    "content": str,
    "status_code": int,
}
```

### Diffbot

**工具名称：** `Diffbot`

**输入：**

```python
{
    "url": str,
    "api": Literal["article", "product", "image", "discussion"],
}
```

**输出：**

```python
{
    "objects": list[dict],
    "type": str,
}
```

### Screenshot

**工具名称：** `Screenshot`

**输入：**

```python
{
    "url": str,
    "width": int | None,
    "height": int | None,
    "full_page": bool | None,
}
```

**输出：**

```python
{
    "screenshot": str,  # Base64 encoded PNG
    "url": str,
}
```

### PDF

**工具名称：** `PDF`

**输入：**

```python
{
    "action": Literal["read", "extract_text", "extract_images", "get_metadata"],
    "file_path": str,
}
```

**输出：**

```python
{
    "text": str | None,
    "metadata": dict | None,
    "images": list[str] | None,
    "page_count": int,
}
```

### CSV

**工具名称：** `CSV`

**输入：**

```python
{
    "action": Literal["read", "query", "get_schema"],
    "file_path": str,
    "query": str | None,
}
```

**输出：**

```python
{
    "data": list[dict] | list[list],
    "columns": list[str],
    "rows": int,
}
```

### Excel

**工具名称：** `Excel`

**输入：**

```python
{
    "action": Literal["read", "write", "get_sheets"],
    "file_path": str,
    "sheet": str | None,
    "data": list[list] | None,
}
```

**输出：**

```python
{
    "data": list[list],
    "sheets": list[str],
    "rows": int,
    "columns": int,
}
```

### Geo

**工具名称：** `Geo`

**输入：**

```python
{
    "action": Literal["geocode", "reverse_geocode", "search_places"],
    "query": str | None,
    "lat": float | None,
    "lng": float | None,
}
```

**输出：**

```python
{
    "results": list[{"lat": float, "lng": float, "address": str, "place_id": str}],
    "total": int,
}
```

### Time

**工具名称：** `Time`

**输入：**

```python
{
    "action": Literal["current_time", "convert_timezone", "list_timezones"],
    "timezone": str | None,
    "target_timezone": str | None,
    "datetime": str | None,
}
```

**输出：**

```python
{
    "datetime": str,
    "timezone": str,
    "unix_timestamp": int,
}
```

### UUID

**工具名称：** `UUID`

**输入：**

```python
{
    "count": int | None,
    "version": Literal[4, 7] | None,
}
```

**输出：**

```python
{
    "uuids": list[str],
}
```

### Hash

**工具名称：** `Hash`

**输入：**

```python
{
    "algorithm": Literal["md5", "sha1", "sha256", "sha512"],
    "input": str,
}
```

**输出：**

```python
{
    "hash": str,
    "algorithm": str,
}
```

### QRCode

**工具名称：** `QRCode`

**输入：**

```python
{
    "data": str,
    "size": int | None,
}
```

**输出：**

```python
{
    "image": str,  # Base64 encoded PNG
    "data": str,
}
```

### Barcode

**工具名称：** `Barcode`

**输入：**

```python
{
    "action": Literal["generate", "decode"],
    "data": str | None,
    "image": str | None,
    "type": Literal["code128", "ean13", "ean8", "upca", "upce"] | None,
}
```

**输出：**

```python
{
    "image": str | None,
    "data": str | None,
    "type": str | None,
}
```

### Compare

**工具名称：** `Compare`

**输入：**

```python
{
    "input1": str,
    "input2": str,
    "type": Literal["text", "json", "code"] | None,
}
```

**输出：**

```python
{
    "diff": str,
    "similarity": float,
}
```

### Template

**工具名称：** `Template`

**输入：**

```python
{
    "template": str,
    "data": dict,
}
```

**输出：**

```python
{
    "result": str,
}
```

### Eval

**工具名称：** `Eval`

**输入：**

```python
{
    "expression": str,
    "context": dict | None,
}
```

**输出：**

```python
{
    "result": Any,
}
```

### Math

**工具名称：** `Math`

**输入：**

```python
{
    "expression": str,
}
```

**输出：**

```python
{
    "result": float | str,
    "steps": list[str] | None,
}
```

### Random

**工具名称：** `Random`

**输入：**

```python
{
    "min": float | None,
    "max": float | None,
    "count": int | None,
    "type": Literal["int", "float", "bool", "uuid"] | None,
}
```

**输出：**

```python
{
    "values": list[Any],
}
```

### Password

**工具名称：** `Password`

**输入：**

```python
{
    "length": int | None,
    "include_uppercase": bool | None,
    "include_lowercase": bool | None,
    "include_numbers": bool | None,
    "include_symbols": bool | None,
}
```

**输出：**

```python
{
    "password": str,
}
```

### Color

**工具名称：** `Color`

**输入：**

```python
{
    "action": Literal["generate", "convert", "analyze"],
    "value": str | None,
    "from_format": Literal["hex", "rgb", "hsl", "hsv"] | None,
    "to_format": Literal["hex", "rgb", "hsl", "hsv"] | None,
}
```

**输出：**

```python
{
    "hex": str,
    "rgb": dict,
    "hsl": dict,
    "name": str | None,
}
```

### Image

**工具名称：** `Image`

**输入：**

```python
{
    "action": Literal["analyze", "convert", "resize", "compress", "generate"],
    "image": str | None,
    "format": str | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": str | dict,
}
```

### Video

**工具名称：** `Video`

**输入：**

```python
{
    "action": Literal["analyze", "convert", "compress", "extract_frames"],
    "video": str,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": str | dict,
}
```

### Audio

**工具名称：** `Audio`

**输入：**

```python
{
    "action": Literal["transcribe", "tts", "analyze"],
    "audio": str | None,
    "text": str | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "result": str | dict,
}
```

### Translate

**工具名称：** `Translate`

**输入：**

```python
{
    "text": str,
    "source_language": str | None,
    "target_language": str,
}
```

**输出：**

```python
{
    "translated_text": str,
    "source_language": str,
    "target_language": str,
}
```

### Summarize

**工具名称：** `Summarize`

**输入：**

```python
{
    "text": str,
    "max_length": int | None,
    "format": Literal["paragraph", "bullets", "tldr"] | None,
}
```

**输出：**

```python
{
    "summary": str,
    "original_length": int,
    "summary_length": int,
}
```

### Classify

**工具名称：** `Classify`

**输入：**

```python
{
    "text": str,
    "categories": list[str],
}
```

**输出：**

```python
{
    "category": str,
    "confidence": float,
    "scores": dict[str, float],
}
```

### Extract

**工具名称：** `Extract`

**输入：**

```python
{
    "text": str,
    "schema": dict,
}
```

**输出：**

```python
{
    "data": dict,
}
```

### Embed

**工具名称：** `Embed`

**输入：**

```python
{
    "text": str | list[str],
    "model": str | None,
}
```

**输出：**

```python
{
    "embeddings": list[list[float]],
    "model": str,
    "dimensions": int,
}
```

### Rerank

**工具名称：** `Rerank`

**输入：**

```python
{
    "query": str,
    "documents": list[str],
    "model": str | None,
    "top_k": int | None,
}
```

**输出：**

```python
{
    "results": list[{"index": int, "score": float, "text": str}],
    "model": str,
}
```

### HybridSearch

**工具名称：** `HybridSearch`

**输入：**

```python
{
    "query": str,
    "documents": list[dict],
    "text_fields": list[str],
    "embedding_fields": list[str],
    "top_k": int | None,
    "alpha": float | None,
}
```

**输出：**

```python
{
    "results": list[dict],
    "total": int,
}
```

### VectorSearch

**工具名称：** `VectorSearch`

**输入：**

```python
{
    "collection": str,
    "query_vector": list[float],
    "top_k": int | None,
    "filters": dict | None,
}
```

**输出：**

```python
{
    "results": list[{"id": str, "score": float, "metadata": dict}],
    "total": int,
}
```

### Memory

**工具名称：** `Memory`

**输入：**

```python
{
    "action": Literal["store", "retrieve", "search", "delete", "list"],
    "key": str | None,
    "value": str | None,
    "query": str | None,
    "namespace": str | None,
}
```

**输出：**

```python
{
    "result": str | list | None,
}
```

### Knowledge

**工具名称：** `Knowledge`

**输入：**

```python
{
    "action": Literal["query", "add", "delete", "list"],
    "query": str | None,
    "content": str | None,
    "source": str | None,
}
```

**输出：**

```python
{
    "result": str | list,
}
```

### SemanticCache

**工具名称：** `SemanticCache`

**输入：**

```python
{
    "action": Literal["get", "set", "invalidate", "clear"],
    "key": str | None,
    "value": str | None,
    "threshold": float | None,
}
```

**输出：**

```python
{
    "result": str | None,
}
```

### Feedback

**工具名称：** `Feedback`

**输入：**

```python
{
    "type": Literal["thumbs_up", "thumbs_down", "rating", "comment"],
    "value": str | int | bool,
    "target": str | None,
}
```

**输出：**

```python
{
    "success": bool,
    "feedback_id": str,
}
```

### Report

**工具名称：** `Report`

**输入：**

```python
{
    "title": str,
    "content": str,
    "format": Literal["markdown", "html", "pdf"] | None,
}
```

**输出：**

```python
{
    "url": str,
    "format": str,
}
```

### Share

**工具名称：** `Share`

**输入：**

```python
{
    "content": str,
    "platform": Literal["twitter", "linkedin", "slack", "discord", "email"] | None,
    "recipients": list[str] | None,
}
```

**输出：**

```python
{
    "success": bool,
    "url": str | None,
    "message": str,
}
```

### Wait

**工具名称：** `Wait`

**输入：**

```python
{
    "duration_ms": int,
}
```

**输出：**

```python
{
    "elapsed_ms": int,
}
```

### Sleep

**工具名称：** `Sleep`

**输入：**

```python
{
    "duration_ms": int,
}
```

**输出：**

```python
{
    "elapsed_ms": int,
}
```

### Loop

**工具名称：** `Loop`

**输入：**

```python
{
    "iterator": list[Any],
    "prompt_template": str,
    "tool_name": str | None,
    "tool_input_template": dict | None,
}
```

**输出：**

```python
{
    "results": list[Any],
    "count": int,
}
```

### Condition

**工具名称：** `Condition`

**输入：**

```python
{
    "condition": str,
    "if_tool": str | None,
    "if_input": dict | None,
    "else_tool": str | None,
    "else_input": dict | None,
}
```

**输出：**

```python
{
    "result": Any,
    "branch": "if" | "else",
}
```

### Map

**工具名称：** `Map`

**输入：**

```python
{
    "items": list[Any],
    "prompt_template": str,
    "concurrency": int | None,
}
```

**输出：**

```python
{
    "results": list[Any],
    "count": int,
}
```

### Filter

**工具名称：** `Filter`

**输入：**

```python
{
    "items": list[Any],
    "condition": str,
}
```

**输出：**

```python
{
    "results": list[Any],
    "count": int,
}
```

### Reduce

**工具名称：** `Reduce`

**输入：**

```python
{
    "items": list[Any],
    "prompt": str,
    "initial_value": Any | None,
}
```

**输出：**

```python
{
    "result": Any,
}
```

### GroupBy

**工具名称：** `GroupBy`

**输入：**

```python
{
    "items": list[dict],
    "key": str,
}
```

**输出：**

```python
{
    "groups": dict[str, list[dict]],
    "count": int,
}
```

### Sort

**工具名称：** `Sort`

**输入：**

```python
{
    "items": list[Any],
    "key": str | None,
    "reverse": bool | None,
}
```

**输出：**

```python
{
    "items": list[Any],
    "count": int,
}
```

### Paginate

**工具名称：** `Paginate`

**输入：**

```python
{
    "items": list[Any],
    "page_size": int,
    "page": int | None,
}
```

**输出：**

```python
{
    "items": list[Any],
    "page": int,
    "total_pages": int,
    "total_items": int,
}
```

### Batch

**工具名称：** `Batch`

**输入：**

```python
{
    "items": list[Any],
    "batch_size": int | None,
}
```

**输出：**

```python
{
    "batches": list[list[Any]],
    "count": int,
}
```

### Chunk

**工具名称：** `Chunk`

**输入：**

```python
{
    "text": str,
    "chunk_size": int,
    "overlap": int | None,
}
```

**输出：**

```python
{
    "chunks": list[str],
    "count": int,
}
```

### Tokenize

**工具名称：** `Tokenize`

**输入：**

```python
{
    "text": str,
    "model": str | None,
}
```

**输出：**

```python
{
    "tokens": list[int],
    "token_count": int,
}
```

### Detokenize

**工具名称：** `Detokenize`

**输入：**

```python
{
    "tokens": list[int],
    "model": str | None,
}
```

**输出：**

```python
{
    "text": str,
}
```

### Encode

**工具名称：** `Encode`

**输入：**

```python
{
    "data": str,
    "encoding": Literal["base64", "url", "html", "unicode"],
}
```

**输出：**

```python
{
    "encoded": str,
}
```

### Decode

**工具名称：** `Decode`

**输入：**

```python
{
    "data": str,
    "encoding": Literal["base64", "url", "html", "unicode"],
}
```

**输出：**

```python
{
    "decoded": str,
}
```

### Compress

**工具名称：** `Compress`

**输入：**

```python
{
    "data": str,
    "algorithm": Literal["gzip", "zlib", "brotli"] | None,
}
```

**输出：**

```python
{
    "compressed": str,  # Base64 encoded
    "algorithm": str,
    "original_size": int,
    "compressed_size": int,
}
```

### Decompress

**工具名称：** `Decompress`

**输入：**

```python
{
    "data": str,  # Base64 encoded compressed data
    "algorithm": Literal["gzip", "zlib", "brotli"],
}
```

**输出：**

```python
{
    "decompressed": str,
    "algorithm": str,
    "original_size": int,
}
```

### Cache

**工具名称：** `Cache`

**输入：**

```python
{
    "action": Literal["get", "set", "delete", "clear", "stats"],
    "key": str | None,
    "value": str | None,
    "ttl_seconds": int | None,
}
```

**输出：**

```python
{
    "result": Any,
    "stats": dict | None,
}
```

### RateLimit

**工具名称：** `RateLimit`

**输入：**

```python
{
    "action": Literal["check", "increment", "reset", "get_limits"],
    "key": str | None,
    "max_requests": int | None,
    "window_seconds": int | None,
}
```

**输出：**

```python
{
    "allowed": bool,
    "remaining": int,
    "reset_at": int,
}
```

### Retry

**工具名称：** `Retry`

**输入：**

```python
{
    "max_retries": int | None,
    "delay_ms": int | None,
    "backoff_multiplier": float | None,
}
```

**输出：**

```python
{
    "attempts": int,
    "delays_ms": list[int],
}
```

### CircuitBreaker

**工具名称：** `CircuitBreaker`

**输入：**

```python
{
    "action": Literal["check", "record_success", "record_failure", "reset", "status"],
    "name": str | None,
    "threshold": int | None,
    "reset_timeout_ms": int | None,
}
```

**输出：**

```python
{
    "state": Literal["closed", "open", "half_open"],
    "failure_count": int,
    "success_count": int,
}
```

### Timeout

**工具名称：** `Timeout`

**输入：**

```python
{
    "duration_ms": int,
}
```

**输出：**

```python
{
    "timed_out": bool,
    "elapsed_ms": int,
}
```

### Debounce

**工具名称：** `Debounce`

**输入：**

```python
{
    "key": str,
    "value": Any,
    "wait_ms": int,
}
```

**输出：**

```python
{
    "debounced": bool,
    "value": Any | None,
}
```

### Throttle

**工具名称：** `Throttle`

**输入：**

```python
{
    "key": str,
    "value": Any,
    "interval_ms": int,
}
```

**输出：**

```python
{
    "throttled": bool,
    "remaining_ms": int,
}
```

### Every

**工具名称：** `Every`

**输入：**

```python
{
    "interval_ms": int,
    "prompt": str,
    "max_executions": int | None,
    "stop_on_failure": bool | None,
}
```

**输出：**

```python
{
    "executions": int,
    "results": list[Any],
    "completed": bool,
}
```

### Cron

**工具名称：** `Cron`

**输入：**

```python
{
    "expression": str,
    "prompt": str,
    "timezone": str | None,
    "max_executions": int | None,
}
```

**输出：**

```python
{
    "job_id": str,
    "next_run": str,
}
```

### Schedule

**工具名称：** `Schedule`

**输入：**

```python
{
    "action": Literal["create", "cancel", "list", "get"],
    "schedule_id": str | None,
    "cron": str | None,
    "prompt": str | None,
    "timezone": str | None,
}
```

**输出：**

```python
{
    "schedule": dict | None,
    "schedules": list[dict] | None,
}
```

### Webhook

**工具名称：** `Webhook`

**输入：**

```python
{
    "action": Literal["register", "trigger", "list", "delete", "get"],
    "webhook_id": str | None,
    "url": str | None,
    "event": str | None,
    "data": dict | None,
}
```

**输出：**

```python
{
    "webhook": dict | None,
    "webhooks": list[dict] | None,
    "result": Any,
}
```

### Event

**工具名称：** `Event`

**输入：**

```python
{
    "action": Literal["emit", "on", "list", "clear"],
    "event": str,
    "data": Any | None,
    "handler": str | None,
}
```

**输出：**

```python
{
    "success": bool,
    "events": list[str] | None,
}
```

### PubSub

**工具名称：** `PubSub`

**输入：**

```python
{
    "action": Literal["publish", "subscribe", "unsubscribe", "list_topics"],
    "topic": str,
    "message": Any | None,
}
```

**输出：**

```python
{
    "success": bool,
    "message_id": str | None,
    "topics": list[str] | None,
}
```

### Messaging

**工具名称：** `Messaging`

**输入：**

```python
{
    "action": Literal["send", "receive", "list_queues", "create_queue", "delete_queue"],
    "queue": str,
    "message": Any | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "success": bool,
    "message_id": str | None,
    "messages": list[Any] | None,
    "queues": list[str] | None,
}
```

### StateMachine

**工具名称：** `StateMachine`

**输入：**

```python
{
    "action": Literal["get_state", "set_state", "transition", "reset", "get_history"],
    "name": str,
    "state": str | None,
    "transition": str | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "state": str,
    "valid_transitions": list[str],
    "history": list[dict] | None,
}
```

### Workflow

**工具名称：** `Workflow`

**输入：**

```python
{
    "action": Literal["start", "pause", "resume", "cancel", "status", "list"],
    "workflow_id": str | None,
    "workflow_name": str | None,
    "input": dict | None,
    "params": dict | None,
}
```

**输出：**

```python
{
    "workflow_id": str,
    "status": str,
    "current_step": str | None,
    "output": Any | None,
}
```