/* global React */
/* ─────────────────────────────────────────────────────────
   agentma — Agent Detail Page
   Click an agent from the fleet → land here. Shows the agent's
   stats, a 24h cost chart, recent sessions, and a full timeline
   for the selected session.
   ───────────────────────────────────────────────────────── */
const { useState, useEffect, useMemo, useRef } = React;

/* Reuse the i18n provider from i18n.jsx (it exposes useLang globally). */
const useLang = window.useLang;

/* Reuse the tiny <symbol> reference. */
function Ag({ which = 'full', stroke = 3.2, style = {} }) {
  return (
    <svg style={{ display: 'block', overflow: 'visible', ...style }} aria-hidden="true">
      <use href={`#${which === 'head' ? 'agentma-head' : 'agentma'}`} style={{ stroke: 'currentColor', strokeWidth: stroke }} />
    </svg>
  );
}

/* ─── synthetic data ─── */

// 24h cost data, hourly. Bumpy with a small spike at 3am to match the
// "midnight-spider" story.
const COSTS_24H = [
  0.02, 0.01, 0.03, 0.04, 0.18, 0.92, 0.41, 0.22,
  0.06, 0.04, 0.03, 0.02, 0.01, 0.02, 0.04, 0.05,
  0.07, 0.08, 0.21, 0.34, 0.48, 0.62, 0.55, 0.36,
];

// Sessions for the selected agent.
const SESSIONS = [
  { id: 's-1041', start: '12:04:21', dur: '4m 12s', cost: '$0.42', calls: 27, status: 'paused', label: { en: 'parsing yesterday\'s invoices', zh: '处理昨天的发票' } },
  { id: 's-1040', start: '11:36:00', dur: '11m 02s', cost: '$0.18', calls: 41, status: 'ok',     label: { en: 'monthly stripe reconciliation', zh: '月度 stripe 对账' } },
  { id: 's-1039', start: '09:14:08', dur: '1m 56s', cost: '$0.04', calls: 12, status: 'ok',     label: { en: 'follow-up email sweep', zh: '催收邮件扫描' } },
  { id: 's-1038', start: '08:02:11', dur: '0m 14s', cost: '$3.14', calls: 211, status: 'bad',   label: { en: 'tried to query prod stripe (caught)', zh: '想偷查 prod stripe（已拦下）' } },
  { id: 's-1037', start: '03:47:33', dur: '0m 04s', cost: '$0.00', calls: 0,  status: 'off',   label: { en: 'budget-paused before start', zh: '预算超限，启动前已暂停' } },
  { id: 's-1036', start: '02:01:09', dur: '6m 50s', cost: '$0.74', calls: 89, status: 'ok',     label: { en: 'overnight pdf attachments', zh: '夜间 pdf 附件处理' } },
];

// Timeline events for the SELECTED session. Each kind has its own treatment.
const TIMELINE = {
  's-1041': [
    { t: '12:04:21', kind: 'start',  msg: { en: 'session started by maya@noxware', zh: '会话由 maya@noxware 启动' } },
    { t: '12:04:22', kind: 'think',  msg: { en: 'goal: parse all unpaid invoices since 2026-05-15 and tag overdue', zh: '目标：解析 2026-05-15 之后所有未付发票，并标记逾期' } },
    { t: '12:04:23', kind: 'tool',   msg: 'db.query("SELECT id, amount FROM invoices WHERE paid_at IS NULL")', meta: '+ 0.03s · 14kb · $0.001' },
    { t: '12:04:24', kind: 'ok',     msg: { en: '94 rows returned', zh: '返回 94 行' } },
    { t: '12:04:32', kind: 'tool',   msg: 'pdf.read("invoice-9981.pdf")', meta: '+ 1.2s · 218kb · $0.004' },
    { t: '12:04:34', kind: 'tool',   msg: 'pdf.read("invoice-9982.pdf")', meta: '+ 1.1s · 184kb · $0.004' },
    { t: '12:04:36', kind: 'think',  msg: { en: 'invoice 9981 is overdue 14 days — flagging', zh: '发票 9981 逾期 14 天，已标记' } },
    { t: '12:04:41', kind: 'tool',   msg: 'db.update("flags", { invoice: 9981, status: \'overdue\' })', meta: '+ 0.04s · $0.001' },
    { t: '12:04:42', kind: 'warn',   msg: { en: 'guardrail: write to flags table OK (in allowlist)', zh: '护栏：写入 flags 表通过（在白名单内）' } },
    { t: '12:05:14', kind: 'tool',   msg: 'slack.post(channel="#ar", msg="9981 → overdue")', meta: '+ 0.3s · $0.002' },
    { t: '12:05:15', kind: 'ok',     msg: { en: 'posted to #ar', zh: '已发到 #ar' } },
    { t: '12:08:33', kind: 'think',  msg: { en: 'rows 14–94 processed; cost approaching limit', zh: '已处理第 14–94 行；预算接近上限' } },
    { t: '12:08:33', kind: 'stop',   msg: { en: 'soft-paused: 80% of $0.50 budget reached. waiting for maya@noxware', zh: '软暂停：达到预算 $0.50 的 80%，等待 maya@noxware' } },
  ],
};

