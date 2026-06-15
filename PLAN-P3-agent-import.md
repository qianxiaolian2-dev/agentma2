# Plan: P3 — 本地 CC 项目「原生解包」导入

> 依赖:P1(沙盒 + env 白名单)+ P2(`settingSources=['project','local']`)已落地并提交(`9e57aee`)。
> 本文是 `PLAN-local-env-agent.md` 第 84 行 P3 的展开:`/api/agents/import` 解包进 workspace + 导入报告 + 模板级 seed。

---

## 目标与非目标

**目标**:把一个本地 cc 项目(目录)**原样解包**成一个租户的 Agent 模板资产 —— `.claude/`(agents/skills/settings)、`.mcp.json`、`CLAUDE.md`、脚本、文档照搬进受控存储;新建/更新对应 Agent 模板;每次该模板新开会话时,把这些文件 **seed 进该会话的 workspace cwd**,让 SDK 在沙盒里**原生加载**(P2 已让 project/local 生效)。不翻译。

**非目标(本轮不做)**:
- zip 上传(deps 里无解压库;先用多文件 multipart,见下)。
- 放开 hooks / stdio MCP 自动执行 —— 那是 P4 容器层的信任边界,本轮**导入时禁用并在报告里说明**。
- user 级配置带入(`~/.claude`)—— 设计上就不带,报告里提示「请放项目级」。

---

## 传输层:多文件 multipart(复用现成模式,零新依赖)

deps 里没有 zip/tar 库(已查实)。**复用 knowledge 上传的模式**:前端用 `<input webkitdirectory multiple>` 选目录,`multer.array('files')` + 并行的 `relativePaths[]` body 字段按下标对应。

- 参考:`server.ts:1851` `knowledgeMultipartUpload`、`:1950` `parseKnowledgeMultipartUpload`、`:2011` `uploadedBodyStrings(req.body?.relativePaths)`、`safeUploadedKnowledgePath`。
- 新建一个 `agentImportUpload`(memoryStorage,limits:files ≤ 300、单文件 ≤ 2MB、总量 ≤ 50MB,与 wiki 上限对齐)。
- (可选,后续)再加 zip 入口:需引入 `adm-zip` 或 `yauzl`;本轮不做。

---

## 存储模型:模板级 seed(持久) + 首跑 seed 进 cwd(易失)

两层,缺一不可:

1. **持久 seed 仓**(导入落点):
   `dataDir/agent-seeds/<tenantId>/<templateId>/`
   —— 这是「该 Agent 自带的初始文件」,跟着模板走,持久。用 `getDataLocation().dataDir`(`server-store.ts:2784`)。

2. **首跑 seed 进会话 cwd**(运行时):
   每条会话的 `sdkCwd` 是 `runAgent` **首跑时懒创建**的 `/tmp/agentma-run-<tenant>-<ts>`(`server-agent.ts:658`),resume 时把存好的 cwd 传回(`server.ts:1436`)。
   → 在 `runAgent` 创建**新** cwd(非 resume)时,把模板 seed 仓 `cp -r` 进去,再 `query()`。这样 SDK 原生加载 workspace 里的 `CLAUDE.md`/`.claude`/`.mcp.json`。

> 为什么不直接把 seed 当 cwd?因为 cwd 易失(7 天 TTL,`cleanupExpiredRunCwds`)且每会话独立、可写;seed 仓要持久且只读源。copy-on-first-run 同时满足「持久来源 + 每会话独立可写副本」。

---

## 改动清单

### A. `runAgent` 加 seed 注入(`server-agent.ts`)
- `RunAgentOptions` 加可选 `seedDir?: string`。
- `runAgent` 开头(`:658-660`,`fs.mkdirSync(cwd)` 之后):
  ```
  const isFreshCwd = !opts.resumeSdkSessionId && !fs.existsSync(path.join(cwd, '.agentma-seeded'));
  if (opts.seedDir && isFreshCwd && fs.existsSync(opts.seedDir)) {
    copyAgentSeedSafe(opts.seedDir, cwd);          // 安全拷贝,见 D
    fs.writeFileSync(path.join(cwd, '.agentma-seeded'), String(Date.now()));
  }
  ```
- 注意顺序:seed **在** `.agent-home`(HOME 隔离,`:670`)创建**之前或之后均可**,但 seed 内容必须落在 `cwd` 根,且不得覆盖 `.agent-home`。`hostPathToolBlock` 不影响(seed 走文件系统拷贝,不经工具层);seed 后的文件都在 cwd 内,沙盒 FS allowlist 天然放行。

