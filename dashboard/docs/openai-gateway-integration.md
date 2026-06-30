# 接入 OpenAI / GPT 模型（方案 A：翻译网关）

目标：让用户能在 dashboard 里选 GPT 模型跑 agent，**不改运行时与路由代码**——
复用现有 `provider_profiles` 的「按 model 选 baseUrl」机制。

## 为什么需要网关

运行时通过 `env.ANTHROPIC_BASE_URL`（`server-agent.ts:892`）把 **Anthropic Messages 协议**
请求发往 provider 的 baseUrl。deepseek 能直连是因为它提供 Anthropic 兼容端点；
**OpenAI 没有 Anthropic 兼容端点**，所以中间必须放一个 Anthropic→OpenAI 翻译网关。

```
选 model=gpt-5.5
  → resolveRuntimeProvider(tenantId, "gpt-5.5")            server.ts:1574 / 3562
  → resolveProviderProfileForModel：命中 availableModels 含 gpt-5.5 的 profile   server-store.ts:3206
  → { apiKey: auth_token, baseUrl: base_url }
  → runAgent：env.ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL   server-agent.ts:891-892
  → Claude SDK query() 发 Anthropic /v1/messages 到 baseUrl
  → 【网关】翻译成 OpenAI → 调 GPT → 翻译回 Anthropic 格式
```

## 步骤

### 1. 起网关

配置见 `dashboard/gateway/litellm.config.yaml`。

```bash
export OPENAI_API_KEY="sk-..."
litellm --config dashboard/gateway/litellm.config.yaml --port 4000
```

入口：`http://<gateway-host>:4000`（SDK 自动拼 `/v1/messages`）。
生产务必在配置里设 `master_key` 并裸跑改鉴权跑。

### 2. 建 provider profile（管理员）

UI：`Account` 页供应商配置；或 `PUT /api/providers`（`requireAdmin`，body 为数组）：

```json
[{
  "name": "OpenAI via gateway",
  "ANTHROPIC_BASE_URL": "http://<gateway-host>:4000",
  "ANTHROPIC_AUTH_TOKEN": "<网关 master_key；免鉴权则填任意非空>",
  "availableModels": ["gpt-5.5"],
  "enabled": true
}]
```

- `availableModels` 必须写**全模型名**，带 `*` 的会被丢弃（`server-store.ts:3120`）——它是按 model 路由的依据。
- profile 名要和网关 `model_list[].model_name` 对应的模型名一致。

### 3. 补成本单价（已加占位，需替换）

`server-agent.ts` 的 `MODEL_PRICES` 已加 `gpt-5.5` 占位项（in/out = 0）。
**上线前用 OpenAI 官方定价（USD / 百万 token）替换**，否则 `estimateCostUsd` 记为 0、计费漏记。

### 4. 验证

选 gpt-5.5 发一条消息，检查：

- dashboard 日志：`[provider-route] ... source=profile:OpenAI... baseUrl=...`（`server.ts:1576`）
- 网关侧：收到 `/v1/messages` 请求，回包正常
- **务必测一条带工具调用的真实会话**（见下）

## 风险 / 必测项

- **工具调用翻译**：运行时重度依赖 SDK 的 `tool_use` + `canUseTool` 闸门。
  网关须双向翻译 Anthropic `tool_use` ↔ OpenAI function-calling，否则 GPT 用工具会断。
  上线前用「带 Read/Bash/数据源工具的会话」验证，**不能只测纯文本**。
- **thinking / 流式**：GPT 无 Claude 的 thinking summary，`includePartialMessages` 的部分
  delta 映射可能缺失，UI 表现有差异，但不影响主流程。
- **resume**：GPT 无 Claude 磁盘 transcript，跨会话 resume 仍受 transcript 寿命/cwd 影响；
  彻底方案是从 SQLite `chat_messages` 重放上下文（与会话保留问题同源）。
