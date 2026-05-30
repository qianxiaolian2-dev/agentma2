import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { query, tool, createSdkMcpServer, type CanUseTool, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { recordAgentRun } from './server-store.ts';

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

type Pending = {
  resolve: (decision: PermissionDecision) => void;
  tenantId: string;
  toolName: string;
  createdAt: number;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, Pending>();
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

// ─── Runner ─────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'system'; subtype: 'init'; model: string; tools: number; cwd: string }
  | { type: 'delta'; text: string; thinking?: boolean }
  | { type: 'permission_request'; reqId: string; toolName: string; input: unknown; title?: string; displayName?: string; description?: string; toolUseID: string }
  | { type: 'permission_resolved'; reqId?: string; toolName: string; decision: 'allow' | 'deny'; reason?: string }
  | { type: 'result'; subtype: string; text: string; usage: { input_tokens: number; output_tokens: number }; duration_ms: number; cost_usd: number; model: string }
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  prompt: string;
  systemPrompt?: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
  /** Template-allowed tool names (bare names like 'Read', 'Bash', 'mineflayer-chat'). Empty/undef = no template restriction. */
  tools?: string[];
  /** Raw tool definitions from the request body (for custom-tools schema). */
  requestTools?: any[];
  maxTurns?: number;
  cwd?: string;
  tenantId: string;
  sub: string;
  emit: (e: AgentEvent) => void;
  requestPermission: RequestPermissionFn;
}

export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const cwd = opts.cwd || path.join('/tmp', `agentma-run-${opts.tenantId}-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });

  // Per-call env (concurrency-safe — never mutate process.env)
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = String(v);
  if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;
  env.ANTHROPIC_API_KEY = opts.apiKey;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const customMcp = buildCustomToolsMcp(opts.requestTools || []);
  // Resolve template tool names → SDK-visible names (prefix custom with mcp__custom__).
  const templateToolNames = new Set<string>();
  if (opts.tools && opts.tools.length) {
    const customNames = new Set<string>();
    if (customMcp) {
      let endpoints: any[] = [];
      try { endpoints = JSON.parse(fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8')); } catch {}
      for (const e of endpoints) if (e?.endpoint && e.name) customNames.add(e.name);
    }
    for (const t of opts.tools) {
      templateToolNames.add(customNames.has(t) ? `mcp__custom__${t}` : t);
    }
  }

  // canUseTool: enforce template scope → safe-allow check → defer to user prompt.
  // NOTE: the SDK's runtime schema requires `updatedInput` to be present (a record)
  // when behavior is 'allow', even though the TS type marks it optional.
  const canUseTool: CanUseTool = async (toolName, input, callOpts) => {
    // 1. Template restriction — if template specifies tools and this isn't one of them, deny.
    if (templateToolNames.size > 0 && !templateToolNames.has(toolName)) {
      return { behavior: 'deny', message: `Tool '${toolName}' is not enabled by the agent template.` } as PermissionResult;
    }
    // 2. Safe auto-allow (read-only). Strip MCP prefix to check the bare name.
    const bareName = toolName.startsWith('mcp__') ? (toolName.split('__').pop() || toolName) : toolName;
    if (SAFE_AUTO_ALLOW_TOOLS.has(bareName)) {
      return { behavior: 'allow', updatedInput: input } as PermissionResult;
    }
    // 3. Interactive: ask the user via SSE.
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
  let inTok = 0, outTok = 0, finalText = '', status = 'success';

  try {
    for await (const msg of query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        permissionMode: 'default',  // canUseTool decides everything
        canUseTool,
        maxTurns: Number(opts.maxTurns) || 20,
        cwd,
        settingSources: [],
        env,
        ...(customMcp ? { mcpServers: { custom: customMcp } } : {}),
        ...(opts.systemPrompt && opts.systemPrompt.trim() ? { systemPrompt: opts.systemPrompt } : {}),
      },
    })) {
      const m = msg as any;
      if (m.type === 'system' && m.subtype === 'init') {
        opts.emit({ type: 'system', subtype: 'init', model: m.model, tools: (m.tools || []).length, cwd });
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
        if (m.result) finalText = m.result;
        const u = m.usage || {};
        inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        outTok = u.output_tokens || 0;
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
  });
}
