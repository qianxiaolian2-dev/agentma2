# Visualization Dashboard Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local URL prototype for "我的可视化" that uploads Excel files, lets users choose a Sheet, generates a strict JSON dashboard config with rule-plus-model generation, renders the dashboard, supports chart/JSON editing, and exports JSON.

**Architecture:** Implement the prototype inside the existing `dashboard/` React + Vite + Express app as a hidden route at `/visualization-prototype`, without adding a sidebar entry. Add local `/api/visualization/*` endpoints before the existing SPA fallback in `dashboard/server.ts`. Keep reusable logic in focused TypeScript modules: field profiling, metric derivation, local dashboard generation, config validation, runtime aggregation, Excel parsing, model generation, and UI rendering.

**Tech Stack:** React 19, Vite, Express, TypeScript, Node built-in test runner, `tsx`, `xlsx` for Excel parsing, `multer` for upload parsing, `recharts` for chart rendering.

---

## File Structure

### Dependencies and Scripts

- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`

Add dependencies:

```json
{
  "dependencies": {
    "multer": "^2.0.2",
    "recharts": "^3.3.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/multer": "^2.0.0"
  }
}
```

Add script:

```json
{
  "scripts": {
    "test:visualization": "node --import tsx --test tests/visualization-*.test.ts"
  }
}
```

### Shared Visualization Core

- Create: `dashboard/src/visualization/types.ts`
  - Owns dashboard config, field profile, workbook, generated dashboard, chart runtime, and API DTO types.
- Create: `dashboard/src/visualization/core/profile.ts`
  - Converts rows into field profiles and field roles.
- Create: `dashboard/src/visualization/core/topic.ts`
  - Infers `business_topic`, dashboard title, and warnings when business input is absent.
- Create: `dashboard/src/visualization/core/calculated-metrics.ts`
  - Detects ROI, CTR, CVR, CPA, CPC, and average order value.
- Create: `dashboard/src/visualization/core/local-generator.ts`
  - Generates the deterministic fallback dashboard config and model candidate structure.
- Create: `dashboard/src/visualization/core/validate-config.ts`
  - Validates and sanitizes dashboard configs.
- Create: `dashboard/src/visualization/core/runtime.ts`
  - Aggregates selected Sheet rows for KPI, line, bar, stacked bar, scatter, pie, and table rendering.

### Server-Side Visualization API

- Create: `dashboard/visualization-server/excel.ts`
  - Parses Excel buffers, stores workbooks in memory, extracts Sheet previews and selected Sheet rows.
- Create: `dashboard/visualization-server/model.ts`
  - Builds model prompts, calls Anthropic-compatible Messages API, extracts strict JSON, and performs one repair attempt.
- Create: `dashboard/visualization-server/routes.ts`
  - Express router for `/api/visualization/workbooks`, `/api/visualization/profile`, and `/api/visualization/generate`.
- Modify: `dashboard/server.ts`
  - Import and register `visualizationRouter` before the SPA fallback.

### Frontend Prototype

- Create: `dashboard/src/pages/VisualizationPrototype.tsx`
  - Page-level state machine for upload, Sheet selection, profile generation, dashboard generation, editing, and export.
- Create: `dashboard/src/visualization/client.ts`
  - Typed fetch helpers for visualization API endpoints.
- Create: `dashboard/src/visualization/components/UploadPanel.tsx`
- Create: `dashboard/src/visualization/components/SheetSelector.tsx`
- Create: `dashboard/src/visualization/components/ProfilePanel.tsx`
- Create: `dashboard/src/visualization/components/DashboardPreview.tsx`
- Create: `dashboard/src/visualization/components/ChartRenderer.tsx`
- Create: `dashboard/src/visualization/components/ChartEditor.tsx`
- Create: `dashboard/src/visualization/components/JsonEditor.tsx`
- Create: `dashboard/src/visualization/visualization.css`
- Modify: `dashboard/src/App.tsx`
  - Add hidden route `/visualization-prototype`.

### Tests

- Create: `dashboard/tests/visualization-profile.test.ts`
- Create: `dashboard/tests/visualization-generator.test.ts`
- Create: `dashboard/tests/visualization-validation-runtime.test.ts`
- Create: `dashboard/tests/visualization-excel.test.ts`
- Create: `dashboard/tests/visualization-model.test.ts`

---

## Task 1: Add Dependencies and Test Harness

**Files:**
- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```bash
cd dashboard
npm install xlsx multer recharts
npm install -D @types/multer
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

If npm reports vulnerabilities from transitive packages, continue and record the exact output in the task notes.

- [ ] **Step 2: Add visualization test script**

Patch `dashboard/package.json` so the `scripts` block includes:

```json
"test:visualization": "node --import tsx --test tests/visualization-*.test.ts"
```

The resulting scripts block must keep existing scripts:

```json
{
  "dev": "vite",
  "server": "tsx server.ts",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test:visualization": "node --import tsx --test tests/visualization-*.test.ts"
}
```

- [ ] **Step 3: Run the test command before tests exist**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: FAIL because no `tests/visualization-*.test.ts` files exist yet. This confirms the script is wired to the intended location.

- [ ] **Step 4: Commit dependency and script changes**

Run:

```bash
git add dashboard/package.json dashboard/package-lock.json
git commit -m "chore: add visualization prototype dependencies"
```

---

## Task 2: Field Profiling and Role Detection

**Files:**
- Create: `dashboard/src/visualization/types.ts`
- Create: `dashboard/src/visualization/core/profile.ts`
- Create: `dashboard/tests/visualization-profile.test.ts`

- [ ] **Step 1: Write failing field profiling tests**

Create `dashboard/tests/visualization-profile.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasetProfile } from '../src/visualization/core/profile.ts';

test('buildDatasetProfile computes column stats and field roles', () => {
  const rows = [
    { date: '2026-01-01', campaign_id: 'c-1', channel: 'Search', cost: 100, revenue: 280, impressions: 1000, clicks: 80, note: 'Strong weekday performance with stable delivery' },
    { date: '2026-01-02', campaign_id: 'c-2', channel: 'Social', cost: 120, revenue: 210, impressions: 900, clicks: 45, note: 'Revenue dropped while spend increased' },
    { date: '2026-01-03', campaign_id: 'c-3', channel: 'Search', cost: null, revenue: 320, impressions: 1100, clicks: 88, note: '' }
  ];

  const profile = buildDatasetProfile({
    datasetName: 'ad_data - Sheet1',
    businessTopic: '',
    rows,
    optionalMetrics: [],
    optionalDimensions: []
  });

  assert.equal(profile.dataset_name, 'ad_data - Sheet1');
  assert.equal(profile.row_count, 3);
  assert.equal(profile.columns.find((c) => c.name === 'cost')?.null_rate, 1 / 3);
  assert.equal(profile.columns.find((c) => c.name === 'cost')?.avg, 110);
  assert.ok(profile.field_roles.time_fields.includes('date'));
  assert.ok(profile.field_roles.id_fields.includes('campaign_id'));
  assert.ok(profile.field_roles.dimension_fields.includes('channel'));
  assert.ok(profile.field_roles.metric_fields.includes('cost'));
  assert.ok(profile.field_roles.metric_fields.includes('revenue'));
  assert.ok(profile.field_roles.text_fields.includes('note'));
});

test('buildDatasetProfile respects optional metric and dimension hints', () => {
  const rows = [
    { period: '2026-W01', owner: 'Ada', score_text: '94', score: 94 },
    { period: '2026-W02', owner: 'Lin', score_text: '88', score: 88 }
  ];

  const profile = buildDatasetProfile({
    datasetName: 'quality',
    businessTopic: '数据质量监控',
    rows,
    optionalMetrics: ['score_text'],
    optionalDimensions: ['owner']
  });

  assert.ok(profile.field_roles.metric_fields.includes('score_text'));
  assert.ok(profile.field_roles.dimension_fields.includes('owner'));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: FAIL with module-not-found errors for `../src/visualization/core/profile.ts`.

- [ ] **Step 3: Create shared types**

Create `dashboard/src/visualization/types.ts` with these exported types:

```ts
export type FieldDataType = 'string' | 'number' | 'date' | 'datetime' | 'boolean';
export type ChartType = 'kpi' | 'line' | 'bar' | 'stacked_bar' | 'table' | 'scatter' | 'pie' | 'map';
export type MetricFormat = 'number' | 'percent' | 'currency' | 'integer';
export type SortOrder = 'asc' | 'desc';

export interface FieldProfile {
  name: string;
  data_type: FieldDataType;
  sample_values: unknown[];
  null_rate: number;
  distinct_count: number;
  min: number | string | null;
  max: number | string | null;
  avg: number | null;
}

export interface FieldRoles {
  time_fields: string[];
  dimension_fields: string[];
  metric_fields: string[];
  id_fields: string[];
  text_fields: string[];
}

export interface DatasetProfile {
  dataset_name: string;
  business_topic: string;
  row_count: number;
  columns: FieldProfile[];
  sample_rows: Record<string, unknown>[];
  optional_metrics: string[];
  optional_dimensions: string[];
  field_roles: FieldRoles;
}

export interface CalculatedMetric {
  name: string;
  display_name: string;
  formula: string;
  description: string;
  format: MetricFormat;
}

export interface DashboardChart {
  chart_id: string;
  chart_type: ChartType;
  title: string;
  description: string;
  section: string;
  data_config: {
    dataset: string;
    x_field: string;
    y_fields: string[];
    dimension_fields: string[];
    metric_fields: string[];
    aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';
    filters: Array<Record<string, unknown>>;
    sort: { field: string; order: SortOrder };
    limit: number;
  };
  style_config: {
    width: number;
    height: number;
    show_legend: boolean;
    show_tooltip: boolean;
  };
  analysis_purpose: string;
  drill_down: {
    enabled: boolean;
    fields: string[];
  };
}

export interface DashboardConfig {
  dashboard_title: string;
  dashboard_description: string;
  business_topic: string;
  data_summary: {
    dataset_name: string;
    row_count: number;
    time_range: { start: string; end: string };
    field_count: number;
  };
  field_roles: FieldRoles;
  calculated_metrics: CalculatedMetric[];
  dashboard_layout: {
    grid_columns: number;
    sections: Array<{
      section_id: string;
      title: string;
      description: string;
      charts: string[];
    }>;
  };
  charts: DashboardChart[];
  insight_cards: Array<{
    type: 'summary' | 'risk' | 'opportunity' | 'data_quality';
    title: string;
    content: string;
    related_charts: string[];
  }>;
  global_filters: Array<{
    field: string;
    filter_type: 'date_range' | 'select' | 'multi_select' | 'search';
    default_value: string;
  }>;
  warnings: string[];
}
```

- [ ] **Step 4: Implement field profiling**

Create `dashboard/src/visualization/core/profile.ts` with:

```ts
import type { DatasetProfile, FieldDataType, FieldProfile, FieldRoles } from '../types.ts';

