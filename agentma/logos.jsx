/* global React, Character, CharacterHead */

/* ──────────────────────────────────────────────────────────
   Hand-drawn wordmark variants for "agentma"
   Some use a handwriting font; some use mono; some are SVG-y
   ────────────────────────────────────────────────────────── */

function Wordmark({ font = 'caveat', color = '#6b2419', size = 120, weight = 700, tracking = '-0.02em', tilt = 0, style = {} }) {
  const families = {
    caveat: '"Caveat", "Bradley Hand", cursive',
    marker: '"Permanent Marker", "Caveat", cursive',
    rock: '"Rock Salt", "Caveat", cursive',
    schoolbell: '"Schoolbell", "Caveat", cursive',
    mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
    serif: '"Gloock", "Cormorant Garamond", serif',
    arch: '"Architects Daughter", "Caveat", cursive',
  };
  return (
    <span style={{
      fontFamily: families[font] || families.caveat,
      fontSize: size,
      fontWeight: weight,
      letterSpacing: tracking,
      color,
      lineHeight: 0.9,
      display: 'inline-block',
      transform: tilt ? `rotate(${tilt}deg)` : undefined,
      ...style,
    }}>agentma</span>
  );
}

/* Subtitle / kicker copy in the platform-context. */
function Kicker({ children, color = '#6b2419', size = 13, opacity = 0.7, tracking = '0.32em', style = {} }) {
  return (
    <div style={{
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: size,
      letterSpacing: tracking,
      textTransform: 'uppercase',
      color, opacity,
      ...style,
    }}>{children}</div>
  );
}

/* Paper texture backdrop — subtle dot grid like the napkin. */
function PaperBg({ color = '#f4f0e6', dot = '#6b2419', children, padding = 40, style = {} }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: `radial-gradient(${dot}22 1px, transparent 1.2px) ${color}`,
      backgroundSize: '18px 18px',
      backgroundPosition: '0 0',
      padding,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style,
    }}>{children}</div>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 01 — Napkin Original
   Full character + handwritten wordmark, cream paper.
   ────────────────────────────────────────────────────────── */
