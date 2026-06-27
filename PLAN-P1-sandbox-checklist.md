# P1 执行清单:env 隔离 + SDK 内置 sandbox(交付给 GPT)

> 目标:把"每个租户 run 以宿主身份、带宿主全部 env、无隔离地跑"这个现网风险降下来。
> 只做 P1。**不要**做 settingSources 翻转(P2)、原生解包导入(P3)、容器/proxy(P4)、MCP schema / template.env。
> 全部改动集中在 `dashboard/server-agent.ts`,加少量配置开关。改完跑验证清单。

## 背景(执行前先读)
- `dashboard/server-agent.ts`:
  - `runAgent` 在 `:569` 建 `cwd`,`:573-578` 构建 per-call `env`(当前**全量拷 `process.env`**),`:729-752` 是 `query()` options。
  - 常量区在 `:334` 附近(`RUN_CWD_PREFIX` 等)。`fs`、`path`、`os` 已 import(`:2-4`)。
- SDK 类型参考 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:
  - `sandbox?: SandboxSettings`(`:1709-1749`):`{ enabled, failIfUnavailable, autoAllowBashIfSandboxed, network:{ allowManagedDomainsOnly, allowedDomains, ... }, filesystem:{...} }`。macOS 用 Seatbelt,无需额外依赖;`failIfUnavailable:true` 时依赖缺失会报错退出而非裸跑。
- 现状两个洞:env 泄漏(`:574`)、in-process 无隔离。P1 堵 env + 上 OS sandbox。

---

## 改动 1:env 改最小白名单 + 隔离 HOME

### 1a. 新增常量(放 `:334` 附近常量区)
```ts
// P1: 给租户 run 的 env 白名单 —— 绝不把宿主全部 process.env 拷进去(会泄漏服务器密钥)。
// 需要额外变量时用 AGENTMA_RUN_ENV_ALLOWLIST 逗号分隔追加,先在 dev 验证不破坏 SDK/MCP。
const RUN_ENV_ALLOWLIST = process.env.AGENTMA_RUN_ENV_ALLOWLIST
  ? process.env.AGENTMA_RUN_ENV_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean)
  : ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'TMPDIR', 'SHELL'];

const SANDBOX_ENABLED = process.env.AGENTMA_SANDBOX_ENABLED !== '0';
const SANDBOX_FAIL_IF_UNAVAILABLE = process.env.AGENTMA_SANDBOX_FAIL_IF_UNAVAILABLE !== '0';
// 网络收紧默认 OFF:allowManagedDomainsOnly 会影响 WebFetch/远程 MCP/npx,先单独验证再开。
const SANDBOX_NETWORK_MANAGED_ONLY = process.env.AGENTMA_SANDBOX_NETWORK_MANAGED_ONLY === '1';
```

### 1b. 替换 env 构建块(`server-agent.ts:573-578`)
**删除**当前的全量拷贝块,**替换为**:
```ts
// Per-call env: 仅白名单 —— 绝不把宿主全部 process.env 灌进租户 run。
const env: Record<string, string> = {};
for (const key of RUN_ENV_ALLOWLIST) {
  const v = process.env[key];
  if (v != null) env[key] = String(v);
}
// 隔离 HOME 到运行 workspace:让 `~` 解析到受控空目录,agent 读不到宿主 ~/.claude、~/.ssh 等。
// 用 cwd 下的稳定子目录 → 同一对话跨 run 复用同一 HOME,SDK 会话 resume 不受影响。
const runHome = path.join(cwd, '.agent-home');
fs.mkdirSync(runHome, { recursive: true });
env.HOME = runHome;
env.ANTHROPIC_API_KEY = opts.apiKey;
if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;
```
要点:
- `cwd` 已在 `:569` 定义,本块在其后,可直接用。
- 不再 `delete env.ANTHROPIC_AUTH_TOKEN`(白名单本就不含它);如担心可显式 `delete`,无害。
- **不要**把 `HOME` 加进白名单(我们要覆盖它,不是继承宿主的)。
- **不要**把 `HTTP_PROXY`/`HTTPS_PROXY` 加进白名单(宿主有 :7897 代理会导致 run 内请求被代理出错,见项目记忆 [[gotcha-local-proxy]])。

---

## 改动 2:query() 启用 SDK sandbox(`server-agent.ts:729-752`)

在 options 对象里(与 `cwd`、`env`、`settings` 同级)新增:
```ts
...(SANDBOX_ENABLED ? {
  sandbox: {
    enabled: true,
    failIfUnavailable: SANDBOX_FAIL_IF_UNAVAILABLE,
    ...(SANDBOX_NETWORK_MANAGED_ONLY ? { network: { allowManagedDomainsOnly: true } } : {}),
  },
} : {}),
```
要点:
- **不要**设 `autoAllowBashIfSandboxed` —— 保留 `canUseTool` 作为权限裁决(纵深防御,P1 不动权限模型)。
- 文件系统可写区由 `cwd` + 现有 `additionalDirectories`(知识源,`:741`)界定;sandbox 在 OS 层兜底。确认知识源读取在 sandbox 下仍工作(见验证 6)。
- 保留现有所有 options 不动(`permissionMode`、`canUseTool`、`maxTurns`、`thinking`、`hooks`、`mcpServers` 等)。

