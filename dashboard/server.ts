import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

interface ProviderConfig {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_MODEL: string;
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface ChatRequest {
  prompt?: string;
  messages?: { role: string; content: string }[];
  systemPrompt?: string;
  provider: ProviderConfig;
  tools?: ToolDef[];
}

// 加载自定义工具（读取 localStorage — 实际上从请求体传，这里作为 fallback）
function loadCustomTools(): Array<{ name: string; endpoint?: { url: string; method: string; headers?: Record<string, string>; bodyTemplate?: string } }> {
  try {
    const raw = fs.readFileSync('/tmp/agentma_custom_tools.json', 'utf-8');
    return JSON.parse(raw);
  } catch { return []; }
}

// POST /api/deploy — 部署 MCP 服务端
app.post('/api/deploy', async (req, res) => {
  const { server, code, tools: deployTools } = req.body as { server: string; code: string; tools?: Array<{ name: string; endpoint?: { url: string; method: string; headers?: Record<string, string>; bodyTemplate?: string } }> };
  if (!server || !code) { res.status(400).json({ error: 'server and code required' }); return; }

  const dir = `/tmp/agentma-mcp-${server}`;
  const file = path.join(dir, 'server.js');

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, code);

    try { const pid = fs.readFileSync(path.join(dir, 'pid'), 'utf-8'); process.kill(Number(pid)); } catch {}
    const proc = spawn('node', [file], { cwd: dir, detached: true, stdio: 'ignore' });
    proc.unref();
    fs.writeFileSync(path.join(dir, 'pid'), String(proc.pid));

    // 保存工具元数据供后续查询
    if (deployTools) fs.writeFileSync('/tmp/agentma_custom_tools.json', JSON.stringify(deployTools));

    console.log(`[deploy] ${server} pid=${proc.pid}`);
    res.json({ ok: true, pid: proc.pid, file });
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message });
  }
});