// Full request/response bodies, keyed by (sessionId, eventIdx).
// Kept separate so the TIMELINE table stays readable.
const TOOL_DETAILS = {
  's-1041': {
    2: {
      req: 'SELECT id, amount, due_date, customer_id\nFROM invoices\nWHERE paid_at IS NULL\n  AND due_date < CURRENT_DATE\nORDER BY due_date ASC\nLIMIT 100;',
      res: '[\n  {"id": 9981, "amount": 1240.00, "due_date": "2026-05-07", "customer_id": 4412},\n  {"id": 9982, "amount":   86.50, "due_date": "2026-05-08", "customer_id": 4501},\n  {"id": 9983, "amount":  412.00, "due_date": "2026-05-09", "customer_id": 4488},\n  ... 91 more rows\n]',
    },
    4: {
      req: '{\n  "path": "s3://acme-invoices/9981.pdf",\n  "mode": "extract_text",\n  "page_range": "1-3"\n}',
      res: 'Acme Corp · Invoice #9981\nIssued: 2026-04-23\nDue:    2026-05-07\nBill to: Globex (cust #4412)\nAmount: $1,240.00 (USD)\n\nLine items\n  Consulting (16h) ............ $1,200.00\n  Travel reimbursement ........    $40.00\n  ---------------------------------------\n  Total                          $1,240.00',
    },
    5: {
      req: '{\n  "path": "s3://acme-invoices/9982.pdf",\n  "mode": "extract_text"\n}',
      res: 'Acme Corp · Invoice #9982\nIssued: 2026-04-24\nDue:    2026-05-08\nBill to: Initech (cust #4501)\nAmount: $86.50 (USD)',
    },
    7: {
      req: "UPDATE flags\nSET status = 'overdue', updated_at = NOW()\nWHERE invoice_id = 9981;",
      res: '{ "rows_affected": 1, "status": "ok" }',
    },
    9: {
      req: '{\n  "channel": "#ar",\n  "text": ":warning: Invoice #9981 is now overdue (14 days).\\nAmount: $1,240.00 · Customer: 4412",\n  "as_user": false,\n  "thread_ts": null\n}',
      res: '{\n  "ok": true,\n  "channel": "C03X1Y2Z3",\n  "ts": "1716998714.000200"\n}',
    },
  },
};

/* ─── Top bar: matches the landing nav pattern. ─── */
function TopBar({ dark, setDark }) {
  const { t, lang, setLang } = useLang();
  const T = t.agent;
  return (
    <nav className="ag-nav">
      <a href="agentma landing page.html" className="ag-logo">
        <Ag which="head" stroke={4} style={{ width: 38, height: 32, color: 'var(--maroon)' }} />
        <span className="ag-logo-text">agentma</span>
      </a>
      <div className="ag-crumbs">
        <a href="agentma landing page.html#dashboard">{T.crumb1}</a>
        <span className="ag-crumb-sep">/</span>
        <a href="agentma landing page.html#dashboard">{T.crumb2}</a>
        <span className="ag-crumb-sep">/</span>
        <span className="ag-crumb-active">midnight-spider</span>
      </div>
      <div className="ag-nav-right">
        <button className="ag-toggle ag-lang-toggle"
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          title={lang === 'en' ? '切换到中文' : 'Switch to English'}>
          {lang === 'en' ? '中' : 'EN'}
        </button>
        <button className="ag-toggle" onClick={() => setDark(d => !d)} aria-label="theme">
          {dark ? '☀' : '☾'}
        </button>
      </div>
    </nav>
  );
}