### B. seed 仓读写 + 导入解包(`server.ts`,新函数)
- `agentSeedDir(tenantId, templateId)` → `path.join(getDataLocation().dataDir, 'agent-seeds', tenantId, templateId)`。
- `unpackAgentImport(auth, templateId, files, relativePaths)`:
  1. 校验每个 `relativePath`(`safeUploadedKnowledgePath` 同款:拒绝绝对路径、`..`、空、非法字符)。
  2. 跑 **import 白名单/黑名单**(见 C),分类、计数、累计字节,超限报 4xx。
  3. 写进 `agentSeedDir(...).tmp`(原子:先写 tmp 再 `rename`,失败清理 —— 抄 `importWorkspaceWikiFromConversation` 的 tmp/rename 模式 `:740-748`)。
  4. 返回 `importReport`(见 E)。

### C. 内容策略:解包什么、禁用什么(安全核心)
**原样解包(native-load)**:
- `CLAUDE.md`、`CLAUDE.local.md`
- `.claude/agents/**`、`.claude/skills/**`
- `.mcp.json`(仅 **远程/HTTP** MCP;stdio MCP 见下)
- 文档/脚本/源码等普通文件

**导入时禁用并在报告标注(P4 前的信任边界)**:
- `.claude/settings.json` / `settings.local.json` 里的 **hooks** → 解包但**重命名为 `settings.json.imported`**(不让 SDK 自动加载执行),报告提示「hooks 待 P4 容器层放开」。
- `.mcp.json` 里 **stdio 型 MCP**(`command`/`args`)→ 剥离,只保留 `url`/`http` 型;报告列出被剥离项。
  > 理由:P2/P1 是 in-process + Seatbelt,hooks/stdio MCP 会以服务身份起子进程,沙盒边界不足以信任陌生项目。这与 `PLAN-local-env-agent.md` 安全红线第 77 行一致:hooks/stdio MCP 仅在真沙盒/容器层(P4)放开。

**直接拒绝**:
- 符号链接(抄 `validateWorkspaceWikiImportTree` 的 `lstat().isSymbolicLink()` `:687`)。
- `node_modules`、`.git`、`.agent-home`、`.agentma-seeded` 等目录/标记(黑名单)。
- 越界路径、超大文件/总量。

### D. 安全拷贝 `copyAgentSeedSafe(srcDir, destDir)`
- 直接复用/泛化 `copyWorkspaceWikiDirSafe`(`server.ts:721`):递归、拒符号链接、黑名单目录、只拷普通文件。

### E. 导入报告 `importReport`
返回并存进 audit,结构:
```jsonc
{
  "templateId": "...",
  "seedDir": "<dataDir>/agent-seeds/<tenant>/<id>",
  "unpacked":  [{ "path": ".claude/agents/foo.md", "bytes": 1234, "category": "agent" }, ...],
  "detected":  { "agents": ["foo"], "skills": ["bar"], "claudeMd": true, "remoteMcp": ["x"] },
  "disabled":  { "hooks": ["PreToolUse"], "stdioMcp": ["localtool"] },   // 被禁用/剥离
  "skipped":   [{ "path": "node_modules/...", "reason": "blocked dir" }],
  "notes": [
    "~/.claude(user 级)不会带入,请放到项目级 .claude/。",
    "settings.json 的 hooks 已禁用(重命名为 .imported),待 P4 容器层再放开。",
    "stdio 型 MCP 已剥离,仅保留远程 MCP。"
  ]
}
```

### F. 端点 `POST /api/agents/import`(`server.ts`,挨着 `:2603 PUT /api/agents`)
```
app.post('/api/agents/import', authMiddleware, parseAgentImportUpload, (req, res) => {
  const mode = req.body?.mode || 'new';     // 'new' | 'merge:<templateId>'
  // 1. 确定 templateId:new → crypto.randomUUID();merge → 校验属本租户
  // 2. report = unpackAgentImport(req.auth, templateId, req.files, relativePaths)
  // 3. 解析 .claude/agents/*.md frontmatter + .mcp.json(远程)→ 组装/合并 AgentTemplate
  //    (name 来自 manifest 或目录名;systemPrompt 可选填 CLAUDE.md 摘要提示;
  //     tools/skills/mcpServers 由检测结果回填;seedDir 记到模板字段)
  // 4. replaceAgentTemplates(tenantId, [...listAgentTemplates(tenantId) 去重, newTpl])
  // 5. audit(tenantId,'import_agent',sub,'agent',templateId,{report 摘要})
  // 6. res.json({ template: normalizeAgentTemplateForApi(newTpl), report })
});
```
- 模板新增字段:`seedDir`(指向 seed 仓)。`normalizeAgentTemplateForApi`(`:957`)无需特别处理(透传)。