interface BuildDatasetProfileInput {
  datasetName: string;
  businessTopic: string;
  rows: Record<string, unknown>[];
  optionalMetrics: string[];
  optionalDimensions: string[];
}

const TIME_NAME_RE = /(date|dt|time|day|month|week|created_at|update_time)/i;
const METRIC_NAME_RE = /(amount|cost|revenue|gmv|sales|count|cnt|num|pv|uv|click|impression|order|pay|rate|ratio|score|duration|conversion)/i;
const DIMENSION_NAME_RE = /(region|country|city|brand|channel|platform|category|type|status|owner|department|user_type)/i;
const ID_NAME_RE = /(^id$|_id$|id$|no$|code$|key$)/i;

export function buildDatasetProfile(input: BuildDatasetProfileInput): DatasetProfile {
  const rows = input.rows;
  const columnNames = collectColumnNames(rows);
  const columns = columnNames.map((name) => profileColumn(name, rows));
  const fieldRoles = classifyFields(columns, rows.length, input.optionalMetrics, input.optionalDimensions);

  return {
    dataset_name: input.datasetName,
    business_topic: input.businessTopic,
    row_count: rows.length,
    columns,
    sample_rows: rows.slice(0, 20),
    optional_metrics: input.optionalMetrics,
    optional_dimensions: input.optionalDimensions,
    field_roles: fieldRoles
  };
}

function collectColumnNames(rows: Record<string, unknown>[]) {
  const names = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return Array.from(names);
}

function profileColumn(name: string, rows: Record<string, unknown>[]): FieldProfile {
  const values = rows.map((row) => row[name]);
  const nonNull = values.filter((value) => !isEmpty(value));
  const distinct = new Set(nonNull.map((value) => String(value)));
  const dataType = inferDataType(name, nonNull);
  const numericValues = nonNull.map(toNumber).filter((value): value is number => Number.isFinite(value));
  const comparableValues = dataType === 'number' ? numericValues : nonNull.map((value) => String(value));

  return {
    name,
    data_type: dataType,
    sample_values: Array.from(distinct).slice(0, 5),
    null_rate: rows.length === 0 ? 0 : (values.length - nonNull.length) / rows.length,
    distinct_count: distinct.size,
    min: comparableValues.length ? minValue(comparableValues) : null,
    max: comparableValues.length ? maxValue(comparableValues) : null,
    avg: numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null
  };
}

function inferDataType(name: string, values: unknown[]): FieldDataType {
  if (TIME_NAME_RE.test(name)) return values.some((value) => isDateLike(value)) ? 'date' : 'string';
  if (values.length === 0) return 'string';
  if (values.every((value) => typeof value === 'boolean')) return 'boolean';
  if (values.every((value) => Number.isFinite(toNumber(value)))) return 'number';
  if (values.every((value) => isDateLike(value))) return 'date';
  return 'string';
}

function classifyFields(columns: FieldProfile[], rowCount: number, optionalMetrics: string[], optionalDimensions: string[]): FieldRoles {
  const roles: FieldRoles = { time_fields: [], dimension_fields: [], metric_fields: [], id_fields: [], text_fields: [] };
  for (const column of columns) {
    const name = column.name;
    const optionalMetric = optionalMetrics.includes(name);
    const optionalDimension = optionalDimensions.includes(name);
    const idLike = ID_NAME_RE.test(name) || (rowCount > 0 && column.distinct_count / rowCount >= 0.9 && ID_NAME_RE.test(name));
    const longText = column.data_type === 'string' && column.sample_values.some((value) => String(value).length >= 28);

    if (column.data_type === 'date' || column.data_type === 'datetime' || TIME_NAME_RE.test(name)) roles.time_fields.push(name);
    if (idLike) roles.id_fields.push(name);
    if (longText) roles.text_fields.push(name);
    if ((optionalMetric || column.data_type === 'number' || METRIC_NAME_RE.test(name)) && !roles.metric_fields.includes(name)) roles.metric_fields.push(name);
    if ((optionalDimension || (column.data_type === 'string' && column.distinct_count > 1 && column.distinct_count <= Math.max(30, rowCount * 0.5) && DIMENSION_NAME_RE.test(name))) && !idLike && !longText) {
      roles.dimension_fields.push(name);
    }
  }
  return roles;
}

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === '';
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

function isDateLike(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && String(value).length >= 6;
}

function minValue(values: Array<number | string>) {
  return values.reduce((min, value) => value < min ? value : min);
}

function maxValue(values: Array<number | string>) {
  return values.reduce((max, value) => value > max ? value : max);
}
```

- [ ] **Step 5: Run profiling tests**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: PASS for `visualization-profile.test.ts`.

- [ ] **Step 6: Commit profiling module**

Run:

```bash
git add dashboard/src/visualization/types.ts dashboard/src/visualization/core/profile.ts dashboard/tests/visualization-profile.test.ts
git commit -m "feat: add visualization field profiling"
```

---

## Task 3: Topic Inference, Calculated Metrics, and Local Dashboard Generation

**Files:**
- Create: `dashboard/src/visualization/core/topic.ts`
- Create: `dashboard/src/visualization/core/calculated-metrics.ts`
- Create: `dashboard/src/visualization/core/local-generator.ts`
- Create: `dashboard/tests/visualization-generator.test.ts`

- [ ] **Step 1: Write failing generator tests**

Create `dashboard/tests/visualization-generator.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasetProfile } from '../src/visualization/core/profile.ts';
import { inferBusinessTopic } from '../src/visualization/core/topic.ts';
import { detectCalculatedMetrics } from '../src/visualization/core/calculated-metrics.ts';
import { generateLocalDashboardConfig } from '../src/visualization/core/local-generator.ts';

test('inferBusinessTopic detects ad performance fields', () => {
  const topic = inferBusinessTopic(['date', 'campaign', 'cost', 'clicks', 'impressions', 'conversions']);
  assert.equal(topic.businessTopic, '广告投放');
  assert.equal(topic.dashboardTitle, '广告投放效果分析看板');
});

test('detectCalculatedMetrics derives advertising formulas', () => {
  const metrics = detectCalculatedMetrics(['revenue', 'cost', 'clicks', 'impressions', 'conversions']);
  assert.deepEqual(metrics.map((metric) => metric.name), ['roi', 'ctr', 'cvr', 'cpa', 'cpc']);
  assert.equal(metrics.find((metric) => metric.name === 'ctr')?.formula, 'clicks / impressions');
});

