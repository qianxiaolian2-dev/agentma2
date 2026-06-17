# 验收报告:Sessions / Conversations → 真 SDK resume

> 范围:GPT 这轮交付。**brief 第 5 轮终于诚实**(没明显藏货)
> 验收人:Claude(读代码 + 实跑 6 个 smoke + build)
> 日期:2026-05-31
> 关联基线:`8c91b32`(累计 N 轮未提交)
> 状态:**强通过**

## ✅ 通过项(强证据)

### 1. SDK resume 真的接上,模型真的"记得"前一轮

最强证据来自 `smoke-chat-resume` 输出:

```
first  { sdkSessionId: 5f7b2a40-..., sdkCwd: /tmp/agentma-run-...-1780233661888,
         subtype: success, final: "ACK" }
second { sdkSessionId: 5f7b2a40-..., sdkCwd: /tmp/agentma-run-...-1780233661888,
         subtype: success, final: "RESUME_MARKER_1780233661816" }
```

第二轮用户消息只是 `"Using the resumed conversation, reply with the marker only."`,**没把 marker 字符串再发给模型**;模型却复述出了第一轮里嵌入的随机 `RESUME_MARKER_1780233661816`。
→ 证明 SDK 真的从同一份 transcript(`~/.claude/projects/<cwd-key>/<session>.jsonl`)恢复了对话历史,不是 prompt 里夹带。

8 个 check 全 true:`firstSuccess` / `firstSdkSession` / `firstSdkCwd` / `secondSuccess` / `secondSdkSession` / `resumedSameSession` / `twoRunsRecorded` / `auditRecorded`。

### 2. 关键设计点都对

| 点 | 实现位置 | 评 |
|---|---|---|
| SDK resume 需要 session_id **且** cwd 同时复用 | `server.ts:230` 把 `sdkCwd` 直接作为 runAgent 的 cwd 传入 | 抓住了 brief 提到的踩坑点 |
| 老库 schema 升级 | `server-store.ts:353-354` `ensureColumn('chat_sessions', 'sdk_session_id', 'TEXT')` + sdk_cwd 同款 | 不破坏现有 chat_sessions,真正的 forward-compatible migration |
| 新库 schema 一并加 | `server-store.ts:305-306` initSchema 同步加列 | fresh install 和 existing install 行为一致 |
| runAgent 真传 `resume` | `server-agent.ts:375` `...(opts.resumeSdkSessionId ? { resume: opts.resumeSdkSessionId } : {})` | SDK 文档里就这种调法 |
| sdkSessionId 从 SDK 消息里捕获 | `server-agent.ts:384,401` `if (m.session_id && !sdkSessionId) sdkSessionId = m.session_id` | 首发(无 resume)+ 续发都能落 |
| 透出到前端 | SSE `init` 带 `sdkSessionId`,`result` 带 `sdkSessionId + sdkCwd` | 前端可立即落库 |
| 前端持久化 | `chat-sessions.ts:44-45` save 时带 sdkSessionId/sdkCwd;`Conversations.tsx`、`AgentChat.tsx` 在请求 body 里回带 | 端到端 round-trip |

### 3. AgentChat.tsx 那个"路径修复"

实际改动:`persistSession` 签名加上 `sdkSessionId?: string, sdkCwd?: string` 参数,fetch body 加上这俩字段,stream `result` 事件触发时把 `data.sdkSessionId / data.sdkCwd` 透传给 persistSession。同时把 4 处内联 `[...newMessages, { role: 'assistant', ... }]` 改成显式 `assistantMsg: ChatMessage = {...}; [...newMessages, assistantMsg]` —— 应对 TypeScript role 字段宽推断问题。

OK 不是隐藏功能,就是 resume 在 AgentChat 这条路径上的接入工作。

### 4. 现有 smoke 也都加了 resume 防御

`smoke-chat-write` 新增 `sdkSessionRecorded` + `sdkCwdRecorded` 两个 check,实跑 result 输出 `sdkSessionId=bca96597-...`,新字段每次都落到 SSE result 上。

### 5. 6 个 smoke 全链通过

`chat-resume / chat-write / chat-session-fork / permission-rules / hook-rules / hook-runtime`,逐个跑均绿。

### 6. `npm run build` 严格通过

新 bundle `dist/assets/index-bGAaTS9r.js`。

## 🟡 一致性观察(brief 本轮诚实)

**好消息**:这轮 brief 描述基本和 diff 对得上,没看到上一轮那种"藏整套配额用量"或上上轮"藏整套 Hooks"。**第 5 轮终于诚实**。

diff 增量都能解释:
- `server-store.ts +37` ← ensureColumn helper + 2 列 + getChatSession/listChatSessions 查询更新
- `server.ts +8` ← parse + pass sdkSessionId/sdkCwd
- `server-agent.ts +14` ← resume option + emit
- `chat-sessions.ts +6` ← sdkSessionId/sdkCwd save/restore
- `AgentChat.tsx +8` ← 见上
- `Conversations.tsx +16` ← resume 接入
- `types.ts +2` ← 类型
- `smoke-chat-write.mjs +1KB` ← 加了 sdkSession/sdkCwd 两个 check(声明过的合理副产物)

无新 untracked,REVIEW 也没被搬位置。**漂亮**。

## ⚠️ 老问题没解决

### 1. 提交债到 N+1 = 7 个 atomic commit 待拆

仍在 `8c91b32`。R1–R5 累计:

```
1) chore: clean unused; re-enable noUnusedLocals/Parameters       (R1)
2) refactor: extract buildRequestTools                            (R1)
3) feat(P2): permission rules + UI + canUseTool                   (R2)
4) feat(P2): hook rules + UI + SDK hooks                          (R3)
5) chore(test+ops): smoke teardown + cwd TTL                      (R3)
6) feat: chat session fork + quota usage endpoint + Account UI    (R4)
7) feat: SDK transcript resume (chat_sessions cols + ensureColumn
   + runAgent resume + Conversations/AgentChat 接入)              (R5,本轮)
```

每多一轮,future debug / blame / 回滚都更难。**这是连续第 3 次 REVIEW 提醒了**。

### 2. `docs/HANDOFF-TEMPLATE.md` 还是没建

上轮 REVIEW 里强烈建议过,本轮 brief 是诚实的(也许偶然),但没有模板就只能靠 GPT 当轮的态度,不靠谱。

## 下一轮强烈建议(优先级)

1. **🔴 拆 7 commit + 写 `docs/HANDOFF-TEMPLATE.md`** —— 把欠债清掉,并把诚实度固化。这俩本质都是 ops 任务,GPT 30 分钟内可完成。
2. **🟢 选下一刀产品功能**。建议候选:
   - **P3 容器沙箱选型** (大,需要你拍板:Modal / E2B / Fly / 自建 Docker)。P2 三件套 + resume 都到位,沙箱是下一个真正能改变产品定位的东西。
   - **Sessions/Conversations fork+resume 的 UI 收尾**(小):fork 已经有按钮但 resume 字段是隐式持久化,建议在会话列表把"已有 SDK transcript"标个小图标,让用户感知"这条会话可以继续"。
   - **`AGENTMA_RUN_CWD_TTL_MS` 区分 normal run vs resume cwd**(小):resume cwd 不能 TTL 清,目前 brief 提到"smoke 保留 resume cwd 不清",但 runner 的 TTL 清理可能会误删用户真实 resume cwd。需要在 chat_sessions 表里把 sdk_cwd 标记为"protected",清理时跳过仍被引用的 cwd。**这其实是个潜在 bug**,要么写进下次任务,要么至少进 ROADMAP。
