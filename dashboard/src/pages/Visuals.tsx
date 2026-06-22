import { useEffect, useMemo, useState } from 'react';
import DashboardStudio from './DashboardStudio';
import VisualsLegacy from './VisualsLegacy';
import { listDashboards, listDashboardVersions, restoreDashboardVersion } from './DashboardStudio/api';
import type { DashboardSummary, DashboardVersionSummary } from './DashboardStudio/types';
import './pages-visuals.css';

type PendingVisualRequest = {
  requestId: string;
  visualId: string;
  title?: string;
} | null;

type DashboardLoadRequest = {
  requestId: string;
  dashboardId: string;
  datasourceId: string;
} | null;

function formatTime(value?: number) {
  if (!value) return '未知';
  return new Date(value).toLocaleString();
}

function explainWorkbenchShelfError(message: string, area: 'list' | 'versions' | 'restore') {
  const normalized = message.toLowerCase();
  if (normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
    return '看板接口暂时连不上。请确认 dashboard 后端 3001 服务已启动，再刷新这里。';
  }
  if (normalized.includes('not found') || normalized.includes('cannot get /api/dashboards')) {
    if (area === 'list') return '当前运行中的后端还没有看板列表接口。请把 dashboard 后端重启到最新代码后再刷新。';
    if (area === 'versions') return '版本接口未就绪，或者这块看板已经不存在。先刷新左侧列表再试。';
    return '当前后端还没有版本恢复接口。请重启 dashboard 后端到最新代码后再试。';
  }
  if (normalized.includes('未登录') || normalized.includes('unauthorized')) {
    return '当前开发页没有登录态。若你打开的是 5173 页面，请刷新本地开发登录态后再试。';
  }
  return message;
}

