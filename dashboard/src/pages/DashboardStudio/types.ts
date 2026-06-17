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

export type WidgetType =
  | 'line' | 'bar' | 'pie' | 'donut' | 'kpi' | 'table'
  | 'heatmap' | 'funnel' | 'gauge' | 'scatter' | 'text';

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
  options?: Record<string, unknown>;
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
  };
  widgets: Widget[];
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
