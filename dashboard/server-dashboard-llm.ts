// ─── LLM 看板布局生成 ─────────────────────────────────────────────────────
// 调用 Anthropic API,system prompt + tool_use 强制输出 DashboardLayout JSON。
// 失败 → 校验失败 → 重试一次(把错误回灌) → 还失败 → 回落 mock。
import Anthropic from '@anthropic-ai/sdk';
import type { DashboardLayout, DatasetProfile, Widget, WidgetType } from './server-dashboard.ts';
import { validateDashboardLayout, buildMockLayout } from './server-dashboard.ts';

const MODEL = process.env.AGENTMA_DASHBOARD_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;
const EDIT_MIN_SIZES: Record<WidgetType, { w: number; h: number }> = {
  line: { w: 6, h: 6 },
  bar: { w: 4, h: 6 },
  pie: { w: 3, h: 5 },
  donut: { w: 3, h: 5 },
  kpi: { w: 3, h: 3 },
  table: { w: 6, h: 5 },
  heatmap: { w: 6, h: 6 },
  funnel: { w: 4, h: 6 },
  gauge: { w: 3, h: 4 },
  scatter: { w: 6, h: 6 },
  text: { w: 3, h: 2 },
  html: { w: 6, h: 7 },
};

const SYSTEM_PROMPT = `你是 BI 看板架构师。基于用户提供的 DatasetProfile,设计一份 DashboardLayout。

【硬规则 — 违反会被拒绝】
1. 仅调用一次 emit_layout 工具,不要输出任何解释文字。
2. 不允许把 isIdLike=true 的字段作为指标 sum/avg(可以 count_distinct)。
3. 时间序列图(line)的 x 轴必须是 type=time 的字段(profile.timeFields 列表)。
4. KPI 卡片只能放数值聚合(metric 或 count/count_distinct),不要放分组数据。
5. widget 总数 4-8 个;每个 widget 都给一句 reasoning(≤ 50 字,说"为什么选这个图、为什么用这个字段")。
6. 网格规则: cols=12, 同一行 x+w ≤ 12;最小尺寸 line/bar w≥6 h≥6, kpi w≥3 h≥3, pie/donut w≥3 h≥5。
7. widget.id 用 'w-1' 'w-2' 这种简短 ID 即可,后端会接收。

【字段绑定优先级】
- profile.suggestedMetrics[0..n] → KPI 和 y 轴
- profile.suggestedDimensions[0..n] → x 轴 / color
- profile.timeFields[0] → time 类型 x 轴(line)
- 字段名带"率/比例/百分比" → 用 avg 而不是 sum

【场景画风建议(scenario)】
- sales: 趋势线 + Top N 横向柱 + 占比环图 + 关键 KPI(销售额/订单数/客单价)
- retention: 留存矩阵热力 + 漏斗 + 留存曲线 + DAU/MAU KPI
- logistics: 时效分布 + 异常 KPI + 区域柱状
- workflow: 漏斗 + 阶段耗时柱状 + 阻塞 Top
- attendance: 出勤热力日历 + 迟到 TopN + 部门对比
- finance/inventory: 趋势 + Top + 占比 + 关键 KPI
- unknown: 4 个 KPI + 1 个明细表

【数据聚合】
y.field 是 metric 字段时:agg 用 sum
y.field 是文本/ID/维度字段时:agg 用 count_distinct
y.field='*' 时:agg='count'(记录数)
率/比例字段时:agg='avg'

每个 widget 的 reasoning 必须解释:
- 这张图回答什么业务问题
- 为什么选这个图表类型(不要用别的)
- 为什么选这些字段(关联业务含义)
`;

