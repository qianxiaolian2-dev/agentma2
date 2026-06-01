import { useMemo, useState } from 'react';
import { getAuthHeaders } from '../utils/client-runtime';

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionRequest {
  reqId: string;
  questions: AskUserQuestionItem[];
  toolUseID: string;
}

function initialAnswers(questions: AskUserQuestionItem[]) {
  const answers: Record<string, string[]> = {};
  for (const question of questions) {
    const first = question.options[0]?.label;
    answers[question.question] = first ? [first] : [];
  }
  return answers;
}

function AskUserQuestionCard({ req, onResolved }: {
  req: AskUserQuestionRequest;
  onResolved: (reqId: string) => void;
}) {
  const defaults = useMemo(() => initialAnswers(req.questions), [req.questions]);
  const [selected, setSelected] = useState<Record<string, string[]>>(defaults);
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const choose = (question: AskUserQuestionItem, label: string, checked: boolean) => {
    if (!question.multiSelect) setUseOther(prev => ({ ...prev, [question.question]: false }));
    setSelected(prev => {
      if (!question.multiSelect) return { ...prev, [question.question]: [label] };
      const current = new Set(prev[question.question] || []);
      if (checked) current.add(label);
      else current.delete(label);
      return { ...prev, [question.question]: Array.from(current) };
    });
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const answers: Record<string, string> = {};
    for (const question of req.questions) {
      const custom = otherText[question.question]?.trim();
      if (useOther[question.question] && custom && !question.multiSelect) {
        answers[question.question] = custom;
        continue;
      }
      const values = [...(selected[question.question] || [])];
      if (useOther[question.question] && custom) values.push(custom);
      if (!values.length) {
        setErr(`请回答：${question.question}`);
        setBusy(false);
        return;
      }
      answers[question.question] = question.multiSelect ? values.join(', ') : values[0];
    }

    try {
      const response = await fetch(`/api/agents/questions/${req.reqId}`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) {
        const e = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        setErr(e.error || `HTTP ${response.status}`);
        setBusy(false);
        return;
      }
      onResolved(req.reqId);
    } catch (e) {
      setErr((e as Error).message || 'network error');
      setBusy(false);
    }
  };

  return (
    <div
      className="card mb-2"
      style={{
        borderColor: 'var(--accent)',
        background: 'var(--accent-bg)',
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '.92em' }}>Agent 需要你选择</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {req.questions.map(question => (
          <div key={question.question}>
            <div className="flex gap-2" style={{ alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span className="badge badge-info">{question.header || 'Question'}</span>
              <span style={{ fontSize: '.86em', fontWeight: 600 }}>{question.question}</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {question.options.map(option => {
                const isChecked = Boolean(selected[question.question]?.includes(option.label)) && !useOther[question.question];
                return (
                  <label
                    key={option.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: 8,
                      alignItems: 'start',
                      cursor: busy ? 'default' : 'pointer',
                      padding: '7px 8px',
                      border: `1px solid ${isChecked ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 6,
                      background: isChecked ? 'var(--bg-card)' : 'transparent',
                    }}
                  >
                    <input
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                      name={`${req.reqId}-${question.question}`}
                      checked={isChecked}
                      disabled={busy}
                      onChange={event => choose(question, option.label, event.target.checked)}
                      style={{ width: 'auto', marginTop: 2 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontSize: '.84em', fontWeight: 600 }}>{option.label}</span>
                      {option.description && (
                        <span style={{ display: 'block', fontSize: '.76em', color: 'var(--ink-secondary)', marginTop: 2 }}>
                          {option.description}
                        </span>
                      )}
                      {option.preview && (
                        <pre style={{ fontSize: '.72em', overflow: 'auto', maxHeight: 120, marginTop: 6, padding: 8, background: 'var(--bg-hover)', borderRadius: 4 }}>
                          {option.preview}
                        </pre>
                      )}
                    </span>
                  </label>
                );
              })}
              <label
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 8,
                  alignItems: 'center',
                  cursor: busy ? 'default' : 'pointer',
                  padding: '7px 8px',
                  border: `1px solid ${useOther[question.question] ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6,
                  background: useOther[question.question] ? 'var(--bg-card)' : 'transparent',
                }}
              >
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={`${req.reqId}-${question.question}`}
                  checked={Boolean(useOther[question.question])}
                  disabled={busy}
                  onChange={event => {
                    setUseOther(prev => ({ ...prev, [question.question]: event.target.checked }));
                    if (event.target.checked && !question.multiSelect) {
                      setSelected(prev => ({ ...prev, [question.question]: [] }));
                    }
                  }}
                  style={{ width: 'auto' }}
                />
                <input
                  value={otherText[question.question] || ''}
                  onChange={event => {
                    setUseOther(prev => ({ ...prev, [question.question]: true }));
                    setOtherText(prev => ({ ...prev, [question.question]: event.target.value }));
                  }}
                  placeholder="其他"
                  disabled={busy}
                  style={{ padding: '5px 7px', fontSize: '.82em' }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      {err && <div style={{ fontSize: '.8em', color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      <div className="flex gap-2 mt-4" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={submit}>
          提交答案
        </button>
      </div>
    </div>
  );
}

export function AskUserQuestionPromptList({ pending, onResolved }: {
  pending: AskUserQuestionRequest[];
  onResolved: (reqId: string) => void;
}) {
  if (!pending.length) return null;
  return (
    <div className="mb-4">
      {pending.map(req => (
        <AskUserQuestionCard key={req.reqId} req={req} onResolved={onResolved} />
      ))}
    </div>
  );
}
