# PLAN:知识库 — Obsidian vault 直读(不造 RAG)

> 范围:让 agent 能访问用户的 Obsidian vault(或任意 markdown 文件夹),用 SDK 自带的 Read/Glob/Grep 检索
> 弃用方案:**上一版 PLAN(RAG + embedding + 向量库)废弃** —— 跟用户已有的 Obsidian 失同步、重复造轮子、单机阶段没必要
> 原则:**用已有的、不造新的**;让 agent 像看自己 cwd 一样看你的 vault

---

## 1. 设计直觉(为什么不做 RAG)

| 维度 | 自建 RAG | **Obsidian 直读** |
|---|---|---|
| 你的知识在哪 | 上传到我系统里再切一遍 | **就在 ~/Obsidian/MyVault/,你天天用** |
| 维护成本 | 改了一处要重新上传 / 重新 embed | **改完即生效**,无同步 |
| 工具 | 新建 search_knowledge MCP tool | **SDK 自带 Read / Glob / Grep**,什么都不写 |
| 搜索质量 | 语义近似,但对你结构化的 [[wikilink]] 和 #tag 视而不见 | grep 直接命中标签 + 文件名 + 全文,**对 Obsidian 的结构友好** |
| 失败模式 | embedding 服务挂 = KB 不可用 | 文件系统挂 = 整个 SDK 都不能用,**问题没法独立发生** |
| 实施工作 | 5 个 commit,新表 + 新文件 + multipart + UI | **2 个 commit,1 个新字段 + 1 个 UI** |
| 行业范式 | ChatGPT custom GPT(大公司 SaaS 场景) | **Cursor 早期 / Claude Code / Continue.dev**(开发者工具范式) |

我们处在 **pre-P3 单机阶段**,产品是 dev tool 而不是 SaaS。直读是对的。
等 P3 沙箱化、多租户起来时再讨论"上传 + 中央向量库"——那时候用户的 Obsidian 不在沙箱里,直读会失效,届时再升级到 RAG **依然成立**,不浪费这次工作(切换点清晰)。

---

## 2. 用户故事

1. 我登录,左侧栏出现 **"知识库"** 入口
2. 进去就一个超简单的页面:**"我的 vault 在哪?"** + 文本框 + 测试按钮
3. 我填 `/Users/xiaoqin/Obsidian/MainVault`(或选多个 path,每个带个名字标签),点保存
4. 点"测试"会跑一下 `ls` + 显示前 20 个 .md 文件名,确认目录可读
5. 我去 Agent 市场编辑某个模板,看到 **☑ 启用知识库**,勾上
6. 我在 Conversations 问:"我之前在哪条笔记里写过 retention 的策略?"
   → agent 自动用 `Grep` 在 vault 里搜 `retention` → 找到 `.md` 文件 → `Read` 读出来 → 答出来,**带文件路径引用**(因为 system prompt 让它带)
7. 我在 Obsidian 里改完那条笔记,**下次聊天 agent 看到的就是最新内容**(无需任何同步操作)

**不做**:上传 PDF、chunking、embedding、vector search、跨平台同步

---

## 3. 技术方案

### 3.1 schema(1 张表,极简)

```sql
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,            -- 用户给的标签,如 "主 vault" / "工作笔记"
  path        TEXT NOT NULL,            -- 绝对路径,如 /Users/xiaoqin/Obsidian/MainVault
  read_only   INTEGER NOT NULL DEFAULT 1, -- v1 强制只读,不让 agent 改 vault
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_tenant ON knowledge_sources (tenant_id);
```

### 3.2 server-store.ts(3 个函数)

```ts
export function listKnowledgeSources(tenantId: string): KnowledgeSource[];
export function replaceKnowledgeSources(tenantId: string, sources: Array<Partial<KnowledgeSource>>): KnowledgeSource[];
export function testKnowledgeSource(path: string): {
  ok: boolean;
  reason?: string;     // "目录不存在" / "无读取权限" / "路径不在允许范围"
  fileCount?: number;
  sampleFiles?: string[];  // 前 20 个 .md 文件名
};
```

`testKnowledgeSource` 校验:
- 路径存在且是目录
- 进程对它有读权限
- **路径必须在 allowlist 内**(防滥用,见 §3.5)

### 3.3 runAgent 集成(server-agent.ts 改 ~15 行)

