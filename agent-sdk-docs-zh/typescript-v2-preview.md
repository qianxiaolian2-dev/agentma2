# TypeScript SDK V2 session API（已移除）

> 已移除的 V2 TypeScript Agent SDK session API 参考

V2 session API 不再受支持。TypeScript Agent SDK 0.3.142 移除了 `unstable_v2_createSession`、`unstable_v2_resumeSession`、`unstable_v2_prompt` 以及 `SDKSession` 和 `SDKSessionOptions` 类型。

要迁移，请使用 `query()` API 和它接受的 session 选项。

V2 是一个实验性的 session API，消除了对异步生成器和 yield 协调的需求。

## 安装（最后一个 V2 兼容版本）

```bash
npm install @anthropic-ai/claude-agent-sdk@0.2
```

## API 参考

### `unstable_v2_createSession()`
为多轮对话创建新会话。

### `unstable_v2_resumeSession()`
按 ID 恢复现有会话。

### `unstable_v2_prompt()`
用于单轮查询的单次便利函数。

### SDKSession interface

```typescript
interface SDKSession {
  readonly sessionId: string;
  send(message: string | SDKUserMessage): Promise<void>;
  stream(): AsyncGenerator<SDKMessage, void>;
  close(): void;
}
```

## 功能可用性

V2 session API 不支持所有 V1 功能。以下功能需要使用 V1 SDK：
- 会话分叉（`forkSession` 选项）
- 某些高级流式输入模式