export default function Visuals() {
  const [pendingVisualRequest, setPendingVisualRequest] = useState<PendingVisualRequest>(null);
  const [boardReady, setBoardReady] = useState(false);
  const [dashboardLoadRequest, setDashboardLoadRequest] = useState<DashboardLoadRequest>(null);
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(true);
  const [dashboardsError, setDashboardsError] = useState('');
  const [selectedDashboardId, setSelectedDashboardId] = useState('');
  const [versions, setVersions] = useState<DashboardVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [restoringVersionId, setRestoringVersionId] = useState('');

  const selectedDashboard = useMemo(
    () => dashboards.find((item) => item.id === selectedDashboardId) || null,
    [dashboards, selectedDashboardId],
  );

  const requestDashboardLoad = (dashboard: DashboardSummary | null) => {
    if (!dashboard) return;
    setSelectedDashboardId(dashboard.id);
    setDashboardLoadRequest({
      requestId: crypto.randomUUID(),
      dashboardId: dashboard.id,
      datasourceId: dashboard.datasourceId,
    });
  };

  const reloadDashboards = async (preferDashboardId?: string) => {
    setDashboardsLoading(true);
    setDashboardsError('');
    try {
      const items = await listDashboards();
      setDashboards(items);
      const preferred = preferDashboardId || selectedDashboardId;
      const nextSelected = items.find((item) => item.id === preferred)?.id || items[0]?.id || '';
      setSelectedDashboardId(nextSelected);
    } catch (loadError) {
      const message = (loadError as Error).message || '读取看板失败';
      setDashboardsError(explainWorkbenchShelfError(message, 'list'));
    } finally {
      setDashboardsLoading(false);
    }
  };

  useEffect(() => {
    void reloadDashboards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedDashboardId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError('');
    listDashboardVersions(selectedDashboardId)
      .then((items) => {
        if (!cancelled) setVersions(items);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setVersions([]);
          const message = (loadError as Error).message || '读取版本失败';
          setVersionsError(explainWorkbenchShelfError(message, 'versions'));
        }
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedDashboardId]);

  return (
    <div className="visuals-shell">
      <div className="page-header visuals-page-header">
        <h1>可视化工坊</h1>
        <p>在同一个工作台里生成数据看板、归档 HTML 可视化页面，并把保存过的结果直接回填成看板组件。</p>
      </div>

      <div className="visuals-callout-grid">
        <article className="card visuals-callout">
          <span className="visuals-callout-kicker">1. 生成看板</span>
          <strong>先用数据源起一个可编辑看板</strong>
          <p>上传 CSV / Excel，或者直接选择已有数据源，工坊会先生成一版可拖拽的看板骨架。</p>
        </article>
        <article className="card visuals-callout">
          <span className="visuals-callout-kicker">2. 归档 HTML</span>
          <strong>把固定页面当成正式素材保存</strong>
          <p>会话里产出的 HTML 页面保存后会进入素材库，不再只是一次性的临时预览链接。</p>
        </article>
        <article className="card visuals-callout">
          <span className="visuals-callout-kicker">3. 回填组件</span>
          <strong>已保存的 HTML 页面可直接放进看板</strong>
          <p>HTML 不再是独立页面，而是看板里的一个 widget 类型，可以和图表、明细、KPI 一起编排。</p>
        </article>
      </div>

      <section className="visuals-workbench">
        <div className="visuals-workbench-head">
          <div>
            <div className="card-header">看板工作台</div>
            <p>这里是主编辑区。HTML 页面已经并入看板体系，会和普通图表一起参与布局、版本管理与自动保存。</p>
          </div>
          <span className={`visuals-workbench-status${boardReady ? ' ready' : ''}`}>
            {boardReady ? '当前看板已就绪，修改后会自动保存并同步到下方“我的看板”' : '先上传数据或选择数据源，再把 HTML 页面放进看板'}
          </span>
        </div>
        <div className="visuals-workbench-surface">
          <DashboardStudio
            pendingVisualRequest={pendingVisualRequest}
            onPendingVisualHandled={() => setPendingVisualRequest(null)}
            onBoardReadyChange={setBoardReady}
            dashboardLoadRequest={dashboardLoadRequest}
            onDashboardLoadHandled={() => setDashboardLoadRequest(null)}
            onDashboardSaved={(dashboardId) => { void reloadDashboards(dashboardId); }}
          />
        </div>
      </section>

      <section className="card visuals-boards-card">
        <div className="visuals-boards-head">
          <div>
            <div className="card-header">我的看板</div>
            <p>这里是已经入库的看板对象。左侧卡片点一下就会直接载入上方工作台，右侧可继续看版本历史或回滚。</p>
          </div>
          <div className="visuals-boards-actions">
            <button className="btn btn-sm" type="button" onClick={() => { void reloadDashboards(); }} disabled={dashboardsLoading}>
              {dashboardsLoading ? '刷新中…' : '刷新列表'}
            </button>
          </div>
        </div>

        {dashboardsError && <div className="visual-inline-error">{dashboardsError}</div>}
        <div className="visuals-boards-grid">
          <div className="visuals-board-column">
            <div className="visuals-board-column-head">
              <strong>看板列表</strong>
              <span>{dashboards.length} 个</span>
            </div>
            {dashboardsLoading && dashboards.length === 0 ? (
              <div className="visuals-board-empty">看板列表加载中…</div>
            ) : dashboards.length === 0 ? (
              <div className="visuals-board-empty">当前还没有已保存看板。上面的工作台生成布局后会在约 1 秒内自动保存到这里；如果一直不出现，请先看工作台右上角的自动保存状态。</div>
            ) : (
              <div className="visuals-board-list">
                {dashboards.map((dashboard) => (
                  <button
                    key={dashboard.id}
                    type="button"
                    className={`visuals-board-item${selectedDashboardId === dashboard.id ? ' selected' : ''}`}
                    onClick={() => requestDashboardLoad(dashboard)}
                  >
                    <div className="visuals-board-item-top">
                      <strong>{dashboard.name}</strong>
                      <span>{dashboard.legacy ? '旧存档' : `v${dashboard.latestVersionNo}`}</span>
                    </div>
                    <div className="visuals-board-item-meta">
                      <span>{dashboard.datasourceName || dashboard.datasourceId}</span>
                      <span>{dashboard.legacy ? '文件存档' : `${dashboard.versionCount} 个版本`}</span>
                    </div>
                    <div className="visuals-board-item-foot">
                      {dashboard.legacy
                        ? `旧版文件保存于 ${formatTime(dashboard.updatedAt)} · 点击载入后再次保存会进入新看板列表`
                        : `最近保存 ${formatTime(dashboard.updatedAt)} · 点击载入工作台`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="visuals-board-column">
            <div className="visuals-board-column-head">
              <strong>版本历史</strong>
              <span>{selectedDashboard ? selectedDashboard.name : '未选择看板'}</span>
            </div>
            {versionsError && <div className="visual-inline-error">{versionsError}</div>}
            {!selectedDashboard ? (
              <div className="visuals-board-empty">先在左侧选择一个看板，再查看它的版本历史。</div>
            ) : (
              <div className="visuals-version-list">
                {versionsLoading ? (
                  <div className="visuals-board-empty">版本加载中…</div>
                ) : versions.length === 0 ? (
                  <div className="visuals-board-empty">
                    {selectedDashboard?.legacy ? '这是旧版文件存档，当前没有版本历史。载入后做一次修改并自动保存，就会进入新的看板对象体系。' : '这个看板还没有可展示的版本记录。'}
                  </div>
                ) : (
                  versions.map((version) => (
                    <div key={version.id} className={`visuals-version-item${version.current ? ' current' : ''}`}>
                      <div className="visuals-version-top">
                        <strong>v{version.versionNo}</strong>
                        {version.current && <span className="visuals-version-badge">当前版本</span>}
                      </div>
                      <div className="visuals-version-meta">
                        <span>{formatTime(version.createdAt)}</span>
                        <span>{version.createdBy || '系统'}</span>
                      </div>
                      {version.note && <div className="visuals-version-note">{version.note}</div>}
                      <div className="visuals-version-actions">
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => requestDashboardLoad(selectedDashboard)}
                          disabled={!selectedDashboard}
                        >
                          载入当前正式版
                        </button>
                        {!version.current && selectedDashboard && (
                          <button
                            className="btn btn-sm btn-primary"
                            type="button"
                            onClick={() => {
                              setRestoringVersionId(version.id);
                              restoreDashboardVersion(selectedDashboard.id, version.id)
                                .then(() => reloadDashboards(selectedDashboard.id))
                                .then(() => {
                                  setDashboardLoadRequest({
                                    requestId: crypto.randomUUID(),
                                    dashboardId: selectedDashboard.id,
                                    datasourceId: selectedDashboard.datasourceId,
                                  });
                                })
                                .catch((restoreError) => {
                                  const message = (restoreError as Error).message || '恢复版本失败';
                                  setVersionsError(explainWorkbenchShelfError(message, 'restore'));
                                })
                                .finally(() => setRestoringVersionId(''));
                            }}
                            disabled={restoringVersionId === version.id}
                          >
                            {restoringVersionId === version.id ? '恢复中…' : '恢复为当前'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card visuals-library-card">
        <div className="visuals-library-head">
          <div>
            <div className="card-header">HTML 素材库</div>
            <p>固定保存的 HTML 结果在这里归档。可以重新打开，也可以直接塞回上面的看板里。</p>
          </div>
          <span className={`visuals-library-status${boardReady ? ' ready' : ''}`}>
            {boardReady ? '可直接放入当前看板' : '未激活看板时只能查看或删除'}
          </span>
        </div>
        <VisualsLegacy
          embedded
          canAddToBoard={boardReady}
          onAddToBoard={(visual) => {
            setPendingVisualRequest({
              requestId: crypto.randomUUID(),
              visualId: visual.id,
              title: visual.title,
            });
          }}
        />
      </section>
    </div>
  );
}
