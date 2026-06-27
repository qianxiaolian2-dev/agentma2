import { useState, useCallback, useRef, useEffect } from 'react';
import type { SDKMessage, ProviderConfig } from '../simulator/types';
import StreamDisplay from '../components/common/StreamDisplay';
import JsonViewer from '../components/common/JsonViewer';
import { getAuthHeaders } from '../utils/client-runtime';
import { PermissionPromptList, type PermissionRequest } from '../components/PermissionPrompt';
import { AskUserQuestionPromptList, type AskUserQuestionRequest } from '../components/AskUserQuestionPrompt';
import { listProviderModels, loadProviderProfiles, resolveProviderForModel } from '../utils/providers';

export default function Playground() {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<SDKMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const modelOptions = listProviderModels();
  const [model, setModel] = useState(() => modelOptions[0] || '');
  const provider: ProviderConfig = resolveProviderForModel(model).provider;
  const [showOptions, setShowOptions] = useState(false);
  const [resultSummary, setResultSummary] = useState<Record<string, unknown> | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<AskUserQuestionRequest[]>([]);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const abortRef = useRef<AbortController | null>(null);
  const modelOptionsKey = modelOptions.join('\n');

  useEffect(() => {
    const options = modelOptionsKey ? modelOptionsKey.split('\n') : [];
    if (!model && options.length) {
      setModel(options[0]);
    } else if (model && options.length && !options.includes(model)) {
      setModel(options[0]);
    }
  }, [model, modelOptionsKey]);

  // 检测后端状态
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        setServerStatus(res.ok ? 'online' : 'offline');
      } catch {
        setServerStatus('offline');
      }
    };
    check();
  }, []);

  // query() —— 真实 API 调用
  const handleQuery = useCallback(async () => {
    if (!prompt.trim() || isStreaming) return;
    setIsStreaming(true);
    setMessages([]);
    setResultSummary(null);
    setPendingPermissions([]);
    setPendingQuestions([]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/agents/run`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          prompt,
          model,
          template: {
            tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'AskUserQuestion'],
            model,
            maxTurns: 20,
          },
          provider,
          providerProfiles: loadProviderProfiles(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        setMessages([{
          type: 'system', subtype: 'error',
          result: err.error || `请求失败: ${response.status}`,
        }]);
        setIsStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) { setIsStreaming(false); return; }

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);

          try {
            const data = JSON.parse(json);
            const dataType = data.type as string;

            if (dataType === 'delta') {
              const isThinking = data.thinking === true;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                // 思考内容和正式回复分开显示
                if (last?.type === 'assistant' && last.subtype === (isThinking ? 'thinking' : 'text')) {
                  return [...prev.slice(0, -1), { ...last, result: (last.result || '') + (data.text || '') }];
                }
                return [...prev, {
                  type: 'assistant',
                  subtype: isThinking ? 'thinking' : 'text',
                  uuid: `msg-${Date.now()}`,
                  model,
                  result: data.text || '',
                }];
              });
            } else if (dataType === 'system') {
              setMessages(prev => [...prev, {
                type: 'system', subtype: data.subtype || 'init',
                uuid: `init-${Date.now()}`,
                result: `已连接 ${data.provider_url || provider.ANTHROPIC_BASE_URL}\n模型: ${data.model}`,
              }]);
            } else if (dataType === 'result') {
              setResultSummary({
                duration_ms: data.duration_ms, model: data.model,
                stop_reason: data.stop_reason, usage: data.usage, text_length: data.text?.length || 0,
              });
              setMessages(prev => [...prev, {
                type: 'result', subtype: 'success', uuid: `result-${Date.now()}`,
                duration_ms: data.duration_ms, result: data.text?.slice(0, 300) || '',
                stop_reason: data.stop_reason, usage: data.usage, model: data.model,
              }]);
            } else if (dataType === 'permission_request') {
              setPendingPermissions(prev => [...prev, {
                reqId: data.reqId, toolName: data.toolName, input: data.input,
                title: data.title, displayName: data.displayName, description: data.description,
                toolUseID: data.toolUseID,
              }]);
            } else if (dataType === 'permission_resolved') {
              if (data.reqId) setPendingPermissions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (dataType === 'ask_user_question') {
              setPendingQuestions(prev => [...prev, {
                reqId: data.reqId,
                questions: data.questions || [],
                toolUseID: data.toolUseID,
              }]);
            } else if (dataType === 'ask_user_question_resolved') {
              if (data.reqId) setPendingQuestions(prev => prev.filter(p => p.reqId !== data.reqId));
            } else if (dataType === 'error') {
              setMessages(prev => [...prev, { type: 'system', subtype: 'error', result: data.message || '未知错误' }]);
            }
          } catch { /* skip */ }
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setMessages(prev => [...prev, {
        type: 'system', subtype: 'error',
        result: `连接失败: ${(e as Error).message || String(e)}`,
      }]);
    }
    setIsStreaming(false);
    abortRef.current = null;
  }, [prompt, provider, model, isStreaming]);

  // interrupt()
  const handleInterrupt = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const needsKey = !provider.ANTHROPIC_AUTH_TOKEN;
  const needsModel = !model || !modelOptions.includes(model);

  return (
    <div>
      <div className="page-header">
        <h1>▶ Playground</h1>
        <p>真实调用 Anthropic 兼容 API — {provider.ANTHROPIC_BASE_URL}</p>
      </div>

      {/* 状态提示 */}
      {needsKey && (
        <div className="card mb-4" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning)' }}>
          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <span>⚠️</span>
            <span style={{ fontSize: '.84em' }}>
              尚未配置 API Key，请先到 <a href="/account" style={{ color: 'var(--accent)' }}>账户管理 → 供应商</a> 填写 ANTHROPIC_AUTH_TOKEN
            </span>
          </div>
        </div>
      )}

      {!needsKey && needsModel && (
        <div className="card mb-4" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning)' }}>
          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: '.84em' }}>
              尚未配置可用模型，请先到 <a href="/account" style={{ color: 'var(--accent)' }}>账户管理 → 供应商</a> 添加可用模型
            </span>
          </div>
        </div>
      )}

      {!needsKey && (
        <div className="card mb-4" style={{ background: serverStatus === 'online' ? 'var(--success-bg)' : 'var(--warning-bg)', borderColor: serverStatus === 'online' ? 'var(--success)' : 'var(--warning)' }}>
          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: '.84em' }}>
              后端 {serverStatus === 'checking' ? '检测中...' : serverStatus === 'online' ? '✓ 在线' : '✗ 离线'}
              {serverStatus === 'online' && model && ` — 模型: ${model}`}
              {serverStatus === 'offline' && ' — 请运行 npm run server 启动后端'}
            </span>
          </div>
        </div>
      )}

      {/* Prompt 输入 */}
      <div className="card mb-4">
        <div className="card-header">
          query(prompt, options?) → AsyncGenerator&lt;SDKMessage&gt;
        </div>
        <div className="form-group">
          <label>Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleQuery();
              }
            }}
            placeholder='输入 prompt，Cmd+Enter 发送'
            rows={3}
            style={{ resize: 'vertical' }}
            disabled={needsKey}
          />
        </div>
        <div className="form-group">
          <label>模型</label>
          <select value={model} onChange={e => setModel(e.target.value)} disabled={!modelOptions.length || isStreaming}>
            {modelOptions.length === 0 && <option value="">未配置可用模型</option>}
            {modelOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="flex gap-3" style={{ alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleQuery}
            disabled={isStreaming || !prompt.trim() || needsKey || needsModel || serverStatus !== 'online'}
          >
            {isStreaming ? 'Streaming...' : '发送 query()'}
          </button>
          {isStreaming && (
            <button className="btn btn-danger" onClick={handleInterrupt}>interrupt()</button>
          )}
          <button className="btn" onClick={() => setShowOptions(!showOptions)}>
            {showOptions ? '隐藏' : '显示'} Options
          </button>
          <button className="btn" onClick={() => { setMessages([]); setResultSummary(null); }}>清除输出</button>
          <span style={{ fontSize: '.75em', color: 'var(--ink-muted)' }}>Cmd+Enter 发送</span>
        </div>
      </div>

      {/* Options 面板 */}
      {showOptions && (
        <div className="card mb-4 fade-in">
          <div className="card-header">Options 配置（发送到后端）</div>
          <div className="grid-3">
            <div className="form-group">
              <label>model</label>
              <input value={model} disabled style={{ fontFamily: 'var(--font-mono)' }} />
              <div style={{ fontSize: '.7em', color: 'var(--ink-muted)', marginTop: 2 }}>从供应商可用模型中选择</div>
            </div>
            <div className="form-group">
              <label>base_url</label>
              <input value={provider.ANTHROPIC_BASE_URL} disabled style={{ fontFamily: 'var(--font-mono)', fontSize: '.78em' }} />
              <div style={{ fontSize: '.7em', color: 'var(--ink-muted)', marginTop: 2 }}>由供应商配置决定</div>
            </div>
            <div className="form-group">
              <label>max_tokens</label>
              <input value="4096" disabled />
            </div>
          </div>
        </div>
      )}

      {/* 结果摘要 */}
      {resultSummary && (
        <div className="card mb-4 fade-in">
          <div className="card-header">query() 返回结果</div>
          <div className="grid-3">
            <div className="kpi-card">
              <div className="kpi-label">耗时</div>
              <div className="kpi-value">{String(resultSummary.duration_ms)}ms</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">模型</div>
              <div className="kpi-value" style={{ fontSize: '.9em' }}>{String(resultSummary.model)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">响应长度</div>
              <div className="kpi-value">{String(resultSummary.text_length)} 字符</div>
            </div>
          </div>
          <div className="mt-4">
            <JsonViewer data={resultSummary} maxHeight={200} />
          </div>
        </div>
      )}

      {/* 权限审批 */}
      <PermissionPromptList
        pending={pendingPermissions}
        onResolved={(reqId) => setPendingPermissions(prev => prev.filter(p => p.reqId !== reqId))}
      />
      <AskUserQuestionPromptList
        pending={pendingQuestions}
        onResolved={(reqId) => setPendingQuestions(prev => prev.filter(p => p.reqId !== reqId))}
      />

      {/* 流式消息展示 */}
      <div className="section">
        <div className="section-title">流式消息输出 (SSE from /api/agents/run · Claude Agent SDK)</div>
        <StreamDisplay messages={messages} isStreaming={isStreaming} />
      </div>
    </div>
  );
}
