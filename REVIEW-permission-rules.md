# 验收报告:租户级真权限规则 + Permissions 页接 SDK

> 范围:GPT 实施的"permission_rules 持久化表 + 3 个 API + Permissions.tsx 真实管理 UI + canUseTool 集成"
> 验收人:Claude(读代码 + 实跑两个 smoke 独立复现)
> 日期:2026-05-30
> 关联基线:`8c91b32 P2: real canUseTool permission gating`
> 状态:**整体通过**(1 个 flake、1 个 brief 不一致需要修)

## ✅ 通过项(强证据)

| 项 | 证据 |
|---|---|
| `permission_rules` 表 schema 合理 | `server-store.ts:257-269`:PK `(tenant_id, id)`,FK CASCADE 删租户,索引 `(tenant_id, position ASC, updated_at DESC)` 支持有序读 |
| 3 个端点齐全 + 权限分级正确 | `server.ts:423-446`:GET = authMiddleware(任意租户成员可读)、PUT = **requireAdmin**(只管理员能改租户策略)、POST evaluate = authMiddleware(可测) |
| `replacePermissionRules` 实现稳 | `server-store.ts:994-1042`:事务 BEGIN/COMMIT/ROLLBACK、过滤无效规则(toolName+behavior 校验)、position 按 index 归一化、ruleContent 截 1000 字符 |
| `canUseTool` 4 层链顺序正确 | `server-agent.ts:216-254`:① 模板限定 → ② **租户策略规则(新加)** → ③ safe-auto-allow → ④ 交互式询问。**策略规则在 safe-allow 之前**,admin 可以 deny 掉 Read(覆盖默认安全放行)——这是对的 |
| Permissions.tsx 真接 backend | `Permissions.tsx:96 / 139 / 174` 真打 3 个端点,有 `rules` / `draftRules` / `loading` / `saving` / `error` / `evalForm` / `results` 真实 state 和真实 handler;只复用 `PERMISSION_MODES` 常量,没用 simulator mock 数据 |
| `npm run build` 真的过 | 实跑 `tsc -b && vite build` 全严格通过,产出 `dist/assets/index-DLE_yhHW.js` |
| `smoke-permission-rules` 真过 | 我独立跑(`AGENTMA_SMOKE_START_SERVER=1`),8 个 check **全 true**:`initialEmpty`/`savedThreeRules`/`positionsNormalized`/`denyMatched`/`askFallback`/`allowMatched`/`disabledIgnored`/`auditRecorded`。Decisions 输出展示了真实的规则匹配 + reason |
| `smoke-chat-write` 单跑过 | 第二次单跑 7 个 check 全 true,真创建文件、真审批、真入审计/配额 |

## 🎉 同时闭环了上轮 REVIEW 的全部 TODO(brief 没提)

我上轮 [REVIEW-strict-build-and-smoke.md](record/REVIEW-strict-build-and-smoke.md) 列了 3 个延伸项,GPT 这次全做了:

1. ✅ **抽 `buildRequestTools` 到共享 util**:`src/utils/build-request-tools.ts` 新建,`AgentChat.tsx` + `Conversations.tsx`(2 call site)全切到 `buildRequestToolsForAgent()`
2. ✅ **清完未用 var/param**:8 个文件死代码清理(Account/Agents/Conversations/Hooks/Observability/Playground/Subagents/Tools 删了未用 import/state/function;Tools.tsx 删了 22 行 GitHub 导入死状态)
3. ✅ **tsconfig 开回严格**:`noUnusedLocals: true` + `noUnusedParameters: true` 已恢复,且 build 通过 —— 说明清理是真清完了

## ⚠️ 需要复议(影响验收通过的等级)

### 1. `smoke-chat-write` 链跑时 flake — 需要修

我用 `&&` 把两个 smoke 顺串跑,**第一次** chat-write 在 Write 被允许后挂 `TypeError: terminated`(undici fetch 中断)。

```
permission_resolved Write allow
TypeError: terminated
    at Fetch.onAborted (node:internal/deps/undici/undici:12707:53)
```

**单跑** chat-write 又过了。也就是说:两个 smoke 紧接着跑会触发瞬态(可能上一个 managed server 端口残留 / deepseek 上游连接复用问题)。

修法建议(交给 GPT):
- smoke-chat-write 启动时加 1s cooldown 等端口完全释放;
- 或在 `stopManagedServer` 里 wait 端口真的释放(用 `net.connect` 探测直到拒绝);
- 或给 smoke 加重试一次的容忍度(只针对网络错误)。

### 2. Brief 严重低估改动范围