const LAYOUT_TOOL = {
  name: 'emit_layout',
  description: '输出最终的 DashboardLayout JSON。必须严格符合 schema。',
  input_schema: {
    type: 'object' as const,
    required: ['version', 'meta', 'widgets'],
    properties: {
      version: { type: 'string', enum: ['1.0'] },
      meta: {
        type: 'object',
        required: ['title', 'scenario', 'datasourceId', 'tableName', 'cols', 'rowHeight'],
        properties: {
          title: { type: 'string', description: '看板标题(简洁,12 字内)' },
          scenario: { type: 'string' },
          datasourceId: { type: 'string' },
          tableName: { type: 'string' },
          cols: { type: 'number', enum: [12] },
          rowHeight: { type: 'number', enum: [40] },
        },
      },
      widgets: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['id', 'type', 'title', 'grid', 'data', 'reasoning'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['line', 'bar', 'pie', 'donut', 'kpi', 'table', 'funnel', 'gauge', 'scatter', 'heatmap'] },
            title: { type: 'string' },
            grid: {
              type: 'object',
              required: ['x', 'y', 'w', 'h'],
              properties: {
                x: { type: 'number', minimum: 0, maximum: 11 },
                y: { type: 'number', minimum: 0 },
                w: { type: 'number', minimum: 3, maximum: 12 },
                h: { type: 'number', minimum: 2, maximum: 16 },
              },
            },
            data: {
              type: 'object',
              properties: {
                encoding: {
                  type: 'object',
                  properties: {
                    x: {
                      type: 'object',
                      properties: {
                        field: { type: 'string' },
                        type: { type: 'string', enum: ['time', 'nominal', 'ordinal', 'quantitative'] },
                      },
                    },
                    y: {
                      type: 'object',
                      properties: {
                        field: { type: 'string', description: '字段名,或 "*" 表示记录数' },
                        type: { type: 'string', enum: ['quantitative'] },
                        agg: { type: 'string', enum: ['sum', 'avg', 'count', 'count_distinct', 'max', 'min'] },
                      },
                    },
                    color: {
                      type: 'object',
                      properties: { field: { type: 'string' } },
                    },
                  },
                },
                limit: { type: 'number' },
                orderBy: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['field', 'dir'],
                    properties: {
                      field: { type: 'string' },
                      dir: { type: 'string', enum: ['asc', 'desc'] },
                    },
                  },
                },
              },
            },
            reasoning: { type: 'string', description: '为什么选这个图 + 为什么用这些字段(中文,≤ 50 字)' },
          },
        },
      },
    },
  },
};

/** 给 LLM 的瘦身 profile,把没用的细节去掉,字段说明拼成自然语言 */
function profileForPrompt(profile: DatasetProfile): any {
  return {
    tableName: profile.tableName,
    rowCount: profile.rowCount,
    scenario: profile.scenario,
    scenarioReason: profile.scenarioReason,
    suggestedMetrics: profile.suggestedMetrics,
    suggestedDimensions: profile.suggestedDimensions,
    timeFields: profile.timeFields,
    geoFields: profile.geoFields,
    fields: profile.fields.map((f) => ({
      name: f.name,
      type: f.type,
      role: f.role,
      cardinality: f.cardinality,
      isMetric: f.isMetric,
      isIdLike: f.isIdLike,
      isTime: f.isTime,
      samples: f.samples.slice(0, 2),
      ...(f.min != null ? { min: f.min, max: f.max } : {}),
    })),
  };
}

function pickClient(provider?: { apiKey?: string; baseUrl?: string } | null): Anthropic | null {
  const apiKey = provider?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({
    apiKey,
    ...((provider?.baseUrl || process.env.ANTHROPIC_BASE_URL) ? { baseURL: provider?.baseUrl || process.env.ANTHROPIC_BASE_URL } : {}),
  });
}

function repairEditedWidget(widget: Widget, index: number): Widget {
  const min = EDIT_MIN_SIZES[widget.type] || { w: 3, h: 3 };
  const rawGrid = widget.grid || { x: 0, y: index * min.h, w: min.w, h: min.h };
  const width = Math.max(min.w, Math.min(12, Math.round(Number(rawGrid.w) || min.w)));
  const height = Math.max(min.h, Math.round(Number(rawGrid.h) || min.h));
  const x = Math.min(
    Math.max(0, Math.round(Number(rawGrid.x) || 0)),
    Math.max(0, 12 - width),
  );
  const y = Math.max(0, Math.round(Number(rawGrid.y) || 0));
  return {
    ...widget,
    manualEdited: false,
    grid: {
      ...rawGrid,
      x,
      y,
      w: width,
      h: height,
      minW: min.w,
      minH: min.h,
    },
  };
}

/** 主入口:LLM → 校验 → 失败重试一次 → 还失败回落 mock */
export async function generateLayoutByLLM(profile: DatasetProfile): Promise<{
  layout: DashboardLayout;
  source: 'llm' | 'llm_retry' | 'mock';
  llmError?: string;
}> {
  return generateLayoutByLLMWithProvider(profile, null);
}

