import type { DatasetProfile, FieldProfile, Widget, WidgetType, WidgetFilter, FilterOp } from './types';

interface Props {
  widget: Widget | null;
  profile: DatasetProfile | null;
  onPatch: (id: string, patch: Partial<Widget>) => void;
}

const OP_LABEL: Record<FilterOp, string> = {
  '=': '等于', '!=': '不等于',
  '>': '大于', '>=': '≥', '<': '小于', '<=': '≤',
  in: '在...之中', not_in: '不在...之中',
  contains: '包含', is_null: '为空', is_not_null: '不为空',
  between: '在...之间',
};

// —— 单条过滤条件:[字段 ▼] [操作符 ▼] [值] [×] ——
function FilterRow({
  filter,
  profile,
  onChange,
  onRemove,
}: {
  filter: WidgetFilter;
  profile: DatasetProfile;
  onChange: (patch: Partial<WidgetFilter>) => void;
  onRemove: () => void;
}) {
  const f = profile.fields.find((x) => x.name === filter.field);
  const isNumeric = f && /^(INTEGER|REAL|NUMERIC|FLOAT|DOUBLE)$/i.test(f.type);
  const isTime = f?.isTime;
  // 字段类型决定可用的 op
  const ops: FilterOp[] = isNumeric || isTime
    ? ['=', '!=', '>', '>=', '<', '<=', 'between', 'is_null', 'is_not_null']
    : ['=', '!=', 'contains', 'in', 'not_in', 'is_null', 'is_not_null'];

  const needsValue = !['is_null', 'is_not_null'].includes(filter.op);
  const isMultiValue = filter.op === 'in' || filter.op === 'not_in' || filter.op === 'between';

  const renderValueInput = () => {
    if (!needsValue) return null;
    if (isMultiValue) {
      const arr = Array.isArray(filter.value) ? filter.value : [];
      const text = arr.join(',');
      return (
        <input
          className="ds-input ds-filter-value"
          placeholder={filter.op === 'between' ? '小,大' : '逗号分隔'}
          value={text}
          onChange={(e) => {
            const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onChange({ value: isNumeric ? parts.map(Number).filter((n) => Number.isFinite(n)) : parts });
          }}
        />
      );
    }
    return (
      <input
        className="ds-input ds-filter-value"
        type={isNumeric ? 'number' : 'text'}
        placeholder="值"
        value={filter.value as any ?? ''}
        onChange={(e) => onChange({ value: isNumeric ? Number(e.target.value) : e.target.value })}
      />
    );
  };

  return (
    <div className="ds-filter-row">
      <select
        className="ds-input ds-filter-field"
        value={filter.field}
        onChange={(e) => onChange({ field: e.target.value, value: '' })}
      >
        {profile.fields.map((fld) => (
          <option key={fld.name} value={fld.name}>{fld.name}</option>
        ))}
      </select>
      <select
        className="ds-input ds-filter-op"
        value={filter.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOp })}
      >
        {ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
      </select>
      {renderValueInput()}
      <button className="ds-filter-remove" onClick={onRemove} title="移除">×</button>
    </div>
  );
}

