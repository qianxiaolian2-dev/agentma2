import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuthHeaders } from '../utils/client-runtime';

type VisualListItem = {
  id: string;
  title?: string;
  createdAt: number;
  sizeBytes: number;
  bundleId?: string;
  bundleTitle?: string;
  bundleIndex?: number;
  bundleSize?: number;
};

type VisualsLegacyProps = {
  embedded?: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) as T : null;
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
      ? String((data as Record<string, unknown>).error || '请求失败')
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: number) {
  return value ? new Date(value).toLocaleString() : '未知';
}

type VisualBundle = {
  key: string;
  title: string;
  createdAt: number;
  items: VisualListItem[];
};

function groupVisuals(items: VisualListItem[]): VisualBundle[] {
  const bundles = new Map<string, VisualBundle>();
  for (const item of items) {
    const key = item.bundleId || `single:${item.id}`;
    const existing = bundles.get(key);
    if (existing) {
      existing.items.push(item);
      if (item.createdAt > existing.createdAt) existing.createdAt = item.createdAt;
      continue;
    }
    bundles.set(key, {
      key,
      title: item.bundleTitle || item.title || '未命名页面',
      createdAt: item.createdAt,
      items: [item],
    });
  }
  return [...bundles.values()]
    .map((bundle) => ({
      ...bundle,
      items: [...bundle.items].sort((a, b) => {
        const aIndex = typeof a.bundleIndex === 'number' ? a.bundleIndex : Number.MAX_SAFE_INTEGER;
        const bIndex = typeof b.bundleIndex === 'number' ? b.bundleIndex : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return b.createdAt - a.createdAt;
      }),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export default function VisualsLegacy({
  embedded = false,
}: VisualsLegacyProps) {
  const [items, setItems] = useState<VisualListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const bundles = groupVisuals(items);

  const loadVisuals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/visuals', { headers: getAuthHeaders() });
      const data = await readJson<VisualListItem[]>(response);
      setItems(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setError((loadError as Error).message || '读取可视化失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVisuals();
  }, [loadVisuals]);

  const deleteVisual = async (visual: VisualListItem) => {
    if (!window.confirm(`删除「${visual.title || '未命名'}」？`)) return;
    setDeletingId(visual.id);
    setError('');
    try {
      const response = await fetch(`/api/visuals/${encodeURIComponent(visual.id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await readJson<{ ok: boolean }>(response);
      await loadVisuals();
    } catch (deleteError) {
      setError((deleteError as Error).message || '删除失败');
    } finally {
      setDeletingId('');
    }
  };

  const content = (
    <>
      <div className="flex-between mb-4 visuals-library-toolbar">
        <div>
          <div className="card-header" style={{ marginBottom: 0 }}>
            已归档 HTML 页面 {items.length > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>({items.length})</span>}
          </div>
          {embedded && (
            <div className="visuals-library-helper">
              这里保存的是固定 HTML 结果。可以打开核对原页面，也可以回到会话继续修改。
            </div>
          )}
        </div>
        <button className="btn btn-sm" type="button" onClick={loadVisuals} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {items.length === 0 && !loading ? (
        <div className="visuals-empty">
          <strong>暂无已保存可视化</strong>
          <p>在会话中打开临时预览后，点击预览页右上角的“保存”即可归档到这里，后续也能从这里继续修改。</p>
          <Link className="btn btn-primary" to="/conversations?agent=viz-agent">去会话生成页面</Link>
        </div>
      ) : (
        <div className="visuals-bundle-list">
          {bundles.map((bundle) => (
            <section key={bundle.key} className="visuals-bundle-card">
              <div className="visuals-bundle-header">
                <div className="visuals-bundle-copy">
                  <div className="visuals-bundle-kicker">
                    {bundle.items.length > 1 ? `一套 ${bundle.items.length} 层页面` : '单页素材'}
                  </div>
                  <strong>{bundle.title}</strong>
                  <span>{formatTime(bundle.createdAt)}</span>
                </div>
              </div>
              <div className="visuals-bundle-items">
                {bundle.items.map((item) => (
                  <article key={item.id} className="visuals-bundle-item">
                    <div className="visuals-bundle-item-main">
                      <div className="visuals-title-cell">
                        <strong>
                          {typeof item.bundleIndex === 'number'
                            ? `第${item.bundleIndex}层 · ${item.title || '未命名'}`
                            : (item.title || '未命名')}
                        </strong>
                        <span>{item.id}</span>
                      </div>
                      <div className="visuals-bundle-meta">
                        <span>{formatBytes(item.sizeBytes)}</span>
                        <span>{formatTime(item.createdAt)}</span>
                      </div>
                    </div>
                    <div className="visual-row-actions">
                      <Link className="btn btn-sm btn-primary" to={`/conversations?agent=viz-agent&visualId=${encodeURIComponent(item.id)}`}>
                        继续修改
                      </Link>
                      <Link className="btn btn-sm" to={`/viz?id=${encodeURIComponent(item.id)}`}>打开</Link>
                      <button
                        className="btn btn-sm btn-danger"
                        type="button"
                        onClick={() => void deleteVisual(item)}
                        disabled={deletingId === item.id}
                      >
                        {deletingId === item.id ? '删除中…' : '删除'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {loading && (
            <div style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: '20px 0' }}>加载中…</div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className={`visuals-page${embedded ? ' visuals-page-embedded' : ''}`}>
      {!embedded && (
        <div className="page-header">
          <h1>HTML 素材库</h1>
          <p>保存后的 HTML 页面会保留在这里。可以重新打开，也可以直接回到会话继续修改。</p>
        </div>
      )}

      {error && <div className="visual-inline-error" style={{ marginBottom: 16 }}>{error}</div>}

      {embedded ? content : <div className="card">{content}</div>}
    </div>
  );
}
