# Plan: 真沙盒 + 本地 CC 原生迁移

## 架构总纲(已定方向)

**先建真沙盒,再放开用户自配。** 隔离由 **OS 边界**保证,而不是靠"拒绝加载配置"。一旦每个 run 跑在真沙盒里,就可以 `settingSources: ['project','local']` + 让用户在自己盒子里随便配 hooks/MCP/CLAUDE.md/permissions —— **本地 cc 项目几乎能原生丢进去跑,翻译量大降。**

这取代了之前"`settingSources:[]` 锁死 + 翻译进托管 schema"的思路:那是"没沙盒"时的退路;有沙盒后走原生加载更简单、覆盖更全。

---

## 为什么必须先沙盒(已查实的现状)

当前**根本不是沙盒**:
- 无任何 OS 级隔离(无容器/换用户/chroot/seccomp,grep 全空)。
- `query()` **in-process** 跑在 Node 服务进程里(`server-agent.ts:729`),Bash = 宿主 `xiaoqin` 用户。
- **宿主整份 `process.env` 灌进每个 run**(`server-agent.ts:574-575`),含服务器环境里的密钥。
- 唯一的墙是 `canUseTool` 应用层闸门,身后什么都没有。

所以"让用户自配权限"在现状下 = 让任意租户以你身份在你 Mac 上跑任意代码。**先补隔离,才能谈自由。**

---

## 沙盒分层落地(官方路线,secure-deployment.md / hosting.md)

### 第 0 层 — SDK 内置 sandbox(先上,低成本,适配 Mac)
- `query()` 加 `sandbox: { enabled: true, failIfUnavailable: true }`(`sdk.d.ts:1709-1749`)。macOS 用 Seatbelt,无需额外依赖。
- **环境隔离(必做,沙盒不替你做)**:`server-agent.ts:574` 不再全量拷 `process.env`,改为**最小白名单 + 每租户 env**(只放 `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`/`PATH`/locale 等),杜绝宿主密钥泄漏。
- **文件系统边界**:sandbox + 权限规则限制为**只读取/写入该租户 workspace**;deny-read 宿主敏感路径(`~/.ssh`、`~/.claude`、其它租户 dataDir)。
- **网络边界**:`sandbox.network.allowManagedDomainsOnly: true`(仅 `api.anthropic.com`),按需放行租户声明的域名,防外泄。
- 效果:即便模型被注入/越权,OS 边界兜底;blast radius 收敛到单租户 workspace。

### 第 1 层 — 容器/microVM(真·untrusted 多租户,后续)
- 把执行从 in-process 迁到**每 run 一个容器/microVM**(hosting.md 列的 Modal / E2B / Fly / Cloudflare Sandboxes / Daytona;或自管 gVisor/Firecracker)。
- 模式参考 hosting.md:临时会话(一次性任务建/毁)、长运行(主动代理)、混合(带历史补充)。
- 凭据用**代理模式**注入(secure-deployment.md):API key 不进容器,proxy 在边界外注入。
- 这是真正能把盒子**完全交给陌生租户自配**的层;第 0 层是它到位前的强力过渡。

### 凭据/网络(两层都适用)
- proxy 模式:`ANTHROPIC_BASE_URL` 指向边界外代理,代理注入凭据 + 做请求校验。
- 文件系统最小挂载、优先只读;容器内 drop Linux capabilities。

---

## 有沙盒后:运行时配置翻转

- `settingSources: ['project','local']`(**不含 `'user'`**,避免读宿主 `~/.claude`;沙盒再 deny-read 兜底)。
- **CLAUDE.md / `.claude/skills` / `.claude/agents` / `.claude/settings.json`(hooks/permissions/env)/ `.mcp.json` 全部由 SDK 原生从租户 workspace 加载** —— 用户自配,沙盒内自负其责。
- `canUseTool` 仍在(纵深防御),但不再是唯一的墙;沙盒是硬边界。
- stdio MCP / hooks **可以放开给用户**(他们只能在自己沙盒里跑)—— 这正是你要的"沙盒里用户自己加权限"。

---

## 迁移功能:从"翻译"降级为"解包"

