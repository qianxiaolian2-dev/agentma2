/* global React */
const { useMemo } = React;

/* ────────────────────────────────────────────────────────────
   Character: renders the 30 napkin strokes as SVG paths.
   Props let each artboard tint, weight, and frame the creature.
   ──────────────────────────────────────────────────────────── */
function Character({
  color = '#6b2419',
  fill = 'none',
  stroke = 2.8,
  jitter = 0,            // small random offset per path -> rougher look
  style = {},
  className = '',
}) {
  const { w, h, paths } = window.AGENTMA;
  // Deterministic jitter
  const offsets = useMemo(() => {
    const arr = [];
    let s = 1;
    for (let i = 0; i < paths.length; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      arr.push([(r - 0.5) * jitter, ((r * 7 % 1) - 0.5) * jitter]);
    }
    return arr;
  }, [paths.length, jitter]);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      preserveAspectRatio="xMidYMid meet"
    >
      {fill !== 'none' && (
        // Use the head outline (path 0 is largest closed-ish stroke) as a fill backdrop
        <path d={paths[0]} fill={fill} stroke="none" />
      )}
      <g
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            transform={jitter ? `translate(${offsets[i][0]} ${offsets[i][1]})` : undefined}
          />
        ))}
      </g>
    </svg>
  );
}

/* Just the head — crops the SVG to the upper portion. */
function CharacterHead({ color = '#6b2419', stroke = 3.2, style = {}, className = '' }) {
  const { paths } = window.AGENTMA;
  // Head occupies roughly y 0..430 in the 650x737 viewBox
  return (
    <svg viewBox="40 0 580 460" xmlns="http://www.w3.org/2000/svg" className={className} style={style} preserveAspectRatio="xMidYMid meet">
      <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  );
}

window.Character = Character;
window.CharacterHead = CharacterHead;
