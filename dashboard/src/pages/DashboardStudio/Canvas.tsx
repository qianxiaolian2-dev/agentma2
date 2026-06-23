import { useMemo, useRef, useState, useEffect } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { WidgetRenderer } from './WidgetRenderer';
import type { DashboardLayout, Widget } from './types';

interface Props {
  layout: DashboardLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLayoutChange: (next: DashboardLayout) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}

const ROW_HEIGHT = 40;
const COLS = 12;

export function Canvas({ layout, selectedId, onSelect, onLayoutChange, onDelete, readOnly }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Math.abs(w - width) > 1) setWidth(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rglLayout: Layout[] = useMemo(
    () => layout.widgets.map((w) => ({
      i: w.id,
      x: w.grid.x, y: w.grid.y, w: w.grid.w, h: w.grid.h,
      minW: w.grid.minW ?? 3, minH: w.grid.minH ?? 3,
    })),
    [layout.widgets],
  );

  // resizeKey:网格变化时让所有图表重新 resize
  const resizeKey = useMemo(
    () => layout.widgets.map((w) => `${w.id}:${w.grid.w}x${w.grid.h}`).join('|'),
    [layout.widgets],
  );

  const handleLayoutChange = (l: Layout[]) => {
    const byId = new Map(l.map((it) => [it.i, it]));
    let changed = false;
    const nextWidgets: Widget[] = layout.widgets.map((w) => {
      const it = byId.get(w.id);
      if (!it) return w;
      if (it.x === w.grid.x && it.y === w.grid.y && it.w === w.grid.w && it.h === w.grid.h) return w;
      changed = true;
      return { ...w, grid: { ...w.grid, x: it.x, y: it.y, w: it.w, h: it.h }, manualEdited: true };
    });
    if (changed) onLayoutChange({ ...layout, widgets: nextWidgets });
  };

  const theme = layout.meta.theme;

  return (
    <div
      className="ds-canvas-wrap"
      ref={wrapRef}
      style={theme?.canvasBg ? { background: theme.canvasBg } : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <GridLayout
        className="ds-grid"
        layout={rglLayout}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        width={width}
        margin={[12, 12]}
        containerPadding={[12, 12]}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".ds-widget-handle"
        compactType="vertical"
        useCSSTransforms
        isDraggable={!readOnly}
        isResizable={!readOnly}
      >
        {layout.widgets.map((w) => {
          const appearance = (w.options as any)?.appearance || {};
          const cardStyle: React.CSSProperties = {};
          const bg = appearance.backgroundColor || theme?.cardBg;
          const border = appearance.borderColor || theme?.cardBorder;
          if (bg) cardStyle.background = bg;
          if (border) cardStyle.borderColor = border;
          const titleColor = appearance.titleColor || theme?.titleColor;
          return (
            <div
              key={w.id}
              className={`ds-widget ${selectedId === w.id ? 'ds-widget-selected' : ''}`}
              style={cardStyle}
              onClick={(e) => { e.stopPropagation(); onSelect(w.id); }}
            >
              <div className="ds-widget-header">
                <span className="ds-widget-handle" title="拖拽">⠿</span>
                <span className="ds-widget-title" style={titleColor ? { color: titleColor } : undefined}>{w.title}</span>
                <button className="ds-widget-del" title="删除" onClick={(e) => { e.stopPropagation(); onDelete(w.id); }}>×</button>
              </div>
              <div className="ds-widget-body">
                {w.type === 'html' && !w.options?.visualId && !w.options?.html
                  ? <div className="ds-widget-state">请选择一个已保存的 HTML 可视化</div>
                  : <WidgetRenderer widget={w} datasourceId={layout.meta.datasourceId} tableName={layout.meta.tableName} theme={theme} resizeKey={`${w.grid.w}x${w.grid.h}`} />}
              </div>
            </div>
          );
        })}
      </GridLayout>
      <div style={{ display: 'none' }}>{resizeKey}</div>
    </div>
  );
}
