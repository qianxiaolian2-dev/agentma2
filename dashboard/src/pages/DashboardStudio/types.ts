// 与 server-dashboard.ts 保持一致的前端类型(手动同步)
export type FieldRole = 'time' | 'metric' | 'dimension' | 'id' | 'text' | 'geo' | 'unknown';

export interface FieldProfile {
  name: string;
  type: string;
  role: FieldRole;
  cardinality: number;
  nullRate: number;
  isIdLike: boolean;
  isMetric: boolean;
  isTime: boolean;
  samples: string[];
  min?: number;
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
  suggestedMetrics: string[];
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
    filters?: WidgetFilter[];
  };
  options?: WidgetOptions;
  reasoning?: string;
  manualEdited?: boolean;
  pending?: boolean;
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

export interface DashboardSummary {
  id: string;
  tenantId: string;
  ownerSub: string;
  datasourceId: string;
  tableName?: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  latestVersionId: string;
  savedFrom?: 'chat' | 'studio' | 'restore';
  latestVersionNo: number;
  versionCount: number;
  datasourceName?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceRunId?: string;
  sourceModel?: string;
  sourceAgentId?: string;
  createdAt: number;
  updatedAt: number;
  legacy?: boolean;
}

export interface DashboardVersionSummary {
  id: string;
  dashboardId: string;
  tenantId: string;
  versionNo: number;
  layoutJson: string;
  profileSnapshotJson?: string;
  note?: string;
  createdBy?: string;
  savedFrom?: 'chat' | 'studio' | 'restore';
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceRunId?: string;
  sourceModel?: string;
  sourceAgentId?: string;
  createdAt: number;
  current: boolean;
}

export interface QueryResult {
  columns: string[];
  rowCount: number;
  truncated: boolean;
  rows: Array<Record<string, unknown>>;
}

export interface DatasourceSummary {
  id: string;
  name: string;
  format: string;
  tables: Array<{ name: string; rowCount: number; columns: Array<{ name: string; type: string }> }>;
  createdAt: number;
}
