/* global React */
/* ─────────────────────────────────────────────────────────
   agentma landing page — sections module
   Aesthetic: hand-drawn napkin maroon on cream paper,
   contrasted by clean JetBrains Mono for tech beats.
   Dark mode flips to #1a1614 + cream lines.
   ───────────────────────────────────────────────────────── */
const { useState, useEffect, useRef } = React;

/* ─── Tiny character renderer using the global <symbol> sprite ─── */
function Ag({ which = 'full', color = 'currentColor', stroke = 3.2, style = {}, className = '' }) {
  const id = which === 'head' ? 'agentma-head' : 'agentma';
  return (
    <svg className={className} style={{ display: 'block', overflow: 'visible', ...style }} aria-hidden="true">
      <use href={`#${id}`} style={{ color, stroke: 'currentColor', strokeWidth: stroke }} />
    </svg>);

}

/* ─── Hand-drawn arrow scribbles ─── */
function ScribbleArrow({ d, style = {}, w = 200, h = 80 }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={style}
    fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>);

}

function Underline({ width = 220, style = {} }) {
  return (
    <svg viewBox="0 0 220 14" width={width} height={14} style={{ display: 'block', ...style }}
    fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M 4 7 Q 40 2, 80 8 T 160 6 T 216 8" />
    </svg>);

}

function Squiggle({ style = {} }) {
  return (
    <svg viewBox="0 0 80 14" width={80} height={14} style={style}
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M 2 7 Q 8 2 14 7 T 26 7 T 38 7 T 50 7 T 62 7 T 74 7" />
    </svg>);

}

/* Small filter dropdown for the fake dashboard. Closes on outside-click,
   on ESC, and after a selection. Keeps the same chrome as the static pills
   it replaces. */
