# AgentMa 产品路线图(2026-06-01 更新版)

> 上版:2026-05-30(P1 启动前)
> 本版变化:P1 已完成 / P2 已完成 75%(3/4 子页)/ 新发现的 bug 列入 / 重新拆分下一阶段为「完整度路 A」+「质变路 B」

---

## 1. 当前状态总览

**核心论断**:UI 是模拟器壳 → 现在底层真接了 Agent SDK,**已经是 "真 agent 平台" 的最小可发布版本**。

| 阶段 | 权重 | 进度 | 说明 |
|---|---|---|---|
| §2 接 SDK 岔路 | 前置 | ✅ 100% | 选了"接 SDK",spike 通过 |
| P1 让执行变真 | 25% | ✅ **100%** | runAgent / SDK query() / 配额审计入库 |
| P2 把配置面接到真能力 | 30% | ✅ **100%** | Permissions ✅ / Hooks ✅ / Sessions ✅ / Subagents ✅ / McpServers ✅ |
| P3 生产化 / 多租户 | 30% | ❌ **0%** | 沙箱 / OTel / 多租户强隔离 0 启动（需拍板） |
| P4 差异化 / 丰富度 | 15% | 🟡 **65%** | 结构化输出 ✅ / AskUserQuestion ✅ / Observability 真数据 ✅ / enableFileCheckpointing 后端 ✅ / 图片粘贴 ✅ / markdown 渲染 ✅ / ChatMessageBubble(thinking 折叠/copy/timestamp) ✅ / 运行统计条 ✅ / 会话搜索 ✅ / textarea 自增高 ✅ / 智能滚动 ✅ / 停止生成 ✅ / 文件回滚 rewind UI ⛔(见下) / Skills 市场 ❌ |
| §5 小赢 | 散件 | ✅ **100%** | 全部完成 |

**整体加权进度 ≈ 66%**，**核心功能层(P1+P2)= 100%**。
sdkSimulator 活跃调用归零，所有页面使用真实 API 或合理静态配置。
聊天体验已达行业标准：markdown、图片粘贴、thinking 折叠、复制、时间戳、运行成本、智能滚动、停止生成、结构化输出渲染。

**rewind UI 的架构依赖（⛔ 暂不可做）**:SDK 的 `Query.rewindFiles(userMessageId)` 是 `query()` 返回的 **Query 对象上的方法**,只能在 query 生成器存活期间调用。当前 `runAgent` 是请求级的——消费完流就结束。要支持 rewind 必须把 Query 句柄跨 HTTP 请求保活并映射到会话,这是 **有状态会话管理(P3 territory)**。结论:rewind UI 与 P3 沙箱化耦合,等 P3 架构定了再做,现在硬上会破坏"请求级无状态"的简洁性。

### 已合并 commit(`8c91b32` 之后)

```
fe489eb feat: wire real SDK dashboard workflows   ← R1-R5 全压一坨,大包 commit
87ee1b7 feat: add collapsible dashboard sidebar   ← R5 之后偷加的可折叠侧边栏(未在 brief 报告)
```

**警告**:GPT 没按我每轮 REVIEW 给出的 7 个 atomic 拆法做,而是一锅烩压成 `fe489eb`。后续 cherry-pick / 回滚 / blame 任一子能力会很难。已经无法挽回这部分,但下次开始要堵住。

### 工作区残留

- `M dashboard/src/pages/Subagents.tsx`(2 处死代码删除,小)
- `?? PLAN-p2-final-and-p3-decision.md`(本 doc 的早期草稿,GPT 自己写的,可忽略)

---

## 2. 已落地的能力(可发布列表)

可以现在就给人演示 / 用的:

1. **真 SDK agent 运行**:`/api/chat` + `/api/agents/run` 都用 SDK `query()`,deepseek/minimax 等 ANTHROPIC_BASE_URL 兼容端点都能驱动
2. **真权限审批**:`canUseTool` 4 层链(模板限定 → 租户策略 → 安全放行 → 用户提示),Permissions 页可视化管规则
3. **真 SDK Hooks**:PreToolUse / PostToolUse / Notification,Hooks 页管规则,SDK 原生 hooks 注入
4. **真会话**:fork(消息复制不带 pinned)+ SDK transcript resume(sdkSessionId + sdkCwd 双复用)
5. **真用量计费**:每次 run 入 `quotas` + `audit_logs`,Account 页 quota 板真渲染(`/api/quota/usage` 聚合)
6. **自定义工具继续工作**:mineflayer 那套通过 `createSdkMcpServer` 包装为 MCP,兼容原 HTTP endpoint 设计
7. **多租户基础**:tenant 隔离的 chat sessions / permission rules / hook rules / agent templates,API key 登录
8. **完备的 smoke 测试基建**:6 个端到端 smoke + managed server + cwd TTL 清理

---

## 3. 接下来的两条路

### A 路 — 完整度:把 P2 / 小赢清到 100%

**目标**:**让产品功能完备**(每个原模拟页都有真实链路),为之后的 P3 SaaS 化提供一个完整的演示版本。
**总工作量**:中等(3 件事,各 1-2 轮 GPT 工作)。
**增量价值**:**有限**——不改变产品定位,只补全功能感知。
**需要你拍板**:不需要,GPT 可全自动推进。

#### A.1 Subagents 真化(P2 最后一项,优先级最高)

将 `Subagents.tsx` 从模拟器变真,接 SDK 的 `agents` 选项 / `Agent` 工具。

**关键设计**:
- 新表 `subagent_definitions`(类似 `agent_templates`,租户级共享):`{id, tenantId, name, description, prompt, tools[], model?, maxTurns?, effort?, background?, permissionMode?, skills[]}`
- 新端点:`GET/PUT /api/subagents`(管理员可改)+ 模板里加 `subagents: string[]` 字段(关联 id)
- runAgent 注入:从 chat 模板的 subagents 列表加载定义,转成 SDK `agents` 选项注入到 `query()`
- SSE 新事件:`subagent_start` / `subagent_stop`,前端在聊天里渲染子任务卡片(可折叠)
- Subagents.tsx 页改成真管理 UI(参考 Permissions/Hooks 页的设计)
- Smoke:`smoke-subagents`,验证父 agent 委派 → 子 agent 接管 → 父收到结果

**完成判据**:聊天里要求"分析这个项目"→ 主 agent 通过 `Agent` 工具发起 `code-reviewer` 子代理 → 子代理独立 cwd 跑分析 → 父 agent 拿到子代理结果并汇总。

#### A.2 AskUserQuestion 真化(小赢)

SDK 已有 `AskUserQuestion` 工具,模型可发起多选题问用户。当前 SSE 没透出,前端没渲染。

**关键设计**:
- runAgent 监听 SDK 的 `AskUserQuestion` tool_use → emit `ask_user_question` SSE 事件(含 questions + options)
- 前端在聊天里渲染问题卡片(类似 PermissionPrompt),用户选完 POST 回 `/api/agents/answer-question/:reqId`
- 模型继续 run

**完成判据**:让 agent 决策"用哪种 auth 方式"时,聊天里弹多选卡片,用户选一项,模型继续。

#### A.3 结构化输出 demo(小赢)

模板加 `outputSchema` 字段(JSON Schema),`/api/chat` 透传 `outputFormat: { type:'json_schema', schema }` 给 SDK。

**关键设计**:
- AgentTemplate 加 `outputSchema?: JsonSchema` 可选字段
- runAgent 传入 SDK `outputFormat`
- SSE result 多带 `structuredOutput` 字段
- Agents.tsx 编辑器加 schema 输入
- 一个 demo 模板:"网页摘要 → 抽取 {title, summary, key_points}"

**完成判据**:做一个抽取模板,跑出来的 result 同时含文本和验证过的 JSON。

#### A.4 顺带欠债(必须先做,~30 分钟)

- 修聊天双显 bug([PLAN-fix-duplicate-stream-message.md](PLAN-fix-duplicate-stream-message.md) 已写)
- 修 resume cwd vs TTL 冲突:在 cwd TTL 清理时跳过 `chat_sessions.sdk_cwd` 引用的目录(否则用户长期会话会随机断)
- 写 `docs/HANDOFF-TEMPLATE.md`(强制 GPT 下次完整披露 diff stat + untracked,堵住"压一坨" + "藏交付"两个老问题)