test('generateLocalDashboardConfig creates strict dashboard sections without forcing trends', () => {
  const rows = [
    { channel: 'Search', cost: 100, revenue: 300, clicks: 50, impressions: 1000 },
    { channel: 'Social', cost: 200, revenue: 260, clicks: 40, impressions: 1100 }
  ];
  const profile = buildDatasetProfile({
    datasetName: 'ad_data - Sheet1',
    businessTopic: '',
    rows,
    optionalMetrics: [],
    optionalDimensions: []
  });
  const config = generateLocalDashboardConfig(profile, rows);

  assert.equal(config.business_topic, '广告投放');
  assert.ok(config.calculated_metrics.some((metric) => metric.name === 'roi'));
  assert.ok(config.charts.some((chart) => chart.chart_type === 'kpi'));
  assert.ok(config.charts.every((chart) => chart.chart_type !== 'line'));
  assert.ok(config.charts.some((chart) => chart.chart_type === 'table'));
  assert.equal(new Set(config.charts.map((chart) => chart.chart_id)).size, config.charts.length);
  assert.ok(config.warnings.some((warning) => warning.includes('未检测到时间字段')));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: FAIL with module-not-found errors for topic, calculated metrics, and local generator modules.

- [ ] **Step 3: Implement topic inference**

Create `dashboard/src/visualization/core/topic.ts`:

```ts
interface TopicInference {
  businessTopic: string;
  dashboardTitle: string;
  warning: string;
}

export function inferBusinessTopic(fieldNames: string[], userTopic = ''): TopicInference {
  if (userTopic.trim()) {
    return {
      businessTopic: userTopic.trim(),
      dashboardTitle: titleForTopic(userTopic.trim()),
      warning: ''
    };
  }

  const text = fieldNames.join(' ').toLowerCase();
  if (/(cost|click|impression|conversion|campaign|ctr|cpc|cpa)/.test(text)) {
    return { businessTopic: '广告投放', dashboardTitle: '广告投放效果分析看板', warning: '未填写业务主题，已基于字段自动推断为广告投放。' };
  }
  if (/(sales|revenue|order|customer|gmv|pay|amount)/.test(text)) {
    return { businessTopic: '销售经营', dashboardTitle: '销售经营分析看板', warning: '未填写业务主题，已基于字段自动推断为销售经营。' };
  }
  if (/(user|uv|retention|active|signup|register)/.test(text)) {
    return { businessTopic: '用户增长', dashboardTitle: '用户增长分析看板', warning: '未填写业务主题，已基于字段自动推断为用户增长。' };
  }
  if (/(null|quality|status|error|check|valid|invalid)/.test(text)) {
    return { businessTopic: '数据质量监控', dashboardTitle: '数据质量监控看板', warning: '未填写业务主题，已基于字段自动推断为数据质量监控。' };
  }
  return { businessTopic: '数据概览分析看板', dashboardTitle: '数据概览分析看板', warning: '无法判断业务主题，已使用默认主题。' };
}

function titleForTopic(topic: string) {
  if (topic.includes('广告')) return '广告投放效果分析看板';
  if (topic.includes('销售')) return '销售经营分析看板';
  if (topic.includes('用户')) return '用户增长分析看板';
  if (topic.includes('质量')) return '数据质量监控看板';
  return `${topic}分析看板`;
}
```

- [ ] **Step 4: Implement calculated metric detection**

Create `dashboard/src/visualization/core/calculated-metrics.ts`:

```ts
import type { CalculatedMetric } from '../types.ts';

export function detectCalculatedMetrics(fields: string[]): CalculatedMetric[] {
  const set = new Set(fields.map((field) => field.toLowerCase()));
  const actual = (name: string) => fields.find((field) => field.toLowerCase() === name) || name;
  const metrics: CalculatedMetric[] = [];

  if (set.has('revenue') && set.has('cost')) {
    metrics.push(metric('roi', 'ROI', `${actual('revenue')} / ${actual('cost')}`, '收益与成本的比值，用于判断投入产出效率。', 'percent'));
  }
  if (set.has('clicks') && set.has('impressions')) {
    metrics.push(metric('ctr', 'CTR', `${actual('clicks')} / ${actual('impressions')}`, '点击量与曝光量的比值，用于判断流量吸引效率。', 'percent'));
  }
  if (set.has('conversions') && set.has('clicks')) {
    metrics.push(metric('cvr', 'CVR', `${actual('conversions')} / ${actual('clicks')}`, '转化量与点击量的比值，用于判断点击后的转化效率。', 'percent'));
  }
  if (set.has('cost') && set.has('conversions')) {
    metrics.push(metric('cpa', 'CPA', `${actual('cost')} / ${actual('conversions')}`, '成本与转化量的比值，用于判断单次转化成本。', 'currency'));
  }
  if (set.has('cost') && set.has('clicks')) {
    metrics.push(metric('cpc', 'CPC', `${actual('cost')} / ${actual('clicks')}`, '成本与点击量的比值，用于判断单次点击成本。', 'currency'));
  }
  if (set.has('revenue') && set.has('order_count')) {
    metrics.push(metric('avg_order_value', '客单价', `${actual('revenue')} / ${actual('order_count')}`, '收入与订单数的比值，用于判断单笔订单价值。', 'currency'));
  }
  return metrics;
}

function metric(name: string, displayName: string, formula: string, description: string, format: CalculatedMetric['format']): CalculatedMetric {
  return { name, display_name: displayName, formula, description, format };
}
```

- [ ] **Step 5: Implement local dashboard generation**

Create `dashboard/src/visualization/core/local-generator.ts` with these exported functions:

```ts
import type { DashboardChart, DashboardConfig, DatasetProfile } from '../types.ts';
import { detectCalculatedMetrics } from './calculated-metrics.ts';
import { inferBusinessTopic } from './topic.ts';

export function generateLocalDashboardConfig(profile: DatasetProfile, rows: Record<string, unknown>[]): DashboardConfig {
  const allFields = profile.columns.map((column) => column.name);
  const topic = inferBusinessTopic(allFields, profile.business_topic);
  const calculatedMetrics = detectCalculatedMetrics(allFields);
  const warnings = topic.warning ? [topic.warning] : [];

  const timeField = profile.field_roles.time_fields[0] || '';
  const metrics = [...profile.optional_metrics, ...profile.field_roles.metric_fields, ...calculatedMetrics.map((metric) => metric.name)]
    .filter((field, index, list) => field && list.indexOf(field) === index)
    .slice(0, 8);
  const dimensions = [...profile.optional_dimensions, ...profile.field_roles.dimension_fields]
    .filter((field, index, list) => field && list.indexOf(field) === index)
    .slice(0, 6);

  const charts: DashboardChart[] = [];
  const sections = [
    section('overview', '核心概览', '快速判断整体业务状态。'),
    section('trend', '趋势分析', '观察关键指标的时间变化。'),
    section('breakdown', '维度拆解', '定位指标贡献和问题来源。'),
    section('anomaly', '异常识别', '识别低于均值、波动异常或结构异常的问题。'),
    section('detail', '明细验证', '回到原始记录验证分析判断。')
  ];

  for (const metricName of metrics.slice(0, 6)) {
    charts.push(chart(`kpi_${metricName}`, 'kpi', display(metricName), 'overview', '', [metricName], [], 'sum', 3, 2));
  }

  if (timeField && metrics.length) {
    charts.push(chart('trend_core_metrics', 'line', '核心指标趋势', 'trend', timeField, metrics.slice(0, 2), [], 'sum', 8, 4));
    charts.push(chart('trend_efficiency_metrics', 'line', '效率指标趋势', 'trend', timeField, calculatedMetrics.slice(0, 2).map((metric) => metric.name), [], 'avg', 4, 4));
  } else {
    warnings.push('未检测到时间字段，已跳过趋势分析图。');
  }

  if (dimensions.length && metrics.length) {
    charts.push(chart(`top_${dimensions[0]}_${metrics[0]}`, 'bar', `${display(dimensions[0])} Top ${display(metrics[0])}`, 'breakdown', dimensions[0], [metrics[0]], [dimensions[0]], 'sum', 6, 4));
    if (dimensions[1]) charts.push(chart(`top_${dimensions[1]}_${metrics[0]}`, 'bar', `${display(dimensions[1])} Top ${display(metrics[0])}`, 'breakdown', dimensions[1], [metrics[0]], [dimensions[1]], 'sum', 6, 4));
    if (dimensions[0] && metrics[1]) charts.push(chart(`compare_${dimensions[0]}_${metrics[0]}_${metrics[1]}`, 'stacked_bar', `${display(dimensions[0])} 多指标对比`, 'breakdown', dimensions[0], metrics.slice(0, 2), [dimensions[0]], 'sum', 6, 4));
  } else {
    warnings.push('未检测到合适的维度字段，已跳过维度拆解图。');
  }

  if (dimensions.length && metrics.length) {
    charts.push(chart(`risk_low_${dimensions[0]}_${metrics[0]}`, 'bar', `${display(dimensions[0])} 低表现识别`, 'anomaly', dimensions[0], [metrics[0]], [dimensions[0]], 'avg', 6, 4, 'asc'));
  } else {
    charts.push(chart('risk_data_quality_fields', 'bar', '字段空值率异常识别', 'anomaly', '', [], [], 'none', 6, 4));
  }

  charts.push({
    ...chart('detail_records', 'table', '明细验证表', 'detail', '', metrics.slice(0, 6), [...profile.field_roles.time_fields, ...dimensions, ...profile.field_roles.id_fields, ...profile.field_roles.text_fields].slice(0, 12), 'none', 12, 5),
    drill_down: { enabled: true, fields: allFields.slice(0, 20) }
  });

  for (const sectionItem of sections) {
    sectionItem.charts = charts.filter((item) => item.section === sectionItem.section_id).map((item) => item.chart_id);
  }

  return {
    dashboard_title: topic.dashboardTitle,
    dashboard_description: `基于 ${profile.dataset_name} 自动生成的${topic.businessTopic}分析看板。`,
    business_topic: topic.businessTopic,
    data_summary: {
      dataset_name: profile.dataset_name,
      row_count: profile.row_count,
      time_range: inferTimeRange(rows, timeField),
      field_count: profile.columns.length
    },
    field_roles: profile.field_roles,
    calculated_metrics: calculatedMetrics,
    dashboard_layout: { grid_columns: 12, sections },
    charts,
    insight_cards: [
      { type: 'summary', title: '整体概览', content: `已识别 ${metrics.length} 个核心指标和 ${dimensions.length} 个分析维度。`, related_charts: charts.filter((item) => item.section === 'overview').map((item) => item.chart_id) },
      { type: 'data_quality', title: '数据检查', content: warnings.length ? warnings.join(' ') : '字段结构可支持基础看板生成。', related_charts: ['detail_records'] }
    ],
    global_filters: timeField ? [{ field: timeField, filter_type: 'date_range', default_value: '' }] : [],
    warnings
  };
}

function section(sectionId: string, title: string, description: string) {
  return { section_id: sectionId, title, description, charts: [] as string[] };
}

function chart(chartId: string, chartType: DashboardChart['chart_type'], title: string, sectionName: string, xField: string, yFields: string[], dimensionFields: string[], aggregation: DashboardChart['data_config']['aggregation'], width: number, height: number, sortOrder: 'asc' | 'desc' = 'desc'): DashboardChart {
  return {
    chart_id: chartId,
    chart_type: chartType,
    title,
    description: title,
    section: sectionName,
    data_config: {
      dataset: '',
      x_field: xField,
      y_fields: yFields,
      dimension_fields: dimensionFields,
      metric_fields: yFields,
      aggregation,
      filters: [],
      sort: { field: yFields[0] || xField, order: sortOrder },
      limit: 10
    },
    style_config: { width, height, show_legend: true, show_tooltip: true },
    analysis_purpose: title,
    drill_down: { enabled: true, fields: [...dimensionFields, ...yFields].filter(Boolean) }
  };
}

function display(field: string) {
  return field.replace(/_/g, ' ');
}

function inferTimeRange(rows: Record<string, unknown>[], timeField: string) {
  if (!timeField) return { start: '', end: '' };
  const values = rows.map((row) => row[timeField]).filter(Boolean).map((value) => new Date(String(value)).toISOString().slice(0, 10)).sort();
  return { start: values[0] || '', end: values[values.length - 1] || '' };
}
```

- [ ] **Step 6: Run generator tests**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: PASS for profile and generator tests.

- [ ] **Step 7: Commit generation logic**

Run:

```bash
git add dashboard/src/visualization/core/topic.ts dashboard/src/visualization/core/calculated-metrics.ts dashboard/src/visualization/core/local-generator.ts dashboard/tests/visualization-generator.test.ts
git commit -m "feat: generate local visualization dashboard config"
```

---

## Task 4: Config Validation and Runtime Aggregation

**Files:**
- Create: `dashboard/src/visualization/core/validate-config.ts`
- Create: `dashboard/src/visualization/core/runtime.ts`
- Create: `dashboard/tests/visualization-validation-runtime.test.ts`

- [ ] **Step 1: Write failing validation and runtime tests**

Create `dashboard/tests/visualization-validation-runtime.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DashboardConfig } from '../src/visualization/types.ts';
import { validateDashboardConfig } from '../src/visualization/core/validate-config.ts';
import { buildChartRuntimeData } from '../src/visualization/core/runtime.ts';

const baseConfig: DashboardConfig = {
  dashboard_title: '销售经营分析看板',
  dashboard_description: 'demo',
  business_topic: '销售经营',
  data_summary: { dataset_name: 'sales', row_count: 3, time_range: { start: '2026-01-01', end: '2026-01-02' }, field_count: 4 },
  field_roles: { time_fields: ['date'], dimension_fields: ['region'], metric_fields: ['revenue'], id_fields: ['order_id'], text_fields: [] },
  calculated_metrics: [],
  dashboard_layout: { grid_columns: 12, sections: [{ section_id: 'overview', title: '核心概览', description: '', charts: ['kpi_revenue'] }] },
  charts: [{
    chart_id: 'kpi_revenue',
    chart_type: 'kpi',
    title: '收入',
    description: '',
    section: 'overview',
    data_config: { dataset: 'sales', x_field: '', y_fields: ['revenue'], dimension_fields: [], metric_fields: ['revenue'], aggregation: 'sum', filters: [], sort: { field: 'revenue', order: 'desc' }, limit: 10 },
    style_config: { width: 3, height: 2, show_legend: true, show_tooltip: true },
    analysis_purpose: '',
    drill_down: { enabled: true, fields: ['region', 'revenue'] }
  }],
  insight_cards: [],
  global_filters: [],
  warnings: []
};

test('validateDashboardConfig accepts valid fields and unique chart ids', () => {
  const result = validateDashboardConfig(baseConfig, ['date', 'region', 'revenue', 'order_id']);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateDashboardConfig rejects unknown chart fields and duplicate ids', () => {
  const invalid: DashboardConfig = {
    ...baseConfig,
    dashboard_layout: { grid_columns: 12, sections: [{ section_id: 'overview', title: '核心概览', description: '', charts: ['same', 'same'] }] },
    charts: [
      { ...baseConfig.charts[0], chart_id: 'same', data_config: { ...baseConfig.charts[0].data_config, y_fields: ['unknown_metric'] } },
      { ...baseConfig.charts[0], chart_id: 'same' }
    ]
  };
  const result = validateDashboardConfig(invalid, ['date', 'region', 'revenue', 'order_id']);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate chart_id')));
  assert.ok(result.errors.some((error) => error.includes('unknown_metric')));
});

test('buildChartRuntimeData aggregates KPI and grouped bars', () => {
  const rows = [
    { date: '2026-01-01', region: 'East', revenue: 100 },
    { date: '2026-01-01', region: 'East', revenue: 80 },
    { date: '2026-01-02', region: 'West', revenue: 70 }
  ];

  const kpi = buildChartRuntimeData(baseConfig.charts[0], rows, []);
  assert.deepEqual(kpi, { value: 250, metric: 'revenue' });

  const bar = buildChartRuntimeData({
    ...baseConfig.charts[0],
    chart_type: 'bar',
    data_config: { ...baseConfig.charts[0].data_config, x_field: 'region', dimension_fields: ['region'], y_fields: ['revenue'], metric_fields: ['revenue'], aggregation: 'sum' }
  }, rows, []);
  assert.deepEqual(bar, [
    { region: 'East', revenue: 180 },
    { region: 'West', revenue: 70 }
  ]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: FAIL with module-not-found errors for validation and runtime modules.

- [ ] **Step 3: Implement config validation**

Create `dashboard/src/visualization/core/validate-config.ts` with:

```ts
import type { DashboardConfig } from '../types.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const CHART_TYPES = new Set(['kpi', 'line', 'bar', 'stacked_bar', 'table', 'scatter', 'pie', 'map']);

export function validateDashboardConfig(config: DashboardConfig, inputFields: string[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const calculatedFields = config.calculated_metrics.map((metric) => metric.name);
  const allowedFields = new Set([...inputFields, ...calculatedFields, '']);
  const chartIds = new Set<string>();

  for (const chart of config.charts || []) {
    if (chartIds.has(chart.chart_id)) errors.push(`duplicate chart_id: ${chart.chart_id}`);
    chartIds.add(chart.chart_id);
    if (!CHART_TYPES.has(chart.chart_type)) errors.push(`invalid chart_type: ${chart.chart_type}`);

    const fields = [
      chart.data_config.x_field,
      ...chart.data_config.y_fields,
      ...chart.data_config.dimension_fields,
      ...chart.data_config.metric_fields,
      chart.data_config.sort.field,
      ...chart.drill_down.fields
    ];
    for (const field of fields) {
      if (!allowedFields.has(field)) errors.push(`chart ${chart.chart_id} references unknown field: ${field}`);
    }
    if (chart.chart_type === 'line' && !config.field_roles.time_fields.includes(chart.data_config.x_field)) {
      errors.push(`line chart ${chart.chart_id} must use a time field`);
    }
    if (['bar', 'stacked_bar', 'pie', 'map'].includes(chart.chart_type) && chart.chart_type !== 'map' && chart.data_config.dimension_fields.length === 0) {
      warnings.push(`chart ${chart.chart_id} has no dimension field`);
    }
  }

  const realChartIds = new Set((config.charts || []).map((chart) => chart.chart_id));
  for (const section of config.dashboard_layout.sections || []) {
    for (const id of section.charts) {
      if (!realChartIds.has(id)) errors.push(`section ${section.section_id} references missing chart: ${id}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Implement runtime aggregation**

Create `dashboard/src/visualization/core/runtime.ts` with:

```ts
import type { CalculatedMetric, DashboardChart } from '../types.ts';

export function buildChartRuntimeData(chart: DashboardChart, rows: Record<string, unknown>[], calculatedMetrics: CalculatedMetric[]) {
  const enriched = rows.map((row) => applyCalculatedMetrics(row, calculatedMetrics));
  if (chart.chart_type === 'table') return enriched.slice(0, chart.data_config.limit || 50);
  if (chart.chart_type === 'kpi') {
    const metric = chart.data_config.y_fields[0] || chart.data_config.metric_fields[0];
    return { value: aggregate(enriched.map((row) => numberValue(row[metric])), chart.data_config.aggregation), metric };
  }
  if (chart.chart_type === 'scatter') {
    const [xMetric, yMetric] = chart.data_config.y_fields;
    return enriched.slice(0, chart.data_config.limit || 200).map((row) => ({ [xMetric]: numberValue(row[xMetric]), [yMetric]: numberValue(row[yMetric]) }));
  }
  if (chart.data_config.x_field) {
    return groupRows(enriched, chart.data_config.x_field, chart.data_config.y_fields, chart.data_config.aggregation, chart.data_config.limit, chart.data_config.sort.order);
  }
  return [];
}

function groupRows(rows: Record<string, unknown>[], xField: string, metrics: string[], aggregation: DashboardChart['data_config']['aggregation'], limit: number, order: 'asc' | 'desc') {
  const groups = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = String(row[xField] ?? '');
    if (!groups.has(key)) groups.set(key, { [xField]: key, __rows: [] as Record<string, unknown>[] });
    (groups.get(key)?.__rows as Record<string, unknown>[]).push(row);
  }
  const output = Array.from(groups.values()).map((group) => {
    const groupRowsValue = group.__rows as Record<string, unknown>[];
    const result: Record<string, unknown> = { [xField]: group[xField] };
    for (const metric of metrics) result[metric] = aggregate(groupRowsValue.map((row) => numberValue(row[metric])), aggregation);
    return result;
  });
  const sortMetric = metrics[0];
  output.sort((a, b) => order === 'asc' ? numberValue(a[sortMetric]) - numberValue(b[sortMetric]) : numberValue(b[sortMetric]) - numberValue(a[sortMetric]));
  return output.slice(0, limit || 10);
}

function applyCalculatedMetrics(row: Record<string, unknown>, calculatedMetrics: CalculatedMetric[]) {
  const next = { ...row };
  for (const metric of calculatedMetrics) {
    const [left, right] = metric.formula.split('/').map((part) => part.trim());
    const denominator = numberValue(next[right]);
    next[metric.name] = denominator === 0 ? 0 : numberValue(next[left]) / denominator;
  }
  return next;
}

function aggregate(values: number[], mode: DashboardChart['data_config']['aggregation']) {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return 0;
  if (mode === 'avg') return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  if (mode === 'count') return valid.length;
  if (mode === 'min') return Math.min(...valid);
  if (mode === 'max') return Math.max(...valid);
  return valid.reduce((sum, value) => sum + value, 0);
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return 0;
}
```

- [ ] **Step 5: Run validation and runtime tests**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: PASS for profile, generator, validation, and runtime tests.

- [ ] **Step 6: Commit validation and runtime logic**

Run:

```bash
git add dashboard/src/visualization/core/validate-config.ts dashboard/src/visualization/core/runtime.ts dashboard/tests/visualization-validation-runtime.test.ts
git commit -m "feat: validate and aggregate visualization configs"
```

---

## Task 5: Excel Parsing and Visualization API Routes

**Files:**
- Create: `dashboard/visualization-server/excel.ts`
- Create: `dashboard/visualization-server/model.ts`
- Create: `dashboard/visualization-server/routes.ts`
- Modify: `dashboard/server.ts`
- Create: `dashboard/tests/visualization-excel.test.ts`

- [ ] **Step 1: Write failing Excel parser tests**

Create `dashboard/tests/visualization-excel.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbookBuffer, getWorkbookRows } from '../visualization-server/excel.ts';

test('parseWorkbookBuffer lists sheets with preview rows', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { date: '2026-01-01', region: 'East', revenue: 100 },
    { date: '2026-01-02', region: 'West', revenue: 90 }
  ]), 'Sales');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { status: 'ok' }
  ]), 'Quality');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbookBuffer(buffer, 'demo.xlsx');

  assert.equal(parsed.fileName, 'demo.xlsx');
  assert.equal(parsed.sheets.length, 2);
  assert.deepEqual(parsed.sheets.map((sheet) => sheet.sheetName), ['Sales', 'Quality']);
  assert.equal(parsed.sheets[0].rowCount, 2);
  assert.equal(parsed.sheets[0].columnCount, 3);
  assert.equal(parsed.sheets[0].previewRows[0].region, 'East');

  const rows = getWorkbookRows(parsed.workbookId, 'Sales');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].revenue, 90);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: FAIL with module-not-found for `../visualization-server/excel.ts`.

