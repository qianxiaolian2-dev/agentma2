import type { MutableRefObject } from 'react';
import type { ChatMessage, ChatRunStats } from '../simulator/types';
import {
  deriveRunPhase,
  mapResultSubtypeToOutcome,
  normalizeRunOutcome,
  type RunOutcome,
  type RunPhase,
} from '../simulator/run-state';
import type { PermissionRequest } from '../components/PermissionPrompt';
import type { AskUserQuestionRequest } from '../components/AskUserQuestionPrompt';
import { mergeAgentTaskEvent, type AgentTaskEvent } from './agent-tasks';
import { mergeContextCompactionEvent, type ContextCompactionEvent } from './context-events';
import { getAuthHeaders } from './client-runtime';
import { finalizeAssistantDraft, updateAssistantDraft } from './chat-stream-draft';
import { chatRunStatsFromResultEvent } from './chat-run-stats';

type ObserveRunOptions = {
  runId: string;
  sessionId: string;
  baseMessages: ChatMessage[];
  draftId: string;
  assistantTimestamp: number;
  initialThinking?: string;
  initialText?: string;
  onMessages: (updater: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => void;
  persistFinal: (messages: ChatMessage[], sdkSessionId?: string, sdkCwd?: string) => Promise<void>;
  setIsStreaming: (value: boolean) => void;
  setRunPhase: (phase: RunPhase) => void;
  setActiveRunId: (runId: string) => void;
  setPendingPermissions: (updater: (previous: PermissionRequest[]) => PermissionRequest[]) => void;
  setPendingQuestions: (updater: (previous: AskUserQuestionRequest[]) => AskUserQuestionRequest[]) => void;
  setAgentTasks: (updater: (previous: AgentTaskEvent[]) => AgentTaskEvent[]) => void;
  setContextEvents: (updater: (previous: ContextCompactionEvent[]) => ContextCompactionEvent[]) => void;
  setStructuredOutput: (value: unknown) => void;
  setRunStats: (value: ChatRunStats | null) => void;
  abortRef: MutableRefObject<AbortController | null>;
  signal?: AbortSignal;
};

async function readSseLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: Record<string, unknown>) => Promise<void>,
) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        await onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
      } catch {}
    }
  }
}

