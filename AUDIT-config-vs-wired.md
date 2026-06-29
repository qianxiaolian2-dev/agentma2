# 审计：哪些能力「看上去可配置，实则没接入」及其原因

> 范围：agentma2 / dashboard 的 agent 运行链路
> 核对文件：`server-agent.ts`（运行时 + query()）、`server.ts`（端点 + 模板）、`src/simulator/types.ts`（配置/类型面）
> 日期：2026-06-27

## 结论（TL;DR）

系统有**三层**，「看上去可配置但没生效」几乎都发生在层与层的**接缝**上：

```
第1层 配置面    模板 schema(AgentTemplate) + types.ts(Options 镜像) + UI 编辑器   ← 很宽，近乎镜像 SDK 全量选项
   │  （能填、能存、能在界面看到）
   ▼
第2层 运行实参  server-agent.ts: RunAgentOptions                                ← 真正的闸门，只精选了一个子集
   │  （没有的字段，运行时根本无从接收）
   ▼
第3层 实际调用  server-agent.ts: query({ options })  (1088–1125)               ← 个别字段还会被写死/覆盖
```

**根因：第1层比第2层宽。** 字段在模板/类型里存在、能填能存，但 `RunAgentOptions` 没有对应字段 → run 调用点（server.ts:1709 / 3637）无从传 → `query()` 永远看不到。再叠加两种特例：个别字段被运行时**刻意写死**，个别字段属于**另一条链路**。

---

## 四类「看上去可配，实则没接」

### A. 断在传递链（收集了，但 RunAgentOptions 没这个字段）

**A1. `effort`（主会话）— 最迷惑的一个**
- 配置面有：`AgentTemplate.effort`（types.ts:406）、模板保存默认 `'high'`（server.ts:2616）、UI 可选 low→max。
- 断点：`RunAgentOptions`（server-agent.ts:454）**无 effort 字段**；两个 run 调用点（server.ts:1709 / 3637）都没传；`query()` options（1088–1125）里也没有。
- 结果：主会话实际用**模型默认 effort**，模板里设的值是死的。
- **为什么特别坑**：子代理的 effort **反而是通的**——子代理经 `agents: opts.subagents` 进 query()，而子代理 AgentDefinition 在 server.ts:1134 解析时带了 effort，SDK 会按子代理生效。于是「同一个 effort，子代理生效、主会话失效」，肉眼极易误判为已接入。

### B. 被运行时刻意覆盖（收集了，但被写死）

**B1. `permissionMode`（主会话）**
- 配置面有：`AgentTemplate.permissionMode`（types.ts:407）、保存默认 `'default'`（server.ts:2617）、UI 可选。
- 断点：`query()` **写死** `permissionMode: 'default'`（server-agent.ts:1092，注释 "canUseTool decides everything"）；`RunAgentOptions` 也无该字段。
- 结果：模板里选 `acceptEdits` / `plan` / `dontAsk` 对**主会话无效**——一律 default，由 canUseTool 三段式接管。
- **为什么**：这是设计取舍（权限全交给 canUseTool），不是 bug。但 UI 仍把它当可配项摆着，没标"仅对子代理生效" → 产生"可配假象"。子代理的 permissionMode 同样经 AgentDefinition 仍生效。

### C. 属于另一条链路（不是 query() 选项）

**C1. `eventSources`**
- 配置面有：`AgentTemplate.eventSources`（types.ts:404）、模板保存保留（server.ts:2614）。
- 真相：它**不是 query() 选项**，而是独立的**事件源注册表**（server.ts:116 的 Map、register/remove 端点 1433–1435、WS 接入 1507/1828）。
- 结果：不是"缺口"，是另一条触发链路；但因为摆在模板配置里，容易被当成 agent 运行参数。

### D. 类型镜像 ≠ 已接入（types.ts 暴露了 SDK 全量 Options）

- `src/simulator/types.ts`（约 258+ 行）几乎**镜像了 SDK 的完整 `Options`**：`forkSession`、`maxBudgetUsd`（如有）、`fallbackModel`、`betas`、`extraArgs`、`executable`、`continue`、`debug`… 这些在类型里"看得到"。
- 真相：那是给模拟器/类型提示用的镜像；后端真正的实参是 `RunAgentOptions`（精简子集），**完全不暴露**这些字段。
- 结果：在类型/代码里看到某选项 ≠ 运行时接了它。这是"看上去可配"的最大来源。

---

## 总览表

| 能力 | 配置面有？ | RunAgentOptions？ | query() 用？ | 实际状态 | 原因类别 |
| :--- | :---: | :---: | :---: | :--- | :--- |
| effort（主会话） | ✅ 模板/UI | ❌ | ❌ | **未接**（用模型默认） | A 断链 |
| effort（子代理） | ✅ | 经 agents | ✅ | 已接 | — |
| permissionMode（主会话） | ✅ 模板/UI | ❌ | 写死 default | **被覆盖** | B 刻意 |
| permissionMode（子代理） | ✅ | 经 agents | ✅ | 已接 | — |
| eventSources | ✅ 模板 | ❌ | ❌ | 另一链路（WS 注册表） | C 异路 |
| forkSession / maxBudgetUsd / fallbackModel / betas / extraArgs … | 仅 types 镜像 | ❌ | ❌ | **未接** | D 类型镜像 |
| maxTurns / model / skills / tools / mcpServers / subagents / outputSchema / sandbox / resume / enableFileCheckpointing | ✅ | ✅ | ✅ | 已接 | — |

---

## 修复建议（按性价比）

1. **effort 主会话**（影响最大、最迷惑）：`RunAgentOptions` 加 `effort?: EffortLevel`；两个 run 调用点传模板/请求的 effort；`query()` options 加 `...(opts.effort ? { effort: opts.effort } : {})`。约 4 处、半屏改动。
2. **permissionMode 主会话**：要么真正接（加字段+传入+替换写死的 'default'），要么在 UI 标注"主会话由 canUseTool 接管，此项仅对子代理生效"消除误解。二选一。
3. **类型镜像清理（D 类）**：在模板编辑器/类型上，把"后端实际支持的子集"与"SDK 全量镜像"区分开（如未接字段灰显或不展示），从源头消除"可配假象"。
4. eventSources：UI 上从"agent 运行参数"区移到"事件触发"区，避免歧义。

> 说明：本审计只读、未改代码。effort 主会话的修补已就绪，确认后即可施行（遵循 plan→verify 流程）。
