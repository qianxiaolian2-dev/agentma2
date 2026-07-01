import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Canvas } from './Canvas';
import { PropertyPanel } from './PropertyPanel';
import { ChatPanel } from './ChatPanel';
import { listDatasources, uploadDatasource, generateDashboard, saveLayout, relayoutDashboard, loadDashboard, profileDataset } from './api';
import type { DashboardLayout, DatasetProfile, DatasourceSummary, Widget, WidgetType } from './types';
import './studio.css';

type PendingVisualRequest = {
  requestId: string;
  visualId: string;
  title?: string;
};

type DashboardLoadRequest = {
  requestId: string;
  dashboardId: string;
  datasourceId: string;
};

type DashboardStudioProps = {
  pendingVisualRequest?: PendingVisualRequest | null;
  onPendingVisualHandled?: (requestId: string) => void;
  onBoardReadyChange?: (ready: boolean) => void;
  dashboardLoadRequest?: DashboardLoadRequest | null;
  onDashboardLoadHandled?: (requestId: string) => void;
  onDashboardSaved?: (dashboardId: string, datasourceId: string) => void;
};

type Phase = 'idle' | 'uploading' | 'profiling' | 'generating' | 'rendering' | 'ready';
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  uploading: '上传数据中',
  profiling: '分析数据画像',
  generating: 'AI 设计看板布局',
  rendering: '渲染图表',
  ready: '',
};

const SCENARIO_LABEL: Record<string, string> = {
  sales: '销售分析', retention: '用户留存', logistics: '物流轨迹',
  workflow: '流程漏斗', attendance: '考勤管理',
  finance: '财务分析', inventory: '库存管理', unknown: '通用看板',
};

function explainWorkbenchRequestError(message: string, action: 'save' | 'load') {
  const normalized = message.toLowerCase();
  if (normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
    return '本地 3001 后端未启动';
  }
  if (normalized.includes('not found') || normalized.includes('cannot get /api/dashboard')) {
    return action === 'save'
      ? '当前后端还不是最新代码，保存接口未就绪'
      : '当前后端还不是最新代码，读取接口未就绪';
  }
  if (normalized.includes('未登录') || normalized.includes('unauthorized')) {
    return '当前开发页没有登录态，请刷新本地开发登录态';
  }
  return message;
}

