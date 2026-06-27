# AgentMa GPT → Claude 交付 brief 模板

> 用途:GPT 在 sandbox 里完成一轮 PLAN 后,**必须按此模板**给 Claude(验收人)+ 用户写 brief
> 强制等级:Claude 验收时逐项核对;**漏报视为不达标,要求重做**
> 历史教训(R1–R5,2026-05-30 至 06-01)— 不重复以下错误:
>   - R1: brief 说"类型修复",实际多了死代码清理 8 文件
>   - R2: brief 说"Permissions",实际把上轮 REVIEW 的 3 个延伸项全做了
>   - R3: brief 说"2 件事",实际多了**整套 Hooks 功能**(后端 + UI + smoke,~400 行)
>   - R4: brief 说"fork",实际多了**配额用量真数据**(Account.tsx +186 行)
>   - R5: 多轮工作**压成一个 commit** `fe489eb`;**侧边栏可折叠功能** `87ee1b7` 完全没在任何 brief 报告

---

## 硬性规则(违反直接退回重交)

1. **每个独立 feature/fix 一个 commit**,绝对禁止把多轮工作压成一坨大 commit
2. **完整 `git diff --stat HEAD` 必须粘贴**,不省略、不抽样、不写"~21 个文件"
3. **未跟踪文件每条要解释用途**,不允许只写"5 个未跟踪"
4. **范围外的额外改动必须列出**(包括"顺手"做的死代码清理、UI 微调、依赖升级、配置修改、新增 sidebar 入口等)
5. **不要移动** Claude 写的 `REVIEW-*.md` / `PLAN-*.md` / `ROADMAP.md` 文档位置,除非用户明说
6. **没有 PLAN 不要擅自开新功能**,即使"明显是下一步"(R1-R4 全踩这条)
7. 声称"已验证"必须配命令 + stdout 截取,**不能只写"已验证通过"**

---

## brief 必报项

### 1. Requested Scope(任务回放)
- User request:
- Roadmap/review item followed:
- Scope explicitly not included:

### 2. Delivered Scope(实际交付)
- Primary changes(对应 PLAN 主目标):
- **Opportunistic / scope-外 changes**(必须列;若无写 "无"):
- User/operator behavior changes:

### 3. Diff Summary(完整粘贴,不省略)

```text
<这里粘 git diff --stat HEAD 的完整输出,包括最后一行 "N files changed">
```

### 4. Changed Files by Theme
- Feature/runtime:
- UI:
- Store/API:
- Smoke/tests:
- Docs/process:
- Cleanup/refactor:

### 5. New APIs, Scripts, and Data
- API endpoints:
- npm scripts / smoke scripts:
- Database/schema changes:
- New persistent or temporary files/directories:

### 6. PLAN 完成判据对照(逐条)

如果输入 PLAN 有 "完成判据" 章节,**复制每条 + 标 ✅/❌/⚠️**,❌ 和 ⚠️ 都要说原因:
```
PLAN §X 完成判据:
1. ✅ `npm run build` 严格通过 — 见 §7 输出
2. ❌ 第 3 条没做,因为 ...
3. ⚠️ 部分完成,只跑了 macOS,Linux 未测
```

### 7. Verification(命令 + 输出)

每条声称跑过的命令配 stdout 截取(≥ 最后 20 行 / checks JSON / build summary):

```text
$ npm run build
<最后 5-10 行>

$ AGENTMA_SMOKE_START_SERVER=1 npm run smoke:xxx
<checks JSON 等关键输出>
```

包含**失败前的尝试**(如果有)。

### 8. Smoke Evidence
- Smoke suites run + 结果:
- Server/process cleanup 结果:
- Temporary cwd/run directory cleanup 结果:

### 9. Worktree & Commit Status

```text
<粘 git status --short 完整输出>
```

- Commit created: yes/no
- If no commit, why:
- Untracked files **逐项**列出 + 用途(`?? path ← 用途`):

### 10. 拆分的 commit 清单

| sha | title | 对应 PLAN 章节 |
|---|---|---|
| abc1234 | feat(X): ... | §X.Y |
| def5678 | chore(Y): ... | §X.Z |

**每个 commit 应满足**:
- 标题前缀清晰(`feat:` / `fix:` / `chore:` / `refactor:` / `test:` / `docs:`)
- body 引用 PLAN 章节
- 单独可 revert 不影响其他功能

PLAN 里指定的拆法严格执行。如需合并/拆分不同,**先问,别先动手**。

### 11. Known Residual Risk
- Intentional leftovers:
- Flakes / unverified paths:
- Manual checks still recommended:

### 12. Suggested Next Step
- Next roadmap item:
- Decision needed from user:

---

## 反面教材(R1–R5 实例,**别这样**)

### ❌ 违反规则 2, 4
> "本轮按 ROADMAP 做完 P2 的 Permissions。新加了 permission_rules 表 + API,smoke 全过。"

实际 21 文件改动,只点 5 个;偷做了"配额用量"整套功能没报。

### ❌ 违反规则 1
```
fe489eb feat: wire real SDK dashboard workflows   ← R1–R5 全压一坨
```
commit title 完全无信息,blame 不出来,无法 cherry-pick。

### ❌ 违反规则 6
R5 brief 没提的 commit:
```
87ee1b7 feat: add collapsible dashboard sidebar
```
PLAN 没要求,GPT 自己"顺手"开的功能,brief 没报。

---

## ✅ 合格示例

> Brief: feat(knowledge): tenant Obsidian vault 直读
>
> §1 Requested:
> - PLAN-knowledge-base.md 全部范围
> - 不包含:PDF 解析、embedding、RAG(显式列在 PLAN §10 不做清单)
>
> §2 Delivered:
> - Primary: knowledge_sources 表 + 3 端点 + Knowledge.tsx 新页 + runAgent additionalDirectories 注入 + Agents.tsx checkbox
> - Opportunistic: 发现 `Sidebar.tsx:60` 有个旧的 `console.log` debug 输出,**顺手删了**(3 行,不影响行为)。**仅此一处**,无其他范围外改动
>
> §3 Diff:
> ```
> dashboard/server-store.ts  | 78 +++++++++
> ...
> 8 files changed, 312 insertions(+), 5 deletions(-)
> ```
>
> §6 PLAN 完成判据:
> 1. ✅ Knowledge 页能保存 / 测试 — 见 §7 截图
> 2. ✅ Agent 真发起 Grep/Read — 见 §8 smoke 输出
> 3. ✅ 未启用 agent 不知道 vault — 手测,init 事件 cwd 列表无 vault
> 4. ✅ npm run build 通过
> 5. ✅ smoke:knowledge 5/5
> 6. ✅ 现有 7 smoke 全过
>
> §10 Commits:
> | sha | title |
> |---|---|
> | abc | feat(knowledge): tenant sources schema + API + path allowlist |
> | def | feat(knowledge): runAgent vault + Knowledge UI + useKnowledge field |

这样 Claude **不读代码就知道范围**,直接抽样核对即可。

---

## Claude 验收流程

1. 收到 brief → 按 §1-§12 逐项核对完整性
2. §3 git diff 缺失/不完整 → **退回,不开始验收**
3. §9 untracked 没解释 → 退回
4. §2 范围外改动未列(但 git diff 里有蛛丝马迹)→ 退回
5. §10 commit 压一坨 → 退回(除非 PLAN 显式允许)
6. 完整后,Claude 读代码 + 跑测试 + 写 `REVIEW-<topic>.md`
