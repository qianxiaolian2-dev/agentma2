import type { Widget, QueryResult } from './types';

const CHART_PALETTE = [
  '#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A',
  '#6DC8EC', '#9270CA', '#FF9D4D', '#269A99', '#FF99C3',
];

const BASE = {
  color: CHART_PALETTE,
  textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
  grid: { left: 56, right: 24, top: 36, bottom: 48, containLabel: true },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  animation: true,
};

// 把后端 widgetQuery 返回的 columns/rows 翻成 ECharts 友好的 [name,value] 数组
function pickXY(result: QueryResult): { x: any[]; y: number[] } {
  const cols = result.columns;
  if (cols.includes('x_value') && cols.includes('y_value')) {
    return {
      x: result.rows.map((r) => r.x_value),
      y: result.rows.map((r) => Number(r.y_value)),
    };
  }
  if (cols.length >= 2) {
    return {
      x: result.rows.map((r) => r[cols[0]]),
      y: result.rows.map((r) => Number(r[cols[1]])),
    };
  }
  return { x: [], y: [] };
}

// —— 推导轴标题:从 encoding 字段名 + 聚合方式 ——
function buildAxisLabel(field: string | undefined, agg?: string): string {
  if (!field || field === '*') return agg === 'count' || !agg ? '记录数' : '';
  if (!agg) return field;
  const aggLabel: Record<string, string> = {
    sum: '求和', avg: '平均', count: '计数', count_distinct: '去重计数',
    max: '最大', min: '最小',
  };
  if (agg === 'count' || agg === 'count_distinct') return `${field} (${aggLabel[agg]})`;
  return `${aggLabel[agg]}(${field})`;
}

export function encodingToOption(widget: Widget, result: QueryResult, palette?: string[]): any {
  const t = widget.type;
  const rawOptions = widget.options || {};
  const enc = widget.data.encoding || {};
  // 配色优先级:组件 appearance.palette > 看板 theme.palette(传入) > 默认
  const appearance = (rawOptions as any).appearance || {};
  const colorList: string[] = (Array.isArray(appearance.palette) && appearance.palette.length)
    ? appearance.palette
    : (Array.isArray(palette) && palette.length ? palette : CHART_PALETTE);
  const baseWithColor = { ...BASE, color: colorList };
  // userOptions 里剔除非 echarts 字段,避免污染 option
  const { appearance: _a, visualId: _v, html: _h, text: _txt, ...userOptions } = rawOptions as any;

  if (t === 'line' || t === 'bar' || t === 'scatter') {
    const { x, y } = pickXY(result);
    const isTime = enc.x?.type === 'time';
    const xLabel = enc.x?.field || '';
    const yLabel = buildAxisLabel(enc.y?.field, enc.y?.agg);
    // 横向柱状图(条形图):options.orient='horizontal' 时交换 x/y 轴
    const horizontal = t === 'bar' && (rawOptions as any).orient === 'horizontal';
    if (horizontal) {
      return {
        ...baseWithColor,
        grid: { left: 80, right: 24, top: 36, bottom: 36, containLabel: true },
        xAxis: {
          type: 'value',
          name: yLabel,
          nameLocation: 'middle', nameGap: 24,
          nameTextStyle: { color: '#666', fontSize: 11 },
          axisLabel: { color: '#666', fontSize: 11 },
        },
        yAxis: {
          type: 'category',
          data: x,
          inverse: true,  // 第一名在最上面
          name: xLabel,
          axisLabel: { color: '#666', fontSize: 11 },
        },
        series: [{
          type: 'bar',
          name: yLabel,
          data: y,
          itemStyle: { borderRadius: [0, 3, 3, 0] },
        }],
        ...userOptions,
      };
    }
    return {
      ...baseWithColor,
      xAxis: {
        type: isTime ? 'time' : 'category',
        data: isTime ? undefined : x,
        name: xLabel,
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: '#666', fontSize: 11 },
        axisLabel: { color: '#666', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: yLabel,
        nameTextStyle: { color: '#666', fontSize: 11, padding: [0, 0, 0, -8] },
        axisLabel: { color: '#666', fontSize: 11 },
      },
      series: [{
        type: t === 'scatter' ? 'scatter' : t,
        name: yLabel,
        data: isTime ? x.map((xv, i) => [xv, y[i]]) : y,
        smooth: t === 'line',
        showBackground: t === 'bar',
        backgroundStyle: { color: 'rgba(180,180,180,0.05)' },
        itemStyle: { borderRadius: t === 'bar' ? [3, 3, 0, 0] : 0 },
        symbol: t === 'line' ? 'circle' : undefined,
        symbolSize: 5,
      }],
      ...userOptions,
    };
  }

  if (t === 'pie' || t === 'donut') {
    const { x, y } = pickXY(result);
    const data = x.map((name, i) => ({ name: String(name ?? ''), value: y[i] }));
    return {
      ...baseWithColor,
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: {
        type: 'scroll', orient: 'horizontal',
        bottom: 4, left: 'center',
        textStyle: { fontSize: 11 },
        itemWidth: 12, itemHeight: 8,
      },
      series: [{
        type: 'pie',
        name: enc.color?.field || '',
        radius: t === 'donut' ? ['42%', '64%'] : '64%',
        center: ['50%', '46%'],
        data,
        avoidLabelOverlap: true,
        label: {
          show: t === 'pie',
          formatter: '{b}\n{d}%',
          fontSize: 10,
        },
        labelLine: { length: 8, length2: 6 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' } },
      }],
      ...userOptions,
    };
  }

  if (t === 'funnel') {
    const { x, y } = pickXY(result);
    return {
      ...baseWithColor,
      tooltip: { trigger: 'item', formatter: '{b}: {c}' },
      series: [{
        type: 'funnel',
        sort: 'descending',
        gap: 4,
        data: x.map((name, i) => ({ name: String(name ?? ''), value: y[i] })),
        label: { show: true, position: 'inside', formatter: '{b}\n{c}' },
      }],
      ...userOptions,
    };
  }

  if (t === 'gauge') {
    const value = result.rows[0] ? Number(Object.values(result.rows[0])[0]) : 0;
    const yLabel = buildAxisLabel(enc.y?.field, enc.y?.agg);
    return {
      ...baseWithColor,
      series: [{
        type: 'gauge',
        progress: { show: true, width: 18 },
        axisLine: { lineStyle: { width: 18 } },
        title: { show: true, offsetCenter: [0, '70%'], fontSize: 12, color: '#666' },
        detail: { valueAnimation: true, fontSize: 28, formatter: '{value}', offsetCenter: [0, 0] },
        data: [{ value, name: yLabel }],
      }],
      ...userOptions,
    };
  }

  if (t === 'heatmap') {
    const xs = Array.from(new Set(result.rows.map((r) => r.x_value as any))) as any[];
    const ys = Array.from(new Set(result.rows.map((r) => r.y_value as any))) as any[];
    const cell = result.columns.includes('value') ? 'value' : (result.columns[2] || 'y_value');
    return {
      ...baseWithColor,
      tooltip: { position: 'top' },
      xAxis: { type: 'category', data: xs.map(String), splitArea: { show: true } },
      yAxis: { type: 'category', data: ys.map(String), splitArea: { show: true } },
      visualMap: { min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
      series: [{
        type: 'heatmap',
        data: result.rows.map((r) => [
          xs.indexOf(r.x_value), ys.indexOf(r.y_value), Number(r[cell]),
        ]),
      }],
      ...userOptions,
    };
  }

  return { ...baseWithColor };
}
