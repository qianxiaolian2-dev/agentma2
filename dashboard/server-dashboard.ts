// ─── Dashboard Studio (AI 自动看板) ────────────────────────────────────────
// 数据源画像 → LLM 布局生成 → 单 widget 查询 → 布局持久化的后端纯逻辑层。
// HTTP 路由在 server.ts 里挂载,本文件只导出可被复用与单测的纯函数 + 类型。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  inspectSqliteSchema,
  runDatasourceQuery,
  validateReadOnlySql,
  type DatasourceColumn,
  type DatasourceTable,
  type DatasourceQueryResult,
} from './server-datasource.ts';

// ─── 类型 ────────────────────────────────────────────────────────────────
export type FieldRole = 'time' | 'metric' | 'dimension' | 'id' | 'text' | 'geo' | 'unknown';

export interface FieldProfile {
  name: string;
  type: string;             // SQLite 原始类型 INTEGER/REAL/TEXT
  role: FieldRole;          // 推断出的语义角色
  cardinality: number;      // 不同值数量(抽样估算)
  nullRate: number;         // 0~1
  isIdLike: boolean;        // 高基数 ID(姓名/单号/uuid)
  isMetric: boolean;        // 适合做 y 轴数值
  isTime: boolean;          // 时间字段
  samples: string[];        // top 3 样例值
  min?: number;             // 数值字段
  max?: number;
}

export type DashboardScenario =
  | 'sales' | 'retention' | 'logistics' | 'workflow'
  | 'attendance' | 'finance' | 'inventory' | 'unknown';

export interface DatasetProfile {
  datasourceId: string;
  tableName: string;
  rowCount: number;
  fields: FieldProfile[];
  scenario: DashboardScenario;
  scenarioReason: string;
  suggestedMetrics: string[];   // 排序后的指标候选
  suggestedDimensions: string[];
  timeFields: string[];
  geoFields: string[];
  generatedAt: string;
}

export interface DashboardTheme {
  accent?: string;
  canvasBg?: string;
  cardBg?: string;
  cardBorder?: string;
  titleColor?: string;
  kpiColor?: string;
  palette?: string[];
}

export interface WidgetAppearance {
  backgroundColor?: string;
  borderColor?: string;
  titleColor?: string;
  valueColor?: string;
  palette?: string[];
}

export interface WidgetOptions {
  visualId?: string;
  html?: string;
  text?: string;
  appearance?: WidgetAppearance;
  [key: string]: unknown;
}

// ─── DashboardLayout v1 (前后端通信契约) ─────────────────────────────────
export type WidgetType =
  | 'line' | 'bar' | 'pie' | 'donut' | 'kpi' | 'table'
  | 'heatmap' | 'funnel' | 'gauge' | 'scatter' | 'text' | 'html';

export interface WidgetEncoding {
  x?: { field: string; type: 'time' | 'nominal' | 'ordinal' | 'quantitative' };
  y?: { field: string; type: 'quantitative'; agg?: 'sum' | 'avg' | 'count' | 'count_distinct' | 'max' | 'min' };
  color?: { field: string };
  series?: { field: string };
}

export type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in' | 'contains' | 'is_null' | 'is_not_null' | 'between';

export interface WidgetFilter {
  field: string;
  op: FilterOp;
  value?: string | number | (string | number)[];
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  grid: { x: number; y: number; w: number; h: number; minW?: number; minH?: number };
  data: {
    sql?: string;
    encoding?: WidgetEncoding;
    limit?: number;
    orderBy?: { field: string; dir: 'asc' | 'desc' }[];
    /** WHERE 条件,多条之间 AND */
    filters?: WidgetFilter[];
  };
  options?: WidgetOptions;
  reasoning?: string;
  manualEdited?: boolean;
}

export interface DashboardLayout {
  version: '1.0';
  meta: {
    title: string;
    scenario: DashboardScenario;
    datasourceId: string;
    tableName: string;
    cols: 12;
    rowHeight: 40;
    theme?: DashboardTheme;
  };
  widgets: Widget[];
}

