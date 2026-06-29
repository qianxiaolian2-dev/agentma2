import { useMemo } from 'react';
import { formatContextTokens, getModelContextWindowInfo } from '../utils/model-context';
import { loadProviderProfiles } from '../utils/providers';

type ContextWindowMeterProps = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  compacted?: boolean;
};

function percentTone(percent?: number) {
  if (percent == null) return 'idle';
  if (percent >= 85) return 'danger';
  if (percent >= 65) return 'warning';
  return 'ok';
}

export default function ContextWindowMeter({ model = '', inputTokens, outputTokens, compacted = false }: ContextWindowMeterProps) {
  const info = useMemo(() => getModelContextWindowInfo(model, loadProviderProfiles()), [model]);
  const observedInputTokens = typeof inputTokens === 'number' && inputTokens > 0 ? inputTokens : undefined;
  const observedOutputTokens = typeof outputTokens === 'number' && outputTokens > 0 ? outputTokens : undefined;
  const usedTokens = observedInputTokens
    ? observedInputTokens + (observedOutputTokens || 0)
    : undefined;
  const percent = info.contextWindowTokens && usedTokens
    ? Math.min(100, Math.max(0, (usedTokens / info.contextWindowTokens) * 100))
    : undefined;
  const tone = percentTone(percent);
  const percentLabel = percent == null ? '-' : `${percent < 1 && percent > 0 ? '<1' : Math.round(percent)}%`;
  const sourceLabel = info.source === 'profile' ? '配置' : info.source === 'known-model' ? '模型库估算' : '未知模型';
  const title = [
    `模型: ${info.model || '未选择'}`,
    `窗口: ${formatContextTokens(info.contextWindowTokens)} (${sourceLabel})`,
    usedTokens ? `最近观测占用: ${usedTokens.toLocaleString()} tokens` : '等待首轮 usage',
    observedInputTokens ? `输入上下文: ${observedInputTokens.toLocaleString()} tokens` : '',
    observedOutputTokens ? `最近输出: ${observedOutputTokens.toLocaleString()} tokens` : '',
    compacted ? '本会话发生过上下文压缩' : '',
  ].filter(Boolean).join('\n');

  return (
    <span className={`context-window-meter context-window-meter-${tone}`} title={title}>
      <span className="context-window-meter-main">
        <span className="context-window-meter-label">Context</span>
        <span className="context-window-meter-value">
          {formatContextTokens(usedTokens)} / {formatContextTokens(info.contextWindowTokens)}
        </span>
        <span className="context-window-meter-percent">{percentLabel}</span>
      </span>
      <span className="context-window-meter-track" aria-hidden="true">
        <span className="context-window-meter-fill" style={{ width: `${percent ?? 0}%` }} />
      </span>
      {compacted && <span className="context-window-meter-flag">已压缩</span>}
    </span>
  );
}