export async function observeServerRun(options: ObserveRunOptions) {
  const streamController = new AbortController();
  const stopController = new AbortController();
  const externalAbort = () => streamController.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  options.abortRef.current = stopController;
  options.setIsStreaming(true);
  options.setRunPhase('initializing');
  options.setActiveRunId(options.runId);

  let thinking = options.initialThinking || '';
  let text = options.initialText || '';
  let didFinalize = false;
  let receivedOutcome: RunOutcome | null = null;
  let outcomeDetail: string | undefined;
  let cachedErrorMessage = '';
  const phaseFlags = {
    initializing: true,
    streaming: false,
    thinking: Boolean(thinking),
    toolExecuting: false,
    awaitingPermission: false,
    awaitingInput: false,
    finalizing: false,
  };
  let pendingPermissionCount = 0;
  let pendingQuestionCount = 0;
  const updateRunPhase = (patch: Partial<typeof phaseFlags>) => {
    Object.assign(phaseFlags, patch);
    options.setRunPhase(deriveRunPhase(phaseFlags));
  };
  const finishRun = () => {
    if (options.abortRef.current === stopController) options.abortRef.current = null;
    options.setIsStreaming(false);
    options.setRunPhase('idle');
    options.setActiveRunId('');
    options.signal?.removeEventListener('abort', externalAbort);
  };
  const persistFinalMessage = async (
    finalContent: string,
    outcome: RunOutcome,
    sdkSessionId?: string,
    sdkCwd?: string,
    detail?: string,
    runStats?: ChatRunStats,
  ) => {
    if (didFinalize) return;
    didFinalize = true;
    updateRunPhase({ finalizing: true, initializing: false, streaming: false, thinking: false, toolExecuting: false });
    const finalMessages = finalizeAssistantDraft(
      options.baseMessages,
      options.draftId,
      options.assistantTimestamp,
      finalContent,
      outcome,
      thinking || undefined,
      detail,
      options.runId,
      runStats,
    );
    options.onMessages(finalMessages);
    await options.persistFinal(finalMessages, sdkSessionId, sdkCwd);
  };

  stopController.signal.addEventListener('abort', () => {
    fetch(`/api/chat/runs/${encodeURIComponent(options.runId)}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    }).catch(() => undefined);
  }, { once: true });

  try {
    const response = await fetch(`/api/chat/runs/${encodeURIComponent(options.runId)}/events`, {
      headers: getAuthHeaders(),
      signal: streamController.signal,
    });
    if (response.status === 404) {
      await persistFinalMessage(text, 'disconnected', undefined, undefined, 'run not found');
      return;
    }
    if (!response.ok) {
      await persistFinalMessage(text, 'provider_error', undefined, undefined, `run events failed: ${response.status}`);
      return;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      await persistFinalMessage(text, 'provider_error', undefined, undefined, 'empty run events body');
      return;
    }

    await readSseLines(reader, streamController.signal, async (data) => {
      if (data.type === 'run_started') {
        return;
      }
      if (data.type === 'system' && data.subtype === 'init') {
        updateRunPhase({ initializing: true });
      } else if (data.type === 'delta') {
        const deltaText = typeof data.text === 'string' ? data.text : '';
        if (data.thinking) {
          thinking += deltaText;
          options.onMessages(prev => updateAssistantDraft(prev, options.draftId, { thinking, status: 'streaming', runId: options.runId }));
          updateRunPhase({ initializing: false, thinking: true, streaming: false, toolExecuting: false });
        } else {
          text += deltaText;
          options.onMessages(prev => updateAssistantDraft(prev, options.draftId, { content: text, status: 'streaming', runId: options.runId }));
          updateRunPhase({ initializing: false, thinking: false, streaming: true, toolExecuting: false });
        }
      } else if (data.type === 'run_log') {
        const level = data.level === 'warn' ? 'warn' : 'info';
        const message = typeof data.message === 'string' ? data.message : '';
        if (message) {
          text += `\n[${level}] ${message}\n`;
          options.onMessages(prev => updateAssistantDraft(prev, options.draftId, { content: text, status: 'streaming', runId: options.runId }));
        }
      } else if (data.type === 'result') {
        const finalOutcome = receivedOutcome || mapResultSubtypeToOutcome(data.subtype);
        const finalDetail = outcomeDetail || (typeof data.subtype === 'string' ? data.subtype : undefined);
        const finalContent = text || (typeof data.text === 'string' ? data.text : '');
        if (data.structuredOutput !== undefined) options.setStructuredOutput(data.structuredOutput);
        let finalRunStats: ChatRunStats | undefined;
        if (data.cost_usd !== undefined || data.duration_ms !== undefined || data.usage !== undefined) {
          finalRunStats = chatRunStatsFromResultEvent(data);
          options.setRunStats(finalRunStats || null);
        }
        await persistFinalMessage(finalContent || (cachedErrorMessage ? `错误: ${cachedErrorMessage}` : ''), finalOutcome, data.sdkSessionId as string | undefined, data.sdkCwd as string | undefined, finalDetail, finalRunStats);
      } else if (data.type === 'run_outcome') {
        receivedOutcome = normalizeRunOutcome(data.outcome, receivedOutcome || 'provider_error');
        outcomeDetail = typeof data.subtype === 'string'
          ? data.subtype
          : typeof data.message === 'string' ? data.message : outcomeDetail;
      } else if (data.type === 'permission_request') {
        pendingPermissionCount += 1;
        options.setPendingPermissions(prev => [...prev, {
          reqId: String(data.reqId || ''),
          toolName: String(data.toolName || ''),
          input: data.input,
          title: typeof data.title === 'string' ? data.title : undefined,
          displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
          description: typeof data.description === 'string' ? data.description : undefined,
          toolUseID: String(data.toolUseID || ''),
        }]);
        updateRunPhase({ awaitingPermission: true, initializing: false });
      } else if (data.type === 'permission_resolved') {
        if (data.reqId) {
          pendingPermissionCount = Math.max(0, pendingPermissionCount - 1);
          options.setPendingPermissions(prev => prev.filter(p => p.reqId !== data.reqId));
          updateRunPhase({ awaitingPermission: pendingPermissionCount > 0 });
        }
      } else if (data.type === 'ask_user_question') {
        pendingQuestionCount += 1;
        options.setPendingQuestions(prev => [...prev, {
          reqId: String(data.reqId || ''),
          questions: Array.isArray(data.questions) ? data.questions as AskUserQuestionRequest['questions'] : [],
          toolUseID: String(data.toolUseID || ''),
        }]);
        updateRunPhase({ awaitingInput: true, initializing: false });
      } else if (data.type === 'ask_user_question_resolved') {
        if (data.reqId) {
          pendingQuestionCount = Math.max(0, pendingQuestionCount - 1);
          options.setPendingQuestions(prev => prev.filter(p => p.reqId !== data.reqId));
          updateRunPhase({ awaitingInput: pendingQuestionCount > 0 });
        }
      } else if (String(data.type || '').startsWith('task_')) {
        options.setAgentTasks(prev => mergeAgentTaskEvent(prev, data));
        updateRunPhase({ initializing: false, toolExecuting: true, thinking: false, streaming: false });
      } else if (data.type === 'context_compaction') {
        options.setContextEvents(prev => mergeContextCompactionEvent(prev, data));
      } else if (data.type === 'error') {
        cachedErrorMessage = String(data.message || '未知错误');
        receivedOutcome = receivedOutcome || 'provider_error';
        outcomeDetail = outcomeDetail || cachedErrorMessage;
      }
    });

    if (!didFinalize && !streamController.signal.aborted) {
      const fallbackOutcome = receivedOutcome && receivedOutcome !== 'completed' ? receivedOutcome : 'disconnected';
      await persistFinalMessage(text || (cachedErrorMessage ? `错误: ${cachedErrorMessage}` : ''), fallbackOutcome, undefined, undefined, outcomeDetail);
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError' && !streamController.signal.aborted) {
      const message = (error as Error).message;
      await persistFinalMessage(text ? text : `连接失败: ${message}`, 'provider_error', undefined, undefined, message);
    }
  } finally {
    finishRun();
  }
}

export function findPendingRunMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => (
    message.role === 'assistant'
    && typeof message.runId === 'string'
    && Boolean(message.runId)
    && (message.status === 'pending' || message.status === 'streaming')
  ));
}