```ts
// 启用知识库时,把 vault path 通过两种方式让 agent 知道:
//   1. additionalDirectories:让 SDK 的 Read/Glob/Grep 可以访问这些路径
//   2. systemPrompt 追加一段说明,引导 agent 主动用这些路径

if (opts.useKnowledge) {
  const sources = listKnowledgeSources(opts.tenantId).filter(s => s.enabled);
  if (sources.length > 0) {
    options.additionalDirectories = sources.map(s => s.path);
    const knowledgeNote = [
      '你可以访问以下用户知识来源(只读):',
      ...sources.map(s => `- "${s.name}": ${s.path}`),
      '回答涉及个人知识时,**主动**用 Glob(找文件)+ Grep(全文搜索)+ Read(读内容)三件套去检索。',
      '引用时给出相对路径和 markdown 段落标题。Obsidian 风格的 [[wikilink]] 和 #tag 可以直接 grep。',
    ].join('\n');
    options.systemPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${knowledgeNote}`
      : knowledgeNote;
  }
}
```

注:`additionalDirectories` 是 SDK ClaudeAgentOptions 的字段,需要确认实际命名(查 sdk.d.ts);若 SDK 不直接支持,fallback 方案见 §3.6。

### 3.4 server.ts 端点(3 个)

```ts
app.get('/api/knowledge/sources', authMiddleware, (req, res) => {
  res.json(listKnowledgeSources(req.auth.tenantId));
});

app.put('/api/knowledge/sources', authMiddleware, requireAdmin, (req: any, res) => {
  const saved = replaceKnowledgeSources(req.auth.tenantId, Array.isArray(req.body) ? req.body : []);
  audit(req.auth.tenantId, 'replace_knowledge_sources', req.auth.sub, 'user', `knowledge:${req.auth.tenantId}`, { count: saved.length });
  res.json(saved);
});

app.post('/api/knowledge/sources/test', authMiddleware, (req: any, res) => {
  const path = String(req.body?.path || '').trim();
  if (!path) { res.status(400).json({ error: 'need path' }); return; }
  res.json(testKnowledgeSource(path));
});
```

### 3.5 路径 allowlist(简单安全)

**问题**:不能让用户填 `/etc` 或 `~/.ssh` 当 vault。
**做法**:env `AGENTMA_KNOWLEDGE_ROOT_ALLOWLIST`(冒号分隔的允许根目录),默认 `~/Documents:~/Obsidian:~/Notes`。`testKnowledgeSource` 和保存时校验 `path` 必须**前缀匹配**其中之一(realpath 后比较)。
不在允许范围:返回 `reason: '路径不在允许范围,请联系管理员加白名单'`。

### 3.6 SDK `additionalDirectories` 不可用时的 fallback

如果 SDK 没有这个字段(或行为不符合预期),fallback 用 MCP wrap 做"vault-only 工具集":

```ts
function buildKnowledgeMcp(sources: KnowledgeSource[]) {
  return createSdkMcpServer({
    name: 'knowledge',
    version: '1.0.0',
    tools: [
      tool('list_vault_files', '...', { source?: z.string(), pattern?: z.string() }, async (args) => {
        // glob 限制在 source.path 内
      }),
      tool('grep_vault', '...', { query: z.string(), source?: z.string() }, async (args) => {
        // ripgrep 或 fs 遍历,限制在 source.path 内
      }),
      tool('read_vault_file', '...', { path: z.string() }, async (args) => {
        // 检查 args.path 是不是任意 source.path 的子路径,否则拒绝
      }),
    ],
  });
}
```

这种 wrap 也防止 agent 用 Read 跳出 vault。**v1 优先用 `additionalDirectories`,验证不通过再切 fallback**。

---

## 4. 前端

### 4.1 新页 `src/pages/Knowledge.tsx`(参考 Permissions.tsx 风格,但更简单)

- 顶部一段说明文本:"这里配置 agent 可以读取的本地文件夹。建议指向你的 Obsidian vault 或 markdown 笔记目录。"
- 表格:`name` / `path` / 启用开关 / `[测试]` 按钮 / `[删除]` / `[+ 添加]`
- 点 `[测试]`:POST `/api/knowledge/sources/test`,展示 `ok / fileCount / sampleFiles` 或 `reason`
- 点保存:PUT `/api/knowledge/sources`

### 4.2 Sidebar 入口

`Sidebar.tsx` 的"核心"分组里加:
```ts
{ path: '/knowledge', label: '知识库', icon: '📚' },
```

### 4.3 路由

`App.tsx` 路由表加 `<Route path="/knowledge" element={<Knowledge />} />`。

### 4.4 Agents 模板编辑器

加一个 checkbox:
```tsx
<label>
  <input type="checkbox" checked={form.useKnowledge}
         onChange={e => setForm({...form, useKnowledge: e.target.checked})} />
  启用知识库(agent 可以读取你配置的本地文件夹)