/* ─── Header band: agent name, owner, status, controls. ─── */
function AgentHeader() {
  const { t, lang } = useLang();
  const T = t.agent;
  const [running, setRunning] = useState(false);

  return (
    <header className="ag-detail-head">
      <div className="ag-detail-id">
        <div className="ag-detail-tag">{T.tag}</div>
        <h1 className="ag-detail-name">midnight-spider</h1>
        <div className="ag-detail-meta">
          <span className="ag-detail-meta-i">
            <span className="ag-mono">@leo</span> {T.metaOwner}
          </span>
          <span className="ag-bullet">·</span>
          <span className="ag-detail-meta-i">
            <span className="ag-mono">claude-sonnet-4.5</span>
          </span>
          <span className="ag-bullet">·</span>
          <span className="ag-detail-meta-i">{T.metaDeployed}</span>
        </div>
      </div>

      <div className="ag-detail-status">
        <div className={`ag-status-big ${running ? 'ag-status-ok' : 'ag-status-bad'}`}>
          <span className="ag-status-pulse"></span>
          {running ? T.statusRunning : T.statusFlagged}
        </div>
        <div className="ag-detail-actions">
          {!running ? (
            <button className="ag-btn ag-btn-primary" onClick={() => setRunning(true)}>
              {T.actionRun}
            </button>
          ) : (
            <button className="ag-btn ag-btn-ghost" onClick={() => setRunning(false)}>
              {T.actionPause}
            </button>
          )}
          <button className="ag-btn ag-btn-danger" title={T.actionKill}>
            ⚠ {T.actionKill}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ─── KPI grid. ─── */
function KPIs() {
  const { t } = useLang();
  const T = t.agent;
  const kpis = [
    { label: T.kpi.cost,     value: '$3.88',   delta: '+184%', tone: 'bad',  sub: T.kpi.costSub },
    { label: T.kpi.calls,    value: '211',     delta: '+62%',  tone: 'warn', sub: T.kpi.callsSub },
    { label: T.kpi.latency,  value: '1.41s',   delta: '-12%',  tone: 'ok',   sub: T.kpi.latencySub },
    { label: T.kpi.success,  value: '94.2%',   delta: '-3.1%', tone: 'warn', sub: T.kpi.successSub },
  ];
  return (
    <div className="ag-kpi-grid">
      {kpis.map((k, i) => (
        <div key={i} className="ag-kpi">
          <div className="ag-kpi-label">{k.label}</div>
          <div className="ag-kpi-val-row">
            <span className="ag-kpi-val">{k.value}</span>
            <span className={`ag-kpi-delta ag-kpi-delta-${k.tone}`}>{k.delta}</span>
          </div>
          <div className="ag-kpi-sub">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── 24h cost sparkbar chart. ─── */
function CostChart() {
  const { t } = useLang();
  const T = t.agent;
  const max = Math.max(...COSTS_24H);
  const [hoverIdx, setHoverIdx] = useState(null);
  return (
    <div className="ag-chart">
      <div className="ag-chart-head">
        <div>
          <div className="ag-section-mini">{T.chart.title}</div>
          <div className="ag-chart-total">$3.88 <span className="ag-chart-budget">/ $50</span></div>
        </div>
        <div className="ag-chart-legend">
          <span className="ag-legend-dot ag-good"></span>
          <span>{T.chart.normal}</span>
          <span className="ag-legend-dot ag-bad"></span>
          <span>{T.chart.spike}</span>
        </div>
      </div>
      <div className="ag-bars">
        {COSTS_24H.map((v, i) => {
          const h = Math.max(2, (v / max) * 100);
          const spike = v > 0.5;
          return (
            <div
              key={i}
              className={`ag-bar ${spike ? 'ag-bar-spike' : ''} ${hoverIdx === i ? 'ag-bar-hover' : ''}`}
              style={{ height: `${h}%` }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              title={`${String(i).padStart(2,'0')}:00 · $${v.toFixed(2)}`}
            >
              {hoverIdx === i && (
                <div className="ag-bar-tt">
                  <div className="ag-bar-tt-h">{String(i).padStart(2,'0')}:00</div>
                  <div className="ag-bar-tt-v">${v.toFixed(2)}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="ag-bars-axis">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span>
      </div>
    </div>
  );
}

/* ─── Session list (left) + timeline (right). ─── */
function SessionsAndTimeline() {
  const { t, lang } = useLang();
  const T = t.agent;
  const [sel, setSel] = useState('s-1041');
  const [drawerIdx, setDrawerIdx] = useState(null);
  const events = TIMELINE[sel] || TIMELINE['s-1041'];

  // ESC closes the drawer.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setDrawerIdx(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ag-sessions">
      <aside className="ag-session-list">
        <div className="ag-section-mini ag-section-mini-row">
          <span>{T.sessions.title}</span>
          <span className="ag-faint">{T.sessions.count}</span>
        </div>
        {SESSIONS.map(s => (
          <button
            key={s.id}
            className={`ag-session-row ${sel === s.id ? 'ag-session-sel' : ''}`}
            onClick={() => setSel(s.id)}
          >
            <div className="ag-session-row-top">
              <span className="ag-mono ag-session-id">{s.id}</span>
              <span className={`ag-status ag-status-${s.status}`}>● {T.statuses[s.status] || s.status}</span>
            </div>
            <div className="ag-session-row-label">
              {s.label[lang] || s.label.en}
            </div>
            <div className="ag-session-row-meta">
              <span>{s.start}</span>
              <span className="ag-bullet">·</span>
              <span>{s.dur}</span>
              <span className="ag-bullet">·</span>
              <span className="ag-session-cost">{s.cost}</span>
              <span className="ag-bullet">·</span>
              <span>{s.calls} {T.sessions.calls}</span>
            </div>
          </button>
        ))}
      </aside>

      <section className="ag-timeline-wrap">
        <div className="ag-timeline-head">
          <div>
            <div className="ag-section-mini">{T.timeline.title}</div>
            <h3 className="ag-timeline-h">
              <span className="ag-mono">{sel}</span> · {(SESSIONS.find(s => s.id === sel) || SESSIONS[0]).label[lang]}
            </h3>
          </div>
          <div className="ag-timeline-actions">
            <button className="ag-btn ag-btn-ghost ag-btn-sm">{T.timeline.replay}</button>
            <button className="ag-btn ag-btn-ghost ag-btn-sm">{T.timeline.diff}</button>
            <button className="ag-btn ag-btn-ghost ag-btn-sm">{T.timeline.share}</button>
          </div>
        </div>

        <ol className="ag-timeline">
          {events.map((ev, i) => {
            const msg = typeof ev.msg === 'string' ? ev.msg : (ev.msg[lang] || ev.msg.en);
            const clickable = ev.kind === 'tool';
            return (
              <li key={i}
                  className={`ag-tl-i ag-tl-${ev.kind} ${clickable ? 'ag-tl-clickable' : ''}`}
                  onClick={clickable ? () => setDrawerIdx(i) : undefined}
                  tabIndex={clickable ? 0 : -1}
                  role={clickable ? 'button' : undefined}>
                <span className="ag-tl-time">{ev.t}</span>
                <span className="ag-tl-kind">{T.timeline.kinds[ev.kind] || ev.kind}</span>
                <div className="ag-tl-body">
                  <div className="ag-tl-msg">{ev.kind === 'tool' ? <code>{msg}</code> : msg}</div>
                  {ev.meta && <div className="ag-tl-meta">{ev.meta}{clickable && <span className="ag-tl-open"> · {T.timeline.openHint}</span>}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <ToolDrawer sessionId={sel} eventIdx={drawerIdx} events={events} onClose={() => setDrawerIdx(null)} />
    </div>
  );
}

/* ─── Tool call drawer ─── */
function ToolDrawer({ sessionId, eventIdx, events, onClose }) {
  const { t, lang } = useLang();
  const T = t.agent;
  const [tab, setTab] = useState('req');
  // Reset to request tab whenever a different tool call opens.
  useEffect(() => { if (eventIdx !== null) setTab('req'); }, [eventIdx]);
  const open = eventIdx !== null;
  const ev = open ? events[eventIdx] : null;
  const details = open ? (TOOL_DETAILS[sessionId] || {})[eventIdx] || {} : {};
  const callMsg = ev && (typeof ev.msg === 'string' ? ev.msg : ev.msg[lang] || ev.msg.en);
  const metaBits = ev && ev.meta ? ev.meta.split('·').map(s => s.trim()) : [];
  return (
    <>
      <div className={`ag-drawer-back ${open ? 'ag-drawer-open' : ''}`} onClick={onClose} />
      <aside className={`ag-drawer ${open ? 'ag-drawer-open' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>
        {ev && (
          <>
            <header className="ag-drawer-head">
              <div className="ag-drawer-head-inner">
                <div className="ag-section-mini">{T.timeline.kinds.tool} · {sessionId} · #{eventIdx + 1}</div>
                <h3 className="ag-drawer-h"><code>{callMsg}</code></h3>
                {ev.meta && <div className="ag-tl-meta">{ev.meta}</div>}
              </div>
              <button className="ag-toggle" onClick={onClose} aria-label="close">✕</button>
            </header>
            <div className="ag-drawer-tabs">
              <button className={`ag-drawer-tab ${tab === 'req' ? 'ag-drawer-tab-on' : ''}`} onClick={() => setTab('req')}>{T.drawer.req}</button>
              <button className={`ag-drawer-tab ${tab === 'res' ? 'ag-drawer-tab-on' : ''}`} onClick={() => setTab('res')}>{T.drawer.res}</button>
              <button className={`ag-drawer-tab ${tab === 'meta' ? 'ag-drawer-tab-on' : ''}`} onClick={() => setTab('meta')}>{T.drawer.meta}</button>
            </div>
            <div className="ag-drawer-body">
              {tab === 'req' && <pre className="ag-code"><code>{details.req || T.drawer.empty}</code></pre>}
              {tab === 'res' && <pre className="ag-code"><code>{details.res || T.drawer.empty}</code></pre>}
              {tab === 'meta' && (
                <div className="ag-drawer-meta-grid">
                  <div><span className="ag-faint">{T.drawer.metaKeys.tool}</span><code>{callMsg.split('(')[0]}</code></div>
                  <div><span className="ag-faint">{T.drawer.metaKeys.time}</span><span>{ev.t}</span></div>
                  <div><span className="ag-faint">{T.drawer.metaKeys.duration}</span><span>{metaBits[0] || '—'}</span></div>
                  <div><span className="ag-faint">{T.drawer.metaKeys.bytes}</span><span>{metaBits[1] || '—'}</span></div>
                  <div><span className="ag-faint">{T.drawer.metaKeys.cost}</span><span>{metaBits[2] || metaBits[1] || '—'}</span></div>
                  <div><span className="ag-faint">{T.drawer.metaKeys.guardrail}</span><span className="ag-status-ok">● {T.drawer.metaKeys.passed}</span></div>
                </div>
              )}
            </div>
            <footer className="ag-drawer-foot">
              <button className="ag-btn ag-btn-ghost ag-btn-sm">{T.drawer.copy}</button>
              <button className="ag-btn ag-btn-ghost ag-btn-sm">{T.drawer.rerun}</button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

/* ─── Guardrails sidebar. ─── */
function Guardrails() {
  const { t } = useLang();
  const T = t.agent;
  const rules = [
    { name: T.guards.budget,       val: '$50 / day',   tone: 'ok',   on: true },
    { name: T.guards.toolAllow,    val: '12 ' + T.guards.allowed,  tone: 'ok', on: true },
    { name: T.guards.network,      val: T.guards.sandboxed,        tone: 'ok', on: true },
    { name: T.guards.regex,        val: '3 ' + T.guards.rules,     tone: 'warn', on: true },
    { name: T.guards.killSwitch,   val: T.guards.armed,            tone: 'ok', on: true },
    { name: T.guards.humanLoop,    val: T.guards.lt + ' 1000 ' + T.guards.rows, tone: 'warn', on: true },
  ];
  return (
    <aside className="ag-guards">
      <div className="ag-section-mini">{T.guards.title}</div>
      {rules.map((r, i) => (
        <div key={i} className="ag-guard-row">
          <span className={`ag-guard-dot ag-${r.tone}`}></span>
          <span className="ag-guard-name">{r.name}</span>
          <span className="ag-guard-val">{r.val}</span>
        </div>
      ))}
      <button className="ag-btn ag-btn-ghost ag-btn-full ag-btn-sm" style={{ marginTop: 16 }}>
        {T.guards.edit}
      </button>
    </aside>
  );
}

/* ─── App ─── */
function AgentApp() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <window.LanguageProvider>
      <div className="ag-app ag-app-detail">
        <TopBar dark={dark} setDark={setDark} />
        <AgentHeader />
        <KPIs />
        <CostChart />
        <div className="ag-detail-grid">
          <SessionsAndTimeline />
          <Guardrails />
        </div>
      </div>
    </window.LanguageProvider>
  );
}

window.AgentApp = AgentApp;
