/* ════════════════════════════════════════════════════════════
   agentma · realistic seed data (zh-CN)
   Mirrors the real backend shapes: agent templates, chat sessions,
   tools, skills, hooks, permissions, mcp servers, observability.
   ════════════════════════════════════════════════════════════ */
window.DATA = {
  user: { name: '陈墨', email: 'mo.chen@dandelion.work', initial: '墨', plan: '团队版', tenant: '蒲公英智能' },

  nav: [
    { group: '核心', items: [
      { id: 'conversations', label: '会话',        icon: 'chat', count: '12' },
      { id: 'agents',        label: 'Agent 市场',  icon: 'market', count: '7' },
      { id: 'skills',      label: '技能背包',   icon: 'spark', count: '10' },
      { id: 'knowledge',   label: '知识库',     icon: 'book' },
    ]},
    { group: '运维', items: [
      { id: 'overview',      label: '总览',        icon: 'overview' },
      { id: 'playground',    label: 'Playground',  icon: 'play' },
      { id: 'settings',      label: '全局设置',    icon: 'gear' },
      { id: 'tools',         label: '工具背包',    icon: 'tools', count: '24' },
      { id: 'hooks',         label: 'Hook 系统',   icon: 'hook', count: '6' },
      { id: 'subagents',     label: '子代理',      icon: 'agents', count: '7' },
      { id: 'permissions',   label: '权限系统',    icon: 'shield' },
      { id: 'observability', label: '可观测性', icon: 'chart' },
    ]},
  ],

  models: [
    { value: 'claude-opus-4-7',   name: 'Claude Opus 4.7' },
    { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5' },
    { value: 'deepseek-v4-pro',   name: 'DeepSeek V4 Pro [1m]' },
  ],

  agents: [
    { id: 'a-review', name: '代码审查官', desc: '审查 PR 变更，盯安全、性能与代码味道。只读 — 不碰你的分支。',
      model: 'claude-sonnet-4-6', tools: ['Read','Grep','Glob','Bash'], skills: ['code-review'], mcp: ['github'],
      effort: 'high', perm: 'plan', runs: 342, status: 'good', accent: false },
    { id: 'a-docs', name: '文档撰写者', desc: '从代码生成 API 文档和注释。语气克制，不写废话。',
      model: 'claude-sonnet-4-6', tools: ['Read','Write','Edit','Glob'], skills: ['api-doc-gen','docx'], mcp: [],
      effort: 'medium', perm: 'acceptEdits', runs: 128, status: 'good', accent: false },
    { id: 'a-test', name: '测试工程师', desc: '为核心模块写单元 + 集成测试。后台跑，跑完报数。',
      model: 'claude-haiku-4-5', tools: ['Read','Write','Edit','Bash'], skills: [], mcp: [],
      effort: 'medium', perm: 'acceptEdits', runs: 96, status: 'good', accent: false },
    { id: 'a-mc', name: 'Minecraft 守夜人', desc: '挂在服务器上，玩家一说话它就回。半夜也不睡。',
      model: 'claude-haiku-4-5', tools: ['Read','Bash'], skills: [], mcp: ['mineflayer'],
      effort: 'low', perm: 'default', runs: 1804, status: 'warn', accent: true },
    { id: 'a-migrate', name: '数据迁移助手', desc: '生成并校验数据库迁移脚本。上线前最后一道关。',
      model: 'claude-opus-4-7', tools: ['Read','Write','Edit','Bash','Grep'], skills: ['db-migration'], mcp: ['postgres'],
      effort: 'xhigh', perm: 'default', runs: 41, status: 'bad', accent: false },
    { id: 'a-research', name: '调研员', desc: '搜网、读网页、整理成结构化输出。给产品同学省一下午。',
      model: 'claude-sonnet-4-6', tools: ['WebSearch','WebFetch','Write','Read'], skills: [], mcp: [],
      effort: 'high', perm: 'default', runs: 215, status: 'good', accent: false },
    { id: 'a-i18n', name: '本地化助手', desc: '提取文案、翻译、回填。中英日三语，术语表对齐。',
      model: 'claude-haiku-4-5', tools: ['Read','Write','Edit','Glob','Grep'], skills: ['i18n-helper'], mcp: [],
      effort: 'low', perm: 'acceptEdits', runs: 67, status: 'idle', accent: false },
  ],

  sessions: [
    { id: 's1', title: '重构 formatDate 支持 locale', agent: '代码审查官', msgs: 14, when: '12 分钟前', pinned: true, status: 'good' },
    { id: 's2', title: '为 auth 中间件补单测', agent: '测试工程师', msgs: 22, when: '1 小时前', pinned: true, status: 'good' },
    { id: 's3', title: '凌晨 3 点它想连生产 Stripe', agent: '数据迁移助手', msgs: 8, when: '今天 03:12', pinned: false, status: 'bad' },
    { id: 's4', title: '生成 v2 API 文档', agent: '文档撰写者', msgs: 31, when: '昨天', pinned: false, status: 'good' },
    { id: 's5', title: 'Minecraft 玩家求路线', agent: 'Minecraft 守夜人', msgs: 56, when: '昨天', pinned: false, status: 'warn' },
    { id: 's6', title: '调研竞品定价页', agent: '调研员', msgs: 12, when: '2 天前', pinned: false, status: 'good' },
    { id: 's7', title: '订单表加索引的迁移', agent: '数据迁移助手', msgs: 9, when: '3 天前', pinned: false, status: 'good' },
    { id: 's8', title: '把设置页文案翻成日语', agent: '本地化助手', msgs: 18, when: '上周', pinned: false, status: 'good' },
  ],

  tools: [
    { name: 'Read', desc: '读取文件内容', cat: '文件', builtin: true, on: true },
    { name: 'Write', desc: '写入文件', cat: '文件', builtin: true, on: true },
    { name: 'Edit', desc: '精确替换编辑文件', cat: '文件', builtin: true, on: true },
    { name: 'Glob', desc: '按模式搜索文件', cat: '搜索', builtin: true, on: true },
    { name: 'Grep', desc: '搜索文件内容', cat: '搜索', builtin: true, on: true },
    { name: 'Bash', desc: '执行 shell 命令', cat: '执行', builtin: true, on: true },
    { name: 'WebSearch', desc: '搜索网页', cat: '搜索', builtin: true, on: true },
    { name: 'WebFetch', desc: '获取网页内容', cat: '搜索', builtin: true, on: false },
    { name: 'Agent', desc: '生成子代理执行复杂任务', cat: '代理', builtin: true, on: true },
    { name: 'Skill', desc: '调用技能', cat: '代理', builtin: true, on: true },
    { name: 'mineflayer-chat', desc: '向 Minecraft 机器人发消息', cat: 'MCP · mineflayer', builtin: false, on: true },
    { name: 'mineflayer-move', desc: '让机器人移动或跟随玩家', cat: 'MCP · mineflayer', builtin: false, on: true },
    { name: 'mineflayer-status', desc: '查看血量 / 饥饿 / 位置 / 装备', cat: 'MCP · mineflayer', builtin: false, on: true },
    { name: 'create_issue', desc: '在 GitHub 创建 Issue', cat: 'MCP · github', builtin: false, on: true },
    { name: 'search_code', desc: '搜索仓库代码', cat: 'MCP · github', builtin: false, on: true },
  ],

  mcp: [
    { name: 'filesystem', status: 'connected', version: '1.0.0', tools: 2, note: '本地文件读写' },
    { name: 'github', status: 'connected', version: '0.2.1', tools: 2, note: 'Issue · 代码搜索' },
    { name: 'mineflayer', status: 'connected', version: '0.4.0', tools: 8, note: 'Minecraft 机器人桥接' },
    { name: 'postgres', status: 'failed', version: '2.0.0', tools: 0, note: 'Connection refused' },
    { name: 'slack', status: 'needs-auth', version: '1.5.0', tools: 0, note: '等待 OAuth 授权' },
    { name: 'jira', status: 'disabled', version: '3.1.0', tools: 0, note: '已停用' },
  ],

  skills: [
    { name: 'pdf', desc: '处理和解析 PDF 文档', loc: '用户', path: '~/.claude/skills/pdf/', on: true },
    { name: 'docx', desc: '读写 Word 文档 (.docx)', loc: '用户', path: '~/.claude/skills/docx/', on: true },
    { name: 'xlsx', desc: '读写 Excel 电子表格', loc: '用户', path: '~/.claude/skills/xlsx/', on: false },
    { name: 'pptx', desc: '创建和编辑 PPT 演示文稿', loc: '用户', path: '~/.claude/skills/pptx/', on: false },
    { name: 'code-review', desc: '自动化代码审查助手', loc: '项目', path: '.claude/skills/code-review/', on: true },
    { name: 'i18n-helper', desc: '国际化翻译辅助工具', loc: '项目', path: '.claude/skills/i18n-helper/', on: true },
    { name: 'api-doc-gen', desc: '从代码生成 API 文档', loc: '项目', path: '.claude/skills/api-doc-gen/', on: true },
    { name: 'db-migration', desc: '数据库迁移脚本生成器', loc: '项目', path: '.claude/skills/db-migration/', on: false },
    { name: 'docker-helper', desc: 'Docker 容器管理助手', loc: '插件', path: '~/.claude/plugins/docker/', on: true },
    { name: 'git-assistant', desc: 'Git 工作流辅助', loc: '插件', path: '~/.claude/plugins/git/', on: true },
  ],

  hooks: [
    { event: 'PreToolUse', cat: '工具', desc: '工具调用前触发', script: 'guard/allowlist.sh', on: true, runs: 1240 },
    { event: 'PostToolUse', cat: '工具', desc: '工具调用成功后触发', script: 'audit/log.ts', on: true, runs: 1198 },
    { event: 'PermissionRequest', cat: '工具', desc: '权限请求时触发', script: 'guard/notify-slack.ts', on: true, runs: 47 },
    { event: 'SessionStart', cat: '会话', desc: '会话启动时触发', script: 'setup/load-context.sh', on: true, runs: 312 },
    { event: 'PreCompact', cat: '会话', desc: '上下文压缩前触发', script: '—', on: false, runs: 0 },
    { event: 'SubagentStop', cat: '代理', desc: '子代理停止时触发', script: 'report/summarize.ts', on: true, runs: 88 },
  ],

  perms: [
    { rule: 'Write(src/**)', mode: 'allow', note: '允许写入源码目录' },
    { rule: 'Bash(git commit:*)', mode: 'allow', note: '允许提交' },
    { rule: 'Bash(rm -rf:*)', mode: 'deny', note: '永远拦截危险删除' },
    { rule: 'WebFetch(*.stripe.com)', mode: 'deny', note: '禁止触碰支付域名' },
    { rule: 'Write(.env*)', mode: 'ask', note: '碰密钥文件必须问' },
    { rule: 'Bash(npm publish:*)', mode: 'ask', note: '发版需人工确认' },
  ],
  permModes: [
    { value: 'default', label: '默认', desc: '每次操作都询问确认' },
    { value: 'acceptEdits', label: '接受编辑', desc: '自动批准文件编辑' },
    { value: 'plan', label: '规划模式', desc: '只读，不执行修改' },
    { value: 'bypassPermissions', label: '绕过权限', desc: '跳过所有检查 · 高风险' },
  ],

  subagents: [
    { name: 'general-purpose', desc: '通用代理，处理各种任务' },
    { name: 'Explore', desc: '只读代码探索 / 搜索代理' },
    { name: 'Plan', desc: '软件架构设计代理' },
    { name: 'code-reviewer', desc: '代码审查代理' },
    { name: 'claude-code-guide', desc: 'Claude Code 使用指南专家' },
    { name: 'statusline-setup', desc: '状态行配置助手' },
    { name: 'doc-writer', desc: '技术文档撰写代理' },
  ],

  /* the conversation transcript shown on the chat screen */
  transcript: [
    { role: 'user', text: 'src/utils/date.ts 里的 formatDate 只输出 ISO，麻烦改成支持 locale，默认中文。' },
    { role: 'assistant', think: '先读一下当前实现，确认签名和调用点，再做最小改动。', steps: [
        { tool: 'Grep', input: 'formatDate · src/', result: '4 处调用 · 3 个文件', ok: true, ts: '14:02:08' },
        { tool: 'Read', input: 'src/utils/date.ts', result: '218 行 · 6.1kb', ok: true, ts: '14:02:09' },
      ],
      text: '当前实现只调用了 `toISOString()`。我会加一个 `locale` 参数(默认 `zh-CN`),用 `toLocaleDateString` 输出「年月日」。4 处调用保持向后兼容。' },
    { role: 'permission', tool: 'Edit', title: '写入 src/utils/date.ts', desc: '命中允许列表 Write(src/**) — 可直接放行', input: 'formatDate(d, locale = "zh-CN")' },
    { role: 'assistant', steps: [
        { tool: 'Edit', input: 'src/utils/date.ts', result: '−2 +4 · 已应用', ok: true, ts: '14:02:31' },
        { tool: 'Bash', input: 'npm run type-check', result: 'tsc · 0 errors', ok: true, ts: '14:02:44' },
      ],
      text: '改完了。新签名 `formatDate(d, locale = "zh-CN")`,默认输出例如 **2026年6月3日**。类型检查通过,4 处旧调用无需改动。要我顺手补个单测吗?' },
  ],
  runStats: { cost: '0.014', dur: '38.2', inTok: '12.4k', outTok: '1.8k' },
};
