/* global React */
/* ─────────────────────────────────────────────────────────
   i18n.jsx — translations for agentma landing page
   Each language exposes the SAME shape. Components consume
   the whole tree via useLang() so they don't sprinkle dot-paths.
   ───────────────────────────────────────────────────────── */
const { createContext, useContext, useState, useEffect } = React;

const I18N = {
  en: {
    code: 'en',
    label: 'EN',

    nav: {
      features: 'features',
      dashboard: 'dashboard',
      pricing: 'pricing',
      docs: 'docs',
      brand: 'brand',
      login: 'log in',
      ctaLong: 'start a',
      cta: 'sandbox',
    },

    hero: {
      eyebrow: 'AGENT MANAGEMENT · v0.1 SANDBOX OPEN',
      titleA: 'wrangle your agents',
      titleB: 'before they wrangle you.',
      ledePre: 'agentma is the control plane for your fleet of AI agents. spin them up, watch them work in real time, and pull the plug the moment one of them starts acting ',
      ledeEm: 'a little too autonomous',
      ledePost: '.',
      ctaPrimary: 'start a free sandbox →',
      ctaSecondary: 'peek at the dashboard',
      meta: ['free forever for 3 agents', 'no credit card', 'self-host on day one'],
      anno: ['← running fine', 'scary tooth', '$0.07 / call', 'kill switch ↓'],
      logosLabel: 'already corralling agents at',
    },

    problem: {
      eyebrow: 'THE OLD WAY',
      titleA: 'right now, your agents',
      titlePre: 'are ',
      titleStrike: 'unsupervised',
      titlePost: ' haunting you.',
      cards: [
        { k: '47', v: 'tabs open trying to figure out which agent spent $312' },
        { k: '0',  v: 'idea what tool your customer-support bot called at 3am' },
        { k: '1',  v: 'slack channel of people asking "is anyone running this?"' },
        { k: '∞',  v: 'logs scrolling past in three different terminals' },
      ],
    },

    features: {
      eyebrow: "WHAT'S INSIDE",
      titleA: 'three things,',
      titleEm: 'done seriously.',
      items: [
        {
          tag: '01 / ROSTER',
          title: 'see every agent',
          sub: 'on one page',
          body: 'a live grid of every agent in your org. running, idle, escaped, possessed. filter by owner, tool, model, cost. find the one that\'s burning a hole in your budget in under three seconds.',
          bullets: ['live status pings every 2s', 'tag agents by team / project', 'click any row → full session'],
        },
        {
          tag: '02 / SESSIONS',
          title: 'replay every step',
          sub: 'tool calls, prompts, costs, weird detours',
          body: 'a full timeline for every run. see exactly what the agent saw, what it decided, what it called, and what it cost. annotate runs, share replay links, and turn the worst ones into regression tests.',
          bullets: ['scrub timeline, tool-by-tool', 'diff two runs side by side', 'share read-only replay urls'],
        },
        {
          tag: '03 / GUARDRAILS',
          title: 'nothing leaves',
          sub: 'the cage',
          body: 'set hard budgets, restrict tool access, sandbox network calls, and define kill conditions. agentma will pull the plug automatically — and tell you why, in plain english, before it does.',
          bullets: ['per-agent + per-org budgets', 'allow / deny tool lists', 'auto-stop on regex match'],
        },
      ],
    },

    dashboard: {
      eyebrow: 'PRODUCT · LIVE VIEW',
      titleA: 'the dashboard',
      titleEm: 'looks like this.',
      sub: 'honest screenshot. nothing photoshopped, nothing redacted. yes, those margins look weird because that\'s what real software looks like before marketing gets ahold of it.',
      url: 'app.agentma.io / fleet',
      org: 'noxware',
      side: ['▦ fleet', '⏱ sessions', '⛓ tools', '⚿ guardrails', '≣ logs', '⌥ settings'],
      budgetLabel: "today's spend",
      budgetOf: '/ $50',
      h: 'fleet',
      agentsWord: 'agents',
      runningWord: 'running',
      empty: 'no agents match those filters — try widening the team or time range.',
      teamFilter: 'team:',
      rangeFilter: 'range:',
      teamsLabel: { all: 'all teams' },
      rangesLabel: { h1: 'last 1h', h24: 'last 24h', d7: 'last 7d', d30: 'last 30d' },
      newAgent: '+ new agent',
      headers: ['agent', 'owner', 'status', 'calls', 'spend'],
      statuses: { running: 'running', stuck: 'stuck', caged: 'caged', flagged: 'flagged' },
      anno1: 'flagged ones bubble\nto the top automatically',
      anno2: 'this one tried to call\nproduction stripe at 3am.\nguardrail caught it.',
      tailLabel: 'live tail · midnight-spider',
      tail: [
        ['12:04:21', 'tool',  'web.fetch("https://api.foo/v1/users")'],
        ['12:04:22', 'ok',    '200 · 14.2kb · $0.001'],
        ['12:04:24', 'think', 'user-table looks ok, moving on...'],
        ['12:04:28', 'tool',  'db.query("SELECT * FROM customers")'],
        ['12:04:28', 'warn',  'guardrail: too many rows, asking confirm'],
        ['12:04:30', 'stop',  'paused — waiting on maya@noxware'],
      ],
      tailPool: [
        ['tool',  'web.fetch("https://api.foo/v1/orders")'],
        ['ok',    '200 · 6.1kb · $0.001'],
        ['think', 'cross-checking with stripe...'],
        ['tool',  'stripe.charges.list(limit=50)'],
        ['ok',    'returned · $0.003'],
        ['think', 'this customer churned last month'],
        ['tool',  'slack.post(channel="#ops", msg="...")'],
        ['warn',  'rate limited — backing off 4s'],
        ['tool',  'db.query("UPDATE flags SET ...")'],
        ['warn',  'guardrail: write outside of allowlist'],
        ['stop',  'soft-stop — budget hit 80%'],
        ['ok',    'resumed · $0.002'],
        ['think', 'parsing pdf attachment...'],
        ['tool',  'pdf.read("invoice-9981.pdf")'],
      ],
      action: 'open ›',
    },

    pricing: {
      eyebrow: 'PRICING',
      titleA: 'honest pricing,',
      titleEm: 'no per-seat tax.',
      sub: 'we charge per managed agent, not per human. invite the whole team.',
      flag: '★ most popular',
      calc: {
        prefix: "i'd manage",
        suffix: 'agents',
        outFree: "you're on sandbox",
        outPaid: "you're on coven",
        outCustom: "you'd be on crypt",
        priceFree: 'free forever',
        priceCustom: "let's talk",
        priceUnit: '/ month',
      },
      tiers: [
        {
          name: 'sandbox', tag: 'for the curious',
          price: '$0', per: 'forever',
          features: ['3 agents', '7-day session history', 'community discord', 'self-host or hosted'],
          cta: 'start free →',
        },
        {
          name: 'coven', tag: 'most teams pick this',
          price: '$49', per: '/ month',
          features: ['50 agents', 'unlimited session history', 'audit log + SOC2 report', 'kill-switch SMS alerts', 'slack & pagerduty', 'email support'],
          cta: 'start 14-day trial →',
        },
        {
          name: 'crypt', tag: 'self-host or vpc',
          price: 'custom', per: 'talk to us',
          features: ['unlimited agents', 'on-prem / vpc deploy', 'SSO + SCIM', 'custom guardrail rules', 'dedicated slack channel', '99.9% SLA'],
          cta: 'book a demo →',
        },
      ],
    },

    final: {
      titleA: 'ready to stop',
      titleEm: 'winging it?',
      sub: 'spin up a sandbox in 90 seconds. no card, no call, no demo wall.',
      ctaPrimary: 'start a sandbox →',
      ctaSecondary: 'read the docs',
    },

    footer: {
      tag: 'agent management, but scary good.',
      meta: 'made in a haunted office · est 2026',
      cols: [
        { h: 'product',    l: ['fleet', 'sessions', 'guardrails', 'pricing', 'changelog'] },
        { h: 'developers', l: ['docs', 'sdk · python', 'sdk · typescript', 'cli', 'self-host'] },
        { h: 'company',    l: ['about', 'blog', 'security', 'careers (2)', 'contact'] },
      ],
      bottom: ['© 2026 agentma, inc.', 'made by people who got bit by their own agents.'],
      legal: ['privacy', 'terms', 'status'],
    },

    agent: {
      crumb1: 'fleet',
      crumb2: 'noxware',
      tag: 'AGENT',
      metaOwner: '· owner',
      metaDeployed: 'deployed 14 days ago',
      statusRunning: 'running',
      statusFlagged: 'flagged · guardrail hit',
      actionRun: '▶ resume',
      actionPause: '∥ pause',
      actionKill: 'kill',

      kpi: {
        cost: 'spend (24h)',
        costSub: 'vs. 7-day avg $1.37',
        calls: 'tool calls',
        callsSub: 'across 6 sessions',
        latency: 'p50 latency',
        latencySub: 'tool call → ok',
        success: 'success rate',
        successSub: 'sessions ending ok',
      },

      chart: {
        title: '24h cost — hourly',
        normal: 'normal',
        spike: 'spike',
      },

      sessions: {
        title: 'recent sessions',
        count: '6 · last 24h',
        calls: 'calls',
      },

      timeline: {
        title: 'session timeline',
        replay: '▶ replay',
        diff: '→← diff',
        share: '⏎ share',
        openHint: 'click for details',
        kinds: {
          start: 'start',
          think: 'think',
          tool:  'tool',
          ok:    'ok',
          warn:  'guardrail',
          stop:  'paused',
        },
      },

      drawer: {
        req: 'request',
        res: 'response',
        meta: 'metadata',
        empty: '(no body captured)',
        copy: 'copy as cURL',
        rerun: '↻ re-run as test',
        metaKeys: {
          tool: 'tool',
          time: 'timestamp',
          duration: 'duration',
          bytes: 'bytes',
          cost: 'cost',
          guardrail: 'guardrail',
          passed: 'passed',
        },
      },

      statuses: {
        ok: 'ok',
        warn: 'stuck',
        off: 'off',
        bad: 'flagged',
        paused: 'paused',
      },

      guards: {
        title: 'guardrails',
        budget: 'budget cap',
        toolAllow: 'tool allowlist',
        allowed: 'allowed',
        network: 'network',
        sandboxed: 'sandboxed',
        regex: 'output regex',
        rules: 'rules',
        killSwitch: 'kill switch',
        armed: 'armed',
        humanLoop: 'human-in-the-loop',
        lt: '>',
        rows: 'rows',
        edit: 'edit guardrails',
      },
    },
  },

  zh: {
    code: 'zh',
    label: '中',

    nav: {
      features: '功能',
      dashboard: '控制台',
      pricing: '定价',
      docs: '文档',
      brand: '品牌',
      login: '登录',
      ctaLong: '开个',
      cta: '沙盒',
    },

    hero: {
      eyebrow: 'AGENT 管理平台 · v0.1 沙盒已开放',
      titleA: '管住你的 agent',
      titleB: '别让它们反过来管你。',
      ledePre: 'agentma 是你 AI agent 舰队的控制中心。一键拉起、实时盯着、一旦发现哪只 ',
      ledeEm: '开始有点太独立',
      ledePost: '——直接拔电。',
      ctaPrimary: '免费开个沙盒 →',
      ctaSecondary: '看眼控制台',
      meta: ['3 个 agent 永久免费', '不用信用卡', '第一天就能自部署'],
      anno: ['← 跑得挺好', '吓人的牙', '$0.07 / 次', '紧急关停 ↓'],
      logosLabel: '这些公司正在用 agentma 管 agent',
    },

    problem: {
      eyebrow: '老办法',
      titleA: '此刻，你的 agent',
      titlePre: '正在',
      titleStrike: '无人看管',
      titlePost: '地折磨你。',
      cards: [
        { k: '47', v: '个标签页，就为了搞清楚是哪个 agent 花了 $312' },
        { k: '0',  v: '点头绪，凌晨 3 点客服 bot 到底调用了什么工具' },
        { k: '1',  v: '个 slack 频道，有人在问"这玩意儿是谁在跑？"' },
        { k: '∞',  v: '行日志，在三个终端里同时刷屏' },
      ],
    },

    features: {
      eyebrow: '里头有啥',
      titleA: '三件事，',
      titleEm: '认真做。',
      items: [
        {
          tag: '01 / 全员',
          title: '看见每只 agent',
          sub: '都在一页里',
          body: 'org 内每只 agent 的实时网格。运行中、空闲、跑丢、被附身。按负责人、工具、模型、花费筛选。三秒内揪出那只在烧你预算的家伙。',
          bullets: ['每 2 秒一次心跳', '按团队 / 项目打标签', '点任意行 → 进入完整会话'],
        },
        {
          tag: '02 / 会话',
          title: '回放每一步',
          sub: '工具调用、提示词、花费、奇怪的弯路',
          body: '每次跑的完整时间线。agent 看到了什么、决定了什么、调用了什么、花了多少，一目了然。给跑加批注、生成只读分享链接，把最糟的几次变成回归测试。',
          bullets: ['逐个工具滚时间线', '两次跑并排 diff', '生成只读分享链接'],
        },
        {
          tag: '03 / 护栏',
          title: '什么都跑不出',
          sub: '这个笼子',
          body: '设硬预算、限制工具访问、沙盒化网络调用、定义关停条件。agentma 会自动拔电——并且在拔之前，用大白话告诉你为什么。',
          bullets: ['按 agent / 按 org 设预算', '工具白名单 / 黑名单', '正则匹配自动停'],
        },
      ],
    },

    dashboard: {
      eyebrow: '产品 · 实时视图',
      titleA: '控制台',
      titleEm: '长这样。',
      sub: '真截图，没修过。是的，那些边距看起来怪怪的——真实软件在被市场部包装之前就长这样。',
      url: 'app.agentma.io / fleet',
      org: 'noxware',
      side: ['▦ 舰队', '⏱ 会话', '⛓ 工具', '⚿ 护栏', '≣ 日志', '⌥ 设置'],
      budgetLabel: '今日花费',
      budgetOf: '/ $50',
      h: '舰队',
      agentsWord: '个 agent',
      runningWord: '运行中',
      empty: '没有符合筛选条件的 agent — 试试放宽条件。',
      teamFilter: '团队：',
      rangeFilter: '区间：',
      teamsLabel: { all: '全部团队' },
      rangesLabel: { h1: '近 1h', h24: '近 24h', d7: '近 7天', d30: '近 30天' },
      newAgent: '+ 新建 agent',
      headers: ['agent', '负责人', '状态', '调用', '花费'],
      statuses: { running: '运行中', stuck: '卡住', caged: '已关停', flagged: '被标记' },
      anno1: '被标记的会自动\n冒到最上面',
      anno2: '这只凌晨 3 点想调\n生产 stripe，\n被护栏拦下了。',
      tailLabel: '实时输出 · midnight-spider',
      tail: [
        ['12:04:21', 'tool',  'web.fetch("https://api.foo/v1/users")'],
        ['12:04:22', 'ok',    '200 · 14.2kb · $0.001'],
        ['12:04:24', 'think', 'user-table 看起来没事，继续...'],
        ['12:04:28', 'tool',  'db.query("SELECT * FROM customers")'],
        ['12:04:28', 'warn',  '护栏：行数太多，请求确认'],
        ['12:04:30', 'stop',  '已暂停 — 等 maya@noxware 批准'],
      ],
      tailPool: [
        ['tool',  'web.fetch("https://api.foo/v1/orders")'],
        ['ok',    '200 · 6.1kb · $0.001'],
        ['think', '跟 stripe 交叉验证中...'],
        ['tool',  'stripe.charges.list(limit=50)'],
        ['ok',    '返回 · $0.003'],
        ['think', '这个用户上个月已流失'],
        ['tool',  'slack.post(channel="#ops", msg="...")'],
        ['warn',  '限流了 — 退避 4s'],
        ['tool',  'db.query("UPDATE flags SET ...")'],
        ['warn',  '护栏：写操作不在白名单'],
        ['stop',  '软暂停 — 预算到达 80%'],
        ['ok',    '已恢复 · $0.002'],
        ['think', '正在解析 pdf 附件...'],
        ['tool',  'pdf.read("invoice-9981.pdf")'],
      ],
      action: '打开 ›',
    },

    pricing: {
      eyebrow: '定价',
      titleA: '老实定价，',
      titleEm: '不按人头收。',
      sub: '按管理的 agent 数量收费，不按人数。整个团队拉进来。',
      flag: '★ 多数人选这个',
      calc: {
        prefix: '我有',
        suffix: '个 agent',
        outFree: '你在沙盒区',
        outPaid: '你在巫师团',
        outCustom: '你需要密室',
        priceFree: '永久免费',
        priceCustom: '联系我们',
        priceUnit: '/ 月',
      },
      tiers: [
        {
          name: '沙盒', tag: '好奇玩玩',
          price: '$0', per: '永久',
          features: ['3 个 agent', '7 天会话历史', 'discord 社区', '自部署或托管'],
          cta: '免费开始 →',
        },
        {
          name: '巫师团', tag: '多数团队的选择',
          price: '$49', per: '/ 月',
          features: ['50 个 agent', '无限会话历史', '审计日志 + SOC2 报告', '关停短信告警', 'slack + pagerduty', '邮件支持'],
          cta: '14 天免费试用 →',
        },
        {
          name: '密室', tag: '自部署 / VPC',
          price: '联系我们', per: '商谈',
          features: ['agent 数量无限', '本地 / VPC 部署', 'SSO + SCIM', '自定义护栏规则', '专属 slack 频道', '99.9% SLA'],
          cta: '预约演示 →',
        },
      ],
    },

    final: {
      titleA: '别再',
      titleEm: '凭感觉了。',
      sub: '90 秒开个沙盒。没注册卡、没销售电话、没 demo 墙。',
      ctaPrimary: '开个沙盒 →',
      ctaSecondary: '读文档',
    },

    footer: {
      tag: 'agent 管理，恐怖的好用。',
      meta: '在闹鬼的办公室造 · 创立于 2026',
      cols: [
        { h: '产品',    l: ['舰队', '会话', '护栏', '定价', '更新日志'] },
        { h: '开发者',  l: ['文档', 'SDK · Python', 'SDK · TypeScript', 'CLI', '自部署'] },
        { h: '公司',    l: ['关于', '博客', '安全', '招聘 (2)', '联系我们'] },
      ],
      bottom: ['© 2026 agentma, inc.', '由一群被自己的 agent 咬过的人造。'],
      legal: ['隐私', '条款', '运行状态'],
    },

    agent: {
      crumb1: '舰队',
      crumb2: 'noxware',
      tag: 'AGENT',
      metaOwner: '· 负责人',
      metaDeployed: '14 天前部署',
      statusRunning: '运行中',
      statusFlagged: '被标记 · 护栏命中',
      actionRun: '▶ 恢复',
      actionPause: '∥ 暂停',
      actionKill: '关停',

      kpi: {
        cost: '近 24h 花销',
        costSub: '与 7 日均值 $1.37 相比',
        calls: '工具调用',
        callsSub: '来自 6 个会话',
        latency: 'P50 延迟',
        latencySub: '工具调用 → 返回',
        success: '成功率',
        successSub: '顺利结束的会话',
      },

      chart: {
        title: '24h 花销 — 按小时',
        normal: '正常',
        spike: '突尖',
      },

      sessions: {
        title: '最近会话',
        count: '6 个 · 近 24h',
        calls: '次调用',
      },

      timeline: {
        title: '会话时间线',
        replay: '▶ 重放',
        diff: '→← 对比',
        share: '⏎ 分享',
        openHint: '点击查看详情',
        kinds: {
          start: '启动',
          think: '思考',
          tool:  '调用',
          ok:    '成功',
          warn:  '护栏',
          stop:  '暂停',
        },
      },

      drawer: {
        req: '请求',
        res: '响应',
        meta: '元信息',
        empty: '（未记录请求体）',
        copy: '复制为 cURL',
        rerun: '↻ 当作测试重跑',
        metaKeys: {
          tool: '工具',
          time: '时间戳',
          duration: '耗时',
          bytes: '字节数',
          cost: '费用',
          guardrail: '护栏',
          passed: '通过',
        },
      },

      statuses: {
        ok: '正常',
        warn: '卡住',
        off: '已关停',
        bad: '被标记',
        paused: '已暂停',
      },

      guards: {
        title: '护栏',
        budget: '预算上限',
        toolAllow: '工具白名单',
        allowed: '个允许',
        network: '网络',
        sandboxed: '沙盒隔离',
        regex: '输出正则',
        rules: '条规则',
        killSwitch: '继电开关',
        armed: '已武装',
        humanLoop: '人工确认',
        lt: '>',
        rows: '行',
        edit: '编辑护栏',
      },
    },
  },
};

const LangCtx = createContext({ t: I18N.en, lang: 'en', setLang: () => {} });

function LanguageProvider({ children }) {
  const [lang, _setLang] = useState(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = localStorage.getItem('agentma-lang');
    if (stored && I18N[stored]) return stored;
    // light heuristic: zh if browser language starts with zh
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  });
  const setLang = (l) => {
    _setLang(l);
    try { localStorage.setItem('agentma-lang', l); } catch (e) {}
  };
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);
  const value = { t: I18N[lang], lang, setLang };
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

function useLang() { return useContext(LangCtx); }

Object.assign(window, { I18N, LanguageProvider, useLang });