有了原生加载,导入大幅简化:

### 主路径 — 原生解包(沙盒就绪后)
- `POST /api/agents/import`:把本地 cc 项目(zip / 目录)**原样解包进该租户的 workspace**(含 `.claude/`、`.mcp.json`、CLAUDE.md、脚本、文档)。
- 不翻译,SDK 在沙盒里原生加载。文档想要"被引用/检索"可顺带建知识库源(可选)。
- 导入报告:列出解包内容 + 提示(如"`~/.claude` user 级不会带入,请放项目级")。

### 过渡路径 — 翻译进托管 schema(沙盒未就绪前,可选)
保留之前的分发器思路作为"无沙盒也能跑"的降级:CLAUDE.md→systemPrompt、permissions→Permissions 页、文档→知识库、脚本→workspace seed、MCP→完整定义。仅在第 0/1 层未上线时用;沙盒到位后可弃用。

---

## 工作区持久化(已有,复用)
- 持久 per-conversation cwd(`sdkCwd`,豁免清理)已存在。沙盒/容器的 workspace 即映射到它。
- 可加"模板级 workspace seed"(绑模板、新会话首跑 seed 进 cwd)作为"该 agent 随时可用的初始文件",见旧版需求。

---

## 安全红线(沙盒模型下)
- **沙盒边界是硬隔离**:env 最小白名单(无宿主密钥)、FS 限本租户 workspace、网络默认仅 anthropic。
- `settingSources` **绝不含 `'user'`**;沙盒 deny-read 宿主 `~/.claude`。
- 凭据走 proxy,不进盒子(第 1 层);容器 drop caps、只读根 + tmpfs。
- 自配自由**仅限沙盒内**:用户配的 hooks/MCP 只影响自己的盒子。

---

## 交付顺序
- **P1**:第 0 层 SDK sandbox + **env 最小白名单**(先把"宿主 env 灌进 run"这个现网洞堵了)+ FS/网络边界。
- **P2**:翻转运行时为 `settingSources:['project','local']`(不含 user)+ 验证 CLAUDE.md/skills/settings 原生加载、宿主 `~/.claude` 不可达。
- **P3**:原生解包导入(`/api/agents/import` 解包进 workspace)+ 导入报告 + 模板级 seed。
- **P4**(真 untrusted 多租户):第 1 层容器/microVM + proxy 凭据注入;放开 stdio MCP/hooks 自配。

---

## 验证清单(交付后跑)
1. **env 隔离**:run 内 `env` 只剩白名单;宿主自定义密钥变量在 run 里读不到。
2. **沙盒边界**:Bash 尝试读 `~/.ssh`/`~/.claude`/其它租户 dataDir → 被拒;写 workspace 外 → 被拒。
3. **网络**:Bash/agent 尝试连非 anthropic 域名 → 默认被拒,放行清单内可连。
4. **原生加载**:workspace 放 `CLAUDE.md`/`.claude/skills`/`.mcp.json`(远程)→ 原生生效;`~/.claude` 内容不出现。
5. **自配仅限盒内**:用户配一个 PreToolUse hook → 只在其沙盒执行,不触及宿主/他租户。
6. **失败安全**:沙盒依赖不可用时 `failIfUnavailable:true` → 报错退出,绝不裸跑。
7. **导入**:解包本地 cc 项目 → 在沙盒内能原生跑(CLAUDE.md 生效、skills 可用、远程 MCP 可用)。

---

## 执行前必读
- `server-agent.ts`:`574`(env 构建,P1 重点)、`729-752`(query options,加 sandbox / settingSources)、`642`(canUseTool 保留)、`750`(MCP 挂载)。
- `server.ts`:`1269`(run 端点/cwd)、`131`(USER_SKILLS_DIR)、`1900`(知识库上传,可选复用)、`/api/agents` PUT。
- SDK:`sdk.d.ts:1709-1749`(sandbox)、`1798-1801`(settingSources)、`1655-1664`(plugins)。
- 文档:`agent-sdk-docs-zh/secure-deployment.md`、`hosting.md`、`migration-guide.md`、`skills.md`、`mcp.md`。
