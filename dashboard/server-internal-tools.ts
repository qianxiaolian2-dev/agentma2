import fs from 'node:fs';
import path from 'node:path';
import {
  createSdkMcpServer,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  getInternalToolSetting,
  listProviderProfiles,
  resolveProviderProfileForModel,
  type DatasourceRow,
  type ProviderProfileRow,
} from './server-store.ts';
import { runDatasourceQuery, serializeQueryResult, DATASOURCE_QUERY_MAX_ROWS } from './server-datasource.ts';

export type InternalToolCatalogItem = {
  id: string;
  serverName: string;
  toolName: string;
  displayName: string;
  description: string;
  category: string;
  inputSchema: Record<string, string>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

const INTERNAL_TOOL_CATALOG: InternalToolCatalogItem[] = [
  {
    id: 'model.request',
    serverName: 'model',
    toolName: 'request',
    displayName: '请求已配置模型',
    description: '调用账户中已配置、已启用的模型。支持文本请求和可选图片输入；不会接受调用方传入的 API Key 或 Base URL。',
    category: '模型',
    inputSchema: {
      model: 'string?',
      prompt: 'string',
      system: 'string?',
      imageUrl: 'string?',
      imageBase64: 'string?',
      imageMediaType: 'string?',
      maxTokens: 'number?',
      temperature: 'number?',
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    id: 'image.inspect',
    serverName: 'image',
    toolName: 'inspect',
    displayName: '识别已上传图片',
    description: '读取当前 run workspace 的 attachments 图片，调用账户中已配置、已启用的视觉模型，并返回文本识别结果。不会允许读取 attachments 之外的文件。',
    category: '模型',
    inputSchema: {
      imagePath: 'string?',
      imagePaths: 'string[]?',
      path: 'string?',
      paths: 'string[]?',
      prompt: 'string?',
      model: 'string?',
      maxTokens: 'number?',
      temperature: 'number?',
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    id: 'datasource.list_datasources',
    serverName: 'datasource',
    toolName: 'list_datasources',
    displayName: '列出数据源',
    description: '列出当前运行可查询的数据源及其表结构。',
    category: '数据源',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    id: 'datasource.query_datasource',
    serverName: 'datasource',
    toolName: 'query_datasource',
    displayName: '查询数据源',
    description: `对当前运行开放的数据源执行只读 SQL(SQLite 方言)，最多返回 ${DATASOURCE_QUERY_MAX_ROWS} 行。`,
    category: '数据源',
    inputSchema: { datasourceId: 'string', sql: 'string' },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export function listInternalTools() {
  return INTERNAL_TOOL_CATALOG;
}

const MODEL_REQUEST_TIMEOUT_MS = 60_000;
const MODEL_REQUEST_DEFAULT_MAX_TOKENS = 2048;
const MODEL_REQUEST_MAX_TOKENS = 8192;
const MODEL_REQUEST_MAX_OUTPUT_CHARS = 24_000;
const IMAGE_INSPECT_MAX_FILES = 4;
const IMAGE_INSPECT_MAX_BYTES = 8 * 1024 * 1024;

const IMAGE_MEDIA_TYPES_BY_EXT: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

type ModelRequestImageInput = {
  data: string;
  mediaType: string;
};

type ModelRequestArgs = {
  model?: string;
  prompt: string;
  system?: string;
  imageUrl?: string;
  imageBase64?: string;
  imageMediaType?: string;
  imageInputs?: ModelRequestImageInput[];
  maxTokens?: number;
  temperature?: number;
};

type ImageInspectArgs = {
  model?: string;
  prompt?: string;
  imagePath?: string;
  imagePaths?: string[];
  path?: string;
  paths?: string[];
  maxTokens?: number;
  temperature?: number;
};

type ResolvedWorkspaceImage = ModelRequestImageInput & {
  relativePath: string;
  size: number;
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBase64ImageData(value: string) {
  return value.trim().replace(/^data:[^;]+;base64,/i, '').trim();
}

function buildAnthropicMessagesUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://api.anthropic.com/v1/messages';
  if (/\/v1\/messages$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function extractModelResponseText(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('\n');
}

function summarizeHtmlModelResponse(raw: string, contentType: string) {
  const trimmed = raw.trim();
  if (!/html/i.test(contentType) && !/^<!doctype html/i.test(trimmed) && !/^<html[\s>]/i.test(trimmed)) return '';
  const title = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  return [
    '模型网关返回了 HTML 页面而不是 JSON 响应。',
    title ? `页面标题: ${title}。` : '',
    '请检查 provider profile 的 Base URL 是否是 Anthropic-compatible API endpoint，而不是网页地址；也检查本机代理、Cloudflare 或网关鉴权是否拦截了请求。',
  ].filter(Boolean).join(' ');
}

function configuredModelNames(tenantId: string) {
  const profiles = listProviderProfiles(tenantId).filter((profile) => profile.enabled);
  return Array.from(new Set(profiles.flatMap((profile) => profile.availableModels)
    .map((model) => model.trim())
    .filter(Boolean)));
}

function defaultModelFromInternalToolSetting(tenantId: string, toolId: string) {
  const value = getInternalToolSetting(tenantId, toolId)?.settings?.defaultModel;
  return typeof value === 'string' ? value.trim() : '';
}

function buildModelSchema(tenantId: string) {
  const models = configuredModelNames(tenantId);
  const modelSchema = models.length
    ? z.enum(models as [string, ...string[]]).optional().describe(`账户已启用的模型名之一: ${models.join(', ')}`)
    : z.string().optional().describe('账户已启用的模型名；当前账户没有可枚举模型');
  const modelHint = models.length ? `可用模型: ${models.join(', ')}` : '当前账户没有已启用模型。';
  return { modelSchema, modelHint };
}

async function requestConfiguredModel(tenantId: string, args: ModelRequestArgs, defaultModel: string) {
  const model = String(args.model || defaultModel || '').trim();
  const prompt = String(args.prompt || '').trim();
  if (!model) throw new Error('model 不能为空；请在工具页配置默认模型，或调用工具时传入账户已配置模型名');
  if (!prompt) throw new Error('prompt 不能为空');

  const profile = resolveProviderProfileForModel(tenantId, model);
  if (!profile || !profile.enabled) {
    throw new Error(`模型未在当前账户中启用或配置: ${model}`);
  }
  if (!profile.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(`模型 ${model} 所属供应商未配置 API Key`);
  }

  const content: Array<Record<string, unknown>> = [];
  for (const image of args.imageInputs || []) {
    const data = normalizeBase64ImageData(String(image.data || ''));
    if (!data) continue;
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: String(image.mediaType || 'image/png').trim() || 'image/png',
        data,
      },
    });
  }
  const imageUrl = String(args.imageUrl || '').trim();
  if (imageUrl) {
    content.push({ type: 'image', source: { type: 'url', url: imageUrl } });
  }
  const imageBase64 = normalizeBase64ImageData(String(args.imageBase64 || ''));
  if (imageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: String(args.imageMediaType || 'image/png').trim() || 'image/png',
        data: imageBase64,
      },
    });
  }
  content.push({ type: 'text', text: prompt });

  const body: Record<string, unknown> = {
    model,
    max_tokens: clampNumber(args.maxTokens, MODEL_REQUEST_DEFAULT_MAX_TOKENS, 1, MODEL_REQUEST_MAX_TOKENS),
    messages: [{ role: 'user', content }],
  };
  const system = String(args.system || '').trim();
  if (system) body.system = system;
  if (args.temperature !== undefined) body.temperature = clampNumber(args.temperature, 0.2, 0, 1);

  const response = await fetchAnthropicCompatible(profile, body);
  const text = extractModelResponseText(response);
  return {
    provider: profile.name,
    model,
    text: text || JSON.stringify(response),
  };
}

async function fetchAnthropicCompatible(profile: ProviderProfileRow, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(buildAnthropicMessagesUrl(profile.ANTHROPIC_BASE_URL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': profile.ANTHROPIC_AUTH_TOKEN,
        authorization: `Bearer ${profile.ANTHROPIC_AUTH_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    const htmlError = summarizeHtmlModelResponse(raw, res.headers.get('content-type') || '');
    if (htmlError) {
      throw new Error(res.ok ? htmlError : `模型请求失败 HTTP ${res.status}: ${htmlError}`);
    }
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      const message = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      throw new Error(`模型请求失败 HTTP ${res.status}: ${message.slice(0, 1200)}`);
    }
    return parsed;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`模型请求超时(${MODEL_REQUEST_TIMEOUT_MS / 1000}s)`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function collectImageInspectPaths(args: ImageInspectArgs) {
  const values: string[] = [];
  for (const value of [args.imagePath, args.path]) {
    if (typeof value === 'string' && value.trim()) values.push(value.trim());
  }
  for (const list of [args.imagePaths, args.paths]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value === 'string' && value.trim()) values.push(value.trim());
    }
  }
  const deduped = Array.from(new Set(values));
  if (!deduped.length) throw new Error('imagePath 不能为空；请传 attachments/... 图片路径');
  if (deduped.length > IMAGE_INSPECT_MAX_FILES) throw new Error(`一次最多识别 ${IMAGE_INSPECT_MAX_FILES} 张图片`);
  return deduped;
}

function resolveAttachmentImagePath(cwd: string, rawPath: string) {
  const value = rawPath.trim();
  if (/^file:/i.test(value)) {
    throw new Error('请传 workspace 相对路径，例如 attachments/image.png，不要传 file:// URL');
  }
  if (value.includes('\0')) throw new Error('图片路径无效');

  const attachmentsRoot = path.resolve(cwd, 'attachments');
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(cwd, value));
  if (resolved !== attachmentsRoot && !resolved.startsWith(`${attachmentsRoot}${path.sep}`)) {
    throw new Error(`只允许识别当前 workspace 的 attachments 目录图片: ${rawPath}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mediaType = IMAGE_MEDIA_TYPES_BY_EXT[ext];
  if (!mediaType) throw new Error(`不支持的图片格式: ${ext || 'unknown'}`);

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`图片路径不是文件: ${rawPath}`);
  if (stat.size > IMAGE_INSPECT_MAX_BYTES) {
    throw new Error(`图片过大: ${rawPath} (${stat.size} bytes)，最大 ${IMAGE_INSPECT_MAX_BYTES} bytes`);
  }

  return {
    resolved,
    relativePath: path.relative(cwd, resolved).replace(/\\/g, '/'),
    mediaType,
    size: stat.size,
  };
}

function readWorkspaceImages(cwd: string, args: ImageInspectArgs): ResolvedWorkspaceImage[] {
  return collectImageInspectPaths(args).map((rawPath) => {
    const file = resolveAttachmentImagePath(cwd, rawPath);
    return {
      relativePath: file.relativePath,
      mediaType: file.mediaType,
      size: file.size,
      data: fs.readFileSync(file.resolved).toString('base64'),
    };
  });
}

async function inspectWorkspaceImages(tenantId: string, cwd: string, args: ImageInspectArgs, defaultModel: string) {
  const images = readWorkspaceImages(cwd, args);
  const imageList = images.map((image, index) => (
    `${index + 1}. ${image.relativePath} (${image.mediaType}, ${image.size} bytes)`
  )).join('\n');
  const userPrompt = String(args.prompt || '').trim() || '请识别图片中的可见内容，提取文字、界面结构、关键对象和不确定项。';
  const result = await requestConfiguredModel(tenantId, {
    model: args.model,
    prompt: [
      '你是 AgentMa 的图片识别工具。请只基于图片中可见内容回答。',
      '',
      '本地附件路径:',
      imageList,
      '',
      '识别要求:',
      userPrompt,
    ].join('\n'),
    imageInputs: images.map((image) => ({ data: image.data, mediaType: image.mediaType })),
    maxTokens: args.maxTokens,
    temperature: args.temperature,
  }, defaultModel);
  return {
    ...result,
    images: images.map((image) => ({
      path: image.relativePath,
      mediaType: image.mediaType,
      size: image.size,
    })),
  };
}

export function buildModelRequestMcp(tenantId: string) {
  const { modelSchema, modelHint } = buildModelSchema(tenantId);
  const defaultModel = defaultModelFromInternalToolSetting(tenantId, 'model.request');
  const defaultModelHint = defaultModel ? `默认模型: ${defaultModel}。` : '尚未配置默认模型；调用时必须传 model。';
  return createSdkMcpServer({
    name: 'model',
    version: '1.0.0',
    tools: [
      tool(
        'request',
        `调用账户已配置的模型执行一次文本或图片分析请求。model 可选；未传时使用工具页配置的默认模型。model 必须是账户中已启用 profile 的模型名；不要传 API Key/Base URL。${defaultModelHint}${modelHint}`,
        {
          model: modelSchema,
          prompt: z.string(),
          system: z.string().optional(),
          imageUrl: z.string().optional(),
          imageBase64: z.string().optional(),
          imageMediaType: z.string().optional(),
          maxTokens: z.number().optional(),
          temperature: z.number().optional(),
        },
        async (args: ModelRequestArgs) => {
          try {
            const result = await requestConfiguredModel(tenantId, args, defaultModel);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result).slice(0, MODEL_REQUEST_MAX_OUTPUT_CHARS),
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text', text: `err: ${(error as Error).message}` }], isError: true };
          }
        },
      ),
    ],
  });
}

export function buildImageInspectMcp(tenantId: string, cwd: string, preferredDefaultModel = '') {
  const { modelSchema, modelHint } = buildModelSchema(tenantId);
  const defaultModel = defaultModelFromInternalToolSetting(tenantId, 'image.inspect')
    || preferredDefaultModel.trim();
  const defaultModelHint = defaultModel ? `默认模型: ${defaultModel}。` : '尚未配置默认模型；调用时必须传 model。';
  return createSdkMcpServer({
    name: 'image',
    version: '1.0.0',
    tools: [
      tool(
        'inspect',
        `读取当前 run workspace 的 attachments 图片并调用已配置视觉模型识别，返回文本结果。请传 imagePath 或 imagePaths，路径应类似 attachments/xxx.png；不要传 file:// 或 base64。model 可选；未传时使用工具页配置的默认模型。${defaultModelHint}${modelHint}`,
        {
          imagePath: z.string().optional().describe('单张图片路径，例如 attachments/image.png'),
          imagePaths: z.array(z.string()).optional().describe(`多张图片路径，一次最多 ${IMAGE_INSPECT_MAX_FILES} 张`),
          path: z.string().optional().describe('imagePath 的兼容别名'),
          paths: z.array(z.string()).optional().describe('imagePaths 的兼容别名'),
          prompt: z.string().optional().describe('希望视觉模型重点识别的内容'),
          model: modelSchema,
          maxTokens: z.number().optional(),
          temperature: z.number().optional(),
        },
        async (args: ImageInspectArgs) => {
          try {
            const result = await inspectWorkspaceImages(tenantId, cwd, args, defaultModel);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result).slice(0, MODEL_REQUEST_MAX_OUTPUT_CHARS),
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text', text: `err: ${(error as Error).message}` }], isError: true };
          }
        },
      ),
    ],
  });
}

