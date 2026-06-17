import { getAuthHeaders } from '../../utils/client-runtime';
import type { DashboardLayout, DatasetProfile, DatasourceSummary, QueryResult, Widget } from './types';

async function jsonReq<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.error || res.statusText || `HTTP ${res.status}`;
    const detail = body?.details ? ` (${body.details.join('; ')})` : '';
    throw new Error(msg + detail);
  }
  return body as T;
}

export async function listDatasources(): Promise<DatasourceSummary[]> {
  return jsonReq<DatasourceSummary[]>('/api/datasources');
}

export async function uploadDatasource(file: File, name?: string): Promise<DatasourceSummary> {
  const fd = new FormData();
  fd.append('file', file);
  if (name) fd.append('name', name);
  const res = await fetch('/api/datasources/upload', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: fd,
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(body?.error || `上传失败 ${res.status}`);
  return body as DatasourceSummary;
}

export async function profileDataset(datasourceId: string, tableName?: string): Promise<DatasetProfile> {
  return jsonReq<DatasetProfile>('/api/dashboard/profile', {
    method: 'POST',
    body: JSON.stringify({ datasourceId, tableName }),
  });
}

export async function generateDashboard(datasourceId: string, tableName?: string): Promise<{
  profile: DatasetProfile;
  layout: DashboardLayout;
  source: 'mock' | 'llm' | 'llm_retry';
  llmError?: string;
}> {
  return jsonReq('/api/dashboard/generate', {
    method: 'POST',
    body: JSON.stringify({ datasourceId, tableName }),
  });
}

export async function queryWidget(
  datasourceId: string,
  tableName: string,
  widget: Widget,
): Promise<QueryResult> {
  return jsonReq<QueryResult>('/api/dashboard/widget/query', {
    method: 'POST',
    body: JSON.stringify({ datasourceId, tableName, widget }),
  });
}

export async function saveLayout(id: string, layout: DashboardLayout): Promise<{ id: string; layout: DashboardLayout }> {
  return jsonReq(`/api/dashboard/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ layout }),
  });
}

export async function relayoutDashboard(layout: DashboardLayout): Promise<{ layout: DashboardLayout }> {
  return jsonReq('/api/dashboard/relayout', {
    method: 'POST',
    body: JSON.stringify({ layout }),
  });
}

export interface AskResult {
  title: string;
  sql: string;
  chartType: import('./types').WidgetType;
  encoding?: any;
  narrative: string;
  queryResult: QueryResult | null;
  queryError?: string;
  error?: string;
}

export async function askQuestion(
  datasourceId: string,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  tableName?: string,
): Promise<AskResult> {
  return jsonReq<AskResult>('/api/dashboard/ask', {
    method: 'POST',
    body: JSON.stringify({ datasourceId, question, history, tableName }),
  });
}
