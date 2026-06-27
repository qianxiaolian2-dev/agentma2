import { useEffect } from 'react';

declare global {
  interface Window {
    installMascot?: () => void;
  }
}

export default function AgentMaMark({ className = 'agentma-mark' }: { className?: string }) {
  useEffect(() => {
    window.installMascot?.();
  }, []);

  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="40 0 580 460" preserveAspectRatio="xMidYMid meet">
        <use href="#agentma-head" />
      </svg>
    </span>
  );
}