- [ ] **Step 3: Implement Excel workbook storage and parsing**

Create `dashboard/visualization-server/excel.ts` with:

```ts
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';

interface StoredWorkbook {
  workbookId: string;
  fileName: string;
  sheets: WorkbookSheetSummary[];
  rowsBySheet: Map<string, Record<string, unknown>[]>;
  createdAt: number;
}

export interface WorkbookSheetSummary {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  previewRows: Record<string, unknown>[];
}

const workbooks = new Map<string, StoredWorkbook>();

export function parseWorkbookBuffer(buffer: Buffer, fileName: string) {
  cleanupOldWorkbooks();
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const workbookId = crypto.randomUUID();
  const rowsBySheet = new Map<string, Record<string, unknown>[]>();
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    rowsBySheet.set(sheetName, normalizeRows(rows));
    const columns = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
    return {
      sheetName,
      rowCount: rows.length,
      columnCount: columns.size,
      previewRows: normalizeRows(rows).slice(0, 5)
    };
  });
  const stored = { workbookId, fileName, sheets, rowsBySheet, createdAt: Date.now() };
  workbooks.set(workbookId, stored);
  return { workbookId, fileName, sheets };
}

export function getWorkbookRows(workbookId: string, sheetName: string) {
  const workbook = workbooks.get(workbookId);
  if (!workbook) throw new Error('workbook not found');
  const rows = workbook.rowsBySheet.get(sheetName);
  if (!rows) throw new Error('sheet not found');
  return rows;
}

function normalizeRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = key.trim() || 'unnamed_column';
      next[normalizedKey] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    }
    return next;
  });
}

function cleanupOldWorkbooks() {
  const maxAgeMs = 60 * 60 * 1000;
  const now = Date.now();
  for (const [id, workbook] of workbooks.entries()) {
    if (now - workbook.createdAt > maxAgeMs) workbooks.delete(id);
  }
}
```

- [ ] **Step 4: Create initial model fallback module**

Create `dashboard/visualization-server/model.ts` with a rule-only implementation so the API route can compile before the real model integration is added:

