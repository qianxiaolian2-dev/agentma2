import type {
  SDKMessage, SdkOptions, SDKSessionInfo, SessionMessage,
  McpServerStatus, HookEvent, HookCallbackMatcher,
  AgentDefinition, PermissionMode, PermissionResult,
  TodoItem, FileCheckpoint, RateLimitInfo,
} from './types';
import {
  generateStreamSequence, generateMockSessions, generateMockMessages,
  MOCK_MCP_SERVERS, generateMockSubagents, generateMockTodos,
  generateMockCheckpoints, generateMockRateLimit,
  generateHookLog,
} from './mock-data';

// SDK 模拟器 —— 模拟 query() 和所有 SDK 操作
class SdkSimulator {
  private sessions: SDKSessionInfo[] = generateMockSessions();
  private mcpServers: McpServerStatus[] = [...MOCK_MCP_SERVERS];
  private subagents: AgentDefinition[] = generateMockSubagents();
  private todos: TodoItem[] = generateMockTodos();
  private checkpoints: FileCheckpoint[] = generateMockCheckpoints();
  private rateLimit: RateLimitInfo = generateMockRateLimit();
  private hookConfigs: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  private hookLogs: Array<{ event: HookEvent; input: Record<string, unknown>; output: Record<string, unknown>; timestamp: number }> = [];
  private permissionMode: PermissionMode = 'default';
  private currentModel = 'claude-sonnet-4-6';
  private maxThinkingTokens = 0;
  private connected = false;
  private listeners: Set<(msg: SDKMessage) => void> = new Set();

  // --- query() —— 核心接口 ---
  async *query(prompt: string, options?: SdkOptions): AsyncGenerator<SDKMessage> {
    this.connected = true;
    const model = options?.model || this.currentModel;
    const messages = generateStreamSequence(prompt, model);

    if (options?.includeHookEvents) {
      yield* this.injectHookEvents(messages);
    } else {
      for (const msg of messages) {
        await this.delay(msg.type === 'assistant' ? 800 : 200);
        this.listeners.forEach(fn => fn(msg));
        yield msg;
      }
    }
  }

  private async *injectHookEvents(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
    for (const msg of messages) {
      await this.delay(600);
      if (msg.type === 'assistant' && msg.message) {
        // 注入 PreToolUse hook
        const hookMsg: SDKMessage = {
          type: 'hook_started',
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          uuid: `hook-${Date.now()}`,
          session_id: msg.session_id,
        };
        this.listeners.forEach(fn => fn(hookMsg));
        yield hookMsg;
      }
      this.listeners.forEach(fn => fn(msg));
      yield msg;
    }
  }

  // --- startup() —— 预热 ---
  async startup(): Promise<{ ready: boolean; warmupMs: number }> {
    const start = Date.now();
    await this.delay(1200);
    return { ready: true, warmupMs: Date.now() - start };
  }

  // --- 会话管理 ---
  async listSessions(): Promise<SDKSessionInfo[]> {
    await this.delay(300);
    return [...this.sessions];
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    await this.delay(200);
    return generateMockMessages(sessionId);
  }

  async getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined> {
    await this.delay(100);
    return this.sessions.find(s => s.sessionId === sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.delay(150);
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (session) session.customTitle = title;
  }

  async tagSession(sessionId: string, tag: string | null): Promise<void> {
    await this.delay(100);
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (session) session.tag = tag ?? undefined;
  }

  // --- ClaudeSDKClient 操作 ---
  async connect(): Promise<void> {
    await this.delay(500);
    this.connected = true;
  }

  async interrupt(): Promise<void> {
    this.listeners.forEach(fn => fn({ type: 'status', status: 'interrupted' }));
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  // --- 权限 ---
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    this.listeners.forEach(fn => fn({
      type: 'system', subtype: 'permission_change',
      permission_mode: mode,
    }));
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  async simulateCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    behavior: 'allow' | 'deny' = 'allow'
  ): Promise<PermissionResult> {
    await this.delay(100);
    if (behavior === 'deny') {
      return { behavior: 'deny', message: `用户拒绝了工具 ${toolName} 的调用`, interrupt: true };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  // --- 模型 ---
  setModel(model: string): void {
    this.currentModel = model;
  }

  getModel(): string {
    return this.currentModel;
  }

  setMaxThinkingTokens(tokens: number | null): void {
    this.maxThinkingTokens = tokens ?? 0;
  }

  getMaxThinkingTokens(): number {
    return this.maxThinkingTokens;
  }

  // --- MCP 服务器 ---
  getMcpStatus(): McpServerStatus[] {
    return [...this.mcpServers];
  }

  async reconnectMcpServer(name: string): Promise<void> {
    await this.delay(800);
    const srv = this.mcpServers.find(s => s.name === name);
    if (srv) srv.status = 'connected';
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    await this.delay(300);
    const srv = this.mcpServers.find(s => s.name === name);
    if (srv) srv.status = enabled ? 'connected' : 'disabled';
  }

  async addMcpServer(name: string, _config: Record<string, unknown>): Promise<void> {
    await this.delay(400);
    this.mcpServers.push({
      name,
      status: 'pending',
      serverInfo: { name, version: '0.1.0' },
      tools: [],
    });
  }

  // --- 子代理 ---
  getSubagents(): AgentDefinition[] {
    return [...this.subagents];
  }

  async stopSubagentTask(_taskId: string): Promise<void> {
    await this.delay(200);
  }

  // --- 任务管理 ---
  getTodos(): TodoItem[] {
    return [...this.todos];
  }

  async createTodo(subject: string, description: string): Promise<TodoItem> {
    await this.delay(100);
    const todo: TodoItem = { id: `todo-${Date.now()}`, subject, description, status: 'pending' };
    this.todos.push(todo);
    return todo;
  }

  async updateTodoStatus(id: string, status: TodoItem['status']): Promise<void> {
    await this.delay(100);
    const todo = this.todos.find(t => t.id === id);
    if (todo) todo.status = status;
  }

  // --- Hook 系统 ---
  configureHooks(config: Partial<Record<HookEvent, HookCallbackMatcher[]>>): void {
    this.hookConfigs = config;
  }

  getHookConfigs(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return { ...this.hookConfigs };
  }

  async triggerHook(event: HookEvent, toolName?: string): Promise<{ event: HookEvent; input: Record<string, unknown>; output: Record<string, unknown> }> {
    await this.delay(300);
    const log = generateHookLog(event, toolName);
    this.hookLogs.push(log);
    return { event: log.event, input: log.input, output: log.output };
  }

  getHookLogs() {
    return [...this.hookLogs];
  }

  clearHookLogs(): void {
    this.hookLogs = [];
  }

  // --- 文件检查点 ---
  getCheckpoints(): FileCheckpoint[] {
    return [...this.checkpoints];
  }

  // --- 速率限制 ---
  getRateLimit(): RateLimitInfo {
    return { ...this.rateLimit };
  }

  // --- 事件监听 ---
  onMessage(fn: (msg: SDKMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// 全局单例
export const sdkSimulator = new SdkSimulator();
