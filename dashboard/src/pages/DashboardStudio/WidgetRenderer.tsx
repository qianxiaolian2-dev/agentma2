import { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { queryWidget } from './api';
import type { QueryResult, Widget } from './types';
import { encodingToOption } from './encodingToOption';

interface Props {
  widget: Widget;
  datasourceId: string;
  tableName: string;
  /** 父级尺寸变化(拖拽/resize)时主动触发图表 resize */
  resizeKey?: string;
}

export function WidgetRenderer({ widget, datasourceId, tableName, resizeKey }: Props) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const echartsRef = useRef<any>(null);

  // 监控 widget.data 变化重新查询
  const dataKey = useMemo(
    () => JSON.stringify({ id: widget.id, type: widget.type, data: widget.data }),
    [widget.id, widget.type, widget.data],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    queryWidget(datasourceId, tableName, widget)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((err) => { if (!cancelled) setError(err.message || '查询失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, datasourceId, tableName]);

  // 拖拽尺寸变化触发 echarts resize
  useEffect(() => {
    const inst = echartsRef.current?.getEchartsInstance?.();
    if (inst) requestAnimationFrame(() => inst.resize());
  }, [resizeKey]);

  if (error) {
    return <div className="ds-widget-state ds-widget-error">查询失败: {error}</div>;
  }
  if (loading && !result) {
    return <div className="ds-widget-state">加载中…</div>;
  }
  if (!result) return null;

  // KPI:不走 echarts,直接 div
  if (widget.type === 'kpi') {
    const v = result.rows[0] ? Object.values(result.rows[0])[0] : 0;
    const num = typeof v === 'number' ? v : Number(v);
    const enc = widget.data.encoding;
    const aggLabel: Record<string, string> = {
      sum: '求和', avg: '平均', count: '计数', count_distinct: '去重计数',
      max: '最大', min: '最小',
    };
    let caption = '';
    if (enc?.y?.field) {
      const f = enc.y.field;
      const a = enc.y.agg || 'sum';
      caption = (f === '*' || a === 'count') ? '记录数 (COUNT)'
        : a === 'count_distinct' ? `去重计数 · ${f}`
        : `${aggLabel[a] || a.toUpperCase()}(${f})`;
    }
    return (
      <div className="ds-kpi">
        <div className="ds-kpi-value">{Number.isFinite(num) ? formatNumber(num) : String(v ?? '-')}</div>
        <div className="ds-kpi-label">{widget.title}</div>
        {caption && <div className="ds-kpi-caption">{caption}</div>}
      </div>
    );
  }

  // table:原生表格
  if (widget.type === 'table') {
    const cols = result.columns;
    return (
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.slice(0, 50).map((row, i) => (
              <tr key={i}>{cols.map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {result.rowCount > 50 && <div className="ds-table-foot">仅显示前 50 行（共 {result.rowCount} 行）</div>}
      </div>
    );
  }

  // text widget:静态说明卡
  if (widget.type === 'text') {
    return <div className="ds-text-card">{widget.title}</div>;
  }

  const option = encodingToOption(widget, result);
  return (
    <ReactECharts
      ref={echartsRef}
      option={option}
      notMerge
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  return n.toLocaleString('zh-CN');
}