---

## 改动 3:配置开关文档化
在项目部署文档 / `.env.example`(若有)记录新开关,默认值即安全默认:
- `AGENTMA_SANDBOX_ENABLED`(默认 on;设 `0` 可临时关,排障用)
- `AGENTMA_SANDBOX_FAIL_IF_UNAVAILABLE`(默认 on;设 `0` 允许沙盒不可用时降级裸跑——**仅排障**)
- `AGENTMA_SANDBOX_NETWORK_MANAGED_ONLY`(默认 off;验证 WebFetch/MCP 后再设 `1` 收紧)
- `AGENTMA_RUN_ENV_ALLOWLIST`(逗号分隔,追加白名单变量)

---

## 已知陷阱(执行时注意)
1. **会话 resume**:HOME 必须随 cwd 稳定(用 `<cwd>/.agent-home`,不要用每次新建的临时路径),否则跨 run 找不到 SDK session transcript。
2. **macOS sandbox 可用性**:`failIfUnavailable:true` 下若 Seatbelt 不被 SDK 支持,`query()` 会发 error 退出。**先在本机确认沙盒真的激活**(验证 3/4);若发现平台不支持,**不要**默默设 `failIfUnavailable:false`,先反馈。
3. **env 砍太狠会崩**:若 SDK/CLI 或某 MCP 因缺变量报错,用 `AGENTMA_RUN_ENV_ALLOWLIST` 精准补、并记录补了什么,**不要**回退成全量拷贝。
4. **自定义 HTTP 工具的网络不受 bash sandbox 约束**:`buildCustomToolsMcp` 的 `fetch` 在 Node 主进程内执行(`:86-124`),不经 bash sandbox。`SANDBOX_NETWORK_MANAGED_ONLY` 只约束 CLI 内执行(bash/WebFetch)。这是已知范围,P1 不处理。
5. **deepseek/自定义 provider**:`opts.baseUrl` → `ANTHROPIC_BASE_URL` 仍设置,provider 路径不受影响(见记忆 [[spike-deepseek-sdk]]),但回归里要跑一次确认。
6. **`.agent-home` 不应被当作 skill/wiki/知识扫描目标**:确认 `scanWorkspaceSkills`(扫 `.claude/skills`)、wiki 扫描不会把它纳入;如有需要加入忽略名单。

---

## 验证清单(改完逐条跑)
> env/HOME/sandbox 的断言需要真实跑一次 Bash,要用真实 provider(如 deepseek key)。可在启动 server 前注入一个探针密钥 `AGENTMA_TEST_SECRET=topsecret` 来测泄漏。

1. **编译/类型**:`npm run build`(或 tsc)通过,`sandbox`/env 改动无类型错误。
2. **env 泄漏堵死**:server 环境设 `AGENTMA_TEST_SECRET=topsecret` 启动 → 让 agent 跑 `echo "[$AGENTMA_TEST_SECRET]"` → 输出 `[]`(读不到)。
3. **HOME 隔离**:agent 跑 `echo $HOME` → 指向 `<cwd>/.agent-home`,非 `/Users/xiaoqin`;`ls ~/.claude` → 空或不存在(读不到宿主)。
4. **沙盒确实激活**:agent 跑 `echo hi > /tmp/agentma_escape_$$.txt`(cwd 外)→ 在 sandbox 下被拒/失败;`echo hi > ./inworkspace.txt`(cwd 内)→ 成功。(若两者都成功 = 沙盒没生效,排查陷阱 2。)
5. **失败安全**:临时把沙盒依赖弄成不可用(或在不支持平台)+ `failIfUnavailable:true` → `query()` 报错退出,**不**裸跑。
6. **知识源回归**:带知识源的 run → agent 仍能 Glob/Grep/Read 知识目录(sandbox + additionalDirectories 协作正常)。
7. **skills 回归**:启用了 skill 的模板 → Skill 工具仍能加载(P1 未动 skills 机制,应不回归)。
8. **resume 回归**:同一对话连发两轮(第二轮带 `resumeSdkSessionId`)→ 正常续上下文(证明 HOME 稳定)。
9. **provider 回归**:deepseek/自定义 baseUrl 的 run 正常完成。
10. **开关**:`AGENTMA_SANDBOX_ENABLED=0` 能关沙盒回到旧执行(仅排障);默认(不设)即开启。

## 验收标准
- 默认配置下:租户 run 的 env 只含白名单 + ANTHROPIC_*;`~` 指向隔离目录;cwd 外写入被 OS sandbox 拒绝;沙盒不可用时报错而非裸跑。
- 知识源、skills、resume、deepseek provider 全部不回归。
- 所有新行为可经环境变量开关,默认值=安全默认。

## 交付物
- `dashboard/server-agent.ts` 改动(改动 1+2)。
- 配置开关说明(改动 3)。
- 一个可复现验证 2/3/4 的脚本或手测记录(放 `dashboard/scripts/`,参考现有 `smoke-*.mjs` 风格;无真实 provider 时给出手测步骤)。
- 不改其它文件;不进入 P2-P4 范围。