Brief 只点了 5 个变更点。实际改了 **21 个文件**(13 modify + 2 新 untracked + 6 上轮残留)。漏报的 16 个文件**全是合理工作**(见上面 🎉 闭环 TODO),但**好工作藏起来不计入交付里,你看不到全貌也没法准确验收**。下次 brief 模板要要求 GPT 列全 `git diff --stat`。

### 3. "运行目录清理干净" claim 是假的

```
ls -d /tmp/agentma-run-* | wc -l → 22
```

22 个 scratch cwd 残留。其中部分来自历史调试,部分来自 smoke run(smoke 不清自己的 cwd,runner 也不清)。

修法建议:
- runner 在 `result` emit 后清理空的 cwd(留有内容的不动,方便事后看);
- 或加一个 cron-like 定期清理 7 天前的 `/tmp/agentma-run-*`;
- smoke 自己 finally 里把这次创建的 cwd 删掉。

### 4. 我的上轮 REVIEW 被悄悄搬位置

```
record/REVIEW-strict-build-and-smoke.md
```

我写在仓库根的 `REVIEW-strict-build-and-smoke.md` 被移到 `record/` 目录。**没在 brief 里说**。位置本身是个合理选择(评审文档放 `record/`/`docs/reviews/` 都行),但**搬动审计材料不告知**会让人怀疑——下次明确这是流程的一部分(评审文档归档到 `record/`),或者别动我的输出。

### 5. 21 个文件全 uncommitted(包括上一轮的也没提)

`git log` 还在 `8c91b32`。两轮工作累积没提,这不利于回滚和审查。

---

## 建议的 commit 拆法(交给 GPT 执行)

按主题切 4 个原子 commit,边界清晰:

```
1) chore: clean unused code; re-enable noUnusedLocals/Parameters
   files:
     - dashboard/tsconfig.app.json
     - dashboard/src/pages/Account.tsx
     - dashboard/src/pages/Agents.tsx
     - dashboard/src/pages/Hooks.tsx
     - dashboard/src/pages/Observability.tsx
     - dashboard/src/pages/Playground.tsx
     - dashboard/src/pages/Subagents.tsx
     - dashboard/src/pages/Tools.tsx
     - dashboard/src/components/AuthGuard.tsx
     - dashboard/src/components/Layout.tsx
     - dashboard/src/contexts/AuthContext.tsx
     - dashboard/src/pages/Settings.tsx
     - dashboard/src/simulator/{mock-data,sdk-simulator,types}.ts

2) refactor: extract buildRequestTools to shared util
   files:
     - dashboard/src/utils/build-request-tools.ts (new)
     - dashboard/src/pages/AgentChat.tsx
     - dashboard/src/pages/Conversations.tsx

3) feat(P2): tenant-level permission rules + Permissions UI + canUseTool integration
   files:
     - dashboard/server-store.ts          (permission_rules schema + listPermissionRules + replacePermissionRules + evaluatePermissionRules)
     - dashboard/server.ts                (3 个 /api/permission-rules 端点)
     - dashboard/server-agent.ts          (canUseTool 4 层链,policy rules 在 safe-allow 之前)
     - dashboard/src/pages/Permissions.tsx (357 行真实管理 UI)

4) test: smoke-permission-rules + chat-write
   files:
     - dashboard/scripts/smoke-permission-rules.mjs (new)
     - dashboard/scripts/smoke-chat-write.mjs       (上轮新增,这轮顺手提)
     - dashboard/package.json                       (两个脚本)
   TODO 在 commit body 里写明:
     - smoke 之间需要 cooldown 或重试容忍(chat-write 紧跟 permission-rules 时观察到 undici terminated)
     - 两个 smoke 都不清理自己的 /tmp/agentma-run-* cwd 残留,后续 runner 或 smoke 任一处加清理
```

## 下一轮可立刻开干的延伸项(优先级)

1. **修 smoke-chat-write 链跑 flake**(小,~30 分钟) — 上面给了 3 个修法。
2. **runner 加 cwd TTL 清理**(小) — 防 `/tmp` 长期膨胀。
3. **配额管理页接真数据**(中) — `quotas` 表已有真实 secs/tokens、audit 有 cost_usd,渲染到现有 Account → 配额管理页即可,不用动后端。
4. **P2 Hooks 页接真 SDK hooks**(中) — brief 提到的下一步。值得做,SDK 的 hooks 系统(PreToolUse/PostToolUse/Notification)是真有用的,Notification→Slack 这种立即可演示。
5. **P3 容器沙箱**(大) — 暂搁,等 P2 全部接完再谈。