### G. 运行时接上 seed(`server.ts` 两个 run 端点)
- `/api/chat`(`:1436`)和 `/api/agents/run`(`:2778`)在 `runAgent({...})` 里加:
  `seedDir: template?.seedDir ? agentSeedDirResolve(tenantId, template) : undefined`
  —— 仅当模板带 `seedDir` 且该会话是首跑(新 cwd)时生效(逻辑在 `runAgent` 内判,见 A)。

### H. 前端(`src/pages/Agents.tsx`)
- 「导入本地项目」按钮 → 目录选择(`webkitdirectory`)→ POST multipart → 弹出**导入报告**(unpacked/detected/disabled/notes)。
- 复用现有 Agent 列表渲染新模板。

---

## 删除/生命周期
- 删除模板时一并 `fs.rm(agentSeedDir, {recursive,force})`。
- seed 仓不进 7 天 TTL(它是持久资产,只有会话 cwd 才清理)。
- 重新导入(merge 模式)= 覆盖该模板的 seed 仓(tmp/rename 原子替换)。

---

## 安全红线(本轮)
- seed 解包**全程不经工具层**,但落点严格限定 `agentSeedDir` 内(path traversal 校验);首跑拷贝落点严格限定会话 cwd 内。
- **hooks 禁用 + stdio MCP 剥离**,直到 P4 容器层。报告必须明示。
- 拒符号链接、黑名单目录、超限。
- 导入的文件在 run 时由 P1/P2 兜底:HOME 隔离、env 白名单、`settingSources` 不含 user、`hostPathToolBlock`、sandbox FS。即便恶意 seed,也只能在单租户 workspace 内活动。

---

## 交付顺序
- **P3a(MVP)**:A(seed 注入)+ B/D(解包+安全拷贝)+ F(端点,`mode=new`)+ G(运行时接 seed)+ 最小报告。先跑通「导入目录 → 新模板 → 新会话原生加载 CLAUDE.md/skills」。
- **P3b**:C 的 hooks/stdio-MCP 禁用与剥离 + 完整报告 + merge 模式 + 删除清理 + 前端报告 UI。
- **P3c(可选)**:zip 上传入口(引 `adm-zip`);.claude/agents frontmatter → 模板字段的精细映射。

---

## 验证清单(交付后跑,新建一个 smoke `smoke-agent-import.mjs`,**务必 `AGENTMA_SMOKE_START_SERVER=1`**)
1. **解包落点**:导入一个含 `CLAUDE.md`/`.claude/skills/x/SKILL.md`/`.mcp.json`(远程)的目录 → `agentSeedDir` 下结构一致,无符号链接、无 node_modules。
2. **新模板**:`GET /api/agents` 出现新模板,带 `seedDir`。
3. **首跑原生加载**:用该模板新开会话跑一次 → 会话 cwd 内出现 seed 文件;`GET /api/agents/:id/claude-md` 的 `loadedFiles` 含 seed 的 `CLAUDE.md`;`effectiveContent` 命中 seed 标记串。
4. **resume 不重复 seed**:同会话二次运行 → cwd 不被覆盖(`.agentma-seeded` 标记生效,用户改动保留)。
5. **hooks 禁用**:seed 里放 `settings.json`(带 hooks)→ 解包后为 `settings.json.imported`,run 内 hooks **不触发**;报告 `disabled.hooks` 列出。
6. **stdio MCP 剥离**:`.mcp.json` 同时含 stdio+远程 → run 内只有远程可用;报告 `disabled.stdioMcp` 列出。
7. **路径安全**:relativePath 含 `../` 或绝对路径 → 4xx 拒绝;含符号链接 → 拒绝。
8. **隔离不回退**:run 内 `cat ~/.claude/CLAUDE.md`、`cat /Users/<host>/.claude/CLAUDE.md` 仍被拦(P1/P2 不受 seed 影响)。

---

## 执行前必读(代码锚点)
- `server.ts`:`1851/1950/2011`(multipart+relativePaths 模式)、`677-755`(wiki 校验/安全拷贝/tmp-rename 可抄)、`957`(normalizeAgentTemplateForApi)、`2558-2607`(/api/agents GET/PUT)、`2750-2799`(/api/agents/run)、`1342/1436`(/api/chat 的 sdkCwd→runAgent.cwd)、`136`(WORKSPACE_ROOT)、`getDataLocation`。
- `server-agent.ts`:`658-674`(cwd/HOME/env 构建,seed 注入点)、`131`(hostPathToolBlock)、`847-864`(query options,settingSources/sandbox 已就绪)。
- `server-store.ts`:`2464`(getLatestAgentRuntimeSession)、`2933/2942`(list/replaceAgentTemplates)、`2784`(getDataLocation)。
- 文档:`PLAN-local-env-agent.md`(P3 + 安全红线)、`agent-sdk-docs-zh/{skills,mcp,settings,migration-guide}.md`。