</label>
```

`AgentTemplate` 类型(`src/simulator/types.ts`)加 `useKnowledge?: boolean;`。
请求体里透传给 `/api/chat` 的 template 字段。

### 4.5 聊天里(可选,**v1 不做**)

如果 agent 引用了文件路径,变成可点击复制按钮。v1 跳过。

---

## 5. Smoke test(`smoke-knowledge.mjs`)

```
1. register 新租户
2. 在 /tmp/agentma-smoke-vault-${ts}/ 创建几个 .md 文件,其中一个含独特字符串 "SMOKE_SECRET_${ts}_42"
3. PUT /api/knowledge/sources [{name:'smoke', path: vaultPath, enabled: true}]
4. POST /api/knowledge/sources/test → expect ok=true, fileCount > 0
5. POST /api/chat:
     - template: { useKnowledge: true, tools: ['Read','Grep','Glob'] }
     - messages: [{role:user, content:"What does the file say about 'SECRET'? Use grep first."}]
6. stream:
     - expect 看到 🔧 Grep(... SECRET ...)
     - expect 看到 🔧 Read(.../file.md)
     - expect 最终 final 含 "42"
7. teardown: rm -rf /tmp/agentma-smoke-vault-${ts}
```

判定项:
- `sourcesSaved`
- `testReturnsOk`
- `agentCalledGrep`(stream 里出现 mcp__custom__... 或 Grep tool_use)
- `agentCalledRead`
- `agentAnswerHasSecret`(模型最终回答含 "42")

---

## 6. allowlist 默认值 + 配置文档

**默认值**(`AGENTMA_KNOWLEDGE_ROOT_ALLOWLIST` 未设时):
```
$HOME/Documents:$HOME/Obsidian:$HOME/Notes:$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents
```
最后一个是 macOS iCloud Drive 下 Obsidian 同步目录的默认位置。

`docs/KNOWLEDGE_SETUP.md`(新建)写一段:
- 默认允许哪些目录
- 怎么改 allowlist
- 怎么找你的 Obsidian vault 路径
- 多个 vault 怎么配
- 注意:agent 默认只读,不会改你的笔记

---

## 7. 完成判据

1. Knowledge 页加上去了,能保存 source、点测试有反馈
2. Agent 模板勾上启用,聊天里问跟笔记内容相关的问题,**agent 真发起 Grep/Read** 并答出
3. 没勾启用的 agent,**看不到** vault(不会出现在 init 事件的 cwd 列表里)
4. `npm run build` 严格通过
5. `smoke:knowledge` 5/5 全 true
6. 现有 7 个 smoke(chat-write / chat-resume / chat-session-fork / hook-rules / hook-runtime / permission-rules / 任何新增)全保持通过

---

## 8. 拆 commit(2 个,简单)

```
1) feat(knowledge): tenant knowledge sources schema + API + path allowlist
   - server-store.ts: knowledge_sources 表 + 函数
   - server.ts: 3 个 /api/knowledge/sources/* 端点
   - allowlist 环境变量 + 默认值
   - smoke 占位

2) feat(knowledge): runAgent 注入 vault + Knowledge UI + 模板 useKnowledge
   - server-agent.ts: additionalDirectories 或 fallback MCP wrap + systemPrompt 追加
   - src/pages/Knowledge.tsx + sidebar 入口 + 路由
   - Agents.tsx: useKnowledge checkbox
   - types.ts: AgentTemplate.useKnowledge
   - smoke-knowledge.mjs 完整(5 个判定)
   - docs/KNOWLEDGE_SETUP.md
```

**禁止合一坨**。

---

## 9. 给 GPT 的交付要求

参考 [PLAN-fix-duplicate-stream-message.md](PLAN-fix-duplicate-stream-message.md) 的 brief 模板要求:
1. 完整 `git diff --stat HEAD` 粘贴
2. 每个新增 untracked 路径解释
3. 上面 §7 的 6 个完成判据**逐条对应说明 ✅/❌**
4. 任何范围外的额外改动 → 列出
5. SDK 那个 `additionalDirectories` 字段实际叫什么 / 有没有,**先查 sdk.d.ts 给出结论再开干**;如果不存在,直接走 §3.6 的 MCP fallback,不要等问

---

## 10. 与未来 P3 RAG 的衔接(写明,不在本 PLAN 范围)

P3 沙箱化之后,vault 在用户 Mac 上、agent 在云沙箱里,**直读会失效**。届时:

- 选项 A:把 vault 同步进沙箱(rclone 之类),延续 Obsidian 直读
- 选项 B:上 RAG(回到我废弃的那版 PLAN),沙箱启动时下载 embedding + 切片到沙箱内
- 选项 C:vault 在 host 上跑一个本地 MCP server,沙箱通过 SSE/WS 调用,host 充当 vault 代理

3 选 1 留到 P3 时决定。本次 PLAN **不为这个未来场景做任何前置工作**,因为切换成本可控,而提前抽象会显著拖慢当前交付。
