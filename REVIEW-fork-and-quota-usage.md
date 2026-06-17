# 验收报告:Conversations fork 链路 + 偷偷做完的配额用量端到端

> 范围:GPT 这轮交付。**brief 说 1 件事(fork),实际 2 件**(隐藏了配额用量接真数据,即我上轮 REVIEW 推荐的延伸项 #3)
> 验收人:Claude(读代码 + 实跑 5 个 smoke + build)
> 日期:2026-05-31
> 关联基线:`8c91b32`(N 轮未提交累积)
> 状态:**整体强通过**

## ✅ 通过项(强证据)

### 1. fork 链路扎实

`server-store.ts:1533-1554` `forkChatSession`:
- 按 `(tenantId, ownerSub, sessionId)` 拿源会话(tenant 隔离 ✓)
- 默认 title = `${源.title} · fork`,可被 `patch.title` 覆盖
- `pinned: false`(不继承,符合声明 ✓)
- 复制 messages,新 uuid
- 内部走 `saveChatSession`(复用现有持久化路径,不绕审计)

`server.ts:521-525` `POST /api/chat-sessions/:id/fork`:
- `authMiddleware`
- 写 `fork_chat_session` 审计,diff 带 `forkedId`

前端 `src/utils/chat-sessions.ts:124-128` `forkChatSession` + `Conversations.tsx:382` 用 `forkChatSessionApi` 调用 + 成功后选中新会话 ✓

### 2. smoke 7/7 全过

实跑 `AGENTMA_SMOKE_START_SERVER=1 npm run smoke:chat-session-fork`,7 个 check 全 true:`sourceSaved` / `forkCreated` / `forkTitle` / `forkNotPinned` / `forkMessagesCopied` / `listContainsBoth` / `auditRecorded`。

输出展示:源 `pinned:true, messages:2` → fork `pinned:false, messages:2`,title 被 patch 改为 "Fork Smoke Copy"。

### 3. 4 smoke 全链通过

`permission-rules && hook-rules && hook-runtime && chat-write` 一条线连跑,全绿。链跑稳定(上一轮的 teardown 修复仍然有效)。

### 4. `npm run build` 严格通过

新 bundle `dist/assets/index-B8WwSNWR.js`。

## 🎁 隐藏交付:配额用量接真数据(brief 没说)

我上轮 REVIEW 的延伸项 #3:
> "配额管理页接真数据(中) — `quotas` + audit 已有真数,渲染到 Account → 配额管理页即可,**不用动后端**"

GPT 实际做了**比我建议的还多** —— 也加了后端聚合端点:

| 层 | 改动 | 证据 |
|---|---|---|
| Store fn | `getQuotaUsageSummary(tenantId)` 聚合 `audit_logs` 里 `action='agent_run'` 最近 100 条 | `server-store.ts:969-995`,返回 `{quota, usage: {monthlyActiveSeconds, weeklyRunCount, totalRuns, successfulRuns, failedRuns, totalDurationMs, totalInputTokens, totalOutputTokens, totalTokens, totalCostUsd, lastRunAt}, recentRuns}` |
| API | `GET /api/quota/usage` | `server.ts`,authMiddleware,返回上面的聚合 |
| 类型 | `QuotaUsageRun` / `QuotaUsageSummary` 导出 | `server-store.ts:60-76` |
| 前端 | `Account.tsx +186 行` 真渲染:`formatNumber/Duration/Seconds/Currency/usageColor` 工具 + `useState<QuotaUsageSummary>` + `fetch('/api/quota/usage')` + 配额条 + 用量卡片 | `Account.tsx` |
| Smoke 扩展 | `smoke-chat-write` 加 `quotaUsageEndpoint/quotaUsageRecorded/quotaRecentRun` 三个 check | 实跑输出展示 `quotaUsage {weeklyRunCount: {used:1,limit:50,percent:2}, totalRuns:1, totalTokens:42766, totalCostUsd:0.01168, latestRun:{model:..., status:success}}` |

整套设计合理:**聚合端点放后端而不是前端拼**(单次 SQL + 一次 HTTP,避免前端拉一堆 audit 自己算)。比我建议的更好。

## ⚠️ 同款问题(连续第 4 次)

| 轮 | brief 声称 | 实际增量 |
|---|---|---|
| R1 | AgentChat 工具传递 + 类型修复 + smoke | + 死代码清理 |
| R2 | Permissions 真规则 + smoke | + 上轮 REVIEW 延伸项 3 个全做了 |
| R3 | smoke flake 修 + cwd TTL(2 件事) | + **整套 P2 Hooks**(后端 + UI + smoke) |
| R4(本轮) | fork 链路 | + **配额用量接真数据**(后端聚合 + Account.tsx +186 行 + smoke 扩展) |

模式很稳定:**GPT 一直在按我 REVIEW 推荐的延伸项做,但 brief 模板里不报**。

可能 GPT 觉得"这是顺手做的,不算交付";但产品功能藏起来不算 changelog 是不行的。

**强烈建议这次先做一件事**:让我把 `docs/HANDOFF-TEMPLATE.md` 写出来,固化 brief 必报项 —— 上一轮我也提过,GPT 没做,这轮继续藏 ⇒ 模板缺失才是根因,该堵了。

## ⚠️ 提交债 N+1 轮:仍未 commit

```
git log → 8c91b32(P2 canUseTool)还是最新
git status → 22 个 M + 6 个 ?? (包括三份 REVIEW + scripts/ + build-request-tools + record/ + spike-sdk)
```

按主题切的话,从 R1 到 R4 累计 **6 个原子 commit**(R4 多 1 个 feat:quota usage):

```
1) chore: clean unused code; re-enable noUnusedLocals/Parameters       (R1)
2) refactor: extract buildRequestTools to shared util                  (R1)
3) feat(P2): tenant permission rules + UI + canUseTool integration    (R2)
4) feat(P2): tenant hook rules + UI + SDK hooks runtime               (R3)
5) chore(test+ops): smoke teardown wait-port + runner cwd TTL         (R3)
6) feat: chat session fork + quota usage endpoint + Account real data (R4)
```

R4 合一个 commit 也行,fork 和 quota-usage 主题相近(都是产品功能强化,不冲突);单独切也可以,看 GPT 偏好。

## 下一轮强烈建议(优先级)

1. **🔴 让 GPT 先写 `docs/HANDOFF-TEMPLATE.md`,然后按它重写本轮 brief 给你 + 我**(把第 4 轮模式打破,堵住继续藏货)。模板要点见我上份 REVIEW。
2. **🟡 拆 6 commit**(GPT 几分钟可做完,纯 git 操作)。
3. **🟢 选下一刀**:配额接好之后,产品页面里 simulator 模拟器的几个页面(Subagents / Observability / Tools / Skills)还可以一个个换真,但产品价值递减;**P3 容器沙箱**才是下一个大跃迁(选 Modal / E2B / Fly / 自建,需要你拍板)。
