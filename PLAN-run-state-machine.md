# PLAN: 统一 Agent 对话运行状态机

> 目标读者:执行实现的 GPT。本文给出设计 + 逐文件改动清单 + 验证步骤。
> 写法约定:先改类型与服务端单一来源,再改前端消费,最后补落库/分析与回归。
>
> **修订 v2(已批准 scope):采用「修正版最小方案」。不先做大重构(不抽共享 stream helper),
> 只补:① `run-state.ts` 单一来源;② 消息表 + 前端 normalize 真正持久化 outcome/status/thinking;
> ③ 两个聊天入口(AgentChat + Conversations)的 outcome/phase 消费;④ analytics 读侧映射;
> ⑤ AbortController 取消。共享 stream helper 抽取留作后续独立 PR。**
>
> **v2 关键修正(GPT review,已逐条核实):**
> - 取消用 SDK 的 `options.abortController`(实例),**不是裸 `signal`**;`req.on('close')` 需配 `didEnd` 标志,避免正常 `res.end()` 后误 abort。
> - `error` 事件**不立即 finalize**:`runAgent` catch 后会先 emit `error`,函数末尾仍会 emit `result`(带 sdkSessionId/cost)。前端缓存 outcome+错误文案,等 `result` 或流真正结束再统一落库。
> - outcome **必须落到 `chat_messages` 表**:现表只有 `session_id/seq/role/content/timestamp`(`server-store.ts:432`),读写两侧都丢状态;`chat-sessions.ts:68` 的 `normalizeMessage` 也丢 `status/thinking/outcome`。两处都要改。
> - **两个入口一起改**:`AgentChat.tsx:348` 与 `Conversations.tsx:307` 各有一份重复 finalize 逻辑,只改一个会留下不一致。
> - ⚠️ 实施前先确认:`chat_messages` 当前**连 attachments 列都没有**,附件落库位置存疑(可能仅前端态)。建表迁移时一并核实 attachments 现状,别假设 `attachments_json` 已存在。

## 0. 背景与问题

当前「运行状态」分散在 4 层、互不收口,且**消息层 `ChatMessage.status` 只有 4 个值**(`pending | streaming | complete | error`),把多种异常坍缩成了 `complete`/`error`:

| 实际发生 | 服务端是否有事实 | 现在消息层显示 | 问题 |
|---|---|---|---|
| 用户主动停止 (Abort) | 是,`AbortError` | `complete` | 看不出「停止」 |
| 跑到 max_turns | 是,`result.subtype=error_max_turns` | `complete` | 看不出截断 |
| 执行中失败 | 是,`result.subtype=error_during_execution` | `complete` | 看不出失败 |
| 授权/提问 120s 超时自动 deny | 是,`reason=timeout` | (仅工具被拒) | 不可见 |
| 客户端断流 / 提前结束 | 服务端 log | `complete`/`error` | run 仍在后台跑,无取消 |

事实分散在:`server.ts`(运行前 4xx)、`server-agent.ts:943`(运行中 catch)、`server-agent.ts:890`(result.subtype)、`server-agent.ts:260`(超时兜底)、`AgentChat.tsx:458-467`(前端断流/Abort)、`agent-tasks.ts`(子任务)。

## 1. 目标 / 非目标

**目标**
- 定义两个正交的、单一来源的状态枚举:
  - `RunPhase` —— 瞬时活动相位(这一轮正在做什么),前端实时显示。
  - `RunOutcome` —— 终态(这一轮如何结束),落库 + 消息持久化。
- 把现有所有「事实」无损映射到这两个枚举,消除坍缩。
- 客户端断开时能真正取消后端 run(接 `AbortSignal`)。

**非目标**
- 不改子任务(Task)状态模型,`agent-tasks.ts` 维持现状,仅作为 `RunPhase=tool_executing` 的子视图。
- 不动权限/提问的交互协议,只新增 outcome 标注。
- 不做跨会话的全局状态聚合(后续另起)。