export default function DashboardStudio({
  pendingVisualRequest = null,
  onPendingVisualHandled,
  onBoardReadyChange,
  dashboardLoadRequest = null,
  onDashboardLoadHandled,
  onDashboardSaved,
}: DashboardStudioProps) {
  const [datasources, setDatasources] = useState<DatasourceSummary[]>([]);
  const [activeDsId, setActiveDsId] = useState<string | null>(null);
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [layoutSource, setLayoutSource] = useState<'mock' | 'llm' | 'llm_retry'>('llm');
  const [llmError, setLlmError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dashId, setDashId] = useState<string>('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedLayoutKey = useRef<string>('');

  // 启动加载已有数据源
  useEffect(() => {
    listDatasources().then(setDatasources).catch((e) => setError(e.message));
  }, []);

  const enrichLayout = useCallback((nextLayout: DashboardLayout) => ({
    ...nextLayout,
    widgets: nextLayout.widgets.map((w) => ({
      ...w,
      grid: {
        ...w.grid,
        minW: w.grid.minW ?? defaultMinSize(w.type).w,
        minH: w.grid.minH ?? defaultMinSize(w.type).h,
      },
    })),
  }), []);

  // ESC 退出预览模式
  useEffect(() => {
    if (!previewMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewMode]);

  const generate = useCallback(async (datasourceId: string, tableName?: string) => {
    setPhase('profiling');
    setError(null);
    try {
      setPhase('generating');
      const result = await generateDashboard(datasourceId, tableName);
      setProfile(result.profile);
      setLayoutSource(result.source);
      setLlmError(result.llmError || null);
      setPhase('rendering');
      const enriched = enrichLayout(result.layout);
      persistedLayoutKey.current = '';
      setLayout(enriched);
      setDashId(crypto.randomUUID());
      setSavedAt(null);
      setSaveState('pending');
      setSaveError(null);
      setPhase('ready');
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  }, [enrichLayout]);

  const onSelectDatasource = useCallback((dsId: string) => {
    setActiveDsId(dsId);
    setLayout(null);
    setProfile(null);
    setSelectedId(null);
    setSaveState('idle');
    setSaveError(null);
    void generate(dsId);
  }, [generate]);

  const onFileSelected = useCallback(async (file: File) => {
    setPhase('uploading');
    setError(null);
    try {
      const ds = await uploadDatasource(file);
      setDatasources((prev) => [ds, ...prev]);
      setActiveDsId(ds.id);
      setSaveState('idle');
      setSaveError(null);
      await generate(ds.id);
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    }
  }, [generate]);

  // —— 编辑动作 ——
  const patchWidget = useCallback((id: string, patch: Partial<Widget>) => {
    setLayout((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        widgets: cur.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      };
    });
  }, []);

  const deleteWidget = useCallback((id: string) => {
    setLayout((cur) => {
      if (!cur) return cur;
      return { ...cur, widgets: cur.widgets.filter((w) => w.id !== id) };
    });
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const pinFromAi = useCallback((widget: Widget) => {
    setLayout((cur) => {
      if (!cur) return cur;
      const min = defaultMinSize(widget.type);
      const maxY = cur.widgets.reduce((m, x) => Math.max(m, x.grid.y + x.grid.h), 0);
      const w: Widget = {
        ...widget,
        grid: {
          ...widget.grid,
          x: 0, y: maxY,
          minW: min.w, minH: min.h,
        },
      };
      return { ...cur, widgets: [...cur.widgets, w] };
    });
    // 滚到底,让用户看到刚加进来的图
    requestAnimationFrame(() => {
      const el = document.querySelector('.ds-canvas-col');
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  const relayout = useCallback(async () => {
    if (!layout) return;
    try {
      const result = await relayoutDashboard(layout);
      setLayout(result.layout);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [layout]);

  const addWidget = useCallback((type: WidgetType) => {
    if (!layout || !profile) return;
    const id = crypto.randomUUID();
    const min = defaultMinSize(type);
    const maxY = layout.widgets.reduce((m, w) => Math.max(m, w.grid.y + w.grid.h), 0);
    const newWidget: Widget = {
      id, type,
      title: defaultTitle(type),
      grid: { x: 0, y: maxY, w: Math.max(min.w, 6), h: Math.max(min.h, 5), minW: min.w, minH: min.h },
      data: { encoding: defaultEncoding(type, profile) },
      reasoning: '手动添加',
      manualEdited: true,
      pending: true,  // 标记为待确认,取消 drawer 时会一并删除
    };
    setLayout({ ...layout, widgets: [...layout.widgets, newWidget] });
    setSelectedId(id);
  }, [layout, profile]);

  const addSavedVisualWidget = useCallback((visualId: string, title?: string) => {
    if (!layout || !profile) return false;
    const id = crypto.randomUUID();
    const min = defaultMinSize('html');
    const maxY = layout.widgets.reduce((m, w) => Math.max(m, w.grid.y + w.grid.h), 0);
    const widgetTitle = title?.trim() || 'HTML 可视化';
    const widget: Widget = {
      id,
      type: 'html',
      title: widgetTitle,
      grid: { x: 0, y: maxY, w: Math.max(min.w, 6), h: Math.max(min.h, 7), minW: min.w, minH: min.h },
      data: {},
      options: { visualId },
      reasoning: '从 HTML 素材库加入',
      manualEdited: true,
    };
    setLayout({ ...layout, widgets: [...layout.widgets, widget] });
    setSelectedId(id);
    return true;
  }, [layout, profile]);

  useEffect(() => {
    onBoardReadyChange?.(Boolean(layout && profile));
  }, [layout, onBoardReadyChange, profile]);

  useEffect(() => {
    if (!pendingVisualRequest || !layout || !profile) return;
    const added = addSavedVisualWidget(pendingVisualRequest.visualId, pendingVisualRequest.title);
    if (added) onPendingVisualHandled?.(pendingVisualRequest.requestId);
  }, [addSavedVisualWidget, layout, onPendingVisualHandled, pendingVisualRequest, profile]);

  useEffect(() => {
    if (!dashboardLoadRequest) return;
    let cancelled = false;
    setPhase('rendering');
    setError(null);
    setSelectedId(null);
    setPreviewMode(false);

    const run = async () => {
      try {
        const dashboardResult = await loadDashboard(dashboardLoadRequest.dashboardId, dashboardLoadRequest.datasourceId);
        const nextProfile = await profileDataset(
          dashboardLoadRequest.datasourceId,
          dashboardResult.layout.meta?.tableName,
        );
        if (cancelled) return;
        const enriched = enrichLayout(dashboardResult.layout);
        persistedLayoutKey.current = JSON.stringify(enriched);
        setActiveDsId(dashboardLoadRequest.datasourceId);
        setProfile(nextProfile);
        setLayout(enriched);
        setDashId(dashboardResult.id);
        setSavedAt(dashboardResult.updatedAt || null);
        setSaveState('saved');
        setSaveError(null);
        setLayoutSource('llm');
        setLlmError(null);
        setPhase('ready');
      } catch (loadError) {
        if (!cancelled) {
          const message = (loadError as Error).message || '读取看板失败';
          setError(explainWorkbenchRequestError(message, 'load'));
          setPhase('idle');
        }
      } finally {
        if (!cancelled) onDashboardLoadHandled?.(dashboardLoadRequest.requestId);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [dashboardLoadRequest, enrichLayout, onDashboardLoadHandled]);

  // 自动保存(debounce)
  useEffect(() => {
    if (!layout || !dashId) return;
    const nextLayoutKey = JSON.stringify(layout);
    if (persistedLayoutKey.current === nextLayoutKey) return;
    setSaveState('pending');
    setSaveError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState('saving');
      saveLayout(dashId, layout)
        .then((result) => {
          persistedLayoutKey.current = nextLayoutKey;
          setSavedAt(result.updatedAt || Date.now());
          setSaveState('saved');
          setSaveError(null);
          onDashboardSaved?.(result.id, layout.meta.datasourceId);
        })
        .catch((saveErr) => {
          const message = explainWorkbenchRequestError((saveErr as Error).message || '自动保存失败', 'save');
          setSaveState('error');
          setSaveError(message);
        });
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [layout, dashId, onDashboardSaved]);

  const selectedWidget = useMemo(
    () => layout?.widgets.find((w) => w.id === selectedId) || null,
    [layout, selectedId],
  );

  return (
    <div className={`ds-root ${previewMode ? 'ds-preview-mode' : ''}`}>
      <header className="ds-topbar">
        <div className="ds-topbar-left">
          <h2 className="ds-title">{layout?.meta.title || '版本工作台'}</h2>
          {profile && (
            <span className="ds-scenario-tag">
              {SCENARIO_LABEL[profile.scenario] || profile.scenario}
              <span className="ds-scenario-reason"> · {profile.scenarioReason}</span>
            </span>
          )}
          {layout && (
            <span className={`ds-source-tag ds-source-${layoutSource}`} title={llmError || ''}>
              {layoutSource === 'llm' ? '🤖 AI 生成' :
               layoutSource === 'llm_retry' ? '🤖 AI 生成 (修正一次)' :
               '⚙️ 规则兜底' + (llmError ? ' (LLM 不可用)' : '')}
            </span>
          )}
        </div>
        <div className="ds-topbar-right">
          {layout && phase === 'ready' && (
            <>
              <span className={`ds-save-chip ds-save-${saveState}`} title={saveError || ''}>
                {saveStateLabel(saveState)}
              </span>
              <span className="ds-saved">{saveStateDetail(saveState, savedAt, saveError)}</span>
            </>
          )}
          {layout && <AddWidgetMenu onAdd={addWidget} />}
          {layout && (
            <button className="ds-btn" onClick={relayout} title="重新规整网格">
              ⊞ 重新排布
            </button>
          )}
          {layout && (
            <button className="ds-btn" onClick={() => setPreviewMode(true)} title="全屏预览(ESC 退出)">
              ⛶ 全屏预览
            </button>
          )}
          {layout && (
            <button className="ds-btn" onClick={() => activeDsId && generate(activeDsId)}>
              ↻ 重新生成
            </button>
          )}
          <select
            className="ds-input"
            value={activeDsId || ''}
            onChange={(e) => e.target.value && onSelectDatasource(e.target.value)}
          >
            <option value="">补选数据源…</option>
            {datasources.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="ds-btn" onClick={() => fileInputRef.current?.click()}>
            ⬆ 补传 CSV/Excel
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx,.sqlite,.db"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileSelected(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {error && <div className="ds-error-bar">⚠ {error}</div>}

      {previewMode && (
        <button className="ds-preview-exit" onClick={() => setPreviewMode(false)} title="退出全屏 (ESC)">
          ⛶ 退出预览
        </button>
      )}

      {phase !== 'idle' && phase !== 'ready' && (
        <div className="ds-progress-bar">
          <div className="ds-progress-fill" style={{ width: phaseProgress(phase) }} />
          <span className="ds-progress-text">{PHASE_LABEL[phase]}…</span>
        </div>
      )}

      <main className="ds-main">
        {!layout ? (
          <EmptyState onUpload={() => fileInputRef.current?.click()} />
        ) : (
          <>
            <aside className="ds-chat-col">
              <ChatPanel
                profile={profile}
                layout={layout}
                onPinToBoard={pinFromAi}
                onApplyLayout={(nextLayout) => {
                  setLayout(enrichLayout(nextLayout));
                  setSelectedId(null);
                  // 编辑后把画布滚回顶部,避免用户停在底部空白看不到改动
                  requestAnimationFrame(() => {
                    document.querySelector('.ds-canvas-col')?.scrollTo({ top: 0, behavior: 'smooth' });
                  });
                }}
              />
            </aside>
            <div className="ds-canvas-col">
              <Canvas
                layout={layout}
                selectedId={selectedId}
                onSelect={previewMode ? () => {} : setSelectedId}
                onLayoutChange={setLayout}
                onDelete={deleteWidget}
                readOnly={previewMode}
              />
            </div>
            {selectedWidget && (
              <EditDrawer
                key={selectedWidget.id}
                widget={selectedWidget}
                profile={profile}
                onPatch={patchWidget}
                onClose={() => setSelectedId(null)}
                onDelete={() => { deleteWidget(selectedWidget.id); }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AddWidgetMenu({ onAdd }: { onAdd: (t: WidgetType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const types: WidgetType[] = ['kpi', 'line', 'bar', 'pie', 'donut', 'funnel', 'gauge', 'scatter', 'table', 'html'];
  return (
    <div className="ds-add-menu" ref={ref}>
      <button className="ds-btn" onClick={() => setOpen((v) => !v)}>
        + 添加图表 ▾
      </button>
      {open && (
        <div className="ds-add-dropdown">
          {types.map((t) => (
            <button
              key={t}
              className="ds-add-item"
              onClick={() => { onAdd(t); setOpen(false); }}
            >
              <span className="ds-add-item-icon">{chartIcon(t)}</span>
              <span>{chartLabel(t)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="ds-empty">
      <div className="ds-empty-card">
        <div className="ds-empty-emoji">📊</div>
        <div className="ds-empty-title">会话先定方案,工坊再做版本化落地</div>
        <div className="ds-empty-hint">模型选择、业务文件上传、Agent 和技能调用优先放在会话里完成。</div>
        <div className="ds-empty-actions">
          <Link className="ds-btn ds-btn-primary" to="/conversations">去会话上传并设计</Link>
          <button className="ds-btn" onClick={onUpload}>补传数据文件</button>
        </div>
        <div className="ds-empty-note">当前如果要进入可拖拽编辑，仍需要选择已有数据源，或在这里补传 CSV / Excel / SQLite 生成数据源。</div>
        <div className="ds-empty-hint">首版生成后会自动保存到下方“看板版本仓库”</div>
      </div>
    </div>
  );
}

function saveStateLabel(state: SaveState): string {
  return {
    idle: '自动保存待命',
    pending: '等待自动保存',
    saving: '自动保存中',
    saved: '已自动保存',
    error: '自动保存失败',
  }[state];
}

function saveStateDetail(state: SaveState, savedAt: number | null, saveError: string | null): string {
  if (state === 'saved' && savedAt) return `最近保存 ${formatTime(savedAt)}`;
  if (state === 'saving') return '草稿正在写回看板对象';
  if (state === 'pending') return '修改后约 1 秒会同步到下方看板列表';
  if (state === 'error') return saveError || '请检查后端服务与登录态';
  return '首版生成后会自动写入下方看板列表';
}

function defaultMinSize(type: WidgetType): { w: number; h: number } {
  const map: Record<WidgetType, { w: number; h: number }> = {
    line: { w: 6, h: 6 }, bar: { w: 4, h: 6 }, pie: { w: 3, h: 5 }, donut: { w: 3, h: 5 },
    kpi: { w: 3, h: 3 }, table: { w: 6, h: 5 },
    heatmap: { w: 6, h: 6 }, funnel: { w: 4, h: 6 }, gauge: { w: 3, h: 4 },
    scatter: { w: 6, h: 6 }, text: { w: 3, h: 2 }, html: { w: 6, h: 7 },
  };
  return map[type];
}

function defaultEncoding(type: WidgetType, profile: DatasetProfile): any {
  const dim = profile.suggestedDimensions[0];
  const metric = profile.suggestedMetrics[0];
  const time = profile.timeFields[0];
  if (type === 'kpi') return { y: { field: metric || '*', type: 'quantitative', agg: metric ? 'sum' : 'count' } };
  if (type === 'line' && time) return { x: { field: time, type: 'time' }, y: { field: metric || '*', type: 'quantitative', agg: metric ? 'sum' : 'count' } };
  if ((type === 'pie' || type === 'donut') && dim) return { color: { field: dim }, y: { field: metric || '*', type: 'quantitative', agg: metric ? 'sum' : 'count' } };
  if (dim) return { x: { field: dim, type: 'nominal' }, y: { field: metric || '*', type: 'quantitative', agg: metric ? 'sum' : 'count' } };
  return {};
}

function defaultTitle(type: WidgetType): string {
  return ({ kpi: '指标卡', line: '趋势图', bar: '排行榜', pie: '占比', donut: '占比', funnel: '漏斗', gauge: '完成度', table: '明细', scatter: '散点', heatmap: '热力图', text: '说明', html: 'HTML 可视化' } as Record<WidgetType, string>)[type];
}

function chartLabel(type: WidgetType): string { return defaultTitle(type); }
function chartIcon(type: WidgetType): string {
  return ({ kpi: '🔢', line: '📈', bar: '📊', pie: '🥧', donut: '🍩', funnel: '🔻', gauge: '⏱', table: '📋', scatter: '✨', heatmap: '🔥', text: '📝', html: '📄' } as Record<WidgetType, string>)[type];
}

function phaseProgress(p: Phase): string {
  return ({ idle: '0%', uploading: '20%', profiling: '40%', generating: '70%', rendering: '90%', ready: '100%' } as Record<Phase, string>)[p];
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/** EditDrawer:草稿模式 — 改的过程中不影响画布,点"应用"才写回 */
function EditDrawer({
  widget,
  profile,
  onPatch,
  onClose,
  onDelete,
}: {
  widget: Widget;
  profile: DatasetProfile | null;
  onPatch: (id: string, patch: Partial<Widget>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  // 打开时拷贝一份"草稿",所有编辑只改草稿,不动画布
  const [draft, setDraft] = useState<Widget>(() => JSON.parse(JSON.stringify(widget)));
  const [hasEdited, setHasEdited] = useState(false);

  // widget id 变了(切到另一个组件)→ 重置草稿
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(widget)));
    setHasEdited(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  // 草稿层 onPatch:只改 draft 不影响画布
  const draftPatch = (_id: string, patch: Partial<Widget>) => {
    setDraft((cur) => ({ ...cur, ...patch, data: patch.data ?? cur.data }));
    setHasEdited(true);
  };

  const apply = () => {
    onPatch(widget.id, { ...draft, manualEdited: true, pending: undefined });
    onClose();
  };

  const cancel = () => {
    // 如果是新建的 pending widget,取消时一并删除
    if (widget.pending) {
      if (!hasEdited || window.confirm('确定取消添加这个组件?')) {
        onDelete();
        return;
      }
    }
    // 已有组件,有改动就提示
    if (hasEdited && !window.confirm('有未应用的改动,确定取消?')) return;
    onClose();
  };

  const isPending = widget.pending === true;

  return (
    <aside className="ds-side-panel ds-side-panel-drawer">
      <div className="ds-drawer-head">
        <span>
          {isPending ? '添加组件' : '编辑组件'}
          {hasEdited && <span className="ds-drawer-dirty"> · 未应用</span>}
        </span>
        <button className="ds-drawer-close" onClick={cancel} title="关闭">×</button>
      </div>
      <PropertyPanel
        widget={draft}
        profile={profile}
        onPatch={draftPatch}
      />
      <div className="ds-drawer-actions">
        {!isPending && (
          <button className="ds-btn ds-btn-danger-soft" onClick={onDelete} title="删除这个组件">
            🗑 删除
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button className="ds-btn" onClick={cancel}>取消</button>
        <button className="ds-btn ds-btn-primary" onClick={apply}>
          {isPending ? '✓ 确认添加' : '✓ 应用更改'}
        </button>
      </div>
    </aside>
  );
}
