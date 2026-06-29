import { useEffect, useState } from 'react';

export default function WaitingHint({ label = '整理思路' }: { label?: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const showElapsed = secs >= 4;
  const showStillWorking = secs >= 8;

  return (
    <div
      className="waiting-hint"
      role="status"
      aria-live="polite"
      aria-label={showElapsed ? `${label}，已等待 ${secs} 秒` : `${label}…`}
    >
      <span className="waiting-hint__signal" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="waiting-hint__copy">
        <span className="waiting-hint__label">{label}</span>
        {showStillWorking && <span className="waiting-hint__sub">还在处理</span>}
      </span>
      {showElapsed && <span className="waiting-hint__time" aria-hidden="true">{secs}s</span>}
    </div>
  );
}
