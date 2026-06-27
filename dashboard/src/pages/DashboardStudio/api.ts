import { getAuthHeaders } from '../../utils/client-runtime';
import type {
  DashboardLayout,
  DashboardSummary,
  DashboardVersionSummary,
  DatasetProfile,
  DatasourceSummary,
  QueryResult,
  Widget,
} from './types';

export type VisualListItem = {
  id: string;
  title?: string;
  createdAt: number;
  sizeBytes: number;
};

export type VisualPayload = {
  id?: string;
  title?: string;
  html: string;
  createdAt?: number;
  mtimeMs?: number;
};

export type DashboardLoadPayload = {
  id: string;
  layout: DashboardLayout;
  versionId?: string;
  createdAt?: number;
  updatedAt?: number;
  legacy?: boolean;
};

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

export async function saveLayout(id: string, layout: DashboardLayout): Promise<{
  id: string;
  layout: DashboardLayout;
  versionId?: string;
  updatedAt?: number;
}> {
  return saveLayoutWithMeta(id, layout);
}

export async function saveLayoutWithMeta(
  id: string,
  layout: DashboardLayout,
  meta?: {
    note?: string;
    savedFrom?: 'chat' | 'studio' | 'restore';
    sourceConversationId?: string;
    sourceMessageId?: string;
    sourceRunId?: string;
    sourceModel?: string;
    sourceAgentId?: string;
  },
): Promise<{
  id: string;
  layout: DashboardLayout;
  versionId?: string;
  updatedAt?: number;
}> {
  return jsonReq(`/api/dashboard/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ layout, ...meta }),
  });
}

export async function loadDashboard(id: string, datasourceId: string): Promise<DashboardLoadPayload> {
  return jsonReq<DashboardLoadPayload>(`/api/dashboard/${encodeURIComponent(id)}?datasourceId=${encodeURIComponent(datasourceId)}`);
}

export async function listDashboards(datasourceId?: string): Promise<DashboardSummary[]> {
  const qs = datasourceId ? `?datasourceId=${encodeURIComponent(datasourceId)}` : '';
  return jsonReq<DashboardSummary[]>(`/api/dashboards${qs}`);
}

export async function listDashboardVersions(id: string): Promise<DashboardVersionSummary[]> {
  return jsonReq<DashboardVersionSummary[]>(`/api/dashboards/${encodeURIComponent(id)}/versions`);
}

export async function restoreDashboardVersion(
  dashboardId: string,
  versionId: string,
  note?: string,
): Promise<{ id: string; layout: DashboardLayout; versionId: string; restoredFromVersionId: string; updatedAt: number }> {
  return jsonReq(`/api/dashboards/${encodeURIComponent(dashboardId)}/restore/${encodeURIComponent(versionId)}`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function relayoutDashboard(layout: DashboardLayout): Promise<{ layout: DashboardLayout }> {
  return jsonReq('/api/dashboard/relayout', {
    method: 'POST',
    body: JSON.stringify({ layout }),
  });
}

export async function listSavedVisuals(): Promise<VisualListItem[]> {
  return jsonReq<VisualListItem[]>('/api/visuals');
}

export async function getSavedVisual(id: string): Promise<VisualPayload> {
  return jsonReq<VisualPayload>(`/api/visuals/${encodeURIComponent(id)}`);
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

export interface DashboardEditResult {
  layout: DashboardLayout;
  summary: string;
}

export interface DashboardChatResult {
  mode: 'answer' | 'edit' | 'html';
  message: string;
  answer?: AskResult;
  layout?: DashboardLayout;
  htmlWidget?: { type: 'html'; title: string; visualId: string };
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

export async function editDashboard(
  datasourceId: string,
  layout: DashboardLayout,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<DashboardEditResult> {
  return jsonReq<DashboardEditResult>('/api/dashboard/edit', {
    method: 'POST',
    body: JSON.stringify({
      datasourceId,
      layout,
      question,
      history,
      tableName: layout.meta.tableName,
    }),
  });
}

export async function chatDashboard(
  datasourceId: string,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  tableName?: string,
  layout?: DashboardLayout | null,
): Promise<DashboardChatResult> {
  return jsonReq<DashboardChatResult>('/api/dashboard/chat', {
    method: 'POST',
    body: JSON.stringify({
      datasourceId,
      question,
      history,
      tableName,
      layout,
    }),
  });
}