## 2. 状态模型(单一来源)

新建 `dashboard/src/simulator/run-state.ts`,导出两个枚举 + 映射函数,前后端共用(服务端用 `import type`)。

### 2.1 RunPhase(瞬时,非持久)
```
type RunPhase =
  | 'idle'                // 无活动
  | 'initializing'        // 收到 system.init 前后,建立 SDK 会话
  | 'thinking'            // delta{thinking:true}
  | 'streaming'           // delta 文本
  | 'tool_executing'      // tool_progress / task_* 进行中
  | 'awaiting_permission' // 有 pending permission_request
  | 'awaiting_input'      // 有 pending ask_user_question
  | 'finalizing'          // 收到 result,落库中
```
派生规则(优先级从高到低):`awaiting_permission > awaiting_input > tool_executing > thinking > streaming > initializing > finalizing > idle`。
即:只要有挂起的授权/提问,相位就是等待态,即便文本仍在流。

### 2.2 RunOutcome(终态,持久化)
```
type RunOutcome =
  | 'completed'      // 正常结束 (result.subtype=success)
  | 'stopped'        // 用户主动停止 (AbortError)
  | 'max_turns'      // result.subtype=error_max_turns
  | 'exec_error'     // result.subtype=error_during_execution
  | 'provider_error' // runAgent catch / provider 抛错 / emit{type:'error'}
  | 'disconnected'   // 客户端断流 / 响应提前结束,run 结果未知
  | 'rejected'       // 运行前 4xx 校验失败 (无模型/无 key/无 prompt 等)
```

### 2.3 映射函数(放同文件)
```
mapResultSubtypeToOutcome(subtype: string): RunOutcome
  'success'                  -> 'completed'
  'error_max_turns'          -> 'max_turns'
  'error_during_execution'   -> 'exec_error'
  其它 error_*               -> 'exec_error'   // 保守归类,保留原 subtype 到 detail

outcomeIsError(o: RunOutcome): boolean   // 'completed'|'stopped' = false,其余 true
outcomeLabel(o): string                  // 中文 UI 文案,见 §5
outcomeColor(o): string                  // 复用 var(--success|warning|danger)
```
- `completed`/`stopped` → success 色;`max_turns`/`disconnected` → warning;`exec_error`/`provider_error`/`rejected` → danger。

### 2.4 与旧 `ChatMessage.status` 的关系
保留 `ChatMessage.status` 字段做向后兼容(旧会话 JSON 已写入),但新增字段承载精确终态:
```
interface ChatMessage {
  ...
  status?: 'pending' | 'streaming' | 'complete' | 'error';  // 保留,作派生
  outcome?: RunOutcome;        // 新增:精确终态(assistant 消息终态时写入)
  outcomeDetail?: string;      // 新增:原始 subtype / 错误信息,可选
}
```
读取旧数据:`outcome` 缺失时由 `status` 反推(`complete→completed`,`error→provider_error`)。

### 2.5 持久化(v2 新增,必做)
现状是「写时丢、读时也丢」,outcome 加进类型却存不下来:
- **DB 表 `chat_messages`**(`server-store.ts:432`)只有 `session_id/seq/role/content/timestamp`。需迁移:`ALTER TABLE chat_messages ADD COLUMN outcome TEXT`、`ADD COLUMN status TEXT`、`ADD COLUMN thinking TEXT`(SQLite 加列幂等需 `PRAGMA table_info` 判断或 try/catch)。写入/读取的 SQL 与映射函数同步带上这些列。
- ⚠️ **附件核实**:该表当前**连 attachments 列都没有**。实施第一步先确认附件现在落在哪(localStorage / 别的表 / 没落库),再决定是否一并补 `attachments_json`。不要假设它已存在。
- **前端 `normalizeMessage`**(`chat-sessions.ts:68`)只回传 `role/content/attachments/timestamp`,把 `status/thinking/outcome` 吃掉。补齐这三个字段的透传(带类型校验)。
- 验收:刷新页面 / 重开会话后,历史 assistant 消息的 outcome 徽章与 thinking 不丢失。

