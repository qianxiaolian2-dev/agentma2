// ─── LLM 看板布局生成 ─────────────────────────────────────────────────────
// 调用 Anthropic API,system prompt + tool_use 强制输出 DashboardLayout JSON。
// 失败 → 校验失败 → 重试一次(把错误回灌) → 还失败 → 回落 mock。
import Anthropic from '@anthropic-ai/sdk';
import type { DashboardLayout, DatasetProfile, Widget, WidgetType } from './server-dashboard.ts';
import { validateDashboardLayout, buildMockLayout } from './server-dashboard.ts';

const MODEL = process.env.AGENTMA_DASHBOARD_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;

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

function pickClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({
    apiKey,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });
}

/** 主入口:LLM → 校验 → 失败重试一次 → 还失败回落 mock */
export async function generateLayoutByLLM(profile: DatasetProfile): Promise<{
  layout: DashboardLayout;
  source: 'llm' | 'llm_retry' | 'mock';
  llmError?: string;
}> {
  const client = pickClient();
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

export async function askQuestion(
  profile: DatasetProfile,
  question: string,
  history: AskHistoryMsg[] = [],
): Promise<AskAnswer | { error: string }> {
  const client = pickClient();
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