function Logo01() {
  return (
    <PaperBg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <Character color="#6b2419" stroke={3.2} style={{ width: 220, height: 250 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <Wordmark font="caveat" color="#6b2419" size={156} weight={700} tracking="-0.01em" tilt={-2} />
          <Kicker color="#6b2419">agent management platform</Kicker>
        </div>
      </div>
    </PaperBg>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 02 — Pumpkin Patch
   Orange + black, character on warm ground, marker wordmark.
   ────────────────────────────────────────────────────────── */
function Logo02() {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0d0a08',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
        <Character color="#ff8a3d" fill="#ff8a3d22" stroke={3.5} style={{ width: 220, height: 250 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <Wordmark font="marker" color="#ff8a3d" size={130} weight={400} tracking="-0.02em" tilt={-1.5} />
          <Kicker color="#ff8a3d" opacity={0.55}>ship the spooky agents</Kicker>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 03 — Stamp Seal
   Circular badge with ring text and creature in middle.
   ────────────────────────────────────────────────────────── */
function Logo03() {
  return (
    <PaperBg padding={20}>
      <svg viewBox="0 0 520 520" style={{ width: 420, height: 420 }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <path id="ring" d="M 260 260 m -210 0 a 210 210 0 1 1 420 0 a 210 210 0 1 1 -420 0" />
          <path id="ringB" d="M 260 260 m -170 0 a 170 170 0 1 0 340 0 a 170 170 0 1 0 -340 0" />
        </defs>
        {/* outer ring (rough) */}
        <circle cx="260" cy="260" r="240" fill="none" stroke="#6b2419" strokeWidth="3" strokeDasharray="0 0" />
        <circle cx="260" cy="260" r="232" fill="none" stroke="#6b2419" strokeWidth="1.5" opacity="0.5" />
        <circle cx="260" cy="260" r="200" fill="none" stroke="#6b2419" strokeWidth="2" />
        <text fontFamily='"JetBrains Mono", monospace' fontSize="15" fill="#6b2419" letterSpacing="6">
          <textPath href="#ring" startOffset="2%">AGENT · MANAGEMENT · PLATFORM · EST · 2026 · ─ · ✷ · ─ · </textPath>
        </text>
        {/* tiny stars */}
        {[[60,260],[460,260],[260,60],[260,460]].map(([x,y],i)=>(
          <text key={i} x={x} y={y+4} textAnchor="middle" fontSize="16" fill="#6b2419">✷</text>
        ))}
      </svg>
      <div style={{ position: 'absolute', display:'flex', flexDirection:'column', alignItems:'center' }}>
        <Character color="#6b2419" stroke={3.2} style={{ width: 180, height: 200 }} />
        <Wordmark font="caveat" color="#6b2419" size={56} tilt={-2} style={{ marginTop: 4 }} />
      </div>
    </PaperBg>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 04 — Big "a" Monogram
   Massive handwritten "a", creature peeks from behind.
   ────────────────────────────────────────────────────────── */
function Logo04() {
  return (
    <PaperBg>
      <div style={{ position: 'relative', width: 480, height: 360 }}>
        <span style={{
          position: 'absolute', inset: 0,
          fontFamily: '"Caveat", cursive', fontWeight: 700,
          fontSize: 460, color: '#6b2419', lineHeight: 0.8,
          letterSpacing: '-0.04em',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>a</span>
        <Character color="#6b2419" stroke={3.5} style={{
          position: 'absolute',
          right: -10, top: 60,
          width: 200, height: 230,
          transform: 'rotate(8deg)',
        }} />
        <Kicker color="#6b2419" style={{ position: 'absolute', bottom: -28, left: 0, right: 0, textAlign: 'center' }}>
          a · g · e · n · t · m · a
        </Kicker>
      </div>
    </PaperBg>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 05 — Tech Tag
   Hand-drawn creature crashes into a clean mono wordmark.
   The "agent platform" contrast play.
   ────────────────────────────────────────────────────────── */
function Logo05() {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#f4f0e6',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Character color="#181410" stroke={3.2} style={{ width: 170, height: 195 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <Wordmark font="mono" color="#181410" size={92} weight={700} tracking="-0.06em" />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
            color: '#181410', opacity: 0.55,
          }}>
            <span style={{ display:'inline-block', width:8, height:8, background:'#ff5a3d', borderRadius:'50%' }}></span>
            <span>v0.1.0 — sandbox</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 06 — Sticker
   Die-cut sticker look — character with thick cream halo on dark.
   ────────────────────────────────────────────────────────── */
function Logo06() {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#1a1614',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, boxSizing: 'border-box',
    }}>
      <div style={{
        position: 'relative',
        padding: '28px 36px',
        background: '#f4f0e6',
        borderRadius: 28,
        boxShadow: '0 14px 0 0 #00000055, 0 30px 60px -20px #00000088',
        transform: 'rotate(-4deg)',
        display: 'flex', alignItems: 'center', gap: 22,
        border: '5px solid #f4f0e6',
        outline: '2px solid #6b241944',
        outlineOffset: '-14px',
      }}>
        <Character color="#6b2419" stroke={3.4} style={{ width: 150, height: 170 }} />
        <div style={{ display:'flex', flexDirection:'column', gap: 4, alignItems:'flex-start' }}>
          <Wordmark font="marker" color="#6b2419" size={86} weight={400} tilt={-2} />
          <Kicker color="#6b2419" size={11} tracking="0.4em">agent · ops</Kicker>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 07 — Tombstone
   Gothic moody arch frame, gravestone hatching.
   ────────────────────────────────────────────────────────── */
function Logo07() {
  return (
    <PaperBg color="#e9e1cf" dot="#3a2a22" padding={20}>
      <svg viewBox="0 0 320 400" style={{ width: 280, height: 350 }} xmlns="http://www.w3.org/2000/svg">
        {/* tombstone arch */}
        <path
          d="M 30 380 L 30 160 Q 30 30 160 30 Q 290 30 290 160 L 290 380 Z"
          fill="none" stroke="#3a2a22" strokeWidth="3.5" strokeLinejoin="round"
        />
        <path
          d="M 40 380 L 40 160 Q 40 40 160 40 Q 280 40 280 160 L 280 380"
          fill="none" stroke="#3a2a22" strokeWidth="1" opacity="0.45"
        />
        {/* hatching at the base */}
        {Array.from({length: 9}).map((_, i) => (
          <line key={i} x1={50 + i*8} y1="370" x2={50 + i*8 - 14} y2="384" stroke="#3a2a22" strokeWidth="1.6"/>
        ))}
        {Array.from({length: 9}).map((_, i) => (
          <line key={'b'+i} x1={170 + i*8} y1="370" x2={170 + i*8 - 14} y2="384" stroke="#3a2a22" strokeWidth="1.6"/>
        ))}
      </svg>
      <div style={{ position:'absolute', display:'flex', flexDirection:'column', alignItems:'center', gap: 8, marginTop: 8 }}>
        <Kicker color="#3a2a22" size={10} tracking="0.5em" opacity={0.8}>HERE LIES YOUR BACKLOG</Kicker>
        <Character color="#3a2a22" stroke={3} style={{ width: 150, height: 170 }} />
        <Wordmark font="serif" color="#3a2a22" size={42} weight={500} tracking="0.04em" />
      </div>
    </PaperBg>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 08 — App Icon
   Tight head crop in a rounded square. The favicon / app tile.
   ────────────────────────────────────────────────────────── */
function Logo08() {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#1a1614',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, boxSizing: 'border-box',
      gap: 40,
    }}>
      {[
        { bg: '#f4f0e6', fg: '#6b2419' },
        { bg: '#ff8a3d', fg: '#1a1614' },
        { bg: '#1a1614', fg: '#f4f0e6' },
      ].map((c, i) => (
        <div key={i} style={{
          width: 180, height: 180, borderRadius: 40,
          background: c.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 18px 40px -10px #00000077',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <CharacterHead color={c.fg} stroke={4.5} style={{ width: '92%', height: '92%', marginTop: 16 }} />
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 09 — Horizontal Banner
   Wide layout — wordmark dominant, creature anchored right.
   ────────────────────────────────────────────────────────── */
function Logo09() {
  return (
    <PaperBg padding={32}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, width: '100%', justifyContent: 'space-between', maxWidth: 880 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 18 }}>
          <Wordmark font="caveat" color="#6b2419" size={210} weight={700} tracking="-0.02em" tilt={-1} />
          <div style={{ display:'flex', alignItems:'center', gap: 14 }}>
            <div style={{ width: 28, height: 2, background: '#6b2419' }}></div>
            <Kicker color="#6b2419" size={14} tracking="0.4em">
              wrangle your agents · before they wrangle you
            </Kicker>
          </div>
        </div>
        <Character color="#6b2419" stroke={3.2} style={{ width: 240, height: 270 }} />
      </div>
    </PaperBg>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 10 — Stacked Compact
   Centered card for narrow placements.
   ────────────────────────────────────────────────────────── */
function Logo10() {
  return (
    <PaperBg>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 14 }}>
        <Character color="#6b2419" stroke={3.4} style={{ width: 200, height: 230 }} />
        <Wordmark font="marker" color="#6b2419" size={86} weight={400} tilt={-2} />
        <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
          <span style={{ width:6, height:6, background:'#6b2419', borderRadius:'50%' }}></span>
          <Kicker color="#6b2419" size={11} tracking="0.45em">agent · management · platform</Kicker>
          <span style={{ width:6, height:6, background:'#6b2419', borderRadius:'50%' }}></span>
        </div>
      </div>
    </PaperBg>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 11 — Receipt
   Black ink on cream — paper-receipt aesthetic with dashed border.
   ────────────────────────────────────────────────────────── */
function Logo11() {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#1a1614',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 30, boxSizing: 'border-box',
    }}>
      <div style={{
        background: '#f4f0e6',
        padding: '32px 40px 26px',
        width: 320,
        position: 'relative',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), 96% 100%, 92% calc(100% - 8px), 88% 100%, 84% calc(100% - 8px), 80% 100%, 76% calc(100% - 8px), 72% 100%, 68% calc(100% - 8px), 64% 100%, 60% calc(100% - 8px), 56% 100%, 52% calc(100% - 8px), 48% 100%, 44% calc(100% - 8px), 40% 100%, 36% calc(100% - 8px), 32% 100%, 28% calc(100% - 8px), 24% 100%, 20% calc(100% - 8px), 16% 100%, 12% calc(100% - 8px), 8% 100%, 4% calc(100% - 8px), 0 100%)',
      }}>
        <div style={{ borderBottom: '1px dashed #181410', paddingBottom: 8, marginBottom: 12,
          fontFamily:'"JetBrains Mono", monospace', fontSize: 11, letterSpacing: '0.25em',
          color: '#181410', display: 'flex', justifyContent: 'space-between' }}>
          <span>RECEIPT</span><span>№ 0007</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 6 }}>
          <Character color="#181410" stroke={3.2} style={{ width: 150, height: 170 }} />
          <Wordmark font="marker" color="#181410" size={62} weight={400} tilt={-1} />
        </div>
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed #181410',
          fontFamily:'"JetBrains Mono", monospace', fontSize: 10, letterSpacing: '0.2em',
          color: '#181410', textAlign: 'center', opacity: 0.7 }}>
          1 × agent management platform · paid in full
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   LOGO 12 — Reverse / dark mode primary
   Cream lines on dark, with a glowing pumpkin accent eye.
   ────────────────────────────────────────────────────────── */
function Logo12() {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: `radial-gradient(#2a201c 1px, transparent 1.2px) #1a1614`,
      backgroundSize: '18px 18px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <div style={{ position: 'relative' }}>
          <Character color="#f4f0e6" stroke={3.2} style={{ width: 220, height: 250 }} />
          {/* glow dot for the eye */}
          <div style={{
            position: 'absolute', left: '54%', top: '36%',
            width: 18, height: 18, borderRadius: '50%',
            background: '#ff8a3d',
            boxShadow: '0 0 24px 6px #ff8a3daa',
          }}></div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap: 10, alignItems:'flex-start' }}>
          <Wordmark font="caveat" color="#f4f0e6" size={156} weight={700} tracking="-0.01em" tilt={-2} />
          <Kicker color="#ff8a3d" opacity={0.85}>night shift · always on</Kicker>
        </div>
      </div>
    </div>
  );
}

window.LOGOS = [
  { id: 'napkin',     label: 'Napkin Original',     comp: Logo01, w: 880, h: 480 },
  { id: 'pumpkin',    label: 'Pumpkin Patch',       comp: Logo02, w: 880, h: 480 },
  { id: 'seal',       label: 'Stamp Seal',          comp: Logo03, w: 560, h: 560 },
  { id: 'monogram',   label: 'Big "a" Monogram',    comp: Logo04, w: 640, h: 520 },
  { id: 'tech',       label: 'Tech Tag (mono)',     comp: Logo05, w: 760, h: 360 },
  { id: 'sticker',    label: 'Die-cut Sticker',     comp: Logo06, w: 720, h: 480 },
  { id: 'tombstone',  label: 'Tombstone',           comp: Logo07, w: 480, h: 520 },
  { id: 'appicon',    label: 'App Icon Trio',       comp: Logo08, w: 760, h: 320 },
  { id: 'banner',     label: 'Horizontal Banner',   comp: Logo09, w: 1080, h: 420 },
  { id: 'stacked',    label: 'Stacked Compact',     comp: Logo10, w: 520, h: 520 },
  { id: 'receipt',    label: 'Receipt',             comp: Logo11, w: 520, h: 540 },
  { id: 'darkmode',   label: 'Dark Mode Primary',   comp: Logo12, w: 880, h: 480 },
];