## 3. 服务端改动

### 3.1 `dashboard/server-agent.ts`
1. **新增 emit 事件 `run_outcome`**,在 `Emitted` 联合类型里加:
   ```
   | { type: 'run_outcome'; outcome: RunOutcome; subtype?: string; message?: string }
   ```
   保留现有 `result` / `error` 事件不动(避免破坏其它消费方),`run_outcome` 是叠加的精确信号。
2. **result 分支**(≈ line 888–890):`status = m.subtype || 'success'` 之后,emit `result` 的同时 emit `run_outcome { outcome: mapResultSubtypeToOutcome(status), subtype: status }`。
3. **catch 分支**(≈ line 943–945):除现有 `emit{type:'error'}` 外,emit `run_outcome { outcome:'provider_error', message }`。
4. **recordAgentRun**(line 950):把入参 `status` 从自由字符串收敛为 `RunOutcome`(`mapResultSubtypeToOutcome` 的结果;catch 路径传 `'provider_error'`)。注意 §6 分析口径。
5. **取消透传(修正)**:SDK `query()` 在 `server-agent.ts:839`,其取消入口是 `options.abortController`(一个 `AbortController` 实例),**不是裸 `signal`**。改 `RunAgentOptions` 接 `abortController?: AbortController`(或在内部由传入 signal 包一个),并在 `query({ ..., abortController })` 里传入。`maxTurns` 已在 `:848`。这是「客户端断开真正取消 run」的关键。

### 3.2 `dashboard/server.ts`
1. **`/api/chat` 运行前 4xx**:在每个 `res.status(4xx).json({error})` 之前(line 1312/1321/1341/1347/1349 等),因为此时还没切到 SSE,前端是靠 `readChatError` 拿到的——**无需 emit**,改由前端把这些归类为 `rejected`(§4)。仅需保证错误体可识别(已满足)。
2. **绑定取消(修正)**:`/api/chat` handler 内:
   ```
   const ac = new AbortController();
   let didEnd = false;
   req.on('close', () => { if (!didEnd) ac.abort(); });   // didEnd 防止正常 res.end() 后误 abort
   await runAgent({ ..., abortController: ac });
   didEnd = true; res.end();
   ```
   传 `abortController`(实例),与 §3.1.5 对齐。客户端断开 → 后端 run 终止,杜绝「后台幽灵 run」;正常收尾不误触发。

## 4. 前端改动 `AgentChat.tsx` + `Conversations.tsx`(两个入口同步改)

> `Conversations.tsx:307` 有一份与 `AgentChat.tsx:348` **完全重复**的 `persistFinalMessage/didFinalize/finalizeAssistantDraft` 流式逻辑。v2 不抽共享 helper(留后续 PR),但**两处必须做等价改动**,否则会话页和聊天页状态不一致。下文规则对两者都适用,行号以 AgentChat 为准、Conversations 对应处一并改。

### 4.1 新增会话相位 state
```
const [runPhase, setRunPhase] = useState<RunPhase>('idle');
```
- 发送时 `setRunPhase('initializing')`;`isStreaming` 保留(很多 `disabled` 依赖它),但其值改为派生:`isStreaming = runPhase !== 'idle'`。
- 在 SSE 循环里按事件更新相位:
  - `system.init` → 仍 `initializing`(等首个 delta)
  - `delta{thinking}` → `thinking`;`delta`文本 → `streaming`
  - `permission_request` 入列 → `awaiting_permission`;resolved 且无剩余 → 回落到 `streaming`
  - `ask_user_question` → `awaiting_input`;resolved → 回落
  - `task_*` 进行中 → `tool_executing`(无 pending 授权/提问时)
  - `result` → `finalizing` → 落库后 `idle`