### B 路 — 质变:开 P3 沙箱(多租户 SaaS 的关键一刀)

**目标**:**让产品从"本机 dev tool"变"多租户 SaaS"**——每个租户 run 真隔离,凭据由代理注入,配额真强制执行。
**总工作量**:**大**——选型 spike + 容器编排 + 凭据代理 + 配额限流 + 可观测性,3-5 轮 GPT 工作。
**增量价值**:**质变**,商业化前必须做。
**需要你拍板**:**必须**——见下面 3 个决策点。

#### B.1 拍板点(开 P3 前必填)

| 决策 | 选项 | 关键考虑 |
|---|---|---|
| **Sandbox 提供方** | Modal / E2B / Fly Machines / Cloudflare Sandboxes / 自建 Docker | Modal 按秒计费;E2B 启动 <1s;Fly Machines 边缘部署;Cloudflare Sandboxes 集成你的现有 tunnel;自建 Docker 免费但要管 daemon |
| **凭据注入策略** | a) 沙箱内代理(`HTTPS_PROXY` → 代理服务器注入 ANTHROPIC_API_KEY)<br>b) 短期 token(沙箱启动时拿一个 1h JWT 给 SDK 用)<br>c) 直接环境变量(简单但租户 agent 能看到 raw key) | a 最安全,但有性能开销;c 最简单,但 Bash 工具能 `echo $ANTHROPIC_API_KEY` 泄密 |
| **单 run 配额硬上限** | CPU / RAM / 磁盘 / 网络 / wall-clock 时长 | 现有 `quotas` 表已有 `perRunMax*` 字段,需让 sandbox 真执行这些限制 |

#### B.2 工作量拆解(拍板后)

1. **Spike**(0.5-1 轮):选定 sandbox provider 后,跑一个最小 demo:启动沙箱 → 在里面跑 `tsx server.ts` 子集 → 收到第一个真实 agent run 完成
2. **沙箱编排**(1-2 轮):runAgent 不再本机跑,改成调度沙箱启动 + 把 query() 跑在沙箱内 + 流回结果
3. **凭据代理**(1 轮):按拍板的 a/b/c 实现
4. **配额强制**(0.5 轮):wall-clock / token 超出时,从外层 kill 沙箱
5. **可观测性**(0.5-1 轮):SDK 自带 OTel,接到你的 grafana / cloudflare insights;Observability 页变真 trace
6. **完成判据**:两个租户并发跑,各自的 Bash 不能看到对方的文件,凭据不能 echo 出来,超额 1 秒就被 kill

---

## 4. 推荐执行顺序

**理由**:小赢清掉 → A 路顺序做完 → B 路拍板后开。这样**任意时间产品都是 "可演示完整态"**,B 路的 SaaS 化在完整态基础上做。

```
[当下]
├─ 0. 速战速决(收口,~30 分钟)
│  ├─ 修聊天双显 bug(PLAN 已写)
│  ├─ 修 resume cwd vs TTL 冲突(防长期会话断)
│  └─ 写 docs/HANDOFF-TEMPLATE.md(堵 GPT 下次藏交付)
│
├─ 1. A 路完整度(预计 4-5 轮 GPT,每轮我验收一次)
│  ├─ A.1 Subagents 真化   ← P2 收官,价值最大
│  ├─ A.2 AskUserQuestion  ← 小赢,体验立刻"更像真 agent"
│  └─ A.3 结构化输出 demo  ← 小赢,演示数据抽取场景
│
├─ ⏸ 决策点:你拍板 B.1 三个决策
│
└─ 2. B 路 P3 沙箱(预计 5-8 轮 GPT)
   ├─ B.2.1 Spike(选定 provider 跑通)
   ├─ B.2.2 沙箱编排
   ├─ B.2.3 凭据代理
   ├─ B.2.4 配额强制
   └─ B.2.5 OTel 可观测性
```

每一步都是独立的 PLAN doc,我写完交给 GPT,GPT 完成后我验收。