// —— 维度/字段下拉:按角色分组的 options —— 顶部放,Fast Refresh 友好
function FieldGroupedOptions({ profile, kind }: {
  profile: DatasetProfile;
  kind: 'dimension' | 'all';
}) {
  void kind;
  const groups = [
    { label: '维度字段 (推荐)', fields: profile.fields.filter((f) => f.role === 'dimension' || f.role === 'geo') },
    { label: '时间字段', fields: profile.fields.filter((f) => f.isTime) },
    { label: '数值字段', fields: profile.fields.filter((f) => /^(INTEGER|REAL|NUMERIC|FLOAT|DOUBLE)$/i.test(f.type) && !f.isTime) },
    { label: 'ID/编号字段', fields: profile.fields.filter((f) => f.isIdLike) },
    { label: '文本字段', fields: profile.fields.filter((f) => f.role === 'text') },
  ].filter((g) => g.fields.length > 0);
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

// —— 字段口径说明卡 —— 放在顶部,避免 HMR Fast Refresh 在 IIFE 中找不到
function FieldExplain({ field }: { field: FieldProfile }) {
  const samples = field.samples.slice(0, 3).join(', ') || '—';
  const range = field.min != null && field.max != null
    ? `${formatNum(field.min)} ~ ${formatNum(field.max)}`
    : null;
  const roleLabel = ({
    metric: '数值指标', dimension: '维度', time: '时间',
    id: 'ID/编号', text: '文本', geo: '地理', unknown: '未知',
  } as Record<string, string>)[field.role] || field.role;

  return (
    <div className="ds-field-explain">
      <div className="ds-field-explain-row">
        <span className="ds-field-explain-key">类型</span>
        <span>{field.type} · {roleLabel}</span>
      </div>
      <div className="ds-field-explain-row">
        <span className="ds-field-explain-key">基数</span>
        <span>{field.cardinality} 个不同值</span>
      </div>
      {range && (
        <div className="ds-field-explain-row">
          <span className="ds-field-explain-key">范围</span>
          <span>{range}</span>
        </div>
      )}
      <div className="ds-field-explain-row">
        <span className="ds-field-explain-key">空值率</span>
        <span>{(field.nullRate * 100).toFixed(1)}%</span>
      </div>
      <div className="ds-field-explain-row">
        <span className="ds-field-explain-key">样例</span>
        <span className="ds-field-explain-samples" title={samples}>{samples}</span>
      </div>
      {field.isIdLike && (
        <div className="ds-field-explain-warn">
          ⚠ 系统识别为 ID/编号字段,sum/avg 通常无意义
        </div>
      )}
      {!field.isMetric && !field.isIdLike && field.role !== 'metric' && (
        <div className="ds-field-explain-hint">
          💡 这不是典型指标字段,确认聚合方式是否符合业务口径
        </div>
      )}
    </div>
  );
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  return n.toLocaleString('zh-CN');
}

const TYPES: Array<{ value: WidgetType; label: string }> = [
  { value: 'kpi', label: 'KPI 卡片' },
  { value: 'line', label: '折线图' },
  { value: 'bar', label: '柱状图' },
  { value: 'pie', label: '饼图' },
  { value: 'donut', label: '环形图' },
  { value: 'funnel', label: '漏斗图' },
  { value: 'gauge', label: '仪表盘' },
  { value: 'scatter', label: '散点图' },
  { value: 'table', label: '数据明细' },
];

const AGGS_NUMERIC = ['sum', 'avg', 'count', 'count_distinct', 'max', 'min'] as const;
const AGGS_TEXT = ['count', 'count_distinct', 'max', 'min'] as const;
const AGG_LABEL: Record<string, string> = {
  sum: 'SUM 求和', avg: 'AVG 平均', count: 'COUNT 计数',
  count_distinct: 'COUNT DISTINCT 去重计数',
  max: 'MAX 最大', min: 'MIN 最小',
};

export function PropertyPanel({ widget, profile, onPatch }: Props) {
  if (!widget || !profile) {
    return (
      <div className="ds-panel-empty">
        <div className="ds-panel-empty-title">未选中组件</div>
        <div className="ds-panel-empty-hint">点击画布中的图表进行编辑</div>
      </div>
    );
  }

  const enc = widget.data.encoding || {};
  const fieldByName = new Map(profile.fields.map((f) => [f.name, f]));
  const isNumericType = (t: string) => /^(INTEGER|REAL|NUMERIC|FLOAT|DOUBLE)$/i.test(t);

  // 字段三个分组(按"通常用作什么"提示用户,但每个字段都允许选)
  const numericFields = profile.fields.filter((f) => isNumericType(f.type) && !f.isTime);
  const recommendedMetrics = profile.fields.filter((f) => f.isMetric || f.role === 'metric');
  const otherNumeric = numericFields.filter((f) => !recommendedMetrics.includes(f));
  const dimFields = profile.fields.filter((f) => f.role === 'dimension' || f.role === 'geo');
  const idLikeFields = profile.fields.filter((f) => f.isIdLike);
  const textFields = profile.fields.filter((f) => f.role === 'text');
  const timeFields = profile.fields.filter((f) => f.isTime);
  // 给"指标"下拉用:推荐 / 数值 / 维度(去重) / ID(去重) / 时间(去重) / 文本(去重)
  const groupedForMetric = [
    { label: '推荐指标 (适合做数值聚合)', fields: recommendedMetrics },
    { label: '其他数值字段', fields: otherNumeric },
    { label: '维度字段 (建议用 COUNT DISTINCT)', fields: dimFields },
    { label: 'ID/编号 (建议用 COUNT DISTINCT)', fields: idLikeFields },
    { label: '文本字段 (建议用 COUNT DISTINCT)', fields: textFields },
    { label: '时间字段', fields: timeFields },
  ].filter((g) => g.fields.length > 0);

  // 默认聚合方式:数值 → sum, 其他 → count_distinct
  const defaultAggFor = (fieldName: string): 'sum' | 'count_distinct' | 'count' => {
    if (fieldName === '*') return 'count';
    const f = fieldByName.get(fieldName);
    if (f && isNumericType(f.type) && !f.isTime && !f.isIdLike) return 'sum';
    return 'count_distinct';
  };

  const allowedAggsFor = (fieldName: string): readonly string[] => {
    if (fieldName === '*') return ['count'];
    const f = fieldByName.get(fieldName);
    if (f && isNumericType(f.type) && !f.isTime && !f.isIdLike) return AGGS_NUMERIC;
    return AGGS_TEXT;
  };

  const switchType = (newType: WidgetType) => {
    // 类型切换时,做最简单的"字段重新映射"
    let nextEnc = { ...enc };
    const firstNumName = numericFields[0]?.name;
    const firstDimName = dimFields[0]?.name;
    const firstTimeName = timeFields[0]?.name;
    if (newType === 'line' && firstTimeName) {
      nextEnc.x = { field: firstTimeName, type: 'time' };
      if (!nextEnc.y && firstNumName) nextEnc.y = { field: firstNumName, type: 'quantitative', agg: 'sum' };
    }
    if ((newType === 'bar' || newType === 'funnel') && firstDimName) {
      nextEnc.x = { field: firstDimName, type: 'nominal' };
      if (!nextEnc.y && firstNumName) nextEnc.y = { field: firstNumName, type: 'quantitative', agg: 'sum' };
    }
    if ((newType === 'pie' || newType === 'donut') && firstDimName) {
      nextEnc.color = { field: firstDimName };
      if (!nextEnc.y && firstNumName) nextEnc.y = { field: firstNumName, type: 'quantitative', agg: 'sum' };
    }
    if (newType === 'kpi' && firstNumName && (!nextEnc.y || nextEnc.y.field === '*')) {
      nextEnc.y = { field: firstNumName, type: 'quantitative', agg: 'sum' };
    }
    onPatch(widget.id, {
      type: newType,
      data: { ...widget.data, encoding: nextEnc },
      manualEdited: true,
    });
  };

  const setEncoding = (key: 'x' | 'y' | 'color', patch: any) => {
    onPatch(widget.id, {
      data: {
        ...widget.data,
        encoding: { ...enc, [key]: { ...(enc as any)[key], ...patch } },
      },
      manualEdited: true,
    });
  };

  const filters = widget.data.filters || [];
  const setFilters = (next: WidgetFilter[]) => {
    onPatch(widget.id, {
      data: { ...widget.data, filters: next },
      manualEdited: true,
    });
  };
  const updateFilter = (i: number, patch: Partial<WidgetFilter>) => {
    setFilters(filters.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  };
  const addFilter = () => {
    const firstField = profile.fields[0]?.name;
    if (!firstField) return;
    setFilters([...filters, { field: firstField, op: '=', value: '' }]);
  };
  const removeFilter = (i: number) => setFilters(filters.filter((_, idx) => idx !== i));

  return (
    <div className="ds-panel">
      <div className="ds-panel-section">
        <label className="ds-panel-label">标题</label>
        <input
          className="ds-input"
          value={widget.title}
          onChange={(e) => onPatch(widget.id, { title: e.target.value, manualEdited: true })}
        />
      </div>

      <div className="ds-panel-section">
        <label className="ds-panel-label">图表类型</label>
        <select
          className="ds-input"
          value={widget.type}
          onChange={(e) => switchType(e.target.value as WidgetType)}
        >
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {(widget.type === 'line' || widget.type === 'bar' || widget.type === 'scatter' || widget.type === 'funnel') && (
        <div className="ds-panel-section">
          <label className="ds-panel-label">
            X 轴 / 维度
            {widget.type === 'line' && <span className="ds-panel-hint"> · 推荐选时间字段</span>}
          </label>
          <select
            className="ds-input"
            value={enc.x?.field || ''}
            onChange={(e) => {
              const name = e.target.value;
              const f = fieldByName.get(name);
              const xType = f?.isTime ? 'time' : 'nominal';
              setEncoding('x', { field: name, type: xType });
            }}
          >
            <option value="">请选择</option>
            <FieldGroupedOptions profile={profile} kind="dimension" />
          </select>
          {enc.x?.field && fieldByName.get(enc.x.field) && (
            <FieldExplain field={fieldByName.get(enc.x.field)!} />
          )}
        </div>
      )}

      {(widget.type === 'pie' || widget.type === 'donut') && (
        <div className="ds-panel-section">
          <label className="ds-panel-label">分组维度</label>
          <select
            className="ds-input"
            value={enc.color?.field || ''}
            onChange={(e) => setEncoding('color', { field: e.target.value })}
          >
            <option value="">请选择</option>
            <FieldGroupedOptions profile={profile} kind="dimension" />
          </select>
          {enc.color?.field && fieldByName.get(enc.color.field) && (
            <FieldExplain field={fieldByName.get(enc.color.field)!} />
          )}
        </div>
      )}

      {widget.type !== 'table' && widget.type !== 'text' && (
        <>
          <div className="ds-panel-section">
            <label className="ds-panel-label">指标</label>
            <select
              className="ds-input"
              value={enc.y?.field || ''}
              onChange={(e) => {
                const name = e.target.value;
                if (name === '*') {
                  setEncoding('y', { field: '*', type: 'quantitative', agg: 'count' });
                  return;
                }
                // 选了字段 → 自动选合适的默认聚合
                const newAgg = enc.y?.agg && allowedAggsFor(name).includes(enc.y.agg)
                  ? enc.y.agg
                  : defaultAggFor(name);
                setEncoding('y', { field: name, type: 'quantitative', agg: newAgg });
              }}
            >
              <option value="*">记录数 (COUNT)</option>
              {groupedForMetric.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.fields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </optgroup>
              ))}
            </select>
            {enc.y?.field && enc.y.field !== '*' && fieldByName.get(enc.y.field) && (
              <FieldExplain field={fieldByName.get(enc.y.field)!} />
            )}
          </div>
          <div className="ds-panel-section">
            <label className="ds-panel-label">聚合方式</label>
            <select
              className="ds-input"
              value={enc.y?.agg || 'count'}
              onChange={(e) => setEncoding('y', { agg: e.target.value })}
              disabled={!enc.y?.field}
            >
              {allowedAggsFor(enc.y?.field || '*').map((a) => (
                <option key={a} value={a}>{AGG_LABEL[a] || a.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* —— 过滤条件:WHERE 子句 —— */}
      <div className="ds-panel-section">
        <label className="ds-panel-label">
          过滤条件
          <span className="ds-panel-hint"> · 多条之间 AND</span>
        </label>
        {filters.map((f, i) => (
          <FilterRow
            key={i}
            filter={f}
            profile={profile}
            onChange={(patch) => updateFilter(i, patch)}
            onRemove={() => removeFilter(i)}
          />
        ))}
        <button className="ds-filter-add" onClick={addFilter}>
          + 添加过滤
        </button>
      </div>

      {widget.reasoning && (
        <div className="ds-panel-section ds-reasoning">
          <label className="ds-panel-label">AI 推荐理由</label>
          <div className="ds-reasoning-text">{widget.reasoning}</div>
        </div>
      )}

      <div className="ds-panel-section ds-panel-meta">
        <div>位置: x={widget.grid.x}, y={widget.grid.y}</div>
        <div>大小: {widget.grid.w} × {widget.grid.h}</div>
        {widget.manualEdited && <div className="ds-edited-tag">已手动编辑</div>}
      </div>
    </div>
  );
}