export async function generateLayoutByLLMWithProvider(
  profile: DatasetProfile,
  provider?: { apiKey?: string; baseUrl?: string } | null,
): Promise<{
  layout: DashboardLayout;
  source: 'llm' | 'llm_retry' | 'mock';
  llmError?: string;
}> {
  const client = pickClient(provider);
  if (!client) {
    return { layout: buildMockLayout(profile), source: 'mock', llmError: 'no api key' };
  }

  const userPayload = profileForPrompt(profile);
  const baseUserMsg = `请基于以下数据画像生成看板布局。\n\nDatasetProfile:\n\`\`\`json\n${JSON.stringify(userPayload, null, 2)}\n\`\`\`\n\n请调用 emit_layout 工具输出布局。`;

  // 第一次尝试
  let raw: any;
  let firstErrors: string[] | null = null;
  try {
    raw = await callOnce(client, baseUserMsg);
  } catch (err) {
    return { layout: buildMockLayout(profile), source: 'mock', llmError: (err as Error).message };
  }
  if (raw) {
    // datasourceId 由后端注入,LLM 不知道
    if (raw.meta) raw.meta.datasourceId = profile.datasourceId;
    if (raw.meta) raw.meta.tableName = profile.tableName;
    if (raw.widgets) {
      raw.widgets = raw.widgets.map((w: Widget, i: number) => ({ ...w, id: w.id || `w-${i + 1}` }));
    }
    const check = validateDashboardLayout(raw, profile);
    if (check.ok) return { layout: check.layout, source: 'llm' };
    firstErrors = check.errors;
  }

  // 第二次:把错误回灌
  try {
    const retryMsg = `${baseUserMsg}\n\n上次输出有以下问题,请修正后重新调用 emit_layout:\n${(firstErrors || ['未知错误']).map((e) => '- ' + e).join('\n')}`;
    const retryRaw = await callOnce(client, retryMsg);
    if (retryRaw) {
      if (retryRaw.meta) retryRaw.meta.datasourceId = profile.datasourceId;
      if (retryRaw.meta) retryRaw.meta.tableName = profile.tableName;
      if (retryRaw.widgets) {
        retryRaw.widgets = retryRaw.widgets.map((w: Widget, i: number) => ({ ...w, id: w.id || `w-${i + 1}` }));
      }
      const check = validateDashboardLayout(retryRaw, profile);
      if (check.ok) return { layout: check.layout, source: 'llm_retry' };
    }
  } catch {
    // ignore
  }

  return {
    layout: buildMockLayout(profile),
    source: 'mock',
    llmError: `LLM 输出校验失败: ${(firstErrors || []).slice(0, 3).join('; ')}`,
  };
}

async function callOnce(client: Anthropic, userMessage: string): Promise<any | null> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [LAYOUT_TOOL as any],
    tool_choice: { type: 'tool', name: 'emit_layout' },
    messages: [{ role: 'user', content: userMessage }],
  });
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'emit_layout') {
      return block.input;
    }
  }
  return null;
}

// ─── AI 问答 (Ask) ─────────────────────────────────────────────────────
// 用户输入自然语言 → LLM 出 SQL + 图表类型 + 解读 → 后端跑 SQL → 返回结果

const ASK_SYSTEM = `你是数据分析师,基于用户提供的数据画像和问题,生成最直接的回答。

【输出要求】
仅调用一次 emit_answer 工具,提供:
1. sql: 单条 SQLite SELECT/WITH 语句(只读),回答用户问题。注意中文字段需要双引号包裹,字符串值用单引号。
2. chartType: 'kpi'|'line'|'bar'|'pie'|'donut'|'table'|'funnel'|'gauge'|'scatter'|'heatmap' 中选一个最能体现答案的图类型。
3. encoding: x.field/x.type/y.field/y.type/y.agg/color.field 等 — 让前端能把 SQL 结果渲染出来。
4. narrative: 60 字内的中文解读,**只描述查询的方法和应该看什么**,不要编造具体数值。例如"统计已成单客户占比,关注是否高于行业平均"。后端会跑出真实数值,前端会把数据呈现给用户,你不需要也不要编数字。
5. title: 给这次回答一个简短标题(≤ 12 字)。

【SQL 注意事项】
- 表名一定用画像里给的 tableName,字段名都得双引号(因为可能含中文)。
- LIMIT 默认 100,看 TopN 时 LIMIT 10。
- 如果用户问"率/比例/占比",用 SUM(CASE WHEN 条件 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) 这种写法。
- 不要 ATTACH/PRAGMA/INSERT/UPDATE/DELETE。

【chartType 选择】
- 单个数字答案 → kpi
- 时间序列 → line
- TopN 排行 → bar
- 占比 → donut
- 转化各阶段 → funnel
- 多列数据 → table

【encoding 怎么填】
SQL 结果列名是什么,encoding 字段就指那个名:
- KPI: y={ field: '<列名>' } (前端直接显示数字)
- 趋势/柱状: x={field:'<日期或维度列名>', type:'time'|'nominal'}, y={field:'<指标列名>'}
- 占比: color={field:'<分类列名>'}, y={field:'<数值列名>'}
- 表格: 不需要 encoding`;