```ts
import type { DashboardConfig, DatasetProfile } from '../src/visualization/types.ts';

interface GenerateDashboardWithModelInput {
  profile: DatasetProfile;
  rows: Record<string, unknown>[];
  fallback: DashboardConfig;
  provider?: Partial<{ ANTHROPIC_AUTH_TOKEN: string; ANTHROPIC_BASE_URL: string; ANTHROPIC_MODEL: string }>;
}

export async function generateDashboardWithModel(input: GenerateDashboardWithModelInput): Promise<{ config: DashboardConfig; source: 'model' | 'rules' }> {
  void input.profile;
  void input.rows;
  void input.provider;
  return {
    config: { ...input.fallback, warnings: [...input.fallback.warnings, '模型集成尚未启用，已使用本地规则引擎生成看板。'] },
    source: 'rules'
  };
}

export function resolveModelProvider(provider: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  const baseUrl = String(provider.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic').replace(/\/$/, '');
  return {
    apiKey: String(provider.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN || ''),
    baseUrl,
    model: String(provider.ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || 'deepseek-v4-pro[1m]'),
    messagesUrl: `${baseUrl}/messages`
  };
}

export function extractJsonObject(text: string) {
  return JSON.parse(text);
}
```

- [ ] **Step 5: Implement visualization routes**

Create `dashboard/visualization-server/routes.ts` with:

```ts
import express from 'express';
import multer from 'multer';
import { buildDatasetProfile } from '../src/visualization/core/profile.ts';
import { generateLocalDashboardConfig } from '../src/visualization/core/local-generator.ts';
import { validateDashboardConfig } from '../src/visualization/core/validate-config.ts';
import { generateDashboardWithModel } from './model.ts';
import { getWorkbookRows, parseWorkbookBuffer } from './excel.ts';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
export const visualizationRouter = express.Router();

visualizationRouter.post('/workbooks', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: '需要上传 .xls 或 .xlsx 文件' });
    return;
  }
  if (!/\.(xls|xlsx)$/i.test(req.file.originalname)) {
    res.status(400).json({ error: '仅支持 .xls 和 .xlsx 文件' });
    return;
  }
  try {
    res.json(parseWorkbookBuffer(req.file.buffer, req.file.originalname));
  } catch (error) {
    res.status(400).json({ error: `Excel 解析失败: ${(error as Error).message}` });
  }
});

visualizationRouter.post('/profile', (req, res) => {
  const { workbookId, sheetName, datasetName, businessTopic, optionalMetrics, optionalDimensions } = req.body || {};
  try {
    const rows = getWorkbookRows(workbookId, sheetName);
    if (rows.length === 0) {
      res.status(400).json({ error: '当前 Sheet 为空，请选择其他 Sheet' });
      return;
    }
    const profile = buildDatasetProfile({
      datasetName: datasetName || `${sheetName}`,
      businessTopic: businessTopic || '',
      rows,
      optionalMetrics: Array.isArray(optionalMetrics) ? optionalMetrics : [],
      optionalDimensions: Array.isArray(optionalDimensions) ? optionalDimensions : []
    });
    res.json({ profile });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

visualizationRouter.post('/generate', async (req, res) => {
  const { workbookId, sheetName, datasetName, businessTopic, optionalMetrics, optionalDimensions, provider } = req.body || {};
  try {
    const rows = getWorkbookRows(workbookId, sheetName);
    if (rows.length === 0) {
      res.status(400).json({ error: '当前 Sheet 为空，请选择其他 Sheet' });
      return;
    }
    const profile = buildDatasetProfile({
      datasetName: datasetName || `${sheetName}`,
      businessTopic: businessTopic || '',
      rows,
      optionalMetrics: Array.isArray(optionalMetrics) ? optionalMetrics : [],
      optionalDimensions: Array.isArray(optionalDimensions) ? optionalDimensions : []
    });
    const fallback = generateLocalDashboardConfig(profile, rows);
    const generated = await generateDashboardWithModel({ profile, rows, fallback, provider });
    const validation = validateDashboardConfig(generated.config, profile.columns.map((column) => column.name));
    if (!validation.valid) {
      generated.config.warnings.push(...validation.errors.map((error) => `配置校验失败: ${error}`));
    }
    generated.config.warnings.push(...validation.warnings);
    res.json({ profile, rows: profile.sample_rows, config: generated.config, source: generated.source });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});
```

- [ ] **Step 6: Register API routes before SPA fallback**

Modify `dashboard/server.ts` near existing imports:

```ts
import { visualizationRouter } from './visualization-server/routes.ts';
```

Register the router after `/api/health` and before the existing SPA fallback:

```ts
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/visualization', visualizationRouter);
```

Confirm the route registration remains before this existing block:

```ts
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/dist')) return next();
  const indexPath = path.join(import.meta.dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else next();
});
```

- [ ] **Step 7: Run Excel parser tests**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: PASS for Excel parser tests and previous tests, except model tests are not present yet.

- [ ] **Step 8: Commit Excel API work**

Run:

```bash
git add dashboard/visualization-server/excel.ts dashboard/visualization-server/model.ts dashboard/visualization-server/routes.ts dashboard/server.ts dashboard/tests/visualization-excel.test.ts
git commit -m "feat: add visualization Excel upload API"
```

---

## Task 6: Model Generation, JSON Extraction, and Rule Fallback

**Files:**
- Modify: `dashboard/visualization-server/model.ts`
- Create: `dashboard/tests/visualization-model.test.ts`

- [ ] **Step 1: Write failing model utility tests**

Create `dashboard/tests/visualization-model.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, resolveModelProvider } from '../visualization-server/model.ts';

test('extractJsonObject parses strict JSON text', () => {
  const parsed = extractJsonObject('{"dashboard_title":"Demo","charts":[]}');
  assert.deepEqual(parsed, { dashboard_title: 'Demo', charts: [] });
});

test('extractJsonObject parses JSON wrapped by accidental text', () => {
  const parsed = extractJsonObject('Result:\n{"dashboard_title":"Demo","charts":[]}\nDone');
  assert.deepEqual(parsed, { dashboard_title: 'Demo', charts: [] });
});

test('resolveModelProvider falls back to environment values', () => {
  const provider = resolveModelProvider({}, {
    ANTHROPIC_AUTH_TOKEN: 'token',
    ANTHROPIC_BASE_URL: 'https://api.example.test/anthropic',
    ANTHROPIC_MODEL: 'model-a'
  });
  assert.equal(provider.apiKey, 'token');
  assert.equal(provider.baseUrl, 'https://api.example.test/anthropic');
  assert.equal(provider.model, 'model-a');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: FAIL in `visualization-model.test.ts` because the initial fallback `extractJsonObject()` only supports strict JSON and does not yet parse JSON wrapped by accidental text.

- [ ] **Step 3: Implement model helpers and fallback behavior**

Replace `dashboard/visualization-server/model.ts` with:

```ts
import type { DashboardConfig, DatasetProfile } from '../src/visualization/types.ts';

interface GenerateDashboardWithModelInput {
  profile: DatasetProfile;
  rows: Record<string, unknown>[];
  fallback: DashboardConfig;
  provider?: Partial<{ ANTHROPIC_AUTH_TOKEN: string; ANTHROPIC_BASE_URL: string; ANTHROPIC_MODEL: string }>;
}

export async function generateDashboardWithModel(input: GenerateDashboardWithModelInput): Promise<{ config: DashboardConfig; source: 'model' | 'rules' }> {
  const provider = resolveModelProvider(input.provider || {}, process.env);
  if (!provider.apiKey) {
    return { config: withWarning(input.fallback, '模型未配置，已使用本地规则引擎生成看板。'), source: 'rules' };
  }

  try {
    const first = await callModel(provider, buildPrompt(input.profile, input.rows, input.fallback));
    return { config: extractJsonObject(first) as DashboardConfig, source: 'model' };
  } catch (firstError) {
    try {
      const repaired = await callModel(provider, buildRepairPrompt(String(firstError), input.fallback));
      return { config: extractJsonObject(repaired) as DashboardConfig, source: 'model' };
    } catch {
      return { config: withWarning(input.fallback, '模型输出无法解析或修复，已回退到本地规则引擎版本。'), source: 'rules' };
    }
  }
}

export function resolveModelProvider(provider: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  const baseUrl = String(provider.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic').replace(/\/$/, '');
  return {
    apiKey: String(provider.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN || ''),
    baseUrl,
    model: String(provider.ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || 'deepseek-v4-pro[1m]'),
    messagesUrl: `${baseUrl}/messages`
  };
}

export function extractJsonObject(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('model output does not contain JSON object');
    return JSON.parse(text.slice(start, end + 1));
  }
}