function DashDropdown({ value, onChange, options, prefix }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = options.find(o => o.id === value);
  return (
    <div className="ag-dropdown" ref={ref}>
      <button
        className={`ag-pill ag-pill-dd ${open ? 'ag-pill-dd-open' : ''}`}
        onClick={(e) => { e.preventDefault(); setOpen(o => !o); }}>
        {prefix && <span className="ag-faint">{prefix}</span>} {current ? current.label : ''} <span className="ag-pill-chev">⌄</span>
      </button>
      {open && (
        <div className="ag-dropdown-menu">
          {options.map(o => (
            <button
              key={o.id}
              className={`ag-dropdown-item ${o.id === value ? 'ag-dropdown-item-on' : ''}`}
              onClick={() => { onChange(o.id); setOpen(false); }}>
              {o.label}
              {o.id === value && <span className="ag-dropdown-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── NAV ─── */
function Nav({ dark, setDark }) {
  const { t, lang, setLang } = useLang();
  return (
    <nav className="ag-nav">
      <a href="#top" className="ag-logo">
        <Ag which="head" stroke={4} style={{ width: 38, height: 32 }} />
        <span className="ag-logo-text">agentma</span>
      </a>
      <div className="ag-nav-links">
        <a href="#features">{t.nav.features}</a>
        <a href="#dashboard">{t.nav.dashboard}</a>
        <a href="#pricing">{t.nav.pricing}</a>
        <a href="#docs" style={{ padding: "2px 5px 2px 0px" }}>{t.nav.docs}</a>
      </div>
      <div className="ag-nav-right">
        <button
          className="ag-toggle ag-lang-toggle"
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          aria-label="Switch language"
          title={lang === 'en' ? '切换到中文' : 'Switch to English'}
        >{lang === 'en' ? '中' : 'EN'}</button>
        <button className="ag-toggle" onClick={() => setDark((d) => !d)} aria-label="Toggle theme">
          {dark ? '☀' : '☾'}
        </button>
        <a className="ag-btn ag-btn-ghost ag-btn-login" href="#login">{t.nav.login}</a>
        <a className="ag-btn ag-btn-primary" href="#start">
          <span className="ag-nav-cta-long">{t.nav.ctaLong}&nbsp;</span>{t.nav.cta}
          <Squiggle style={{ position: 'absolute', left: '12%', bottom: -7, width: 76, opacity: 0.5 }} />
        </a>
      </div>
    </nav>);

}

/* ─── HERO ─── */
function Hero() {
  const { t } = useLang();
  return (
    <section className="ag-hero" id="top">
      <div className="ag-hero-grid">
        <div className="ag-hero-copy">
          <div className="ag-eyebrow">
            <span className="ag-dot ag-dot-pulse"></span>
            <span>{t.hero.eyebrow}</span>
          </div>
          <h1 className="ag-headline">
            {t.hero.titleA}
            <br />
            <span className="ag-headline-em">
              {t.hero.titleB}
              <Underline width={520} style={{ position: 'absolute', left: 0, bottom: -14, color: 'var(--accent)' }} />
            </span>
          </h1>
          <p className="ag-lede">
            {t.hero.ledePre}
            <em>{t.hero.ledeEm}</em>
            {t.hero.ledePost}
          </p>
          <div className="ag-cta-row">
            <a className="ag-btn ag-btn-primary ag-btn-lg" href="#start">
              {t.hero.ctaPrimary}
            </a>
            <a className="ag-btn ag-btn-ghost ag-btn-lg" href="#dashboard">
              {t.hero.ctaSecondary}
            </a>
          </div>
          <div className="ag-hero-meta">
            {t.hero.meta.map((m, i) =>
            <React.Fragment key={i}>
                <span>{m}</span>
                {i < t.hero.meta.length - 1 && <span className="ag-bullet">·</span>}
              </React.Fragment>
            )}
          </div>
        </div>

        <div className="ag-hero-art">
          <CreatureWithEye />
        </div>
      </div>

      <div className="ag-logos">
        <span className="ag-logos-label">{t.hero.logosLabel}</span>
        <div className="ag-logos-row">
          {['NOXWARE', 'spookd', 'GRIMOIRE.io', 'witchhat', 'pumpkin labs', 'NIGHTSHIFT'].map((l) =>
          <span key={l} className="ag-logo-mark">{l}</span>
          )}
        </div>
      </div>
    </section>);

}

/* Pupil that tracks the cursor — positioned over the creature's open eye.
   Annotations live in here too so they keep their absolute positioning
   relative to the wrap (and float with it). */
/* The character is drawn from 30 sketch strokes. Stroke #18 — the small
   oval — is the open eye, centered at viewBox (289, 236). We render the
   character inline (not via <Ag>) so we can layer an eye-white circle
   underneath and a pupil group on top, all in viewBox coordinates. The
   pupil follows the cursor via the SVG's getScreenCTM() — exact in any
   layout. */
const EYE_VB = { cx: 289, cy: 236, rWhite: 14, rPupil: 5.5, maxMove: 7 };

function CreatureWithEye() {
  const { t } = useLang();
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const pupilRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let raf = 0;
    let tx = 0, ty = 0;
    function onMove(e) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const eyeX = ctm.a * EYE_VB.cx + ctm.c * EYE_VB.cy + ctm.e;
      const eyeY = ctm.b * EYE_VB.cx + ctm.d * EYE_VB.cy + ctm.f;
      const dx = e.clientX - eyeX;
      const dy = e.clientY - eyeY;
      const dist = Math.hypot(dx, dy) || 1;
      const factor = Math.min(1, dist / 240);
      tx = dx / dist * EYE_VB.maxMove * factor;
      ty = dy / dist * EYE_VB.maxMove * factor;
      if (!raf) raf = requestAnimationFrame(apply);
    }
    function apply() {
      raf = 0;
      if (pupilRef.current) {
        pupilRef.current.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`);
      }
    }
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="ag-creature-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox="0 0 650 737"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: 360, height: 410, overflow: 'visible', color: 'var(--maroon)' }}
        aria-hidden="true"
      >
        {/* Eye-white underneath so the drawn outline shows on top. */}
        <circle cx={EYE_VB.cx} cy={EYE_VB.cy} r={EYE_VB.rWhite} fill="var(--bg)" />
        {/* The 30 character strokes. */}
        <use href="#agentma" style={{ stroke: 'currentColor', strokeWidth: 3.2 }} />
        {/* Pupil on top, follows the cursor. */}
        <g ref={pupilRef} className="ag-pupil-g">
          <circle cx={EYE_VB.cx} cy={EYE_VB.cy} r={EYE_VB.rPupil} fill="var(--ink)" />
        </g>
      </svg>
      <div className="ag-anno ag-anno-1">
        <span>{t.hero.anno[0]}</span>
        <ScribbleArrow w={100} h={50}
          d="M 4 30 Q 30 10 60 25 T 96 22 M 90 18 L 96 22 L 90 28" />
      </div>
      <div className="ag-anno ag-anno-2">
        <ScribbleArrow w={110} h={60}
          d="M 100 8 Q 70 18 50 38 T 8 50 M 14 44 L 8 50 L 16 54" />
        <span>{t.hero.anno[1]}</span>
      </div>
      <div className="ag-anno ag-anno-3">
        <span>{t.hero.anno[2]}</span>
        <ScribbleArrow w={80} h={40}
          d="M 4 8 Q 30 28 64 30 M 58 24 L 64 30 L 56 32" />
      </div>
      <div className="ag-anno ag-anno-4">
        <ScribbleArrow w={90} h={40}
          d="M 86 8 Q 50 22 8 30 M 14 24 L 8 30 L 16 34" />
        <span>{t.hero.anno[3]}</span>
      </div>
    </div>);

}

/* ─── PROBLEM ─── */
function Problem() {
  const { t } = useLang();
  return (
    <section className="ag-problem">
      <div className="ag-section-head">
        <div className="ag-eyebrow">{t.problem.eyebrow}</div>
        <h2 className="ag-h2">
          {t.problem.titleA} <br />
          {t.problem.titlePre}<span className="ag-strike">{t.problem.titleStrike}</span>{t.problem.titlePost}
        </h2>
      </div>

      <div className="ag-problem-grid">
        {t.problem.cards.map((c, i) =>
        <div key={i} className="ag-problem-card">
            <div className="ag-problem-k">{c.k}</div>
            <div className="ag-problem-v">{c.v}</div>
          </div>
        )}
      </div>
    </section>);

}

/* ─── FEATURES ─── */
function Features() {
  const { t } = useLang();
  const poses = ['wave', 'watch', 'cage'];
  return (
    <section className="ag-features" id="features">
      <div className="ag-section-head">
        <div className="ag-eyebrow">{t.features.eyebrow}</div>
        <h2 className="ag-h2">
          {t.features.titleA} <br />
          <span className="ag-em">{t.features.titleEm}</span>
        </h2>
      </div>

      <div className="ag-features-grid">
        {t.features.items.map((f, i) => {
          const pose = poses[i] || 'wave';
          return (
            <article key={i} className={`ag-feature ag-feature-${pose}`}>
              <div className="ag-feature-art">
                {pose === 'wave' &&
                <Ag which="full" stroke={3} style={{ width: '100%', height: 220 }} />
                }
                {pose === 'watch' &&
                <div className="ag-watch">
                    <Ag which="head" stroke={3.6} style={{ width: '100%', height: 220 }} />
                    <div className="ag-eye-glow"></div>
                  </div>
                }
                {pose === 'cage' &&
                <div className="ag-caged">
                    <Ag which="full" stroke={3} style={{ width: '100%', height: 220 }} />
                    <svg className="ag-bars" viewBox="0 0 240 220" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" preserveAspectRatio="none">
                      <line x1="40" y1="20" x2="40" y2="200" />
                      <line x1="100" y1="20" x2="100" y2="200" />
                      <line x1="160" y1="20" x2="160" y2="200" />
                      <line x1="200" y1="20" x2="200" y2="200" />
                      <path d="M 20 20 Q 120 8 220 20" />
                      <path d="M 20 200 Q 120 212 220 200" />
                    </svg>
                  </div>
                }
              </div>
              <div className="ag-feature-tag">{f.tag}</div>
              <h3 className="ag-feature-title">
                {f.title}
                <br />
                <span className="ag-feature-sub">{f.sub}</span>
              </h3>
              <p className="ag-feature-body">{f.body}</p>
              <ul className="ag-feature-bullets">
                {f.bullets.map((b, j) =>
                <li key={j}>
                    <span className="ag-check">✓</span>
                    <span>{b}</span>
                  </li>
                )}
              </ul>
            </article>);

        })}
      </div>
    </section>);

}

/* ─── DASHBOARD MOCK ─── */
function Dashboard() {
  const { t, lang } = useLang();
  const allAgents = [
    { name: 'support-triage',  owner: 'maya',   team: 'support', status: 'running', cost: '$0.12', calls: 47, tone: 'ok' },
    { name: 'invoice-reader',  owner: 'jun',    team: 'finance', status: 'running', cost: '$0.03', calls: 12, tone: 'ok' },
    { name: 'lead-enricher',   owner: 'priya',  team: 'growth',  status: 'stuck',   cost: '$1.04', calls: 3,  tone: 'warn' },
    { name: 'data-migrator',   owner: 'sam',    team: 'devops',  status: 'caged',   cost: '$0.00', calls: 0,  tone: 'off' },
    { name: 'pr-summarizer',   owner: 'devops', team: 'devops',  status: 'running', cost: '$0.41', calls: 92, tone: 'ok' },
    { name: 'midnight-spider', owner: 'leo',    team: 'finance', status: 'flagged', cost: '$3.88', calls: 211,tone: 'bad' },
  ];
  const [team, setTeam] = useState('all');
  const [range, setRange] = useState('24h');

  const filtered = allAgents.filter(a => team === 'all' || a.team === team);
  const running = filtered.filter(a => a.status === 'running').length;
  const totalCost = filtered.reduce((s, a) => s + Number(a.cost.replace('$','')), 0);

  // Spend bar widths scale by the longest range we've selected.
  const rangeMult = { '1h': 1/24, '24h': 1, '7d': 7, '30d': 30 }[range] || 1;

  // Team / range option lists (ids are stable, labels come from i18n).
  const teamOpts = [
    { id: 'all',     label: t.dashboard.teamsLabel.all },
    { id: 'support', label: 'support' },
    { id: 'finance', label: 'finance' },
    { id: 'devops',  label: 'devops' },
    { id: 'growth',  label: 'growth' },
  ];
  const rangeOpts = [
    { id: '1h',  label: t.dashboard.rangesLabel.h1 },
    { id: '24h', label: t.dashboard.rangesLabel.h24 },
    { id: '7d',  label: t.dashboard.rangesLabel.d7 },
    { id: '30d', label: t.dashboard.rangesLabel.d30 },
  ];

  return (
    <section className="ag-dashboard" id="dashboard">
      <div className="ag-section-head ag-section-head-tight">
        <div className="ag-eyebrow">{t.dashboard.eyebrow}</div>
        <h2 className="ag-h2">
          {t.dashboard.titleA} <br />
          <span className="ag-em">{t.dashboard.titleEm}</span>
        </h2>
        <p className="ag-section-sub">{t.dashboard.sub}</p>
      </div>

      <div className="ag-dash-frame">
        <div className="ag-dash-chrome">
          <span className="ag-dot-os ag-dot-r"></span>
          <span className="ag-dot-os ag-dot-y"></span>
          <span className="ag-dot-os ag-dot-g"></span>
          <span className="ag-dash-url">{t.dashboard.url}</span>
        </div>

        <div className="ag-dash-body">
          <aside className="ag-dash-side">
            <div className="ag-dash-org">
              <Ag which="head" stroke={4.5} style={{ width: 24, height: 22 }} />
              <span>{t.dashboard.org}</span>
              <span className="ag-dash-chev">›</span>
            </div>
            <nav className="ag-dash-nav">
              {t.dashboard.side.map((s, i) =>
              <a key={i} className={`ag-dash-navitem ${i === 0 ? 'ag-active' : ''}`}>{s}</a>
              )}
            </nav>
            <div className="ag-dash-budget">
              <div className="ag-dash-budget-label">{t.dashboard.budgetLabel}</div>
              <div className="ag-dash-budget-amt">$5.48 <span>{t.dashboard.budgetOf}</span></div>
              <div className="ag-dash-budget-bar"><span style={{ width: '11%' }}></span></div>
            </div>
          </aside>

          <div className="ag-dash-main">
            <div className="ag-dash-toolbar">
              <h3 className="ag-dash-h">{t.dashboard.h} <span className="ag-dash-count">{filtered.length} {t.dashboard.agentsWord} · {running} {t.dashboard.runningWord}</span></h3>
              <div className="ag-dash-filters">
                <DashDropdown value={team}  onChange={setTeam}  options={teamOpts}  prefix={t.dashboard.teamFilter} />
                <DashDropdown value={range} onChange={setRange} options={rangeOpts} prefix={t.dashboard.rangeFilter} />
                <button className="ag-pill ag-pill-primary" onClick={(e) => e.preventDefault()}>{t.dashboard.newAgent}</button>
              </div>
            </div>

            <table className="ag-dash-table">
              <thead>
                <tr>
                  {t.dashboard.headers.map((h, i) =>
                  <th key={i} style={i >= 3 ? { textAlign: 'right' } : undefined}>{h}</th>
                  )}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan="6" className="ag-row-empty">{t.dashboard.empty}</td></tr>
                )}
                {filtered.map((a, i) =>
                <tr key={i}
                    className={`ag-row ag-row-${a.tone} ag-row-clickable`}
                    onClick={(e) => {
                      // Every row points at the same detail page for now.
                      window.location.href = 'agent.html';
                    }}>
                    <td><span className="ag-mono">{a.name}</span></td>
                    <td><span className="ag-owner">{a.owner}</span></td>
                    <td><span className={`ag-status ag-status-${a.tone}`}>● {t.dashboard.statuses[a.status] || a.status}</span></td>
                    <td style={{ textAlign: 'right' }}>{Math.round(a.calls * rangeMult)}</td>
                    <td style={{ textAlign: 'right' }}>${(Number(a.cost.replace('$','')) * rangeMult).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}><span className="ag-dash-action">{t.dashboard.action}</span></td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="ag-dash-anno ag-dash-anno-1">
              <ScribbleArrow w={120} h={50}
              d="M 110 40 Q 70 30 30 20 Q 20 18 4 10 M 12 6 L 4 10 L 10 16" />
              <span style={{ whiteSpace: 'pre-line' }}>{t.dashboard.anno1}</span>
            </div>
            <div className="ag-dash-anno ag-dash-anno-2">
              <span style={{ whiteSpace: 'pre-line' }}>{t.dashboard.anno2}</span>
              <ScribbleArrow w={130} h={56}
              d="M 4 8 Q 50 18 100 32 T 126 50 M 116 46 L 126 50 L 120 56" />
            </div>
          </div>

          <aside className="ag-dash-tail">
            <div className="ag-dash-tail-label">{t.dashboard.tailLabel}</div>
            <div className="ag-dash-tail-stream">
              {t.dashboard.tail.map((row, i) =>
              <div key={i} className={`ag-stream ag-stream-${row[1]}`}>
                  <span className="ag-stream-time">{row[0]}</span>
                  <span className="ag-stream-kind">{row[1]}</span>
                  <span className="ag-stream-msg">{row[2]}</span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>);

}

/* ─── PRICING ─── */
function Pricing() {
  const { t } = useLang();
  const tiers = t.pricing.tiers.map((tier, i) => ({ ...tier, featured: i === 1 }));
  return (
    <section className="ag-pricing" id="pricing">
      <div className="ag-section-head">
        <div className="ag-eyebrow">{t.pricing.eyebrow}</div>
        <h2 className="ag-h2">
          {t.pricing.titleA} <br />
          <span className="ag-em">{t.pricing.titleEm}</span>
        </h2>
        <p className="ag-section-sub">{t.pricing.sub}</p>
      </div>

      <div className="ag-pricing-grid">
        {tiers.map((tier, i) =>
        <div key={i} className={`ag-tier ${tier.featured ? 'ag-tier-featured' : ''}`}>
            {tier.featured && <div className="ag-tier-flag">{t.pricing.flag}</div>}
            <div className="ag-tier-name">{tier.name}</div>
            <div className="ag-tier-tag">{tier.tag}</div>
            <div className="ag-tier-price">
              <span className={`ag-tier-amt ${/^[a-z\u4e00-\u9fff]/i.test(tier.price) ? 'ag-tier-amt-text' : ''}`}>{tier.price}</span>
              <span className="ag-tier-per">{tier.per}</span>
            </div>
            <ul className="ag-tier-features">
              {tier.features.map((f, j) =>
            <li key={j}><span className="ag-check">✓</span>{f}</li>
            )}
            </ul>
            <a href="#" className={`ag-btn ${tier.featured ? 'ag-btn-primary' : 'ag-btn-ghost'} ag-btn-lg ag-btn-full`}>
              {tier.cta}
            </a>
          </div>
        )}
      </div>
    </section>);

}

/* ─── CTA / Footer ─── */
function FinalCta() {
  const { t } = useLang();
  return (
    <section className="ag-final">
      <div className="ag-final-inner">
        <Ag which="full" stroke={3.4} style={{ width: 220, height: 250, color: 'var(--ink)' }} />
        <div className="ag-final-copy">
          <h2 className="ag-h2">
            {t.final.titleA} <br />
            <span className="ag-em">{t.final.titleEm}</span>
          </h2>
          <p className="ag-section-sub">{t.final.sub}</p>
          <div className="ag-cta-row">
            <a className="ag-btn ag-btn-primary ag-btn-lg" href="#">{t.final.ctaPrimary}</a>
            <a className="ag-btn ag-btn-ghost ag-btn-lg" href="#">{t.final.ctaSecondary}</a>
          </div>
        </div>
      </div>
    </section>);

}

function Footer() {
  const { t } = useLang();
  return (
    <footer className="ag-footer">
      <div className="ag-footer-grid">
        <div className="ag-footer-brand">
          <div className="ag-logo">
            <Ag which="head" stroke={4} style={{ width: 38, height: 32 }} />
            <span className="ag-logo-text">agentma</span>
          </div>
          <p className="ag-footer-tag">{t.footer.tag}</p>
          <div className="ag-footer-meta">{t.footer.meta}</div>
        </div>
        {t.footer.cols.map((c, i) =>
        <div key={i} className="ag-footer-col">
            <div className="ag-footer-h">{c.h}</div>
            {c.l.map((li) => <a key={li} href="#" className="ag-footer-li">{li}</a>)}
          </div>
        )}
      </div>
      <div className="ag-footer-bottom">
        <span>{t.footer.bottom[0]}</span>
        <span>{t.footer.bottom[1]}</span>
        <span>{t.footer.legal.map((l, i) =>
          <React.Fragment key={i}>
            <a href="#">{l}</a>{i < t.footer.legal.length - 1 && ' · '}
          </React.Fragment>
          )}</span>
      </div>
    </footer>);

}

/* ─── App ─── */
function App() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <LanguageProvider>
      <div className="ag-app">
        <Nav dark={dark} setDark={setDark} />
        <Hero />
        <Problem />
        <Features />
        <Dashboard />
        <Pricing />
        <FinalCta />
        <Footer />
      </div>
    </LanguageProvider>);

}

window.AgentmaApp = App;