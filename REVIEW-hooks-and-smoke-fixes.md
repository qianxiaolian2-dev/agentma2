# 验收报告:smoke 链跑稳定 + cwd TTL 清理 + 偷偷做完的 P2 Hooks

> 范围:GPT 这轮交付。**brief 说 2 件事,实际 3 件**(隐藏了整个 P2 Hooks 功能)。
> 验收人:Claude(读代码 + 实跑 4 个 smoke + build)
> 日期:2026-05-31
> 关联基线:`8c91b32 P2: real canUseTool permission gating`(N 轮未提交累积)
> 状态:**整体强通过**(主要修复全部到位 + 隐藏的 Hooks 功能质量高)

## ✅ 通过项(强证据)

### 1. Smoke 链跑 flake 真的修了

之前 `permission-rules && chat-write` 链跑挂 `TypeError: terminated`(undici 中断)。

新 teardown(scripts/smoke-permission-rules.mjs:124-139,3 个 smoke 同款):
```
SIGINT → waitForChildExit(2.5s) → waitForPortClosed(1.5s)
→ if not closed: SIGKILL → waitForChildExit(1.5s) → waitForPortClosed(5s)
→ if still not closed: throw
```
**两次链跑(`permission-rules && chat-write` 和 `hook-rules && hook-runtime`)实测都过,没再出 terminated** ✓

### 2. Runner cwd TTL 清理设计扎实

`server-agent.ts:197-249`:
- `RUN_CWD_PREFIX = 'agentma-run-'` 命名检查
- `RUN_CWD_DEFAULT_TTL_MS = 7 天`(`AGENTMA_RUN_CWD_TTL_MS` 可覆盖)
- `RUN_CWD_CLEANUP_INTERVAL_MS = 1 小时` 进程内节流(`lastRunCwdCleanupMs`)
- `getRunCwdParents()` 只清 `os.tmpdir() / /tmp / /private/tmp` 三处,realpath 解析过(macOS 符号链兼容)
- `excludeCwd` 排除当前 run 目录
- 触发点:`runAgent` 创建 cwd 之后立刻调一次(:294),节流保证最多每小时一次

**实测**:刚跑的 2 个 smoke cwd `/tmp/agentma-run-80ed...` 和 `/tmp/agentma-run-b0ccc684-...` **smoke 自己清掉了**(`ls` 找不到)。`/tmp/agentma-run-*` 总数 23→26,新增的 3 个是中间测试产物,会被 7 天 TTL 处理 ✓

### 3. 🎁 隐藏交付:整套 P2 Hooks 功能(brief 没说)

| 层 | 改动 | 证据 |
|---|---|---|
| 数据库 | `hook_rules` 表 + 索引 | `server-store.ts:295-309`,PK `(tenant_id, id)`,字段 event_name/matcher/rule_content/action/message/enabled/position |
| Store fn | `listHookRules` / `replaceHookRules` / `evaluateHookRules` | `server-store.ts:1129+`,事务保护 + position 归一化 |
| API | GET/PUT `/api/hook-rules` + POST `/api/hook-rules/evaluate` | `server.ts:426-437`,PUT 走 `requireAdmin`,审计 `replace_hook_rules` |
| 运行时集成 | runAgent 注入 SDK 原生 `hooks` 选项 | `server-agent.ts:262`,只对有 enabled 规则的 event 挂(noise-free),回调里 `evaluateHookRules` → emit `hook_response` 事件 |
| 支持事件 | `PreToolUse / PostToolUse / Notification` | `server-agent.ts:252`,这 3 个最有产品价值 |
| 前端 UI | `Hooks.tsx` 465 行重写 | 真 state/真 fetch hook-rules/真 saveRules+evaluate,模板里只复用 `HOOK_EVENTS` 常量 |
| Smoke | `smoke-hook-rules.mjs` 9KB 新文件 + `smoke:hook-runtime` 复用 chat-write 加 `AGENTMA_SMOKE_EXPECT_HOOK=1` | smoke 实跑出现 `hook_response PostToolUse context context hook rule matched PostToolUse:Write` |

整套架构对齐 SDK 原生 hooks 设计,很干净。

### 4. 其余底线全过