// ─── 启发式词典 ───────────────────────────────────────────────────────────
const TIME_RE = /(date|time|day|month|year|created|updated|日期|时间|月份|年份|当日|当月)/i;
const METRIC_RE = /(amount|sales|gmv|revenue|profit|cost|count|qty|quantity|num|金额|收入|销售|利润|成本|数量|订单数|gmv)/i;
const ID_RE = /(^id$|_id$|uuid|guid|编号|单号|工号)/i;
const RATIO_RE = /(rate|ratio|percent|率|占比|百分比)/i;
const GEO_RE = /(province|city|region|country|address|省|市|区|国|地区|城市)/i;
const STATUS_RE = /(status|stage|state|阶段|状态|审批|流程)/i;
const SALES_HINT = /(订单|销售|gmv|sales|revenue|客户|product|商品)/i;
const RETENTION_HINT = /(留存|retention|active|dau|mau|登录|签到)/i;
const LOGISTICS_HINT = /(物流|配送|发货|运单|快递|shipment|delivery)/i;
const WORKFLOW_HINT = /(漏斗|funnel|阶段|stage|审批|approval|工单|ticket)/i;
const ATTENDANCE_HINT = /(打卡|考勤|出勤|attendance|签到)/i;
const INVENTORY_HINT = /(库存|inventory|stock|仓库|sku)/i;
const FINANCE_HINT = /(财务|科目|finance|账户|凭证|应收|应付)/i;