- 用 §2.1 的优先级派生函数集中计算,避免分支里手写顺序。

### 4.2 终态映射(替换 `persistFinalMessage` 的 `'complete'/'error'`)
`persistFinalMessage` 第二参数从 `ChatMessage['status']` 改成接收 `RunOutcome`,内部同时写 `outcome` 和派生的旧 `status`(`outcomeIsError ? 'error' : 'complete'`)。改各调用点:
- line 392 `readChatError` → `'rejected'`
- line 399 响应体为空 → `'provider_error'`
- line 433 `result` 分支:改用收到的 `run_outcome.outcome`(在 SSE 里捕获并存入局部 `let outcome`),默认 `'completed'`
- line 453 `error` 事件 → **不立即 finalize**。仅缓存 `let outcome='provider_error'` 和错误文案到局部变量,等后续 `result`/`run_outcome`/流结束再统一落库——因为 `runAgent` catch 后会先 emit `error`、函数末尾仍 emit `result`(带 sdkSessionId/cost),提前 finalize 会丢这些。`didFinalize` 守卫保证最终只落一次。
- line 459 提前结束 → 有文本 `'disconnected'`,无文本 `'disconnected'`(统一,文案区分)
- line 463 AbortError → `'stopped'`(**不再是 complete**)
- line 465 其它 catch → `'provider_error'`
- 新增:SSE 分支处理 `data.type === 'run_outcome'` → 存 `outcome`,**不立即 finalize**(等 `result`/流结束统一落库,避免双写;`didFinalize` 守卫已在)。

### 4.3 渲染
- 顶部/输入区:`runPhase !== 'idle'` 时显示相位徽章(用 `phaseLabel(runPhase)`)。停止按钮文案随相位:等待态显示「跳过/回答」,其余「停止」。
- 历史消息:assistant 气泡右上角根据 `message.outcome` 显示 `outcomeLabel`+`outcomeColor` 徽章(`completed` 不显示徽章以免噪声;其余都显示)。
- 删除现在硬编码的 `_（已停止）_` 文本注入(line 463),改由 outcome 徽章表达,正文不再污染。

## 5. UI 文案(`run-state.ts` 内)
```
phaseLabel:  idle '空闲' | initializing '初始化' | thinking '思考中' |
             streaming '生成中' | tool_executing '执行工具' |
             awaiting_permission '等待授权' | awaiting_input '等待回答' |
             finalizing '收尾'
outcomeLabel: completed '完成' | stopped '已停止' | max_turns '达到轮次上限' |
              exec_error '执行失败' | provider_error '服务异常' |
              disconnected '连接中断' | rejected '请求被拒'
```

## 6. 落库 / 分析口径 `dashboard/server-store.ts`
- `recordAgentRun` 的 `status` 现以自由字符串入库(line 2856)。改为写 `RunOutcome`。
- **回归风险**:`server-store.ts:1545-1546` 统计 `run.status === 'success'` 为成功。现枚举里没有 `'success'`,改为 `outcome === 'completed'`(并把 `'stopped'` 视作非失败,不计入 failedRuns —— 用户主动停止不是失败)。
  ```
  successfulRuns = runs.filter(r => r.status === 'completed').length
  failedRuns     = runs.filter(r => !['completed','stopped'].includes(r.status)).length
  ```
- 历史行 `status='success'/'error'`:在读侧做兼容映射(`'success'→'completed'`),或一次性迁移脚本 UPDATE。推荐读侧兼容,零停机。