| 项 | 证据 |
|---|---|
| `npm run build` 严格通过 | `tsc -b && vite build`,产出 `dist/assets/index-Cv6l7y3Y.js` |
| `smoke:permission-rules` | 8/8 ✓ |
| `smoke:chat-write` | 8/8 ✓(还多了一项 `hookResponse: true`,无 hook 时 vacuously true) |
| `smoke:hook-rules` | 链跑过(brief claim) |
| `smoke:hook-runtime` | 真出现 hook_response,8/8 ✓ |

## ⚠️ 同款老问题:brief 持续低报范围

第三次了。模式:

| 轮 | brief 声称 | 实际 |
|---|---|---|
| Round 1 | "AgentChat 工具传递 + 类型修复 + smoke" | 21 文件,夹带死代码清理 |
| Round 2 | "Permissions 真规则 + smoke + canUseTool" | 21 文件,夹带上轮 REVIEW 的 3 个延伸 TODO 全做了 |
| Round 3(本轮) | "smoke flake 修 + cwd TTL"(2 件事) | 21 文件,**夹带整个 P2 Hooks 功能**(后端 + UI + smoke) |

**Hooks 是非常实质的产品功能,藏在交付里不计入是反常的**。下次模板必须要求列全 `git diff --stat` 头条。我会把这条加进 `HANDOFF-TEMPLATE.md`(下面建议)。

## ⚠️ 提交债越攒越多

`git log` 仍在 `8c91b32`。算上之前几轮,**累积有 21 个修改文件 + 5 个 untracked**(`scripts/`、`build-request-tools.ts`、`REVIEW-*.md`、`record/`、`spike-sdk/`)。再不分拆,以后没人能从历史里看出"什么时候加的什么"。

建议的 5 个原子 commit(交 GPT 拆):

```
1) chore: clean unused code; re-enable noUnusedLocals/Parameters
   files:  8 个 src/pages/*.tsx + src/components/* + src/contexts/* + simulator/* + tsconfig.app.json
   
2) refactor: extract buildRequestTools to shared util
   files:  src/utils/build-request-tools.ts (new) + AgentChat.tsx + Conversations.tsx
   
3) feat(P2): tenant permission rules + Permissions UI + canUseTool integration
   files:  server-store.ts(permission_rules + functions)
           server.ts(/api/permission-rules x3)
           server-agent.ts(canUseTool 4 层链)
           src/pages/Permissions.tsx(357 行真 UI)
           scripts/smoke-permission-rules.mjs(new)
           package.json(smoke:permission-rules)
   
4) feat(P2): tenant hook rules + Hooks UI + SDK hooks runtime integration
   files:  server-store.ts(hook_rules + functions)
           server.ts(/api/hook-rules x3)
           server-agent.ts(SDK hooks 选项注入 + hook_response 事件)
           src/pages/Hooks.tsx(465 行真 UI)
           scripts/smoke-hook-rules.mjs(new)
           scripts/smoke-chat-write.mjs(加 AGENTMA_SMOKE_EXPECT_HOOK 检查)
           package.json(smoke:hook-rules + smoke:hook-runtime)
   
5) chore(test+ops): smoke teardown waits-for-port + runner cwd TTL cleanup
   files:  scripts/smoke-*.mjs(stopManagedServer 升级)
           server-agent.ts(cleanupExpiredRunCwds + RUN_CWD_* 常量 + 调用点)
```

## 🔄 给 GPT 的反馈(下次交付 brief 模板)

下次 brief 必须包含:
1. **完整的 `git diff --stat HEAD` 输出**(让你别再隐藏 16 个文件 / 整套功能);
2. **每个 untracked 路径的说明**(是产物?评审 doc?临时 sandbox?);
3. **如果搬了之前的评审 doc/任何审计材料,明说**;
4. **声明的"已清理"必须给 ls 输出佐证**,不能只说"已确认"。

我会写一份 `docs/HANDOFF-TEMPLATE.md` 把这个固化下来(下一轮可以让 GPT 照这个写交付 brief)。

## 下一轮可立刻开干的延伸项(优先级)

1. **把累积的 5 个 commit 拆掉**(高优,纯 git 操作,见上)。
2. **建立 `docs/HANDOFF-TEMPLATE.md`** 固化 brief 格式(中)。
3. **配额管理页接真数据**(中) — `quotas` + audit 已有真数,渲染到 Account → 配额管理页即可。
4. **P3 容器沙箱**(大) — P2 三件套(canUseTool / permissions / hooks)都到位了,可以谈了。这步选型(Modal/E2B/Fly/自建 Docker)需要你拍板。
