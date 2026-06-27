import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { composeSrcdoc, type VisualTheme } from './composeSrcdoc';

export const VISUAL_FRAME_SANDBOX = 'allow-scripts';

type VisualFrameProps = {
  html: string;
};

type VisualErrorBoundaryProps = {
  html: string;
  children: ReactNode;
};

type VisualErrorBoundaryState = {
  hasError: boolean;
};

class VisualErrorBoundary extends Component<VisualErrorBoundaryProps, VisualErrorBoundaryState> {
  state: VisualErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.hasError) {
      return (
        <div className="visual-frame-fallback">
          <strong>无法渲染此可视化</strong>
          <pre>{this.props.html}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function clampHeight(value: unknown) {
  const height = Number(value);
  if (!Number.isFinite(height)) return null;
  return Math.min(4000, Math.max(24, Math.ceil(height)));
}

function readTheme(): VisualTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return {};
  const computed = window.getComputedStyle(document.documentElement);
  const theme: VisualTheme = {};
  for (const key of ['--bg', '--ink', '--ink-secondary', '--border', '--accent', '--bg-hover']) {
    const value = computed.getPropertyValue(key).trim();
    if (value) theme[key] = value;
  }
  theme['font-family'] = computed.fontFamily;
  return theme;
}

function VisualFrameInner({ html }: VisualFrameProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(160);
  const theme = useMemo(() => readTheme(), []);
  const srcDoc = useMemo(() => composeSrcdoc(html, theme), [html, theme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (!event.data?.__agentmaVisual) return;
      const nextHeight = clampHeight(event.data.h);
      if (nextHeight !== null) setHeight(nextHeight);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title="可视化预览"
      sandbox={VISUAL_FRAME_SANDBOX}
      allow="fullscreen"
      allowFullScreen
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{
        width: '100%',
        height,
        minHeight: 'var(--visual-frame-min-height, 560px)',
        border: 0,
        display: 'block',
      }}
    />
  );
}

export default function VisualFrame({ html }: VisualFrameProps) {
  return (
    <VisualErrorBoundary html={html}>
      <VisualFrameInner html={html} />
    </VisualErrorBoundary>
  );
}