## 7. 改动文件清单(摘要,v2)
- 新增 `dashboard/src/simulator/run-state.ts` —— 枚举 + map/label/color + 派生函数(单一来源)
- `dashboard/src/simulator/types.ts` —— `ChatMessage` 加 `outcome`/`outcomeDetail`
- `dashboard/server-agent.ts` —— `run_outcome` 事件、result/catch emit、recordAgentRun 收敛、`query()` 接 `abortController`
- `dashboard/server.ts` —— `/api/chat` `AbortController` + `didEnd` 绑 `req.on('close')`
- `dashboard/src/pages/AgentChat.tsx` —— `runPhase` state、SSE 相位派生、error 缓存不立即 finalize、`persistFinalMessage` 改 outcome、渲染徽章
- `dashboard/src/pages/Conversations.tsx` —— **同 AgentChat 的等价改动**(重复 finalize 逻辑,本轮不抽共享 helper)
- `dashboard/src/utils/chat-stream-draft.ts` —— `finalizeAssistantDraft` 接受 outcome 并写入消息
- `dashboard/src/utils/chat-sessions.ts` —— `normalizeMessage` 透传 `status/thinking/outcome`(当前丢弃)
- `dashboard/server-store.ts` —— `chat_messages` 加列迁移(`outcome/status/thinking`,核实 attachments)+ 读写 SQL + 成功/失败统计口径 + 历史 status 读侧兼容
- `dashboard/src/utils/agent-tasks.ts` —— 不变(作为 tool_executing 子视图)

## 8. 向后兼容
- 旧会话 JSON 无 `outcome`:渲染时 `outcome ?? (status==='error'?'provider_error':'completed')`。
- 旧 analytics 行 `status='success'`:读侧映射到 `completed`。
- 旧消费 `result`/`error` SSE 的代码不受影响(`run_outcome` 是叠加事件)。

## 9. 验证步骤(用 /verify 思路,真跑)
1. **正常完成**:发一条普通消息 → 相位 `thinking→streaming→finalizing→idle`,消息无错误徽章,`outcome=completed`,analytics successfulRuns +1。
2. **用户停止**:长任务中途点停止 → `outcome=stopped`,徽章「已停止」,正文不含 `_（已停止）_`,failedRuns **不** +1。
3. **max_turns**:构造低 maxTurns 模板触发 → `outcome=max_turns`,徽章「达到轮次上限」。
4. **provider_error**:故意填错 baseUrl/key → `outcome=provider_error`,徽章「服务异常」。
5. **断开取消**:发消息后立刻关闭标签页 → 服务端日志显示 `req close → abort`,SDK run 终止(确认无后台继续计费的 run)。
6. **正常收尾不误 abort**:一条普通消息正常完成 → 确认 `didEnd` 生效,服务端**没有**打出 abort 日志,计费/落库完整(回归 abortController 引入的风险)。
7. **等待相位**:触发一个需授权的工具 → 相位 `awaiting_permission`,按钮文案变化;120s 不处理 → 自动 deny,相位回落。
8. **持久化往返**:跑出 `stopped`/`max_turns`/`provider_error` 各一条后,**刷新页面 + 重开会话** → outcome 徽章与 thinking 不丢(验证 DB 列 + `normalizeMessage` 透传)。
9. **error+result 不双落**:provider_error 场景下确认消息只 finalize 一次,且 sdkSessionId/cost 仍被记录(没被提前 finalize 丢掉)。
10. **两个入口一致**:同一异常分别在 AgentChat 和 Conversations 触发,徽章/文案表现一致。
11. **旧会话**:打开一个改动前保存的会话 → 不报错,assistant 消息按兼容规则显示。

## 10. 实施顺序(建议提交粒度,v2)
1. `run-state.ts` + `types.ts`(纯类型,无行为变化)
2. **持久化打底**:`chat_messages` 加列迁移 + 读写 SQL + `normalizeMessage` 透传(先核实 attachments 现状)
3. 服务端 emit `run_outcome` + recordAgentRun 收敛 + store 统计口径(后端先行,前端旧逻辑仍可跑)
4. 前端 `runPhase` + outcome 消费 + 渲染 —— **AgentChat 与 Conversations 同提交**
5. AbortController 取消(独立小 PR,便于单独验证 #5/#6)
6. 回归 §9 全量
