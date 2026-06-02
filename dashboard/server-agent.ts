import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  query,
  tool,
  createSdkMcpServer,
  type AgentDefinition,
  type CanUseTool,
  type HookCallbackMatcher,
  type HookEvent,
  type PermissionResult,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { evaluateHookRules, evaluatePermissionRules, listHookRules, listKnowledgeSources, listProtectedSdkCwds, recordAgentRun } from './server-store.ts';
import type { HookRuleEvent } from './server-store.ts';

// ─── Pricing ─────────────────────────────────────────────────────────────────
// Edit to match your provider's actual rates. The SDK's own total_cost_usd
// assumes Claude pricing and is wrong for deepseek/minimax.
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'deepseek-chat':     { in: 0.27, out: 1.10 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
};
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

// ─── Safe-allow tool list (read-only, no side effects) ──────────────────────
// These run without prompting the user. Everything else falls through to
// requestPermission.
export const SAFE_AUTO_ALLOW_TOOLS = new Set<string>([
  'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'TodoWrite', 'TodoRead', 'TaskGet', 'TaskList', 'TaskOutput',
  'ListMcpResources', 'ReadMcpResource',
]);

// ─── Custom HTTP-endpoint tools → SDK MCP wrapper ───────────────────────────
// Schemas come from the request body's `tools` array; endpoints come from
// /tmp/agentma_custom_tools.json.
export function buildCustomToolsMcp(requestTools: unknown[]) {
  if (!Array.isArray(requestTools) || !requestTools.length) return null;
  let endpoints: any[] = [];
  try { endpoints = JSON.parse(fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8')); } catch {}
  const byName: Record<string, any> = {};
  for (const e of endpoints) if (e?.endpoint && e.name) byName[e.name] = e;

  const sdkTools: any[] = [];
  for (const t of requestTools as any[]) {
    if (!t?.name || !byName[t.name]) continue;
    const ct = byName[t.name];
    const schema: Record<string, any> = {};
    for (const [k, v] of Object.entries(t.input_schema || {})) {
      let tn = String(v); const opt = tn.endsWith('?'); if (opt) tn = tn.slice(0, -1);
      let zt: any = tn === 'number' ? z.number() : tn === 'boolean' ? z.boolean() : z.string();
      if (opt) zt = zt.optional();
      schema[k] = zt;
    }
    sdkTools.push(tool(t.name, t.description || `Custom tool: ${t.name}`, schema, async (args: any) => {
      let url = ct.endpoint.url;
      let body = ct.endpoint.bodyTemplate || '{}';
      for (const [k, v] of Object.entries(args || {})) {
        url = url.replace(`{{${k}}}`, encodeURIComponent(String(v)));
        body = body.replace(`{{${k}}}`, String(v));
      }
      try {
        const r = await fetch(url, {
          method: ct.endpoint.method,
          headers: { 'Content-Type': 'application/json', ...(ct.endpoint.headers || {}) },
          body: ct.endpoint.method !== 'GET' ? body : undefined,
        });
        return { content: [{ type: 'text', text: (await r.text()).slice(0, 4000) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `err: ${(e as Error).message}` }], isError: true };
      }
    }));
  }
  if (!sdkTools.length) return null;
  return createSdkMcpServer({ name: 'custom', version: '1.0.0', tools: sdkTools });
}

// ─── Permission request system ──────────────────────────────────────────────
// runAgent calls into `RequestPermissionFn`; the HTTP layer registers a
// requester that emits SSE events and waits for the frontend to POST a
// decision back to /api/agents/permissions/:reqId.

export type PermissionDecision = {
  decision: 'allow' | 'deny';
  reason?: string;
  updatedInput?: Record<string, unknown>;
  rememberForSession?: boolean;  // remember within THIS run
};

export type AskUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type AskUserQuestionItem = {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
};

export type AskUserQuestionAnswer = {
  answers: Record<string, string>;
  reason?: string;
};

export type PermissionRequest = {
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  toolUseID: string;
  signal?: AbortSignal;
};

export type RequestPermissionFn = (req: PermissionRequest) => Promise<PermissionDecision>;
export type RequestUserQuestionFn = (req: {
  questions: AskUserQuestionItem[];
  toolUseID: string;
  signal?: AbortSignal;
}) => Promise<AskUserQuestionAnswer>;

type Pending = {
  resolve: (decision: PermissionDecision) => void;
  tenantId: string;
  toolName: string;
  createdAt: number;
  timer: NodeJS.Timeout;
};

type PendingUserQuestion = {
  resolve: (answer: AskUserQuestionAnswer) => void;
  tenantId: string;
  createdAt: number;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, Pending>();
const pendingUserQuestions = new Map<string, PendingUserQuestion>();
const PROMPT_TIMEOUT_MS = 120 * 1000;  // 2 min for user decision; auto-deny on timeout

export function resolvePermissionRequest(reqId: string, tenantId: string, decision: PermissionDecision) {
  const p = pending.get(reqId);
  if (!p) return { ok: false, reason: 'unknown reqId' };
  if (p.tenantId !== tenantId) return { ok: false, reason: 'tenant mismatch' };
  clearTimeout(p.timer);
  pending.delete(reqId);
  p.resolve(decision);
  return { ok: true };
}

export function resolveAskUserQuestion(reqId: string, tenantId: string, answer: AskUserQuestionAnswer) {
  const p = pendingUserQuestions.get(reqId);
  if (!p) return { ok: false, reason: 'unknown reqId' };
  if (p.tenantId !== tenantId) return { ok: false, reason: 'tenant mismatch' };
  clearTimeout(p.timer);
  pendingUserQuestions.delete(reqId);
  p.resolve(answer);
  return { ok: true };
}

export function createPermissionRequester(opts: {
  emit: (event: any) => void;
  sessionAllow: Set<string>;
  tenantId: string;
}): RequestPermissionFn {
  return async (req) => {
    if (opts.sessionAllow.has(req.toolName)) {
      opts.emit({ type: 'permission_resolved', toolName: req.toolName, decision: 'allow', reason: 'session-allow' });
      return { decision: 'allow' };
    }
    const reqId = crypto.randomUUID();
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.has(reqId)) {
          pending.delete(reqId);
          opts.emit({ type: 'permission_resolved', reqId, toolName: req.toolName, decision: 'deny', reason: 'timeout' });
          resolve({ decision: 'deny', reason: `no decision in ${PROMPT_TIMEOUT_MS / 1000}s` });
        }
      }, PROMPT_TIMEOUT_MS);
      pending.set(reqId, { resolve, tenantId: opts.tenantId, toolName: req.toolName, createdAt: Date.now(), timer });
      opts.emit({
        type: 'permission_request',
        reqId,
        toolName: req.toolName,
        input: req.input,
        title: req.title,
        displayName: req.displayName,
        description: req.description,
        toolUseID: req.toolUseID,
      });
    }).then((decision) => {
      if (decision.decision === 'allow' && decision.rememberForSession) {
        opts.sessionAllow.add(req.toolName);
      }
      opts.emit({ type: 'permission_resolved', reqId, toolName: req.toolName, decision: decision.decision, reason: decision.reason });
      return decision;
    });
  };
}

