# PLAN: P2 收尾 + P3 沙箱选型决策

> 日期：2026-06-01  
> 前置状态：`87ee1b7`（collapsible sidebar）是当前 HEAD，working tree 干净。  
> P2 完成度：~95%，剩一处 mock 残留 + 一个过时的 PLAN 文档。

---

## 任务 A：清理过时文件（5 分钟）

### A1. 删除 `PLAN-fix-duplicate-stream-message.md`

该 PLAN 描述的 `setStreamText` bug 已被 `withAssistantDraft` 重构消除，文件已无效。

```bash
git rm PLAN-fix-duplicate-stream-message.md
```

---

## 任务 B：Subagents 页去 mock（~1 小时）

### 背景

`dashboard/src/pages/Subagents.tsx` 有 5 处 mock/simulator 引用：
- `sdkSimulator` — 导入但未实际调用（仅类型兼容），可直接删除
- `generateMockTodos` — 给 `todos` 状态填假数据
- `EFFORT_LEVELS`, `PERMISSION_MODES`, `TodoItem` — 从 `mock-data` / `types` 导入，分别替换或删除

真实的 task 事件已有完整工具链：
- 服务端：`server-agent.ts` emit `task_started / task_progress / task_notification`
- 工具函数：`src/utils/agent-tasks.ts`（`AgentTaskEvent`, `mergeAgentTaskEvent`, `taskStatusLabel`, `taskStatusColor`）
- `Conversations.tsx` 和 `AgentChat.tsx` 已经用上了 `agentTasks` 状态

但 Subagents.tsx 是**配置页**（管理 template 里的 subagent 定义），不是 chat 页，它没有 SSE stream。`todos` 状态显示的是 "假进行中任务" 的装饰性 UI。

### 改动

1. **删 `sdkSimulator` 和 `generateMockTodos` 导入**
2. **将 `todos` 状态改为空数组 `AgentTaskEvent[]`**（不再填假数据）
3. **将 `TodoItem` 替换为 `AgentTaskEvent`**（来自 `src/utils/agent-tasks.ts`）
4. **将任务列表渲染切到 `taskStatusLabel / taskStatusColor`**
5. **`EFFORT_LEVELS / PERMISSION_MODES`** 已在 `agent-templates.ts` 里有定义，检查并从那里导入，删掉 `mock-data` 导入
6. 全程 `npm run build` 严格通过（`noUnusedLocals: true`）

### 不做的事

- 不给 Subagents 页加 SSE 连接（它是配置页，不是运行页）
- 不重构整个页面，只去 mock

### 验收标准

1. `npm run build` 严格通过（无 unused import/variable）
2. `grep -r "sdkSimulator\|generateMockTodos\|TodoItem" dashboard/src/pages/Subagents.tsx` → 0 结果
3. Subagents 页在浏览器里正常加载，模板列表和 subagent 定义管理功能正常
4. `smoke:chat-write && smoke:permission-rules && smoke:hook-rules` 全链通过（改动不动后端）

---

## 任务 C：smoke 全套回归（10 分钟）

在 B 完成后跑全套 smoke，确认没有回归：

```bash
cd dashboard
npm run smoke:chat-write && \
npm run smoke:chat-resume && \
npm run smoke:chat-session-fork && \
npm run smoke:permission-rules && \
npm run smoke:hook-rules && \
npm run smoke:hook-runtime
```

`smoke:chat-ask-user-question` 和 `smoke:chat-subagents` 也跑一遍，记录结果（这两个是新加的，需要首次绿灯确认）。

---

## 任务 D：提交（2 个 commit）

```
1) chore(p2): remove last simulator mocks from Subagents page
   files: dashboard/src/pages/Subagents.tsx
          (可能) dashboard/src/simulator/types.ts (如果 TodoItem 只被 Subagents 用)

2) chore: delete obsolete PLAN-fix-duplicate-stream-message.md
   files: PLAN-fix-duplicate-stream-message.md
```

---

## 任务 E（需用户决策）：P3 沙箱选型

P2 三件套（permissions / hooks / resume+fork）已全部落地，下一个大跃迁是 P3 容器沙箱。

### 选型对比

| 方案 | 隔离级别 | 成本 | 冷启动 | 难度 | 适合场景 |
|------|---------|------|-------|------|---------|
| **Modal** | 容器/进程 | ~$0.05/h/container + token | ~2s | 中 | 快速上线，适合 SaaS MVP |
| **E2B** | 微容器 | ~$0.07/h + token | ~300ms | 低 | Agent 工作区即开即用 |
| **Fly.io** | VM | ~$0.02/h + 自管 | ~3-5s | 高 | 完全掌控，长期成本低 |
| **自建 Docker** | 容器 | 仅机器成本 | ~1-2s | 高 | 本机/私有部署，无外部依赖 |
| **暂不做沙箱** | 无（当前状态） | 0 | 0 | 0 | 单机单租户演示用 |

### 当前风险

不做沙箱时，所有租户的 agent 跑在同一 node 进程 + 同一文件系统，配额强制执行是空转（schema 有，引擎没有）。

### 建议

**先用自建 Docker**（`docker run --rm` 每次跑 agent 起一个容器），不依赖外部服务，本机可验证，迁移到 Modal/E2B 是后续优化。成本：需要用户机器装 Docker，agent 冷启动 ~1-2s。

**需要你回答**：P3 沙箱是否开始？用哪个方案？还是先做其他 P4 功能（结构化输出 / Skills 市场 / 可观测性）？

---

## 交付 brief 格式要求

按 `docs/HANDOFF-TEMPLATE.md` 逐项填写，包含：
- 完整 `git diff --stat HEAD` 输出
- 所有 smoke 输出片段（每个 suite 至少贴最后的 checks 行）
- 新增 untracked 文件说明
