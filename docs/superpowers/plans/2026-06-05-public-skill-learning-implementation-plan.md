# 公共技能学习实施计划

设计依据：[公共技能学习设计](../specs/2026-06-05-public-skill-learning-design.md)

## 目标边界

实现公共技能的“学习即复制”第一版：

- 公共技能不支持引用，不直接启用，不进入 agent 运行时。
- 用户点击“学习技能”后，公共技能包复制到用户技能背包。
- 学习后的技能是 `location: "user"` 的可编辑副本。
- 公共技能后续更新不影响已学习副本。
- 保留现有 GitHub 导入和 Workspace 抽取行为。

## 改动顺序

### 1. 后端数据模型

文件：

- `dashboard/server-store.ts`
- `dashboard/server.ts`
- `dashboard/src/simulator/types.ts`

实现：

1. 新增公共技能类型和学习来源类型：
   - `PublicSkill`
   - `LearnedSkillMetadata`
   - 扩展 `SkillInfo` 的可选来源字段。
2. 在 SQLite 中新增公共技能目录表：
   - `public_skills`
   - 字段包含 `id`、`slug`、`name`、`description`、`author_sub`、`author_tenant_id`、`revision`、`bundle_path`、`published_at`、`updated_at`。
3. 新增已学习技能来源表：
   - `learned_skills`
   - 字段包含 `tenant_id`、`owner_sub`、`skill_name`、`skill_path`、`public_skill_id`、`public_revision`、`learned_at`。
4. 公共技能包保存到 AgentMa 数据目录下的 `public-skills/<id>/rev-<revision>/`。

注意：

- 第一版仍沿用当前 `USER_SKILLS_DIR` 作为技能安装目录。
- `learned_skills` 只用于归因、审计和 UI 展示，不代表同步关系。

### 2. 后端复制与发布逻辑

文件：

- `dashboard/server.ts`

实现：

1. 抽出可复用的技能校验和安全复制 helper：
   - 校验 `SKILL.md` 文件存在。
   - 校验 frontmatter 中的 `name` 和 `description`。
   - 禁止符号链接。
   - 复用文件数量和总大小限制。
   - 使用临时目录加原子 rename。
2. 发布公共技能：
   - 从用户背包技能路径读取技能包。
   - 复制到公共技能存储目录。
   - 首次发布创建 `public_skills` 记录，revision 从 `1` 开始。
   - 更新公共技能时创建新 revision，并更新当前 `bundle_path`。
   - 发布和更新都写 audit。
3. 学习公共技能：
   - 读取当前公共技能 revision 的 bundle。
   - 复制到 `USER_SKILLS_DIR/<normalized-name>`。
   - 同名冲突返回 `409`。
   - 成功后写入 `learned_skills` 归因记录。
   - 返回一个 `SkillInfo`，其中 `location` 为 `"user"`，并带来源元数据。

### 3. 后端 API

文件：

- `dashboard/server.ts`
- `dashboard/docs/api.md`

实现接口：

- `GET /api/skills/public`
- `GET /api/skills/public/:id`
- `POST /api/skills/public/:id/learn`
- `POST /api/skills/public`
- `PATCH /api/skills/public/:id`

权限：

- 列表、详情、学习：登录用户可用。
- 发布、更新：第一版要求 `requireAdmin`。

请求约定：

- 发布接口接收用户背包中的技能路径或技能名。
- 学习接口可选接收 `nameOverride`，用于解决同名冲突。
- API 不提供“引用公共技能”的字段。

### 4. 前端 Skills 页面

文件：

- `dashboard/src/pages/Skills.tsx`
- `dashboard/src/simulator/types.ts`
- `dashboard/src/App.css`

实现：

1. 把页面拆成两个一级视图：
   - `我的技能背包`
   - `公共技能`
2. 我的技能背包：
   - 保留现有技能列表、启用/停用、GitHub 导入、Workspace 抽取。
   - 展示从公共技能学习来的来源归因。
   - 为背包技能增加“发布到公共空间”入口。
3. 公共技能：
   - 调用公共技能列表 API。
   - 展示名称、描述、作者、revision。
   - 主按钮为“学习技能”。
   - 不展示“启用”或“使用”。
4. 学习流程：
   - 成功后把返回的 `SkillInfo` 加入背包列表。
   - 同名冲突时提示用户输入新名称，再用 `nameOverride` 重试。
   - 学习完成后切回或提示查看“我的技能背包”。

### 5. 测试

文件：

- `dashboard/scripts/smoke-skills-public.mjs`
- 需要时补充服务端 helper 单元脚本。

验证：

1. 发布一个测试技能到公共空间。
2. 列出公共技能，确认能看到该技能。
3. 学习该技能，确认返回 `location: "user"`。
4. 修改公共技能并更新 revision。
5. 确认已经学习的用户副本内容不变。
6. 重复学习同名技能，确认返回 `409`。
7. 使用 `nameOverride` 后学习成功。

运行命令：

```bash
cd dashboard
npm run typecheck
node scripts/smoke-skills-public.mjs
```

如果当前项目没有 `typecheck` 脚本，就使用现有等价的 TypeScript 校验或 `npx tsc --noEmit`。

### 6. 提交拆分

按下面顺序提交，避免把市场功能压成一个大包：

1. `feat(skills): add public skill store and APIs`
2. `feat(skills): add public learning UI`
3. `test(skills): cover public learning flow`
4. `docs(skills): document public skill APIs`

## 验收标准

- 公共技能页面没有“引用”“启用”“使用”公共技能的入口。
- 点击“学习技能”后，技能进入我的技能背包。
- 学习后的技能可编辑，并显示为用户级技能。
- 更新公共技能不会改变已经学习的副本。
- 同名冲突有明确错误和改名重试路径。
- smoke 测试覆盖发布、学习、隔离、冲突和改名学习。