const ANSWER_TOOL = {
  name: 'emit_answer',
  description: '输出针对用户问题的分析答案(SQL + 图表 + 解读)',
  input_schema: {
    type: 'object' as const,
    required: ['title', 'sql', 'chartType', 'narrative'],
    properties: {
      title: { type: 'string' },
      sql: { type: 'string' },
      chartType: { type: 'string', enum: ['kpi', 'line', 'bar', 'pie', 'donut', 'table', 'funnel', 'gauge', 'scatter', 'heatmap'] },
      narrative: { type: 'string', description: '中文解读, 100 字内' },
      encoding: {
        type: 'object',
        properties: {
          x: { type: 'object', properties: { field: { type: 'string' }, type: { type: 'string', enum: ['time', 'nominal', 'ordinal', 'quantitative'] } } },
          y: { type: 'object', properties: { field: { type: 'string' }, type: { type: 'string', enum: ['quantitative'] }, agg: { type: 'string', enum: ['sum', 'avg', 'count', 'count_distinct', 'max', 'min'] } } },
          color: { type: 'object', properties: { field: { type: 'string' } } },
        },
      },
    },
  },
};

const EDIT_TOOL = {
  name: 'emit_dashboard_edit',
  description: '输出修改后的完整 DashboardLayout。必须返回完整布局，不是局部 patch。',
  input_schema: {
    type: 'object' as const,
    required: ['version', 'meta', 'widgets'],
    properties: {
      version: { type: 'string', enum: ['1.0'] },
      meta: {
        type: 'object',
        required: ['title', 'scenario', 'datasourceId', 'tableName', 'cols', 'rowHeight'],
        properties: {
          title: { type: 'string' },
          scenario: { type: 'string' },
          datasourceId: { type: 'string' },
          tableName: { type: 'string' },
          cols: { type: 'number', enum: [12] },
          rowHeight: { type: 'number', enum: [40] },
          theme: {
            type: 'object',
            properties: {
              accent: { type: 'string' },
              canvasBg: { type: 'string' },
              cardBg: { type: 'string' },
              cardBorder: { type: 'string' },
              titleColor: { type: 'string' },
              kpiColor: { type: 'string' },
              palette: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      widgets: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'type', 'title', 'grid', 'data'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['line', 'bar', 'pie', 'donut', 'kpi', 'table', 'funnel', 'gauge', 'scatter', 'heatmap', 'text', 'html'] },
            title: { type: 'string' },
            grid: {
              type: 'object',
              required: ['x', 'y', 'w', 'h'],
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
                minW: { type: 'number' },
                minH: { type: 'number' },
              },
            },
            data: { type: 'object' },
            options: {
              type: 'object',
              properties: {
                visualId: { type: 'string' },
                html: { type: 'string' },
                text: { type: 'string' },
                appearance: {
                  type: 'object',
                  properties: {
                    backgroundColor: { type: 'string' },
                    borderColor: { type: 'string' },
                    titleColor: { type: 'string' },
                    valueColor: { type: 'string' },
                    palette: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
            reasoning: { type: 'string' },
            manualEdited: { type: 'boolean' },
          },
        },
      },
      summary: { type: 'string' },
    },
  },
};

const EDIT_SYSTEM = `你是可视化工坊里的看板编排师。你会收到:
1. 数据画像 DatasetProfile
2. 当前完整 DashboardLayout
3. 用户对看板的自然语言修改要求

你的任务是:
- 理解用户是在改样式、改文案、改布局、删组件、加组件、换图表类型、调主题，还是组合修改
- 直接输出修改后的完整 DashboardLayout

【硬规则】
1. 只能调用一次 emit_dashboard_edit 工具，不要输出解释文字。
2. 返回的是完整布局，不是 patch。保留不需要修改的组件。
3. 允许删除组件、调整位置、改标题、改 chart type、改 encoding、改 SQL、改 filters、改 options.appearance、改 meta.theme。
4. 不要修改 datasourceId、tableName、cols、rowHeight。
5. 如果用户要求“更统一/更高级/更轻/更暖/更商务”，优先改 meta.theme 和组件 options.appearance，不要无意义删组件。
6. 如果用户要求“去掉重复/删掉某个卡/把 KPI 放前面/把趋势图放大”，你要直接改 widgets。
7. 所有保留下来的 widget.id 必须稳定，不要重建全量 id。新增组件才生成新 id，建议用 edit-1/edit-2 这种。
8. 如果改成 text 组件，可以把文案放到 options.text。
9. reasoning 要简短说明这次修改意图，保留或更新都可以。
10. 输出的布局必须尽量满足现有网格规则，x+w<=12。

【风格指引】
- 当前产品是暖米色、深棕线框、卡片感明显的控制台，不要输出冷蓝 BI 套皮。
- 样式修改应优先通过 theme/appearance 完成，而不是改坏数据结构。
- 若用户只说“统一样式/再浅一点/高级一点”，默认:
  - 调浅 canvas/card 背景
  - 统一边框和标题色
  - KPI 数值和主强调色收敛到同一套 accent

【数据安全】
- 保持 SQL 只读
- 不要引用画像里不存在的字段
- 不要把 isIdLike 字段做 sum/avg
`;

export interface AskAnswer {
  title: string;
  sql: string;
  chartType: WidgetType;
  encoding?: any;
  narrative: string;
}

export interface AskHistoryMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface DashboardEditAnswer {
  layout: DashboardLayout;
  summary: string;
}

function relayoutWidgets(profile: DatasetProfile, layout: DashboardLayout): DashboardEditAnswer | null {
  const repaired = validateDashboardLayout({
    ...layout,
    widgets: layout.widgets.map((widget) => ({ ...widget, manualEdited: false })),
  }, profile, { normalize: true });
  if (!repaired.ok) return null;
  return {
    layout: {
      ...repaired.layout,
      widgets: repaired.layout.widgets.map((widget) => ({ ...widget, manualEdited: true })),
    },
    summary: '已重新调整当前看板布局。',
  };
}

function defaultMinSize(type: WidgetType): { w: number; h: number } {
  return {
    line: { w: 6, h: 6 },
    bar: { w: 4, h: 6 },
    pie: { w: 3, h: 5 },
    donut: { w: 3, h: 5 },
    kpi: { w: 3, h: 3 },
    table: { w: 6, h: 5 },
    heatmap: { w: 6, h: 6 },
    funnel: { w: 4, h: 6 },
    gauge: { w: 3, h: 4 },
    scatter: { w: 6, h: 6 },
    text: { w: 3, h: 2 },
    html: { w: 6, h: 7 },
  }[type];
}

function inferWidgetType(question: string): WidgetType | null {
  const compact = question.replace(/\s+/g, '');
  if (/(指标卡|kpi|数字卡)/i.test(compact)) return 'kpi';
  if (/(折线图|趋势图|趋势线)/i.test(compact)) return 'line';
  if (/(柱状图|条形图|排行榜)/i.test(compact)) return 'bar';
  if (/(饼图)/i.test(compact)) return 'pie';
  if (/(环图|环形图|占比图|占比)/i.test(compact)) return 'donut';
  if (/(漏斗图|漏斗)/i.test(compact)) return 'funnel';
  if (/(散点图|散点)/i.test(compact)) return 'scatter';
  if (/(热力图|热力)/i.test(compact)) return 'heatmap';
  if (/(表格|明细表|明细)/i.test(compact)) return 'table';
  if (/(说明卡|说明文字|说明)/i.test(compact)) return 'text';
  return null;
}

function defaultEncoding(type: WidgetType, profile: DatasetProfile) {
  const dim = profile.suggestedDimensions[0];
  const metric = profile.suggestedMetrics[0];
  const time = profile.timeFields[0];
  if (type === 'kpi') return { y: { field: metric || '*', type: 'quantitative' as const, agg: metric ? 'sum' as const : 'count' as const } };
  if (type === 'line' && time) return { x: { field: time, type: 'time' as const }, y: { field: metric || '*', type: 'quantitative' as const, agg: metric ? 'sum' as const : 'count' as const } };
  if ((type === 'pie' || type === 'donut') && dim) return { color: { field: dim }, y: { field: metric || '*', type: 'quantitative' as const, agg: metric ? 'sum' as const : 'count' as const } };
  if ((type === 'bar' || type === 'funnel' || type === 'scatter' || type === 'heatmap') && dim) {
    return { x: { field: dim, type: 'nominal' as const }, y: { field: metric || '*', type: 'quantitative' as const, agg: metric ? 'sum' as const : 'count' as const } };
  }
  return {};
}

function defaultWidgetTitle(type: WidgetType, profile: DatasetProfile, question: string) {
  const dim = profile.suggestedDimensions[0];
  const metric = profile.suggestedMetrics[0];
  if (/(客户来源|来源结构)/i.test(question)) {
    if (type === 'bar') return '客户来源结构排行';
    if (type === 'pie' || type === 'donut') return '客户来源结构占比';
  }
  return ({
    kpi: metric ? `${metric} 指标卡` : '指标卡',
    line: metric ? `${metric} 趋势` : '趋势图',
    bar: dim && metric ? `${dim} 排行` : '柱状图',
    pie: dim ? `${dim} 占比` : '饼图',
    donut: dim ? `${dim} 占比` : '环图',
    funnel: '漏斗分析',
    gauge: '完成度',
    scatter: '散点分布',
    heatmap: '热力图',
    table: '数据明细',
    text: '说明',
    html: 'HTML 可视化',
  } as Record<WidgetType, string>)[type];
}

function buildGenericAddWidgetEdit(
  profile: DatasetProfile,
  layout: DashboardLayout,
  question: string,
): DashboardEditAnswer | null {
  const compact = question.replace(/\s+/g, '');
  const wantsAdd = /(加|新增|添加|补|插入|放|塞|来|做|搞|生成)/i.test(compact);
  const type = inferWidgetType(compact);
  if (!wantsAdd || !type) return null;
  if (/(成单率|转化率|成交率)/i.test(compact) && type === 'kpi') return null;

  const min = defaultMinSize(type);
  const newWidget: Widget = {
    id: `edit-widget-${Date.now()}`,
    type,
    title: defaultWidgetTitle(type, profile, question),
    grid: { x: 0, y: 999, w: min.w, h: Math.max(min.h, type === 'table' ? 8 : min.h), minW: min.w, minH: min.h },
    data: type === 'table'
      ? { limit: 100 }
      : type === 'text'
        ? {}
        : {
          encoding: defaultEncoding(type, profile),
          ...(type === 'bar' || type === 'pie' || type === 'donut' ? { limit: 8 } : {}),
        },
    options: type === 'text' ? { text: '请补充说明文案' } : undefined,
    reasoning: '按你的要求新增一个组件。',
    manualEdited: false,
  };

  const repaired = relayoutWidgets(profile, {
    ...layout,
    widgets: [...layout.widgets, newWidget],
  });
  if (!repaired) return null;
  return {
    ...repaired,
    summary: `已新增「${newWidget.title}」。`,
  };
}

function normalizeMatchText(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[，。、“”‘’：:；;！？!?\-()（）【】\[\]'"'`]/g, '')
    .replace(/(原来|原先|之前|上面|下面|这个|那个|一下|一下子|帮我|给我|吧|呢|呀|啊|了|的|个|张|图表|图|卡片|卡|组件|模块)/g, '');
}

function longestContainedSegment(reference: string, target: string) {
  let best = 0;
  for (let start = 0; start < reference.length; start += 1) {
    for (let end = start + 2; end <= reference.length; end += 1) {
      const slice = reference.slice(start, end);
      if (target.includes(slice)) best = Math.max(best, slice.length);
    }
  }
  return best;
}

function findBestWidgetMatch(reference: string, widgets: Widget[]) {
  const normalizedRef = normalizeMatchText(reference);
  if (!normalizedRef) return null;
  let best: { widget: Widget; score: number } | null = null;
  for (const widget of widgets) {
    const normalizedTitle = normalizeMatchText(widget.title || '');
    if (!normalizedTitle) continue;
    let score = 0;
    if (normalizedTitle.includes(normalizedRef) || normalizedRef.includes(normalizedTitle)) {
      score = Math.max(normalizedRef.length, normalizedTitle.length) + 10;
    } else {
      score = longestContainedSegment(normalizedRef, normalizedTitle);
    }
    if (score >= 2 && (!best || score > best.score)) best = { widget, score };
  }
  return best?.widget || null;
}

function buildMetricIntentEdit(
  profile: DatasetProfile,
  layout: DashboardLayout,
  question: string,
): DashboardEditAnswer | null {
  const compact = question.replace(/\s+/g, '');
  const wantsKpi = /(加|新增|添加|补|放|来|做).*(指标卡|kpi|卡片)/i.test(compact);
  if (!wantsKpi) return null;

  const wonField = profile.fields.find((field) => field.name === '是否成单');
  const hasWonFlag = Boolean(wonField);
  const wantsWinRate = /(成单率|转化率|成交率)/i.test(compact);
  if (!wantsWinRate || !hasWonFlag) return null;

  const exists = layout.widgets.some((widget) => widget.type === 'kpi' && /成单率|转化率|成交率/.test(widget.title));
  if (exists) {
    return {
      layout,
      summary: '当前看板里已经有成单率指标卡了。',
    };
  }

  const nextWidget: Widget = {
    id: `edit-kpi-${Date.now()}`,
    type: 'kpi',
    title: '客户成单率',
    grid: { x: 0, y: 999, w: 3, h: 3, minW: 3, minH: 3 },
    data: {
      sql: `SELECT SUM(CASE WHEN "是否成单" = '是' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS value FROM "客户明细表"`,
      encoding: {
        y: { field: 'value', type: 'quantitative', agg: 'avg' },
      },
    },
    reasoning: '统计已成单客户占全部客户的比例，适合用 KPI 直接查看。',
    manualEdited: false,
  };

  const repaired = validateDashboardLayout({
    ...layout,
    widgets: [...layout.widgets.map((widget) => ({ ...widget, manualEdited: false })), nextWidget],
  }, profile, { normalize: true });
  if (!repaired.ok) {
    return { layout, summary: `未能自动加入成单率指标卡: ${repaired.errors.slice(0, 2).join('；')}` };
  }
  return {
    layout: {
      ...repaired.layout,
      widgets: repaired.layout.widgets.map((widget) => ({ ...widget, manualEdited: true })),
    },
    summary: '已加入成单率指标卡。',
  };
}

function buildLayoutIntentEdit(
  profile: DatasetProfile,
  layout: DashboardLayout,
  question: string,
): DashboardEditAnswer | null {
  const compact = question.replace(/\s+/g, '');
  const wantsRelayout = /(重新调整布局|重新排布|重新布局|重新整理|调整下布局|调整看板布局|整体布局|整体排布|整个看板布局|整个布局|重排一下|重新调整下看板布局|出边框了|出边了|超出边框|溢出去了|挤出去了|边框外面)/i.test(compact);
  if (wantsRelayout) {
    return relayoutWidgets(profile, layout);
  }

  const wantsDelete = /(删掉|删除|移除|去掉|删了吧|干掉)/i.test(compact);
  if (wantsDelete) {
    const targetText = compact.replace(/(删掉|删除|移除|去掉|删了吧|干掉)/g, '');
    const matched = findBestWidgetMatch(targetText, layout.widgets);
    if (matched) {
      const repaired = relayoutWidgets(profile, {
        ...layout,
        widgets: layout.widgets.filter((widget) => widget.id !== matched.id),
      });
      if (repaired) {
        return {
          ...repaired,
          summary: `已删除「${matched.title}」。`,
        };
      }
    }
  }

  const wantsTopAlign = /(成单率.*(和上面并列|放到上面|移到上面|排成一行|放同一行)|和上面并列|排成一行|放同一行)/i.test(compact);
  if (!wantsTopAlign) return null;

  const rateWidget = layout.widgets.find((widget) => /成单率|转化率|成交率/.test(widget.title));
  if (!rateWidget) return null;

  const topWidgets = layout.widgets
    .filter((widget) => widget.type === 'kpi' || widget.type === 'gauge' || widget.id === rateWidget.id)
    .map((widget) => widget.id);
  const ordered = [
    ...layout.widgets.filter((widget) => topWidgets.includes(widget.id)),
    ...layout.widgets.filter((widget) => !topWidgets.includes(widget.id)),
  ];
  const repaired = relayoutWidgets(profile, { ...layout, widgets: ordered });
  if (!repaired) return null;
  return {
    ...repaired,
    summary: '已把成单率指标卡调整到顶部并列展示。',
  };
}

export async function askQuestion(
  profile: DatasetProfile,
  question: string,
  history: AskHistoryMsg[] = [],
): Promise<AskAnswer | { error: string }> {
  return askQuestionWithProvider(profile, question, history, null);
}

export async function askQuestionWithProvider(
  profile: DatasetProfile,
  question: string,
  history: AskHistoryMsg[] = [],
  provider?: { apiKey?: string; baseUrl?: string } | null,
): Promise<AskAnswer | { error: string }> {
  const client = pickClient(provider);
  if (!client) return { error: 'LLM 未配置 ANTHROPIC_API_KEY' };

  const profileBrief = profileForPrompt(profile);
  const userMsg = `数据画像:
\`\`\`json
${JSON.stringify(profileBrief, null, 2)}
\`\`\`

用户问题: ${question}

请调用 emit_answer 输出 SQL + 图类型 + 解读。`;

  // 拼对话历史(只取最近 6 轮,避免太长)
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMsg },
  ];

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: ASK_SYSTEM,
      tools: [ANSWER_TOOL as any],
      tool_choice: { type: 'tool', name: 'emit_answer' },
      messages,
    });
    for (const block of res.content) {
      if (block.type === 'tool_use' && block.name === 'emit_answer') {
        const ans = block.input as AskAnswer;
        return ans;
      }
    }
    return { error: 'LLM 未输出 emit_answer' };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function editDashboardByChat(
  profile: DatasetProfile,
  layout: DashboardLayout,
  question: string,
  history: AskHistoryMsg[] = [],
): Promise<DashboardEditAnswer | { error: string }> {
  return editDashboardByChatWithProvider(profile, layout, question, history, null);
}

export async function editDashboardByChatWithProvider(
  profile: DatasetProfile,
  layout: DashboardLayout,
  question: string,
  history: AskHistoryMsg[] = [],
  provider?: { apiKey?: string; baseUrl?: string } | null,
): Promise<DashboardEditAnswer | { error: string }> {
  const localIntentEdit = buildMetricIntentEdit(profile, layout, question);
  if (localIntentEdit) return localIntentEdit;
  const genericAddEdit = buildGenericAddWidgetEdit(profile, layout, question);
  if (genericAddEdit) return genericAddEdit;
  const localLayoutEdit = buildLayoutIntentEdit(profile, layout, question);
  if (localLayoutEdit) return localLayoutEdit;

  const client = pickClient(provider);
  if (!client) return { error: 'LLM 未配置 ANTHROPIC_API_KEY' };

  const userMsg = `数据画像:
\`\`\`json
${JSON.stringify(profileForPrompt(profile), null, 2)}
\`\`\`

当前看板:
\`\`\`json
${JSON.stringify(layout, null, 2)}
\`\`\`

用户要求: ${question}

请调用 emit_dashboard_edit 输出修改后的完整布局。`;

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMsg },
  ];

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: EDIT_SYSTEM,
      tools: [EDIT_TOOL as any],
      tool_choice: { type: 'tool', name: 'emit_dashboard_edit' },
      messages,
    });
    for (const block of res.content) {
      if (block.type === 'tool_use' && block.name === 'emit_dashboard_edit') {
        const output = block.input as DashboardLayout & { summary?: string };
        const summary = typeof output.summary === 'string' && output.summary.trim()
          ? output.summary.trim()
          : '已按你的要求更新当前看板。';
        const rawWidgets = Array.isArray(output.widgets) ? output.widgets : [];
        const nextLayout = {
          ...output,
          meta: {
            ...output.meta,
            datasourceId: profile.datasourceId,
            tableName: profile.tableName,
            cols: 12,
            rowHeight: 40,
          },
          widgets: rawWidgets.map((widget) => ({ ...widget, manualEdited: true })),
        };
        const check = validateDashboardLayout(nextLayout, profile, { normalize: false });
        if (check.ok) return { layout: check.layout, summary };

        const repaired = validateDashboardLayout({
          ...nextLayout,
          widgets: rawWidgets.map((widget, index) => repairEditedWidget(widget, index)),
        }, profile, { normalize: true });
        if (!repaired.ok) return { error: `看板修改结果校验失败: ${repaired.errors.slice(0, 3).join('; ')}` };
        return {
          layout: {
            ...repaired.layout,
            widgets: repaired.layout.widgets.map((widget) => ({ ...widget, manualEdited: true })),
          },
          summary: `${summary} 已自动规整布局。`,
        };
      }
    }
    return { error: 'LLM 未输出 emit_dashboard_edit' };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