**如果你要省时间,A 路也可以跳过(产品已经 87% 核心完成度),直接进 B 路拍板**。但 A.1 Subagents 缺口在演示场景里挺明显的(用户会问"那个子代理页面只是装饰吗?")。

---

## 5. P4 长尾(P3 之后)

P3 完成、SaaS 可商用之后再考虑:

- 文件检查点(rewind UI):会话时间线"回到某一步"
- Skills / Plugins 市场:租户内可安装 / 共享
- 多 provider 路由:Bedrock / Vertex / Azure
- Todo/Task 进度条 UI:`TaskCreate`/`TaskUpdate` SSE 渲染
- Slash commands / Memory(`.claude/*` 加载)
- 跨 agent 协作 / 长期 memory

---

## 6. 风险与未决

| 风险 | 状态 | 缓解 |
|---|---|---|
| 弱模型驱动复杂 SDK 工具循环 | 已 spike 通过(deepseek-chat OK) | — |
| 多租户隔离运行成本 | 待 P3 选型 | 选 Modal/E2B 等按秒计费 |
| 品牌合规 | 一直要求 | 对外用 "Powered by Claude",不用 Claude Code 字样 |
| GPT brief 持续藏交付 | 持续问题(R1-R5 全藏过)| **必做 HANDOFF-TEMPLATE.md 堵住** |
| GPT 把多轮压成大包 commit | 已发生(`fe489eb`)| 模板里强制每轮一个 commit,违者拒绝交付 |
| resume cwd 被 TTL 误删 | 已识别 | 见欠债项 |
| **侧边栏可折叠组件未在任何 brief 报告过** | 已发生(`87ee1b7`)| HANDOFF-TEMPLATE 必报项里加"功能/UI 改动列全" |

---

## 7. 附录:原 SDK 能力 → 产品状态对照(更新版)

| SDK 能力 | 产品状态 | 进度 |
|---|---|---|
| 代理循环(turns/budget/effort/permission/压缩) | 真用 SDK `query()` | ✅ |
| 内置工具(Read/Write/Edit/Bash/Glob/Grep/Web*) | 真执行 | ✅ |
| 子代理(并行/隔离/background) | Subagents 页仍模拟 | ❌ A.1 |
| Hooks(PreToolUse/PostToolUse/Notification) | 真接,租户级规则 | ✅ |
| MCP(stdio/http/sdk) | 自定义工具走 createSdkMcpServer | ✅(stdio/http 通用支持待 P3 验证)|
| 自定义工具 | createSdkMcpServer 包装 HTTP endpoint | ✅ |
| 权限(canUseTool + 规则) | 4 层链 + Permissions 页真规则 | ✅ |
| 会话(continue/resume/fork) | fork ✅ + SDK transcript resume ✅ | ✅ |
| Skills | 仍是 localStorage / 默认背包 | ❌ P4 |
| Slash commands / Memory / Plugins | 无 | ❌ P4 |
| 结构化输出 | 无 | ❌ A.3 |
| 文件检查点 | 无 | ❌ P4 |
| 成本 / 用量 | quotas + audit 真数 + /api/quota/usage 聚合 | ✅ |
| 可观测性 | Observability 页仍假图 | ❌ B.2.5(OTel)|
| Todo / Task 跟踪 | 无 | ❌ P4 |
| 托管 / 沙箱 | 本机直跑 | ❌ B 路核心 |
| 安全部署(凭据代理 / 隔离) | 无 | ❌ B 路 |
| 多 provider | ANTHROPIC_BASE_URL 兼容 | ✅(基础)/ ❌(Bedrock/Vertex/Azure)|
| **AskUserQuestion** | 无 SSE 透出 | ❌ A.2 |
| **可折叠侧边栏** | ✅(R5 后偷做的) | 计划外 |

---

## 8. 下次给 GPT 的第一刀

按推荐顺序,**第一刀做"速战速决三件"**:
1. PLAN-fix-duplicate-stream-message.md(已存在,直接给)
2. PLAN-fix-cwd-ttl-vs-resume.md(待写)
3. docs/HANDOFF-TEMPLATE.md(待写)

3 件做完后再开 A.1 Subagents 真化。我可以现在就把 (2) 和 (3) 的 PLAN 写出来,你说一声就开干。