export function createAskUserQuestionRequester(opts: {
  emit: (event: any) => void;
  tenantId: string;
}): RequestUserQuestionFn {
  return async (req) => {
    const reqId = crypto.randomUUID();
    return new Promise<AskUserQuestionAnswer>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingUserQuestions.has(reqId)) {
          pendingUserQuestions.delete(reqId);
          const answers = buildFallbackAnswers(req.questions);
          resolve({ answers, reason: 'timeout' });
        }
      }, PROMPT_TIMEOUT_MS);
      pendingUserQuestions.set(reqId, { resolve, tenantId: opts.tenantId, createdAt: Date.now(), timer });
      opts.emit({
        type: 'ask_user_question',
        reqId,
        questions: req.questions,
        toolUseID: req.toolUseID,
      });
    }).then((answer) => {
      opts.emit({ type: 'ask_user_question_resolved', reqId, answers: answer.answers, reason: answer.reason });
      return answer;
    });
  };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'system'; subtype: 'init'; model: string; tools: number; cwd: string; sdkSessionId?: string }
  | { type: 'delta'; text: string; thinking?: boolean }
  | { type: 'permission_request'; reqId: string; toolName: string; input: unknown; title?: string; displayName?: string; description?: string; toolUseID: string }
  | { type: 'permission_resolved'; reqId?: string; toolName: string; decision: 'allow' | 'deny'; reason?: string }
  | { type: 'ask_user_question'; reqId: string; questions: AskUserQuestionItem[]; toolUseID: string }
  | { type: 'ask_user_question_resolved'; reqId: string; answers?: Record<string, string>; reason?: string }
  | { type: 'hook_response'; eventName: HookRuleEvent; action: string; reason: string; input: unknown; output: unknown; toolUseID?: string }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; subagentType?: string; taskType?: string; prompt?: string; sdkSessionId?: string }
  | { type: 'task_progress'; taskId: string; toolUseId?: string; description: string; subagentType?: string; lastToolName?: string; summary?: string; usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }; sdkSessionId?: string }
  | { type: 'task_updated'; taskId: string; status?: string; description?: string; error?: string; backgrounded?: boolean; sdkSessionId?: string }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; status: string; summary?: string; outputFile?: string; usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }; sdkSessionId?: string }
  | { type: 'result'; subtype: string; text: string; usage: { input_tokens: number; output_tokens: number }; duration_ms: number; cost_usd: number; model: string; sdkSessionId?: string; sdkCwd?: string; structuredOutput?: unknown }
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  prompt: string;
  promptImages?: Array<{
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  }>;
  systemPrompt?: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
  /** Template-allowed tool names (bare names like 'Read', 'Bash', 'mineflayer-chat'). Empty/undef = no template restriction. */
  tools?: string[];
  /** Raw tool definitions from the request body (for custom-tools schema). */
  requestTools?: any[];
  /** Programmatic SDK subagents exposed through the Agent tool. */
  subagents?: Record<string, AgentDefinition>;
  /** Structured output JSON Schema — when set, SDK returns structured_output alongside text. */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  /** Snapshot files before edits so /rewind can restore them. */
  enableFileCheckpointing?: boolean;
  /** Allow the agent to read tenant-configured knowledge source directories. */
  useKnowledge?: boolean;
  maxTurns?: number;
  cwd?: string;
  resumeSdkSessionId?: string;
  tenantId: string;
  sub: string;
  emit: (e: AgentEvent) => void;
  requestPermission: RequestPermissionFn;
  requestUserQuestion: RequestUserQuestionFn;
}

