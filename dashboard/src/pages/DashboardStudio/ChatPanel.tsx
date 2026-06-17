import { useState, useEffect, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { askQuestion, type AskResult } from './api';
import { encodingToOption } from './encodingToOption';
import type { DatasetProfile, QueryResult, Widget, WidgetType } from './types';

export interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  text: string;
  /** 推送的快捷问题(AI 主动给) */
  suggestions?: string[];
  /** AI 回答附带的图卡 */
  answer?: AskResult;
  ts: number;
  loading?: boolean;
}

interface Props {
  profile: DatasetProfile | null;
  onPinToBoard?: (widget: Widget) => void;
}

/**
 * 左侧 AI 对话区:接 /api/dashboard/ask,流式收消息,
 * AI 答案带图 + 解读 + [📌 付到看板] 按钮。
 */
export function ChatPanel({ profile, onPinToBoard }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // profile 变了 → AI 主动打招呼
  useEffect(() => {
    if (!profile) {
      setMessages([]);
      return;
    }
    const greet: ChatMessage = {
      id: 'greet',
      role: 'ai',
      ts: Date.now(),
      text: buildGreeting(profile),
      suggestions: buildSuggestions(profile),
    };
    setMessages([greet]);
  }, [profile?.datasourceId, profile?.tableName]);

  // 自动滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.loading]);

  const submit = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || !profile || pending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: t, ts: Date.now() };
    const placeholder: ChatMessage = { id: crypto.randomUUID(), role: 'ai', text: '正在思考…', ts: Date.now(), loading: true };
    setMessages((cur) => [...cur, userMsg, placeholder]);
    setInput('');
    setPending(true);

    try {
      // 拼最近的对话历史(只取真实问答,不含 greet)
      const history = messages
        .filter((m) => m.id !== 'greet' && !m.loading)
        .map((m) => ({ role: (m.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.text }))
        .slice(-10);

      const ans = await askQuestion(profile.datasourceId, t, history, profile.tableName);
      setMessages((cur) => cur.map((m) => m.id === placeholder.id ? {
        ...m,
        text: ans.error ? `❌ ${ans.error}` : ans.narrative,
        answer: ans.error ? undefined : ans,
        loading: false,
      } : m));
    } catch (err) {
      setMessages((cur) => cur.map((m) => m.id === placeholder.id ? {
        ...m, text: '❌ ' + (err as Error).message, loading: false,
      } : m));
    } finally {
      setPending(false);
    }
  }, [profile, pending, messages]);

  const pinAnswer = (ans: AskResult) => {
    if (!onPinToBoard) return;
    // AskResult → Widget
    const w: Widget = {
      id: crypto.randomUUID(),
      type: ans.chartType as WidgetType,
      title: ans.title,
      grid: { x: 0, y: 999, w: 6, h: 6 },  // y=999 让 autoLayoutFix 重排到底部
      data: {
        sql: ans.sql,
        encoding: ans.encoding,
      },
      reasoning: ans.narrative,
      manualEdited: true,
    };
    onPinToBoard(w);
  };

  return (
    <div className="ds-chat">
      <div className="ds-chat-header">
        <span className="ds-chat-title">💬 数据助手</span>
        {profile && <span className="ds-chat-sub">{profile.tableName} · {profile.rowCount.toLocaleString()} 行</span>}
      </div>
      <div className="ds-chat-body" ref={scrollRef}>
        {!profile && (
          <div className="ds-chat-placeholder">
            上传或选择数据源后,我会自动出一份初版看板,并告诉你接下来可以问什么。
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`ds-msg ds-msg-${m.role}`}>
            <div className="ds-msg-avatar">{m.role === 'ai' ? '🤖' : '🙂'}</div>
            <div className="ds-msg-bubble">
              <div className="ds-msg-text">{m.loading ? '⏳ 正在分析…' : m.text}</div>
              {m.answer && m.answer.queryResult && (
                <AnswerCard answer={m.answer} onPin={() => pinAnswer(m.answer!)} canPin={!!onPinToBoard} />
              )}
              {m.suggestions && m.suggestions.length > 0 && (
                <div className="ds-msg-suggestions">
                  {m.suggestions.map((s, i) => (
                    <button key={i} className="ds-suggestion" onClick={() => submit(s)}>
                      🔍 {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <form className="ds-chat-input"
        onSubmit={(e) => { e.preventDefault(); submit(input); }}>
        <input
          className="ds-chat-textbox"
          placeholder={profile ? (pending ? '请等待回答…' : '问点什么…(回车发送)') : '请先选择数据源'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!profile || pending}
        />
        <button className="ds-btn ds-btn-primary" type="submit" disabled={!input.trim() || !profile || pending}>
          {pending ? '...' : '发送'}
        </button>
      </form>
    </div>
  );
}

// —— 答案卡片:渲染 SQL 结果(图 + 表) + [📌 付到看板] ——
function AnswerCard({ answer, onPin, canPin }: { answer: AskResult; onPin: () => void; canPin: boolean }) {
  if (!answer.queryResult) {
    return <div className="ds-answer-error">⚠ {answer.queryError || '未拿到结果'}</div>;
  }
  if (answer.queryError) {
    return <div className="ds-answer-error">⚠ SQL 执行失败: {answer.queryError}</div>;
  }
  return (
    <div className="ds-answer-card">
      <div className="ds-answer-title">{answer.title}</div>
      <AnswerRenderer answer={answer} result={answer.queryResult} />
      <div className="ds-answer-actions">
        <button className="ds-answer-sql-toggle" onClick={(e) => {
          const el = (e.currentTarget.nextSibling as HTMLElement);
          if (el) el.classList.toggle('ds-show');
        }}>
          📋 SQL
        </button>
        <pre className="ds-answer-sql">{answer.sql}</pre>
        {canPin && (
          <button className="ds-answer-pin" onClick={onPin} title="把这个图加到右侧画布">
            📌 付到看板
          </button>
        )}
      </div>
    </div>
  );
}

function AnswerRenderer({ answer, result }: { answer: AskResult; result: QueryResult }) {
  // KPI:首列首行
  if (answer.chartType === 'kpi') {
    const v = result.rows[0] ? Object.values(result.rows[0])[0] : null;
    return (
      <div className="ds-answer-kpi">
        {typeof v === 'number' ? formatKpiNumber(v) : String(v ?? '-')}
      </div>
    );
  }
  // 表格:简单展示
  if (answer.chartType === 'table' || !result.columns.length) {
    return (
      <div className="ds-answer-table-wrap">
        <table className="ds-answer-table">
          <thead>
            <tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.slice(0, 20).map((r, i) => (
              <tr key={i}>{result.columns.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  // 其他:用 echarts 渲染。把 ask 的 encoding 包成一个临时 widget 喂给 encodingToOption
  const fakeWidget: Widget = {
    id: 'preview',
    type: answer.chartType as WidgetType,
    title: answer.title,
    grid: { x: 0, y: 0, w: 6, h: 5 },
    data: { encoding: answer.encoding },
  };
  // 把后端返回的 SQL 列名归一为 x_value / y_value 让 encodingToOption 能识别
  const normalized = normalizeForEcharts(result, answer);
  const option = encodingToOption(fakeWidget, normalized);
  return (
    <div className="ds-answer-chart">
      <ReactECharts option={option} notMerge style={{ height: 220, width: '100%' }} opts={{ renderer: 'canvas' }} />
    </div>
  );
}

function formatKpiNumber(n: number): string {
  if (!Number.isFinite(n)) return '-';
  // 比例小数(0~1.5)按百分比显示
  if (n > 0 && n < 1.5 && !Number.isInteger(n)) return (n * 100).toFixed(2) + '%';
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  if (!Number.isInteger(n)) return n.toFixed(2);
  return n.toLocaleString('zh-CN');
}

/** 把 SQL 结果列名归一,适配 encodingToOption */
function normalizeForEcharts(result: QueryResult, answer: AskResult): QueryResult {
  const enc = answer.encoding || {};
  if (!enc.x?.field || !enc.y?.field) return result;
  // 如果列名已经是 x_value/y_value 就别动
  if (result.columns.includes('x_value') && result.columns.includes('y_value')) return result;
  // 否则做一次别名映射
  const xCol = enc.x.field;
  const yCol = enc.y.field;
  if (!result.columns.includes(xCol) || !result.columns.includes(yCol)) return result;
  return {
    ...result,
    columns: ['x_value', 'y_value'],
    rows: result.rows.map((r) => ({ x_value: r[xCol], y_value: r[yCol] })),
  };
}

function buildGreeting(p: DatasetProfile): string {
  const scenarioLabel: Record<string, string> = {
    sales: '销售/订单类', retention: '用户留存类', logistics: '物流配送类',
    workflow: '流程漏斗类', attendance: '考勤类',
    finance: '财务类', inventory: '库存类', unknown: '通用',
  };
  const s = scenarioLabel[p.scenario] || p.scenario;
  const fieldHint = [
    p.timeFields[0] && `时间字段: ${p.timeFields[0]}`,
    p.suggestedMetrics[0] && `主指标: ${p.suggestedMetrics[0]}`,
    p.suggestedDimensions[0] && `主维度: ${p.suggestedDimensions[0]}`,
  ].filter(Boolean).join(' · ');
  return `👋 我看到这是「${p.tableName}」(${s}数据,${p.rowCount.toLocaleString()} 行)。

已为你生成初版看板,见右侧。${fieldHint ? '\n关键字段 → ' + fieldHint : ''}

试试问我下面这些问题,或自己输入新问题 ↓`;
}

function buildSuggestions(p: DatasetProfile): string[] {
  const list: string[] = [];
  const time = p.timeFields[0];
  const metric = p.suggestedMetrics[0];
  const dim = p.suggestedDimensions[0];
  if (time && metric) list.push(`${metric} 最近的趋势是什么?`);
  if (dim && metric) list.push(`哪个 ${dim} 的 ${metric} 最高?`);
  if (p.scenario === 'sales') list.push('成单率怎么样?');
  if (p.scenario === 'retention') list.push('留存曲线大致什么形状?');
  if (p.scenario === 'workflow') list.push('每个阶段流失了多少?');
  if (dim) list.push(`各 ${dim} 的占比`);
  return list.slice(0, 4);
}