// in-process 跑在服务进程里(受信代码)，agent(沙箱内)只能拿到查询结果，
// 摸不到 SQLite 文件本身。只读保证见 server-datasource.ts。
export function buildDatasourceMcp(datasources: DatasourceRow[]) {
  if (!datasources.length) return null;
  const byId = new Map(datasources.map((source) => [source.id, source]));
  const summarize = (source: DatasourceRow) => ({
    id: source.id,
    name: source.name,
    tables: source.tables.map((table) => ({
      name: table.name,
      rowCount: table.rowCount,
      columns: table.columns.map((column) => `${column.name} ${column.type}`.trim()),
    })),
  });
  return createSdkMcpServer({
    name: 'datasource',
    version: '1.0.0',
    tools: [
      tool(
        'list_datasources',
        '列出当前可查询的数据源及其表结构(表名、行数、列名/类型)。',
        {},
        async () => ({
          content: [{ type: 'text', text: JSON.stringify(datasources.map(summarize)) }],
        }),
      ),
      tool(
        'query_datasource',
        `对指定数据源执行只读 SQL(SQLite 方言)。只允许单条 SELECT/WITH;结果最多返回 ${DATASOURCE_QUERY_MAX_ROWS} 行,聚合请在 SQL 内完成。`,
        { datasourceId: z.string(), sql: z.string() },
        async (args: { datasourceId: string; sql: string }) => {
          const source = byId.get(String(args.datasourceId || '').trim());
          if (!source) {
            return { content: [{ type: 'text', text: `err: 数据源不存在或未对本次运行开放: ${args.datasourceId}` }], isError: true };
          }
          try {
            const result = runDatasourceQuery(source.path, String(args.sql || ''));
            return { content: [{ type: 'text', text: serializeQueryResult(result) }] };
          } catch (error) {
            return { content: [{ type: 'text', text: `err: ${(error as Error).message}` }], isError: true };
          }
        },
      ),
    ],
  });
}