const RUN_CWD_PREFIX = 'agentma-run-';
const RUN_CWD_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_CWD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastRunCwdCleanupMs = 0;

function realpathIfPossible(filePath: string) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function getRunCwdParents() {
  const parents = new Set<string>();
  for (const root of [os.tmpdir(), '/tmp', '/private/tmp']) {
    try {
      parents.add(fs.realpathSync.native(root));
    } catch {}
  }
  return parents;
}

function cleanupExpiredRunCwds(excludeCwd: string) {
  const ttlMs = Number(process.env.AGENTMA_RUN_CWD_TTL_MS || RUN_CWD_DEFAULT_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;

  const now = Date.now();
  if (now - lastRunCwdCleanupMs < RUN_CWD_CLEANUP_INTERVAL_MS) return;
  lastRunCwdCleanupMs = now;

  const parents = getRunCwdParents();
  const excluded = realpathIfPossible(excludeCwd);
  const protectedCwds = new Set(listProtectedSdkCwds().map(realpathIfPossible));
  for (const parent of parents) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(RUN_CWD_PREFIX)) continue;
      const candidate = path.join(parent, entry.name);
      try {
        const resolved = fs.realpathSync.native(candidate);
        if (resolved === excluded || !parents.has(path.dirname(resolved))) continue;
        if (protectedCwds.has(resolved)) continue;
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory() || now - stat.mtimeMs < ttlMs) continue;
        fs.rmSync(resolved, { recursive: true, force: true });
      } catch {}
    }
  }
}

const SUPPORTED_HOOK_EVENTS: HookRuleEvent[] = ['PreToolUse', 'PostToolUse', 'Notification'];

function asHookInputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function buildTenantHooks(
  tenantId: string,
  emit: (e: AgentEvent) => void,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  const activeRules = listHookRules(tenantId).filter((rule) => rule.enabled);
  if (!activeRules.length) return undefined;

  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  for (const eventName of SUPPORTED_HOOK_EVENTS) {
    if (!activeRules.some((rule) => rule.eventName === eventName)) continue;
    hooks[eventName] = [{
      hooks: [async (input, toolUseID) => {
        const inputRecord = asHookInputRecord(input);
        const decision = evaluateHookRules(tenantId, eventName, inputRecord);
        if (!decision) return {};
        emit({
          type: 'hook_response',
          eventName,
          action: decision.action,
          reason: decision.reason,
          input: inputRecord,
          output: decision.output,
          toolUseID,
        });
        return decision.output as any;
      }],
      timeout: 30,
    }];
  }

  return Object.keys(hooks).length ? hooks : undefined;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function normalizeAskUserQuestions(input: Record<string, unknown>): AskUserQuestionItem[] {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  return rawQuestions.slice(0, 4).flatMap((item): AskUserQuestionItem[] => {
    const raw = asRecord(item);
    const question = typeof raw.question === 'string' ? raw.question.trim() : '';
    if (!question) return [];
    const header = typeof raw.header === 'string' && raw.header.trim()
      ? raw.header.trim().slice(0, 24)
      : 'Question';
    const options = Array.isArray(raw.options)
      ? raw.options.slice(0, 4).flatMap((option): AskUserQuestionOption[] => {
          const opt = asRecord(option);
          const label = typeof opt.label === 'string' ? opt.label.trim() : '';
          if (!label) return [];
          return [{
            label,
            description: typeof opt.description === 'string' ? opt.description : '',
            preview: typeof opt.preview === 'string' ? opt.preview : undefined,
          }];
        })
      : [];
    if (options.length < 2) return [];
    return [{
      question,
      header,
      options,
      multiSelect: raw.multiSelect === true,
    }];
  });
}

function buildFallbackAnswers(questions: AskUserQuestionItem[]) {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    answers[question.question] = 'No response before timeout';
  }
  return answers;
}

function buildKnowledgeSystemPrompt(sources: Array<{ name: string; path: string }>) {
  return [
    '你可以访问以下用户知识来源(只读):',
    ...sources.map((source) => `- "${source.name}": ${source.path}`),
    '回答涉及个人知识、笔记、历史记录或知识库内容时,主动使用 Glob 找文件、Grep 全文搜索、Read 读取内容。',
    '引用时给出文件路径和 markdown 段落标题。Obsidian 风格的 [[wikilink]] 和 #tag 可以直接 grep。',
  ].join('\n');
}

async function* buildUserPromptStream(text: string, images: NonNullable<RunAgentOptions['promptImages']>): AsyncIterable<SDKUserMessage> {
  const content: any[] = [];
  const cleanText = text.trim();
  if (cleanText) content.push({ type: 'text', text: cleanText });
  for (const image of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }
  yield {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
  };
}