// POST /api/chat — Agent 循环: 消息 → 工具调用 → 执行 → 回传 → 直到纯文本
app.post('/api/chat', async (req, res) => {
  const { prompt, messages: inputMessages, systemPrompt, provider, tools } = req.body as ChatRequest;

  const convMsgs: Array<{ role: string; content: unknown }> = [];
  if (inputMessages && inputMessages.length > 0) {
    for (const m of inputMessages) {
      // 原样保留 content（支持 string 和数组格式）
      convMsgs.push({ role: m.role, content: m.content });
    }
  } else if (prompt) {
    convMsgs.push({ role: 'user', content: prompt });
  } else {
    res.status(400).json({ error: 'prompt 或 messages 需要至少提供一个' });
    return;
  }

  // System prompt 注入到首条 user message
  if (systemPrompt) {
    const idx = convMsgs.findIndex(m => m.role === 'user');
    if (idx >= 0) {
      const oldContent = typeof convMsgs[idx].content === 'string' ? convMsgs[idx].content : JSON.stringify(convMsgs[idx].content);
      convMsgs[idx] = {
        role: 'user',
        content: `[System instructions]\n${systemPrompt}\n\n[User message]\n${oldContent}`,
      };
    }
  }

  const baseUrl = (provider?.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic').replace(/\/$/, '');
  const model = provider?.ANTHROPIC_MODEL || 'deepseek-v4-pro[1m]';
  const apiKey = provider?.ANTHROPIC_AUTH_TOKEN || '';

  if (!apiKey) { res.status(400).json({ error: 'ANTHROPIC_AUTH_TOKEN 未配置' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'system', subtype: 'init', model, provider_url: baseUrl, tools: (tools || []).map(t => t.name) });

  const startTime = Date.now();
  let totalTokens = { input: 0, output: 0 };
  let allText = '';
  const customTools = loadCustomTools();
  const MAX_LOOPS = 10;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    console.log(`[chat] loop ${loop}, msgs=${convMsgs.length}, tools=${(tools || []).length}`);

    // 非首轮时 wait 一下
    if (loop > 0) await new Promise(r => setTimeout(r, 500));

    const apiBody: Record<string, unknown> = { model, max_tokens: 4096, stream: true, messages: convMsgs };
    if (tools?.length) {
      apiBody.tools = tools.map(t => {
        // 将简化 schema (如 { file_path: 'string' }) 转为标准 JSON Schema
        const raw = t.input_schema as Record<string, unknown>;
        const props: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [k, v] of Object.entries(raw)) {
          let typeName = String(v);
          let optional = false;
          if (typeName.endsWith('?')) { optional = true; typeName = typeName.slice(0, -1); }
          if (typeName === 'number') {
            props[k] = { type: 'number' };
          } else if (typeName === 'boolean') {
            props[k] = { type: 'boolean' };
          } else {
            props[k] = { type: 'string' };
          }
          if (!optional) required.push(k);
        }
        return {
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object',
            properties: props,
            required,
          },
        };
      });
    }

    const apiRes = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(apiBody),
    });

    if (!apiRes.ok) {
      const e = await apiRes.text();
      send({ type: 'error', message: `API ${apiRes.status}: ${e.slice(0, 300)}` });
      res.end(); return;
    }

    const reader = apiRes.body?.getReader();
    if (!reader) { send({ type: 'error', message: 'no response body' }); res.end(); return; }

    const decoder = new TextDecoder();
    let buf = '';
    const blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];
    let cur: { type: string; text?: string; id?: string; name?: string; input?: string } | null = null;
    let textOutput = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const j = line.slice(6).trim();
        if (!j || j === '[DONE]') continue;
        try {
          const ev = JSON.parse(j);
          if (ev.type === 'content_block_start') {
            cur = { type: ev.content_block?.type || 'text', id: ev.content_block?.id, name: ev.content_block?.name };
          } else if (ev.type === 'content_block_delta') {
            const d = ev.delta;
            if (d?.type === 'text_delta' && cur) {
              cur.text = (cur.text || '') + (d.text || '');
              textOutput += d.text || '';
              send({ type: 'delta', text: d.text || '', thinking: false });
            } else if (d?.type === 'thinking_delta') {
              send({ type: 'delta', text: d.thinking || '', thinking: true });
            } else if (d?.type === 'input_json_delta' && cur) {
              cur.input = (cur.input || '') + (d.partial_json || '');
            }
          } else if (ev.type === 'content_block_stop' && cur) {
            const saved: typeof blocks[0] = { type: cur.type, text: cur.text, id: cur.id, name: cur.name };
            if (cur.type === 'tool_use' && cur.input) {
              try { saved.input = JSON.parse(cur.input); } catch { saved.input = {}; }
            }
            blocks.push(saved);
            cur = null;
          } else if (ev.type === 'message_start') {
            totalTokens.input += ev.message?.usage?.input_tokens || 0;
          } else if (ev.type === 'message_delta') {
            totalTokens.output += ev.usage?.output_tokens || 0;
          }
        } catch {}
      }
    }

    allText += textOutput;
    const toolBlocks = blocks.filter(b => b.type === 'tool_use');

    if (toolBlocks.length === 0) break; // 纯文本 → 结束

    // 标准 Anthropic content 数组格式（text 用字符串，tool_use 用对象）
    const textParts = blocks.filter(b => b.type === 'text').map(b => b.text).filter(Boolean);
    const toolParts = blocks.filter(b => b.type === 'tool_use');
    if (toolParts.length === 0) {
      convMsgs.push({ role: 'assistant', content: textParts.join('\n') || '(empty)' });
    } else {
      const content: Record<string, unknown>[] = [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text });
        else if (b.type === 'thinking') content.push({ type: 'thinking', thinking: b.text || '' });
        else if (b.type === 'tool_use') {
          content.push({
            type: 'tool_use',
            id: b.id || `toolu_${Date.now()}`,
            name: b.name,
            input: b.input || {},
          });
        }
      }
      convMsgs.push({ role: 'assistant', content });
    }

    // 执行工具
    for (const tb of toolBlocks) {
      const def = (tools || []).find(t => t.name === tb.name);
      const input = tb.input || {};
      send({ type: 'delta', text: `\n🔧 ${tb.name}(${JSON.stringify(input).slice(0, 120)})\n`, thinking: false });

      // 查找 endpoint
      const ct = customTools.find(c => c.name === tb.name);
      let result = '';
      if (ct?.endpoint) {
        try {
          let url = ct.endpoint.url;
          let body = ct.endpoint.bodyTemplate || '{}';
          for (const [k, v] of Object.entries(input)) {
            url = url.replace(`{{${k}}}`, encodeURIComponent(String(v)));
            body = body.replace(`{{${k}}}`, String(v));
          }
          const r = await fetch(url, {
            method: ct.endpoint.method,
            headers: { 'Content-Type': 'application/json', ...(ct.endpoint.headers || {}) },
            body: ct.endpoint.method !== 'GET' ? body : undefined,
          });
          result = await r.text();
          console.log(`[tool] ${tb.name}: ${r.status} ${result.slice(0, 80)}`);
        } catch (e) { result = `错误: ${(e as Error).message}`; }
      } else {
        result = `[内置] ${tb.name} 已调用，参数: ${JSON.stringify(input)}`;
      }

      send({ type: 'delta', text: `📤 结果: ${result.slice(0, 200)}\n`, thinking: false });
      convMsgs.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tb.id, content: result.slice(0, 1000) }],
      });
    }
  }

  const dur = Date.now() - startTime;
  console.log(`[chat] done: ${allText.length} chars, ${dur}ms`);
  send({
    type: 'result', subtype: 'success', text: allText, duration_ms: dur,
    stop_reason: 'end_turn',
    usage: { input_tokens: totalTokens.input, output_tokens: totalTokens.output },
    model,
  });
  res.end();
});

const PORT = 3001;
app.listen(PORT, () => console.log(`[agentma] http://localhost:${PORT}`));