async function callModel(provider: ReturnType<typeof resolveModelProvider>, prompt: string) {
  const response = await fetch(provider.messagesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      stream: false,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`model API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { content?: Array<{ text?: string }> };
  return data.content?.map((item) => item.text || '').join('\n') || '';
}

function buildPrompt(profile: DatasetProfile, rows: Record<string, unknown>[], fallback: DashboardConfig) {
  return [
    '你是一个专业的数据可视化看板生成引擎。你的输出必须是严格 JSON，不要输出 Markdown、解释文字、代码块或多余说明。',
    '根据字段画像、样本数据和候选看板生成最终 dashboard config。',
    '必须遵守：chart_id 唯一；图表字段只能来自输入字段或 calculated_metrics；没有时间字段不要生成趋势图；没有维度字段不要生成维度拆解图；必须包含明细表。',
    `字段画像：${JSON.stringify(profile)}`,
    `样本数据：${JSON.stringify(rows.slice(0, 20))}`,
    `候选看板：${JSON.stringify(fallback)}`
  ].join('\n\n');
}

function buildRepairPrompt(error: string, fallback: DashboardConfig) {
  return [
    '上一次模型输出不是合法 dashboard JSON。请返回严格 JSON，不能输出 Markdown、解释文字、代码块或多余说明。',
    `错误：${error}`,
    `参考结构：${JSON.stringify(fallback)}`
  ].join('\n\n');
}

function withWarning(config: DashboardConfig, warning: string): DashboardConfig {
  return { ...config, warnings: [...config.warnings, warning] };
}
```

- [ ] **Step 4: Run model utility tests**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: PASS for all visualization tests.

- [ ] **Step 5: Commit model generation fallback**

Run:

```bash
git add dashboard/visualization-server/model.ts dashboard/tests/visualization-model.test.ts
git commit -m "feat: add visualization model generation fallback"
```

---

## Task 7: Frontend API Client and Hidden Prototype Route

**Files:**
- Create: `dashboard/src/visualization/client.ts`
- Create: `dashboard/src/pages/VisualizationPrototype.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Create typed API client**

Create `dashboard/src/visualization/client.ts`:

```ts
import type { DashboardConfig, DatasetProfile } from './types.ts';

export interface WorkbookUploadResponse {
  workbookId: string;
  fileName: string;
  sheets: Array<{
    sheetName: string;
    rowCount: number;
    columnCount: number;
    previewRows: Record<string, unknown>[];
  }>;
}

export interface GenerateOptions {
  workbookId: string;
  sheetName: string;
  datasetName: string;
  businessTopic: string;
  optionalMetrics: string[];
  optionalDimensions: string[];
}

export async function uploadWorkbook(file: File): Promise<WorkbookUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/visualization/workbooks', { method: 'POST', body: formData });
  return readJson(response);
}

export async function buildProfile(options: GenerateOptions): Promise<{ profile: DatasetProfile }> {
  const response = await fetch('/api/visualization/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return readJson(response);
}

export async function generateDashboard(options: GenerateOptions): Promise<{ profile: DatasetProfile; rows: Record<string, unknown>[]; config: DashboardConfig; source: 'model' | 'rules' }> {
  const response = await fetch('/api/visualization/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  return readJson(response);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}
```

- [ ] **Step 2: Create initial page state machine**

Create `dashboard/src/pages/VisualizationPrototype.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { DashboardConfig, DatasetProfile } from '../visualization/types.ts';
import type { WorkbookUploadResponse } from '../visualization/client.ts';
import { buildProfile, generateDashboard, uploadWorkbook } from '../visualization/client.ts';
import '../visualization/visualization.css';

type Status = 'idle' | 'uploading' | 'profiling' | 'generating' | 'ready' | 'error';

export default function VisualizationPrototype() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [workbook, setWorkbook] = useState<WorkbookUploadResponse | null>(null);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [businessTopic, setBusinessTopic] = useState('');
  const [optionalMetricsText, setOptionalMetricsText] = useState('');
  const [optionalDimensionsText, setOptionalDimensionsText] = useState('');
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [source, setSource] = useState<'model' | 'rules' | ''>('');

  const options = useMemo(() => ({
    workbookId: workbook?.workbookId || '',
    sheetName: selectedSheet,
    datasetName: datasetName || `${workbook?.fileName || 'dataset'} - ${selectedSheet}`,
    businessTopic,
    optionalMetrics: splitList(optionalMetricsText),
    optionalDimensions: splitList(optionalDimensionsText)
  }), [workbook, selectedSheet, datasetName, businessTopic, optionalMetricsText, optionalDimensionsText]);

  async function handleUpload(file: File) {
    setStatus('uploading');
    setError('');
    try {
      const uploaded = await uploadWorkbook(file);
      setWorkbook(uploaded);
      setSelectedSheet(uploaded.sheets[0]?.sheetName || '');
      setDatasetName(`${file.name} - ${uploaded.sheets[0]?.sheetName || ''}`);
      setStatus('idle');
    } catch (uploadError) {
      setError((uploadError as Error).message);
      setStatus('error');
    }
  }

  async function handleProfile() {
    if (!workbook || !selectedSheet) return;
    setStatus('profiling');
    setError('');
    try {
      const result = await buildProfile(options);
      setProfile(result.profile);
      setStatus('idle');
    } catch (profileError) {
      setError((profileError as Error).message);
      setStatus('error');
    }
  }

  async function handleGenerate() {
    if (!workbook || !selectedSheet) return;
    setStatus('generating');
    setError('');
    try {
      const result = await generateDashboard(options);
      setProfile(result.profile);
      setRows(result.rows);
      setConfig(result.config);
      setSource(result.source);
      setStatus('ready');
    } catch (generateError) {
      setError((generateError as Error).message);
      setStatus('error');
    }
  }

  return (
    <div className="viz-page">
      <div className="page-header">
        <h1>我的可视化</h1>
        <p>本地原型：上传 Excel，选择 Sheet，生成可编辑的数据看板 JSON。</p>
      </div>
      <div className="viz-shell">
        <section className="viz-panel">
          <h2>数据输入</h2>
          <input type="file" accept=".xls,.xlsx" onChange={(event) => event.target.files?.[0] && handleUpload(event.target.files[0])} />
          {workbook && (
            <div className="viz-stack">
              <label>Sheet</label>
              <select value={selectedSheet} onChange={(event) => {
                const nextSheet = event.target.value;
                setSelectedSheet(nextSheet);
                setDatasetName(`${workbook.fileName} - ${nextSheet}`);
              }}>
                {workbook.sheets.map((sheet) => <option key={sheet.sheetName} value={sheet.sheetName}>{sheet.sheetName} ({sheet.rowCount} 行 / {sheet.columnCount} 列)</option>)}
              </select>
              <label>数据集名称</label>
              <input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} />
              <label>业务主题（可空）</label>
              <input value={businessTopic} onChange={(event) => setBusinessTopic(event.target.value)} placeholder="不填写时自动推断" />
              <label>核心指标（逗号分隔，可空）</label>
              <input value={optionalMetricsText} onChange={(event) => setOptionalMetricsText(event.target.value)} />
              <label>分析维度（逗号分隔，可空）</label>
              <input value={optionalDimensionsText} onChange={(event) => setOptionalDimensionsText(event.target.value)} />
              <div className="viz-actions">
                <button className="btn" onClick={handleProfile} disabled={status === 'profiling'}>生成字段画像</button>
                <button className="btn btn-primary" onClick={handleGenerate} disabled={status === 'generating'}>生成看板</button>
              </div>
            </div>
          )}
          {status !== 'idle' && <div className="viz-status">{status}</div>}
          {error && <div className="viz-error">{error}</div>}
        </section>
        <section className="viz-panel viz-panel-wide">
          <h2>工作台</h2>
          <pre>{JSON.stringify({ source, profile, config, rows }, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}

function splitList(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}
```

- [ ] **Step 3: Register hidden route**

Modify `dashboard/src/App.tsx`:

```tsx
import VisualizationPrototype from './pages/VisualizationPrototype';
```

Add inside the authenticated route list:

```tsx
<Route path="/visualization-prototype" element={<VisualizationPrototype />} />
```

Do not modify `dashboard/src/components/Sidebar.tsx` in this task.

- [ ] **Step 4: Run build check**

Run:

```bash
cd dashboard
npm run build
```

Expected: PASS or fail only on pre-existing unrelated TypeScript issues. If it fails, record the first 20 lines and continue only if the failures are unrelated to visualization files.

- [ ] **Step 5: Commit hidden route and client**

Run:

```bash
git add dashboard/src/visualization/client.ts dashboard/src/pages/VisualizationPrototype.tsx dashboard/src/App.tsx
git commit -m "feat: add visualization prototype route"
```

---

## Task 8: Upload, Sheet Selection, and Profile UI Components

**Files:**
- Create: `dashboard/src/visualization/components/UploadPanel.tsx`
- Create: `dashboard/src/visualization/components/SheetSelector.tsx`
- Create: `dashboard/src/visualization/components/ProfilePanel.tsx`
- Modify: `dashboard/src/pages/VisualizationPrototype.tsx`
- Create: `dashboard/src/visualization/visualization.css`

- [ ] **Step 1: Create upload panel**

Create `dashboard/src/visualization/components/UploadPanel.tsx`:

```tsx
interface UploadPanelProps {
  status: string;
  error: string;
  onUpload: (file: File) => void;
}

export default function UploadPanel({ status, error, onUpload }: UploadPanelProps) {
  return (
    <section className="viz-card">
      <div className="viz-card-header">
        <h2>上传 Excel</h2>
        <span className="badge badge-muted">{status}</span>
      </div>
      <label className="viz-upload">
        <input type="file" accept=".xls,.xlsx" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
        <span>选择 .xls / .xlsx 文件</span>
      </label>
      {error && <div className="viz-error">{error}</div>}
    </section>
  );
}
```

- [ ] **Step 2: Create Sheet selector**

Create `dashboard/src/visualization/components/SheetSelector.tsx`:

```tsx
import type { WorkbookUploadResponse } from '../client.ts';

interface SheetSelectorProps {
  workbook: WorkbookUploadResponse;
  selectedSheet: string;
  onSelect: (sheetName: string) => void;
}

export default function SheetSelector({ workbook, selectedSheet, onSelect }: SheetSelectorProps) {
  const sheet = workbook.sheets.find((item) => item.sheetName === selectedSheet);
  return (
    <section className="viz-card">
      <div className="viz-card-header">
        <h2>选择 Sheet</h2>
        <span className="badge badge-info">{workbook.sheets.length} 个 Sheet</span>
      </div>
      <div className="viz-sheet-grid">
        {workbook.sheets.map((item) => (
          <button key={item.sheetName} className={`viz-sheet${item.sheetName === selectedSheet ? ' active' : ''}`} onClick={() => onSelect(item.sheetName)}>
            <strong>{item.sheetName}</strong>
            <span>{item.rowCount} 行 / {item.columnCount} 列</span>
          </button>
        ))}
      </div>
      {sheet && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>{Object.keys(sheet.previewRows[0] || {}).map((field) => <th key={field}>{field}</th>)}</tr>
            </thead>
            <tbody>
              {sheet.previewRows.map((row, index) => (
                <tr key={index}>{Object.keys(sheet.previewRows[0] || {}).map((field) => <td key={field}>{String(row[field] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Create profile panel**

Create `dashboard/src/visualization/components/ProfilePanel.tsx`:

```tsx
import type { DatasetProfile } from '../types.ts';

interface ProfilePanelProps {
  profile: DatasetProfile | null;
  datasetName: string;
  businessTopic: string;
  optionalMetricsText: string;
  optionalDimensionsText: string;
  onDatasetNameChange: (value: string) => void;
  onBusinessTopicChange: (value: string) => void;
  onOptionalMetricsChange: (value: string) => void;
  onOptionalDimensionsChange: (value: string) => void;
  onProfile: () => void;
  onGenerate: () => void;
  busy: boolean;
}

export default function ProfilePanel(props: ProfilePanelProps) {
  return (
    <section className="viz-card">
      <div className="viz-card-header">
        <h2>生成配置</h2>
        <span className="badge badge-muted">业务信息可跳过</span>
      </div>
      <div className="grid-2">
        <div className="form-group">
          <label>数据集名称</label>
          <input value={props.datasetName} onChange={(event) => props.onDatasetNameChange(event.target.value)} />
        </div>
        <div className="form-group">
          <label>业务主题</label>
          <input value={props.businessTopic} onChange={(event) => props.onBusinessTopicChange(event.target.value)} placeholder="不填写时自动推断" />
        </div>
        <div className="form-group">
          <label>核心指标</label>
          <input value={props.optionalMetricsText} onChange={(event) => props.onOptionalMetricsChange(event.target.value)} placeholder="逗号分隔，可空" />
        </div>
        <div className="form-group">
          <label>分析维度</label>
          <input value={props.optionalDimensionsText} onChange={(event) => props.onOptionalDimensionsChange(event.target.value)} placeholder="逗号分隔，可空" />
        </div>
      </div>
      <div className="viz-actions">
        <button className="btn" onClick={props.onProfile} disabled={props.busy}>生成字段画像</button>
        <button className="btn btn-primary" onClick={props.onGenerate} disabled={props.busy}>生成看板</button>
      </div>
      {props.profile && (
        <div className="viz-role-grid">
          {Object.entries(props.profile.field_roles).map(([role, fields]) => (
            <div key={role} className="viz-role">
              <strong>{role}</strong>
              <span>{(fields as string[]).join(', ') || '无'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add visualization CSS**

Create `dashboard/src/visualization/visualization.css`:

```css
.viz-page { max-width: 1440px; }
.viz-shell { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; align-items: start; }
.viz-left { display: grid; gap: 16px; }
.viz-main { min-width: 0; display: grid; gap: 16px; }
.viz-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow); }
.viz-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.viz-card-header h2 { font-size: .98em; }
.viz-upload { display: grid; place-items: center; min-height: 120px; border: 1px dashed var(--border); border-radius: var(--radius); background: var(--bg-hover); cursor: pointer; color: var(--ink-secondary); }
.viz-upload input { display: none; }
.viz-error { margin-top: 10px; padding: 10px; border-radius: var(--radius-sm); background: var(--danger-bg); color: var(--danger); font-size: .82em; }
.viz-status { color: var(--ink-muted); font-size: .8em; }
.viz-stack { display: grid; gap: 12px; }
.viz-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.viz-sheet-grid { display: grid; gap: 8px; margin-bottom: 12px; }
.viz-sheet { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); padding: 10px; text-align: left; cursor: pointer; }
.viz-sheet.active { border-color: var(--accent); background: var(--accent-bg); }
.viz-sheet strong { display: block; color: var(--ink); }
.viz-sheet span { display: block; color: var(--ink-muted); font-size: .78em; }
.viz-role-grid { display: grid; gap: 8px; margin-top: 12px; }
.viz-role { display: grid; gap: 2px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.viz-role strong { font-size: .74em; color: var(--ink-muted); }
.viz-role span { font-size: .8em; color: var(--ink-secondary); word-break: break-word; }
@media (max-width: 1100px) { .viz-shell { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Replace inline page markup with components**

Modify `dashboard/src/pages/VisualizationPrototype.tsx` to import and render `UploadPanel`, `SheetSelector`, and `ProfilePanel`. Keep state and handlers from Task 7. The layout should be:

```tsx
<div className="viz-shell">
  <div className="viz-left">
    <UploadPanel status={status} error={error} onUpload={handleUpload} />
    {workbook && <SheetSelector workbook={workbook} selectedSheet={selectedSheet} onSelect={handleSheetSelect} />}
    {workbook && <ProfilePanel ... />}
  </div>
  <div className="viz-main">
    ...
  </div>
</div>
```

Add a local handler:

```ts
function handleSheetSelect(sheetName: string) {
  setSelectedSheet(sheetName);
  setDatasetName(`${workbook?.fileName || 'dataset'} - ${sheetName}`);
  setProfile(null);
  setConfig(null);
  setRows([]);
}
```

- [ ] **Step 6: Run build check**

Run:

```bash
cd dashboard
npm run build
```

Expected: PASS or fail only on pre-existing unrelated TypeScript issues. Visualization files must not appear in the error list.

- [ ] **Step 7: Commit upload and profile UI**

Run:

```bash
git add dashboard/src/visualization/components/UploadPanel.tsx dashboard/src/visualization/components/SheetSelector.tsx dashboard/src/visualization/components/ProfilePanel.tsx dashboard/src/visualization/visualization.css dashboard/src/pages/VisualizationPrototype.tsx
git commit -m "feat: add visualization upload and profile UI"
```

---

## Task 9: Dashboard Preview and Chart Rendering

**Files:**
- Create: `dashboard/src/visualization/components/DashboardPreview.tsx`
- Create: `dashboard/src/visualization/components/ChartRenderer.tsx`
- Modify: `dashboard/src/pages/VisualizationPrototype.tsx`
- Modify: `dashboard/src/visualization/visualization.css`

- [ ] **Step 1: Create chart renderer**

Create `dashboard/src/visualization/components/ChartRenderer.tsx`:

```tsx
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { CalculatedMetric, DashboardChart } from '../types.ts';
import { buildChartRuntimeData } from '../core/runtime.ts';

interface ChartRendererProps {
  chart: DashboardChart;
  rows: Record<string, unknown>[];
  calculatedMetrics: CalculatedMetric[];
}

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];

export default function ChartRenderer({ chart, rows, calculatedMetrics }: ChartRendererProps) {
  const data = buildChartRuntimeData(chart, rows, calculatedMetrics);
  const metrics = chart.data_config.y_fields.length ? chart.data_config.y_fields : chart.data_config.metric_fields;

  if (chart.chart_type === 'kpi') {
    const kpi = data as { value: number; metric: string };
    return (
      <div className="viz-kpi">
        <div className="viz-kpi-label">{kpi.metric}</div>
        <div className="viz-kpi-value">{formatNumber(kpi.value)}</div>
      </div>
    );
  }

  if (chart.chart_type === 'table') {
    const tableRows = data as Record<string, unknown>[];
    const fields = chart.data_config.dimension_fields.length ? chart.data_config.dimension_fields : Object.keys(tableRows[0] || {}).slice(0, 10);
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead>
          <tbody>{tableRows.slice(0, 20).map((row, index) => <tr key={index}>{fields.map((field) => <td key={field}>{String(row[field] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }

  if (chart.chart_type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data as Record<string, unknown>[]}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={chart.data_config.x_field} />
          <YAxis />
          <Tooltip />
          {metrics.map((metric, index) => <Line key={metric} type="monotone" dataKey={metric} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chart.chart_type === 'bar' || chart.chart_type === 'stacked_bar') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data as Record<string, unknown>[]} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey={chart.data_config.x_field} width={90} />
          <Tooltip />
          {metrics.map((metric, index) => <Bar key={metric} dataKey={metric} stackId={chart.chart_type === 'stacked_bar' ? 'total' : undefined} fill={COLORS[index % COLORS.length]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chart.chart_type === 'pie') {
    const pieData = data as Record<string, unknown>[];
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={pieData} dataKey={metrics[0]} nameKey={chart.data_config.x_field} outerRadius={90}>
            {pieData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chart.chart_type === 'scatter') {
    const [xMetric, yMetric] = metrics;
    return (
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart>
          <CartesianGrid />
          <XAxis dataKey={xMetric} />
          <YAxis dataKey={yMetric} />
          <Tooltip />
          <Scatter data={data as Record<string, unknown>[]} fill="#2563eb" />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return <div className="viz-empty">当前图表类型暂不渲染：{chart.chart_type}</div>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value || 0);
}
```

- [ ] **Step 2: Create dashboard preview**

Create `dashboard/src/visualization/components/DashboardPreview.tsx`:

```tsx
import type { DashboardConfig } from '../types.ts';
import ChartRenderer from './ChartRenderer.tsx';

interface DashboardPreviewProps {
  config: DashboardConfig | null;
  rows: Record<string, unknown>[];
  selectedChartId: string;
  onSelectChart: (chartId: string) => void;
}

export default function DashboardPreview({ config, rows, selectedChartId, onSelectChart }: DashboardPreviewProps) {
  if (!config) {
    return <section className="viz-card viz-empty">上传 Excel 并生成看板后，这里会显示预览。</section>;
  }

  return (
    <div className="viz-preview">
      <section className="viz-card">
        <div className="viz-preview-header">
          <div>
            <h2>{config.dashboard_title}</h2>
            <p>{config.dashboard_description}</p>
          </div>
          <span className="badge badge-info">{config.business_topic}</span>
        </div>
        {config.warnings.length > 0 && <div className="viz-warning">{config.warnings.join(' ')}</div>}
      </section>
      {config.dashboard_layout.sections.map((section) => {
        const charts = section.charts.map((id) => config.charts.find((chart) => chart.chart_id === id)).filter(Boolean);
        if (charts.length === 0) return null;
        return (
          <section key={section.section_id} className="viz-section">
            <div className="viz-section-head">
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </div>
            <div className="viz-chart-grid">
              {charts.map((chart) => chart && (
                <article key={chart.chart_id} className={`viz-chart-card${chart.chart_id === selectedChartId ? ' active' : ''}`} style={{ gridColumn: `span ${Math.min(12, Math.max(3, chart.style_config.width))}` }} onClick={() => onSelectChart(chart.chart_id)}>
                  <div className="viz-chart-head">
                    <h4>{chart.title}</h4>
                    <span>{chart.chart_type}</span>
                  </div>
                  <p>{chart.description}</p>
                  <ChartRenderer chart={chart} rows={rows} calculatedMetrics={config.calculated_metrics} />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Render preview from page**

Modify `dashboard/src/pages/VisualizationPrototype.tsx`:

```tsx
import DashboardPreview from '../visualization/components/DashboardPreview.tsx';
```

Add state:

```ts
const [selectedChartId, setSelectedChartId] = useState('');
```

After generation succeeds:

```ts
setSelectedChartId(result.config.charts[0]?.chart_id || '');
```

Replace the JSON `<pre>` in the right work area with:

```tsx
<DashboardPreview config={config} rows={rows} selectedChartId={selectedChartId} onSelectChart={setSelectedChartId} />
```

- [ ] **Step 4: Add preview CSS**

Append to `dashboard/src/visualization/visualization.css`:

```css
.viz-preview { display: grid; gap: 16px; }
.viz-preview-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.viz-preview-header h2 { font-size: 1.2em; }
.viz-preview-header p { color: var(--ink-secondary); font-size: .84em; margin-top: 4px; }
.viz-warning { margin-top: 12px; padding: 10px; background: var(--warning-bg); color: var(--warning); border-radius: var(--radius-sm); font-size: .82em; }
.viz-section { display: grid; gap: 10px; }
.viz-section-head h3 { font-size: 1em; }
.viz-section-head p { color: var(--ink-muted); font-size: .82em; }
.viz-chart-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; }
.viz-chart-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; min-width: 0; cursor: pointer; }
.viz-chart-card.active { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
.viz-chart-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.viz-chart-head h4 { font-size: .9em; }
.viz-chart-head span { color: var(--ink-muted); font-size: .75em; }
.viz-chart-card p { color: var(--ink-secondary); font-size: .78em; margin-bottom: 10px; }
.viz-kpi { display: grid; gap: 4px; padding: 10px 0; }
.viz-kpi-label { color: var(--ink-muted); font-size: .76em; }
.viz-kpi-value { font-size: 1.8em; font-weight: 700; color: var(--ink); }
.viz-empty { min-height: 160px; display: grid; place-items: center; color: var(--ink-muted); }
@media (max-width: 900px) { .viz-chart-card { grid-column: span 12 !important; } }
```

- [ ] **Step 5: Run build check**

Run:

```bash
cd dashboard
npm run build
```

Expected: Visualization files compile. If unrelated legacy TypeScript errors exist, record them.

- [ ] **Step 6: Commit preview rendering**

Run:

```bash
git add dashboard/src/visualization/components/DashboardPreview.tsx dashboard/src/visualization/components/ChartRenderer.tsx dashboard/src/pages/VisualizationPrototype.tsx dashboard/src/visualization/visualization.css
git commit -m "feat: render visualization dashboard preview"
```

---

## Task 10: Chart Config Editor, JSON Editor, and Export

**Files:**
- Create: `dashboard/src/visualization/components/ChartEditor.tsx`
- Create: `dashboard/src/visualization/components/JsonEditor.tsx`
- Modify: `dashboard/src/pages/VisualizationPrototype.tsx`
- Modify: `dashboard/src/visualization/visualization.css`

- [ ] **Step 1: Create chart editor**

Create `dashboard/src/visualization/components/ChartEditor.tsx`:

```tsx
import type { DashboardChart, DashboardConfig } from '../types.ts';

interface ChartEditorProps {
  config: DashboardConfig | null;
  selectedChartId: string;
  onChange: (config: DashboardConfig) => void;
}

export default function ChartEditor({ config, selectedChartId, onChange }: ChartEditorProps) {
  if (!config) return <section className="viz-card viz-empty">生成看板后可编辑图表配置。</section>;
  const chart = config.charts.find((item) => item.chart_id === selectedChartId) || config.charts[0];
  if (!chart) return <section className="viz-card viz-empty">没有可编辑图表。</section>;

  function update(patch: Partial<DashboardChart>) {
    if (!config || !chart) return;
    onChange({ ...config, charts: config.charts.map((item) => item.chart_id === chart.chart_id ? { ...item, ...patch } : item) });
  }

  function updateDataConfig(field: keyof DashboardChart['data_config'], value: unknown) {
    update({ data_config: { ...chart.data_config, [field]: value } });
  }

  function updateStyle(field: keyof DashboardChart['style_config'], value: unknown) {
    update({ style_config: { ...chart.style_config, [field]: value } });
  }

  return (
    <section className="viz-card">
      <div className="viz-card-header">
        <h2>图表配置</h2>
        <span className="badge badge-info">{chart.chart_type}</span>
      </div>
      <div className="form-group">
        <label>标题</label>
        <input value={chart.title} onChange={(event) => update({ title: event.target.value })} />
      </div>
      <div className="form-group">
        <label>描述</label>
        <textarea value={chart.description} onChange={(event) => update({ description: event.target.value })} rows={2} />
      </div>
      <div className="grid-2">
        <div className="form-group">
          <label>X 字段</label>
          <input value={chart.data_config.x_field} onChange={(event) => updateDataConfig('x_field', event.target.value)} />
        </div>
        <div className="form-group">
          <label>聚合</label>
          <select value={chart.data_config.aggregation} onChange={(event) => updateDataConfig('aggregation', event.target.value)}>
            {['sum', 'avg', 'count', 'min', 'max', 'none'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>指标字段</label>
          <input value={chart.data_config.y_fields.join(', ')} onChange={(event) => updateDataConfig('y_fields', splitList(event.target.value))} />
        </div>
        <div className="form-group">
          <label>维度字段</label>
          <input value={chart.data_config.dimension_fields.join(', ')} onChange={(event) => updateDataConfig('dimension_fields', splitList(event.target.value))} />
        </div>
        <div className="form-group">
          <label>宽度</label>
          <input type="number" min={3} max={12} value={chart.style_config.width} onChange={(event) => updateStyle('width', Number(event.target.value))} />
        </div>
        <div className="form-group">
          <label>TopN</label>
          <input type="number" min={1} max={100} value={chart.data_config.limit} onChange={(event) => updateDataConfig('limit', Number(event.target.value))} />
        </div>
      </div>
    </section>
  );
}

function splitList(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}
```

- [ ] **Step 2: Create JSON editor and export controls**

Create `dashboard/src/visualization/components/JsonEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { DashboardConfig } from '../types.ts';

interface JsonEditorProps {
  config: DashboardConfig | null;
  onChange: (config: DashboardConfig) => void;
}

export default function JsonEditor({ config, onChange }: JsonEditorProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setText(config ? JSON.stringify(config, null, 2) : '');
    setError('');
  }, [config]);

  function apply() {
    try {
      const parsed = JSON.parse(text) as DashboardConfig;
      onChange(parsed);
      setError('');
    } catch (jsonError) {
      setError((jsonError as Error).message);
    }
  }

  async function copyJson() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }

  function downloadJson() {
    if (!text) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${config?.dashboard_title || 'dashboard-config'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="viz-card">
      <div className="viz-card-header">
        <h2>JSON 配置</h2>
        <div className="viz-actions">
          <button className="btn btn-sm" onClick={copyJson} disabled={!config}>复制</button>
          <button className="btn btn-sm" onClick={downloadJson} disabled={!config}>下载</button>
          <button className="btn btn-primary btn-sm" onClick={apply} disabled={!config}>应用</button>
        </div>
      </div>
      <textarea className="viz-json-editor" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} />
      {error && <div className="viz-error">JSON 错误：{error}</div>}
    </section>
  );
}
```

- [ ] **Step 3: Add editors to page**

Modify `dashboard/src/pages/VisualizationPrototype.tsx`:

```tsx
import ChartEditor from '../visualization/components/ChartEditor.tsx';
import JsonEditor from '../visualization/components/JsonEditor.tsx';
```

Add editor panel below `DashboardPreview`:

```tsx
<div className="viz-editor-grid">
  <ChartEditor config={config} selectedChartId={selectedChartId} onChange={setConfig} />
  <JsonEditor config={config} onChange={(nextConfig) => {
    setConfig(nextConfig);
    setSelectedChartId(nextConfig.charts[0]?.chart_id || '');
  }} />
</div>
```

- [ ] **Step 4: Add editor CSS**

Append to `dashboard/src/visualization/visualization.css`:

```css
.viz-editor-grid { display: grid; grid-template-columns: minmax(280px, 420px) minmax(0, 1fr); gap: 16px; align-items: start; }
.viz-json-editor { min-height: 420px; font-family: var(--font-mono); font-size: .78em; line-height: 1.6; resize: vertical; }
@media (max-width: 1100px) { .viz-editor-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Run build check**

Run:

```bash
cd dashboard
npm run build
```

Expected: Visualization files compile. If unrelated legacy TypeScript errors exist, record them.

- [ ] **Step 6: Commit editing and export**

Run:

```bash
git add dashboard/src/visualization/components/ChartEditor.tsx dashboard/src/visualization/components/JsonEditor.tsx dashboard/src/pages/VisualizationPrototype.tsx dashboard/src/visualization/visualization.css
git commit -m "feat: edit and export visualization dashboard config"
```

---

## Task 11: End-to-End Local Verification

**Files:**
- Modify only if verification reveals visualization-specific defects.

- [ ] **Step 1: Run unit tests**

Run:

```bash
cd dashboard
npm run test:visualization
```

Expected: PASS for:

```text
visualization-profile.test.ts
visualization-generator.test.ts
visualization-validation-runtime.test.ts
visualization-excel.test.ts
visualization-model.test.ts
```

- [ ] **Step 2: Run build**

Run:

```bash
cd dashboard
npm run build
```

Expected: PASS. If it fails due existing unrelated project errors, list those errors and confirm no error references `src/visualization`, `pages/VisualizationPrototype.tsx`, or `visualization-server`.

- [ ] **Step 3: Start backend server**

Run:

```bash
cd dashboard
npm run server
```

Expected:

```text
[agentma] http://localhost:3001
```

Keep this session running until manual verification is complete.

- [ ] **Step 4: Start frontend dev server**

In a second terminal:

```bash
cd dashboard
npm run dev
```

Expected:

```text
Local: http://localhost:5173/
```

Open:

```text
http://localhost:5173/visualization-prototype
```

- [ ] **Step 5: Verify Excel upload and Sheet selection manually**

Use an `.xlsx` workbook with at least two Sheets:

```text
Sheet Sales:
date, region, channel, revenue, cost, order_count, order_id, note

Sheet Ads:
date, campaign_id, channel, cost, revenue, impressions, clicks, conversions
```

Expected:

- Upload succeeds.
- Both Sheets appear.
- Row and column counts are visible.
- Preview table shows the first rows.
- Selecting a Sheet updates the dataset name.

- [ ] **Step 6: Verify generation without business info**

Leave `business_topic`, optional metrics, and optional dimensions empty. Click generate.

Expected:

- A dashboard renders.
- `warnings` mention automatic topic inference or default topic.
- KPI cards render.
- If a date field exists, trend charts render.
- Dimension charts render when dimensions exist.
- Detail table renders.
- Source badge or JSON shows either `model` or `rules`.

- [ ] **Step 7: Verify editing and export**

Expected:

- Clicking a chart selects it.
- Editing title changes the preview.
- Editing TopN changes bar/table output.
- Invalid JSON in JSON editor shows an error and keeps previous preview.
- Valid JSON applied through the editor changes the preview.
- Copy JSON writes to clipboard.
- Download JSON produces a `.json` file.

- [ ] **Step 8: Commit verification fixes**

If any visualization-specific fixes were made, commit them:

```bash
git add dashboard
git commit -m "fix: verify visualization prototype flow"
```

If no fixes were needed, do not create an empty commit.

---

## Task 12: Final Review and User Handoff

**Files:**
- No required file changes.

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short
```

Expected: clean worktree or only intentional uncommitted local runtime files. Do not commit generated build artifacts unless the repository already tracks them.

- [ ] **Step 2: Summarize implementation**

Prepare a concise summary with:

- Prototype URL: `http://localhost:5173/visualization-prototype`
- Backend URL: `http://localhost:3001`
- Whether model generation is active or rule fallback was used.
- Test command result.
- Build command result.
- Any residual limitations from the spec.

- [ ] **Step 3: Keep required dev servers running**

If the user wants to try the prototype immediately, leave both commands running:

```bash
cd dashboard && npm run server
cd dashboard && npm run dev
```

Report both URLs.

---

## Self-Review Checklist

- Spec coverage:
  - Excel upload and Sheet selection: Task 5, Task 8, Task 11.
  - Business info optional and topic fallback: Task 3, Task 7, Task 11.
  - Field profiling and roles: Task 2.
  - Calculated metrics: Task 3.
  - Rule-plus-model generation: Task 3, Task 6.
  - JSON validation: Task 4, Task 5.
  - Dashboard rendering: Task 9.
  - Chart and JSON editing: Task 10.
  - Export: Task 10.
  - Local URL prototype without AgentMa sidebar integration: Task 7.
- Placeholder scan:
  - No `TBD`, `TODO`, `implement later`, or unspecified validation steps.
- Type consistency:
  - API client and server routes use matching fields: `workbookId`, `sheetName`, `datasetName`, `businessTopic`, `optionalMetrics`, `optionalDimensions`.
  - Dashboard config types match the design spec.
  - Runtime aggregation reads `DashboardChart.data_config`.