export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const cwd = opts.cwd || path.join('/tmp', `agentma-run-${opts.tenantId}-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });
  cleanupExpiredRunCwds(cwd);

  // Per-call env (concurrency-safe — never mutate process.env)
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = String(v);
  if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;
  env.ANTHROPIC_API_KEY = opts.apiKey;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const customMcp = buildCustomToolsMcp(opts.requestTools || []);
  const hooks = buildTenantHooks(opts.tenantId, opts.emit);
  const knowledgeSources = opts.useKnowledge
    ? listKnowledgeSources(opts.tenantId).filter((source) => source.enabled)
    : [];
  const additionalDirectories = knowledgeSources.map((source) => source.path);
  const knowledgeSystemPrompt = knowledgeSources.length ? buildKnowledgeSystemPrompt(knowledgeSources) : '';
  const effectiveSystemPrompt = [opts.systemPrompt, knowledgeSystemPrompt].filter((part) => part && part.trim()).join('\n\n');
  const agentNames = Object.keys(opts.subagents || {});
  const subagentToolNames = new Set<string>();
  for (const agent of Object.values(opts.subagents || {})) {
    for (const toolName of agent.tools || []) subagentToolNames.add(toolName);
  }
  let customNames = new Set<string>();
  if (customMcp) {
    let endpoints: any[] = [];
    try { endpoints = JSON.parse(fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8')); } catch {}
    customNames = new Set(endpoints.filter((e) => e?.endpoint && e.name).map((e) => String(e.name)));
  }
  // Resolve template tool names → SDK-visible names (prefix custom with mcp__custom__).
  const templateToolNames = new Set<string>();
  const sdkBuiltinTools = new Set<string>();
  if (opts.tools && opts.tools.length) {
    for (const t of opts.tools) {
      const isCustom = customNames.has(t);
      templateToolNames.add(isCustom ? `mcp__custom__${t}` : t);
      if (t === 'Agent') templateToolNames.add('Task');
      if (t === 'Task') templateToolNames.add('Agent');
      if (!isCustom) sdkBuiltinTools.add(t);
    }
    for (const t of subagentToolNames) {
      if (!customNames.has(t) && !t.startsWith('mcp__')) sdkBuiltinTools.add(t);
    }
  }
  if (knowledgeSources.length) {
    for (const toolName of ['Read', 'Grep', 'Glob']) {
      templateToolNames.add(toolName);
      sdkBuiltinTools.add(toolName);
    }
  }

  // canUseTool: enforce template scope → safe-allow check → defer to user prompt.
  // NOTE: the SDK's runtime schema requires `updatedInput` to be present (a record)
  // when behavior is 'allow', even though the TS type marks it optional.
  const canUseTool: CanUseTool = async (toolName, input, callOpts) => {
    // 1. Template restriction — if template specifies tools and this isn't one of them, deny.
    const allowedBySubagentDefinition = Boolean(callOpts.agentID && subagentToolNames.has(toolName));
    if (templateToolNames.size > 0 && !templateToolNames.has(toolName) && !allowedBySubagentDefinition) {
      return { behavior: 'deny', message: `Tool '${toolName}' is not enabled by the agent template.` } as PermissionResult;
    }
    if (toolName === 'AskUserQuestion') {
      const questions = normalizeAskUserQuestions(input);
      if (!questions.length) {
        return { behavior: 'deny', message: 'AskUserQuestion did not provide valid questions.' } as PermissionResult;
      }
      const answer = await opts.requestUserQuestion({
        questions,
        toolUseID: callOpts.toolUseID,
        signal: callOpts.signal,
      });
      return {
        behavior: 'allow',
        updatedInput: { ...input, questions, answers: answer.answers },
      } as PermissionResult;
    }
    // 2. Tenant policy rules from the Permissions page.
    const policyDecision = evaluatePermissionRules(opts.tenantId, toolName, input);
    if (policyDecision) {
      opts.emit({
        type: 'permission_resolved',
        toolName,
        decision: policyDecision.behavior,
        reason: policyDecision.reason,
      });
      if (policyDecision.behavior === 'allow') {
        return { behavior: 'allow', updatedInput: input } as PermissionResult;
      }
      return { behavior: 'deny', message: policyDecision.reason } as PermissionResult;
    }
    // 3. Safe auto-allow (read-only). Strip MCP prefix to check the bare name.
    const bareName = toolName.startsWith('mcp__') ? (toolName.split('__').pop() || toolName) : toolName;
    if (SAFE_AUTO_ALLOW_TOOLS.has(bareName)) {
      return { behavior: 'allow', updatedInput: input } as PermissionResult;
    }
    // 4. Interactive: ask the user via SSE.
    const r = await opts.requestPermission({
      toolName,
      input,
      title: callOpts.title,
      displayName: callOpts.displayName,
      description: callOpts.description,
      toolUseID: callOpts.toolUseID,
      signal: callOpts.signal,
    });
    if (r.decision === 'allow') {
      return { behavior: 'allow', updatedInput: r.updatedInput || input } as PermissionResult;
    }
    return { behavior: 'deny', message: r.reason || 'denied by user' } as PermissionResult;
  };

  const startTime = Date.now();
  let inTok = 0, outTok = 0, finalText = '', status = 'success', sdkSessionId = opts.resumeSdkSessionId || '', structuredOutput: unknown = undefined;

  try {
    const queryPrompt = opts.promptImages?.length
      ? buildUserPromptStream(opts.prompt, opts.promptImages)
      : opts.prompt;
    for await (const msg of query({
      prompt: queryPrompt,
      options: {
        model: opts.model,
        permissionMode: 'default',  // canUseTool decides everything
        ...(sdkBuiltinTools.size ? { tools: Array.from(sdkBuiltinTools) } : {}),
        canUseTool,
        maxTurns: Number(opts.maxTurns) || 20,
        cwd,
        ...(additionalDirectories.length ? { additionalDirectories } : {}),
        ...(agentNames.length ? { agents: opts.subagents, forwardSubagentText: true, agentProgressSummaries: true } : {}),
        ...(opts.resumeSdkSessionId ? { resume: opts.resumeSdkSessionId } : {}),
        ...(opts.outputFormat ? { outputFormat: opts.outputFormat } : {}),
        ...(opts.enableFileCheckpointing ? { enableFileCheckpointing: true } : {}),
        settingSources: [],
        env,
        ...(hooks ? { hooks, includeHookEvents: true } : {}),
        ...(customMcp ? { mcpServers: { custom: customMcp } } : {}),
        ...(effectiveSystemPrompt ? { systemPrompt: effectiveSystemPrompt } : {}),
      },
    })) {
      const m = msg as any;
      if (m.session_id && !sdkSessionId) sdkSessionId = m.session_id;
      if (m.type === 'system' && m.subtype === 'init') {
        opts.emit({ type: 'system', subtype: 'init', model: m.model, tools: (m.tools || []).length, cwd, sdkSessionId: m.session_id || sdkSessionId || undefined });
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text) { finalText += b.text; opts.emit({ type: 'delta', text: b.text }); }
          else if (b.type === 'tool_use') opts.emit({ type: 'delta', text: `\n🔧 ${b.name}(${JSON.stringify(b.input).slice(0, 150)})\n` });
        }
      } else if (m.type === 'user') {
        for (const b of m.message?.content || []) {
          if (b.type === 'tool_result') {
            const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            opts.emit({ type: 'delta', text: `📤 ${t.slice(0, 300)}\n` });
          }
        }
      } else if (m.type === 'result') {
        status = m.subtype || 'success';
        if (m.session_id) sdkSessionId = m.session_id;
        if (m.result) finalText = m.result;
        if (m.structured_output !== undefined) structuredOutput = m.structured_output;
        const u = m.usage || {};
        inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        outTok = u.output_tokens || 0;
      } else if (m.type === 'system' && m.subtype === 'task_started') {
        opts.emit({
          type: 'task_started',
          taskId: m.task_id,
          toolUseId: m.tool_use_id,
          description: m.description || '',
          subagentType: m.subagent_type,
          taskType: m.task_type,
          prompt: m.prompt,
          sdkSessionId: m.session_id || sdkSessionId || undefined,
        });
      } else if (m.type === 'system' && m.subtype === 'task_progress') {
        opts.emit({
          type: 'task_progress',
          taskId: m.task_id,
          toolUseId: m.tool_use_id,
          description: m.description || '',
          subagentType: m.subagent_type,
          lastToolName: m.last_tool_name,
          summary: m.summary,
          usage: m.usage,
          sdkSessionId: m.session_id || sdkSessionId || undefined,
        });
      } else if (m.type === 'system' && m.subtype === 'task_updated') {
        opts.emit({
          type: 'task_updated',
          taskId: m.task_id,
          status: m.patch?.status,
          description: m.patch?.description,
          error: m.patch?.error,
          backgrounded: m.patch?.is_backgrounded,
          sdkSessionId: m.session_id || sdkSessionId || undefined,
        });
      } else if (m.type === 'system' && m.subtype === 'task_notification') {
        opts.emit({
          type: 'task_notification',
          taskId: m.task_id,
          toolUseId: m.tool_use_id,
          status: m.status,
          summary: m.summary,
          outputFile: m.output_file,
          usage: m.usage,
          sdkSessionId: m.session_id || sdkSessionId || undefined,
        });
      }
    }
  } catch (e) {
    status = 'error';
    opts.emit({ type: 'error', message: (e as Error).message });
  }

  const durationMs = Date.now() - startTime;
  const costUsd = estimateCostUsd(opts.model, inTok, outTok);
  try { recordAgentRun(opts.tenantId, { sub: opts.sub, model: opts.model, durationMs, inputTokens: inTok, outputTokens: outTok, costUsd, status }); } catch {}
  opts.emit({
    type: 'result',
    subtype: status,
    text: finalText,
    usage: { input_tokens: inTok, output_tokens: outTok },
    duration_ms: durationMs,
    cost_usd: costUsd,
    model: opts.model,
    sdkSessionId: sdkSessionId || undefined,
    sdkCwd: cwd,
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
  });
}