function looksNumber(value: string): boolean {
  if (!value) return false;
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function looksDate(value: string): boolean {
  if (!value) return false;
  const v = value.trim();
  if (/^\d{4}[-/.年]\d{1,2}([-/.月]\d{1,2}日?)?/.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(v)) return true;
  return false;
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// ─── 字段画像 ────────────────────────────────────────────────────────────
function profileField(
  column: DatasourceColumn,
  samples: string[],
  totalRows: number,
): FieldProfile {
  const nonNull = samples.filter((v) => v !== '' && v != null);
  const numericValues = nonNull.filter(looksNumber);
  const dateValues = nonNull.filter(looksDate);
  const distinctCount = new Set(nonNull).size;

  const isNumericType = /^(INTEGER|REAL|NUMERIC|FLOAT|DOUBLE)$/i.test(column.type);
  const numericBySample = nonNull.length > 0 && numericValues.length / nonNull.length > 0.9;
  const isNumeric = isNumericType || numericBySample;

  // 名字带"金额/收入/数量"等强指标语义,直接判 metric,不再走 ID 路径
  const semanticMetric = METRIC_RE.test(column.name) || RATIO_RE.test(column.name);

  // ID 判定:名字像 ID,或全部唯一且不是语义指标
  const isIdLike = ID_RE.test(column.name)
    || (isNumeric && !semanticMetric && distinctCount === nonNull.length && nonNull.length > 20);

  const isTime = TIME_RE.test(column.name)
    || (dateValues.length > 0 && dateValues.length / Math.max(1, nonNull.length) > 0.8);

  const isGeo = GEO_RE.test(column.name);

  const isMetric = isNumeric && !isIdLike && !isTime
    && (semanticMetric || distinctCount > 10 || nonNull.length <= 20);

  let role: FieldRole = 'unknown';
  if (isTime) role = 'time';
  else if (isIdLike) role = 'id';
  else if (isMetric) role = 'metric';
  else if (isGeo) role = 'geo';
  else if (!isNumeric && samples.some((v) => v && v.length > 12)) role = 'text';
  else role = 'dimension';

  const profile: FieldProfile = {
    name: column.name,
    type: column.type,
    role,
    cardinality: distinctCount,
    nullRate: totalRows > 0 ? 1 - nonNull.length / Math.min(totalRows, samples.length || 1) : 0,
    isIdLike,
    isMetric,
    isTime,
    samples: nonNull.slice(0, 3),
  };

  if (isNumeric && numericValues.length) {
    const nums = numericValues.map(Number).filter(Number.isFinite);
    if (nums.length) {
      profile.min = Math.min(...nums);
      profile.max = Math.max(...nums);
    }
  }

  return profile;
}

function detectScenario(fields: FieldProfile[], tableName: string): { scenario: DashboardScenario; reason: string } {
  const allText = [tableName, ...fields.map((f) => f.name)].join(' ');
  const checks: Array<[DashboardScenario, RegExp, string]> = [
    ['sales', SALES_HINT, '存在订单/销售/客户类字段'],
    ['retention', RETENTION_HINT, '存在留存/登录/活跃类字段'],
    ['logistics', LOGISTICS_HINT, '存在物流/配送/运单类字段'],
    ['workflow', WORKFLOW_HINT, '存在阶段/审批/工单类字段'],
    ['attendance', ATTENDANCE_HINT, '存在打卡/考勤类字段'],
    ['inventory', INVENTORY_HINT, '存在库存/SKU 类字段'],
    ['finance', FINANCE_HINT, '存在财务/科目/凭证类字段'],
  ];
  for (const [scenario, re, reason] of checks) {
    if (re.test(allText)) return { scenario, reason };
  }
  return { scenario: 'unknown', reason: '未匹配到典型业务场景,使用通用看板布局' };
}

// ─── 主函数:从 SQLite 抽样并产出 DatasetProfile ─────────────────────────
const PROFILE_SAMPLE_LIMIT = 500;

export function buildDatasetProfile(
  datasourceId: string,
  dbPath: string,
  tableName?: string,
): DatasetProfile {
  const tables = inspectSqliteSchema(dbPath);
  if (!tables.length) throw new Error('数据源没有可分析的表');
  const target = tableName
    ? tables.find((t) => t.name === tableName) || tables[0]
    : tables[0];
  if (!target) throw new Error(`表 ${tableName} 不存在`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let samples: Record<string, string[]> = {};
  try {
    // 总行数 ≤ 10w 全量,>10w 走 RANDOM 抽样
    const sampleSql = target.rowCount > 100000
      ? `SELECT * FROM ${quoteIdent(target.name)} ORDER BY RANDOM() LIMIT ${PROFILE_SAMPLE_LIMIT}`
      : `SELECT * FROM ${quoteIdent(target.name)} LIMIT ${PROFILE_SAMPLE_LIMIT}`;
    const rows = db.prepare(sampleSql).all() as Array<Record<string, unknown>>;
    for (const col of target.columns) {
      samples[col.name] = rows.map((r) => {
        const v = r[col.name];
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString();
        return String(v);
      });
    }
  } finally {
    db.close();
  }

  const fields = target.columns.map((col) => profileField(col, samples[col.name] || [], target.rowCount));

  // 排序候选
  const suggestedMetrics = fields
    .filter((f) => f.isMetric)
    .sort((a, b) => {
      const sa = METRIC_RE.test(a.name) ? 2 : 0;
      const sb = METRIC_RE.test(b.name) ? 2 : 0;
      return sb - sa;
    })
    .map((f) => f.name);

  const suggestedDimensions = fields
    .filter((f) => f.role === 'dimension' || f.role === 'geo')
    .sort((a, b) => {
      // 基数适中的维度更好(2-50)
      const sa = a.cardinality >= 2 && a.cardinality <= 50 ? 2 : 0;
      const sb = b.cardinality >= 2 && b.cardinality <= 50 ? 2 : 0;
      return sb - sa;
    })
    .map((f) => f.name);

  const timeFields = fields.filter((f) => f.isTime).map((f) => f.name);
  const geoFields = fields.filter((f) => f.role === 'geo').map((f) => f.name);

  const { scenario, reason } = detectScenario(fields, target.name);

  return {
    datasourceId,
    tableName: target.name,
    rowCount: target.rowCount,
    fields,
    scenario,
    scenarioReason: reason,
    suggestedMetrics,
    suggestedDimensions,
    timeFields,
    geoFields,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Layout 校验(JSON Schema 兜底:LLM 输出 / 手工保存前都要过)─────────
const VALID_TYPES: WidgetType[] = [
  'line', 'bar', 'pie', 'donut', 'kpi', 'table',
  'heatmap', 'funnel', 'gauge', 'scatter', 'text', 'html',
];
const MIN_SIZES: Record<WidgetType, { w: number; h: number }> = {
  line: { w: 6, h: 6 }, bar: { w: 4, h: 6 }, pie: { w: 3, h: 5 }, donut: { w: 3, h: 5 },
  kpi: { w: 3, h: 3 }, table: { w: 6, h: 5 },
  heatmap: { w: 6, h: 6 }, funnel: { w: 4, h: 6 }, gauge: { w: 3, h: 4 },
  scatter: { w: 6, h: 6 }, text: { w: 3, h: 2 }, html: { w: 6, h: 7 },
};

function sanitizeTheme(raw: unknown): DashboardTheme | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const theme = raw as Record<string, unknown>;
  const pick = (key: keyof DashboardTheme) => {
    const value = theme[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const palette = Array.isArray(theme.palette)
    ? theme.palette.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10)
    : undefined;
  const result: DashboardTheme = {
    accent: pick('accent'),
    canvasBg: pick('canvasBg'),
    cardBg: pick('cardBg'),
    cardBorder: pick('cardBorder'),
    titleColor: pick('titleColor'),
    kpiColor: pick('kpiColor'),
    ...(palette && palette.length ? { palette } : {}),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

export function validateDashboardLayout(
  raw: unknown,
  profile: DatasetProfile,
  options: { normalize?: boolean } = { normalize: true },
): { ok: true; layout: DashboardLayout } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const normalize = options.normalize !== false;
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['layout 不是对象'] };
  const layout = raw as Partial<DashboardLayout>;
  if (layout.version !== '1.0') errors.push('version 必须为 "1.0"');
  if (!Array.isArray(layout.widgets)) errors.push('widgets 必须是数组');

  const fieldByName = new Map(profile.fields.map((f) => [f.name, f]));
  const widgets: Widget[] = [];

  for (const [i, w] of (layout.widgets || []).entries()) {
    const tag = `widgets[${i}]`;
    if (!w || typeof w !== 'object') { errors.push(`${tag} 不是对象`); continue; }
    if (!VALID_TYPES.includes(w.type as WidgetType)) {
      errors.push(`${tag}.type "${w.type}" 不在合法集合内`); continue;
    }
    const grid = w.grid;
    if (!grid || typeof grid.x !== 'number' || typeof grid.y !== 'number'
      || typeof grid.w !== 'number' || typeof grid.h !== 'number') {
      errors.push(`${tag}.grid 必须包含 x/y/w/h 数字`); continue;
    }
    if (grid.x < 0 || grid.y < 0 || grid.w <= 0 || grid.h <= 0) errors.push(`${tag}.grid 数值非法`);
    const min = MIN_SIZES[w.type as WidgetType];
    if (!normalize) {
      if (grid.x + grid.w > 12) errors.push(`${tag}.grid 越界(x+w>12)`);
      if (grid.w < min.w) errors.push(`${tag}.grid.w 至少 ${min.w}`);
      if (grid.h < min.h) errors.push(`${tag}.grid.h 至少 ${min.h}`);
    }

    const enc = w.data?.encoding;
    const usesRawFieldEncoding = !w.data?.sql;
    if (usesRawFieldEncoding && enc?.x?.field && !fieldByName.has(enc.x.field)) {
      errors.push(`${tag}.encoding.x.field "${enc.x.field}" 不存在`);
    }
    if (usesRawFieldEncoding && enc?.y?.field && enc.y.field !== '*' && !fieldByName.has(enc.y.field)) {
      errors.push(`${tag}.encoding.y.field "${enc.y.field}" 不存在`);
    }
    if (usesRawFieldEncoding && enc?.y?.field && enc.y.field !== '*') {
      const f = fieldByName.get(enc.y.field);
      // 非数值字段只允许 count / count_distinct / max / min
      const isNumeric = f && /^(INTEGER|REAL|NUMERIC|FLOAT|DOUBLE)$/i.test(f.type);
      const agg = enc.y.agg;
      if (!isNumeric && agg && agg !== 'count' && agg !== 'count_distinct' && agg !== 'max' && agg !== 'min') {
        errors.push(`${tag}.encoding.y "${enc.y.field}" 是非数值字段,只允许 count/count_distinct/max/min`);
      }
    }
    if (w.type === 'line' && enc?.x && enc.x.type !== 'time') errors.push(`${tag} line 图 x 轴必须 type=time`);
    // filter 字段必须存在
    if (w.data?.filters) {
      for (const [j, f] of w.data.filters.entries()) {
        if (!fieldByName.has(f.field)) errors.push(`${tag}.filters[${j}].field "${f.field}" 不存在`);
      }
    }
    if (w.data?.sql) {
      const check = validateReadOnlySql(w.data.sql);
      if (!check.ok) errors.push(`${tag}.data.sql 非法: ${check.reason}`);
    }
    widgets.push((normalize
      ? {
        ...w,
        grid: {
          ...grid,
          x: Math.max(0, Math.round(grid.x)),
          y: Math.max(0, Math.round(grid.y)),
          w: Math.max(1, Math.min(12, Math.round(grid.w))),
          h: Math.max(1, Math.round(grid.h)),
        },
      }
      : w) as Widget);
  }
  if (errors.length) return { ok: false, errors };
  let fixed: Widget[] = widgets;
  if (normalize) {
    // 只对 AI 新生成的(manualEdited != true)做布局规范化,保护用户手改
    const userPinned = widgets.filter((w) => w.manualEdited);
    const aiManaged = widgets.filter((w) => !w.manualEdited);
    fixed = aiManaged.length ? [...autoLayoutFix(aiManaged), ...userPinned] : userPinned;
  }
  const layoutErrors: string[] = [];
  for (const [i, w] of fixed.entries()) {
    const tag = `widgets[${i}]`;
    const min = MIN_SIZES[w.type as WidgetType];
    if (w.grid.x + w.grid.w > 12) layoutErrors.push(`${tag}.grid 越界(x+w>12)`);
    if (w.grid.w < min.w) layoutErrors.push(`${tag}.grid.w 至少 ${min.w}`);
    if (w.grid.h < min.h) layoutErrors.push(`${tag}.grid.h 至少 ${min.h}`);
  }
  if (layoutErrors.length) return { ok: false, errors: layoutErrors };
  return {
    ok: true,
    layout: {
      version: '1.0',
      meta: {
        title: layout.meta?.title || `${profile.tableName} 自动看板`,
        scenario: profile.scenario,
        datasourceId: profile.datasourceId,
        tableName: profile.tableName,
        cols: 12,
        rowHeight: 40,
        ...(sanitizeTheme(layout.meta?.theme) ? { theme: sanitizeTheme(layout.meta?.theme) } : {}),
      },
      widgets: fixed,
    },
  };
}

/**
 * 视觉布局规范化:把 LLM 给的 widgets 重排成"BI 金字塔"
 *  Row 1: 所有 KPI/gauge 横排,统一 h=3
 *  Row 2: 趋势图(line) 满宽或 6+6
 *  Row 3: 分布图(bar/pie/donut/funnel/heatmap/scatter)
 *  Row 4: 表格/其他
 * 同一组内 widget 等宽分格,h 取该组的标准高度。
 */
function autoLayoutFix(widgets: Widget[]): Widget[] {
  if (!widgets.length) return widgets;

  // 1. 分组
  const kpis = widgets.filter((w) => w.type === 'kpi' || w.type === 'gauge');
  const trends = widgets.filter((w) => w.type === 'line');
  const dists = widgets.filter((w) => ['bar', 'pie', 'donut', 'funnel', 'scatter', 'heatmap'].includes(w.type));
  const tables = widgets.filter((w) => w.type === 'table' || w.type === 'text' || w.type === 'html');

  const placed: Widget[] = [];
  let cursorY = 0;

  // 2. KPI 行:最多 4 个一行,均分
  if (kpis.length > 0) {
    const rows = chunkInto(kpis, 4);
    for (const row of rows) {
      const w = Math.floor(12 / row.length);
      const remainder = 12 - w * row.length;
      let x = 0;
      row.forEach((widget, i) => {
        const myW = w + (i < remainder ? 1 : 0);
        placed.push({
          ...widget,
          grid: { ...widget.grid, x, y: cursorY, w: myW, h: 3, minW: 3, minH: 3 },
        });
        x += myW;
      });
      cursorY += 3;
    }
  }

  // 3. 趋势行:1 张满宽,2 张 6+6,3+ 取前 2 满宽叠
  if (trends.length > 0) {
    const trendH = 6;
    if (trends.length === 1) {
      placed.push({ ...trends[0], grid: { ...trends[0].grid, x: 0, y: cursorY, w: 12, h: trendH, minW: 6, minH: 5 } });
      cursorY += trendH;
    } else {
      // 两两一行
      for (let i = 0; i < trends.length; i += 2) {
        const pair = trends.slice(i, i + 2);
        if (pair.length === 1) {
          placed.push({ ...pair[0], grid: { ...pair[0].grid, x: 0, y: cursorY, w: 12, h: trendH, minW: 6, minH: 5 } });
        } else {
          placed.push({ ...pair[0], grid: { ...pair[0].grid, x: 0, y: cursorY, w: 6, h: trendH, minW: 4, minH: 5 } });
          placed.push({ ...pair[1], grid: { ...pair[1].grid, x: 6, y: cursorY, w: 6, h: trendH, minW: 4, minH: 5 } });
        }
        cursorY += trendH;
      }
    }
  }

  // 4. 分布行:1 张 12, 2 张 6+6, 3 张 4+4+4。最多 3 个一行
  //    (bar/funnel/scatter/heatmap 最小宽 4 列,4 个一行会破最小宽校验)
  if (dists.length > 0) {
    const distH = 7;
    const rows = chunkInto(dists, 3);
    for (const row of rows) {
      const cols = row.length;
      const w = cols === 1 ? 12 : cols === 2 ? 6 : 4;
      row.forEach((widget, i) => {
        placed.push({
          ...widget,
          grid: { ...widget.grid, x: i * w, y: cursorY, w, h: distH, minW: Math.min(w, 4), minH: 5 },
        });
      });
      cursorY += distH;
    }
  }

  // 5. 表格/其他:全宽
  if (tables.length > 0) {
    for (const widget of tables) {
      const tableH = widget.type === 'table' ? 8 : widget.type === 'html' ? 8 : 4;
      placed.push({
        ...widget,
        grid: { ...widget.grid, x: 0, y: cursorY, w: 12, h: tableH, minW: 6, minH: 3 },
      });
      cursorY += tableH;
    }
  }

  return placed;
}

function chunkInto<T>(arr: T[], maxPerChunk: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += maxPerChunk) {
    result.push(arr.slice(i, i + maxPerChunk));
  }
  return result;
}

// ─── Mock layout 生成器(链路打通用,后续被真 LLM 替换)──────────────────
export function buildMockLayout(profile: DatasetProfile): DashboardLayout {
  const widgets: Widget[] = [];
  const metric = profile.suggestedMetrics[0];
  const time = profile.timeFields[0];
  const dim = profile.suggestedDimensions[0];

  // 3-4 张 KPI
  const kpiMetrics = profile.suggestedMetrics.slice(0, 3);
  kpiMetrics.forEach((m, i) => {
    widgets.push({
      id: crypto.randomUUID(),
      type: 'kpi',
      title: `总${m}`,
      grid: { x: i * 3, y: 0, w: 3, h: 3 },
      data: { encoding: { y: { field: m, type: 'quantitative', agg: 'sum' } } },
      reasoning: `${m} 是核心数值指标,适合放 KPI`,
    });
  });
  if (kpiMetrics.length < 3) {
    for (let i = kpiMetrics.length; i < 3; i++) {
      widgets.push({
        id: crypto.randomUUID(),
        type: 'kpi', title: '记录数',
        grid: { x: i * 3, y: 0, w: 3, h: 3 },
        data: { encoding: { y: { field: '*', type: 'quantitative', agg: 'count' } } },
        reasoning: '无数值指标时回落到记录数',
      });
    }
  }

  // 趋势图(若有时间字段)
  if (time && metric) {
    widgets.push({
      id: crypto.randomUUID(),
      type: 'line', title: `${metric} 趋势`,
      grid: { x: 0, y: 3, w: 12, h: 6 },
      data: {
        encoding: {
          x: { field: time, type: 'time' },
          y: { field: metric, type: 'quantitative', agg: 'sum' },
        },
      },
      reasoning: `时间字段 ${time} + 指标 ${metric} 适合做趋势线`,
    });
  }

  // TopN 横向柱
  if (dim && metric) {
    widgets.push({
      id: crypto.randomUUID(),
      type: 'bar', title: `${dim} Top 10 (按${metric})`,
      grid: { x: 0, y: time ? 9 : 3, w: 6, h: 7 },
      data: {
        encoding: {
          x: { field: dim, type: 'nominal' },
          y: { field: metric, type: 'quantitative', agg: 'sum' },
        },
        orderBy: [{ field: metric, dir: 'desc' }],
        limit: 10,
      },
      reasoning: `维度 ${dim} 排行榜`,
    });
  }

  // 占比环图
  if (dim && metric) {
    widgets.push({
      id: crypto.randomUUID(),
      type: 'donut', title: `${dim} 占比`,
      grid: { x: 6, y: time ? 9 : 3, w: 6, h: 7 },
      data: {
        encoding: {
          color: { field: dim },
          y: { field: metric, type: 'quantitative', agg: 'sum' },
        },
        limit: 8,
      },
      reasoning: `${dim} 在${metric}中的占比`,
    });
  }

  // 兜底:啥都没识别就给一张明细表
  if (widgets.length <= 3) {
    widgets.push({
      id: crypto.randomUUID(),
      type: 'table', title: '数据明细',
      grid: { x: 0, y: 3, w: 12, h: 8 },
      data: { limit: 100 },
      reasoning: '未识别到合适指标,展示原始明细',
    });
  }

  const result = validateDashboardLayout({
    version: '1.0',
    meta: {
      title: `${profile.tableName} 看板`,
      scenario: profile.scenario,
      datasourceId: profile.datasourceId,
      tableName: profile.tableName,
      cols: 12, rowHeight: 40,
    },
    widgets,
  }, profile);
  if (!result.ok) {
    // mock 自己出问题就 throw,方便定位
    throw new Error(`mock layout 自校验失败: ${result.errors.join('; ')}`);
  }
  return result.layout;
}

// ─── 单 widget 取数:把 encoding 翻译为只读 SQL,落到 SQLite 上 ─────────
export function widgetQuery(
  dbPath: string,
  tableName: string,
  widget: Widget,
): DatasourceQueryResult {
  const sql = widget.data.sql || encodingToSql(tableName, widget);
  return runDatasourceQuery(dbPath, sql);
}

function encodingToSql(table: string, widget: Widget): string {
  const enc = widget.data.encoding || {};
  const limit = Math.min(widget.data.limit || 1000, 1000);
  const T = quoteIdent(table);
  const filters = widget.data.filters || [];

  const yExpr = (yField?: string, agg?: string) => {
    if (!yField || yField === '*' || agg === 'count') return 'COUNT(*)';
    if (agg === 'count_distinct') return `COUNT(DISTINCT ${quoteIdent(yField)})`;
    return `${(agg || 'sum').toUpperCase()}(${quoteIdent(yField)})`;
  };

  const userWhere = buildFilterWhere(filters);
  const andWhere = (extra: string) => {
    const parts = [userWhere, extra].filter(Boolean);
    return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  };

  if (widget.type === 'kpi') {
    return `SELECT ${yExpr(enc.y?.field, enc.y?.agg)} AS value FROM ${T} ${userWhere ? `WHERE ${userWhere}` : ''}`;
  }

  if (widget.type === 'table') {
    return `SELECT * FROM ${T} ${userWhere ? `WHERE ${userWhere}` : ''} LIMIT ${limit}`;
  }

  // pie/donut: 仅按 color 字段聚合 y
  if ((widget.type === 'pie' || widget.type === 'donut') && enc.color && enc.y) {
    const dim = quoteIdent(enc.color.field);
    return `SELECT ${dim} AS name, ${yExpr(enc.y.field, enc.y.agg)} AS value FROM ${T}
            ${andWhere(`${dim} IS NOT NULL`)} GROUP BY ${dim}
            ORDER BY value DESC LIMIT ${limit}`;
  }

  // bar/line/scatter/funnel: 按 x 分组聚合 y
  if (enc.x && enc.y) {
    const xExpr = quoteIdent(enc.x.field);
    const order = widget.data.orderBy?.[0];
    const orderClause = order
      ? `ORDER BY ${order.field === enc.y.field ? 'y_value' : quoteIdent(order.field)} ${order.dir}`
      : (enc.x.type === 'time' ? `ORDER BY ${xExpr} ASC` : `ORDER BY y_value DESC`);
    return `SELECT ${xExpr} AS x_value, ${yExpr(enc.y.field, enc.y.agg)} AS y_value FROM ${T}
            ${andWhere(`${xExpr} IS NOT NULL`)} GROUP BY ${xExpr}
            ${orderClause} LIMIT ${limit}`;
  }

  return `SELECT * FROM ${T} ${userWhere ? `WHERE ${userWhere}` : ''} LIMIT ${limit}`;
}

/** 把 WidgetFilter[] 翻译成 SQL WHERE 子句(参数化字面量,防注入) */
function buildFilterWhere(filters: WidgetFilter[]): string {
  if (!filters.length) return '';
  const parts: string[] = [];
  for (const f of filters) {
    if (!f.field || !f.op) continue;
    const col = quoteIdent(f.field);
    switch (f.op) {
      case '=': case '!=': case '>': case '>=': case '<': case '<=':
        if (f.value === undefined) continue;
        parts.push(`${col} ${f.op} ${quoteLiteral(f.value)}`);
        break;
      case 'in':
      case 'not_in': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        if (!arr.length) continue;
        const literals = arr.filter((v) => v !== undefined).map(quoteLiteral).join(', ');
        if (!literals) continue;
        parts.push(`${col} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${literals})`);
        break;
      }
      case 'contains':
        if (typeof f.value !== 'string' || !f.value) continue;
        parts.push(`${col} LIKE ${quoteLiteral('%' + f.value + '%')}`);
        break;
      case 'is_null':
        parts.push(`${col} IS NULL`); break;
      case 'is_not_null':
        parts.push(`${col} IS NOT NULL`); break;
      case 'between': {
        const arr = Array.isArray(f.value) ? f.value : [];
        if (arr.length !== 2) continue;
        parts.push(`${col} BETWEEN ${quoteLiteral(arr[0])} AND ${quoteLiteral(arr[1])}`);
        break;
      }
    }
  }
  return parts.join(' AND ');
}

function quoteLiteral(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  // 字符串或其它转字符串,按 SQLite 单引号转义
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ─── Layout 持久化(简单 JSON 文件,跟数据源同目录)──────────────────────
export function dashboardJsonPath(dbPath: string, dashboardId: string): string {
  return path.join(path.dirname(dbPath), `dashboard-${dashboardId}.json`);
}

export function saveDashboard(dbPath: string, layout: DashboardLayout, id?: string): { id: string; path: string } {
  const dashboardId = id || crypto.randomUUID();
  const file = dashboardJsonPath(dbPath, dashboardId);
  fs.writeFileSync(file, JSON.stringify(layout, null, 2), 'utf8');
  return { id: dashboardId, path: file };
}

export function loadDashboard(dbPath: string, dashboardId: string): DashboardLayout | null {
  const file = dashboardJsonPath(dbPath, dashboardId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DashboardLayout;
  } catch {
    return null;
  }
}

export type LegacyDashboardSummary = {
  id: string;
  name: string;
  tableName?: string;
  createdAt: number;
  updatedAt: number;
};

export function listLegacyDashboards(dbPath: string): LegacyDashboardSummary[] {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => /^dashboard-.+\.json$/i.test(file))
    .map((file) => {
      const id = file.replace(/^dashboard-/, '').replace(/\.json$/i, '');
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      const layout = loadDashboard(dbPath, id);
      return {
        id,
        name: layout?.meta?.title?.trim() || id,
        tableName: layout?.meta?.tableName,
        createdAt: Number(stat.birthtimeMs || stat.mtimeMs) || Date.now(),
        updatedAt: Number(stat.mtimeMs || stat.birthtimeMs) || Date.now(),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
