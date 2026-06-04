/* agentma console runtime API bridge */
(function () {
  const DEFAULT_PROVIDER = {
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_MODEL: '',
  };
  const LS_PROVIDER = 'agentma_provider_config';
  const LS_PROVIDER_PROFILES = 'agentma_provider_profiles';

  function getToken() {
    return localStorage.getItem('agentma_jwt') || localStorage.getItem('agentma_api_key') || '';
  }

  function setJwt(token) {
    localStorage.setItem('agentma_jwt', token);
    localStorage.removeItem('agentma_api_key');
  }

  function clearAuth() {
    localStorage.removeItem('agentma_jwt');
    localStorage.removeItem('agentma_api_key');
    localStorage.removeItem('agentma_user');
  }

  function authHeaders(extra) {
    const token = getToken();
    return token ? { ...(extra || {}), Authorization: `Bearer ${token}` } : (extra || {});
  }

  async function readJson(response) {
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text.slice(0, 200) };
      }
    }
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  async function api(path, init) {
    return readJson(await fetch(path, {
      ...(init || {}),
      headers: authHeaders(init && init.headers),
    }));
  }

  function loadProvider() {
    try {
      return { ...DEFAULT_PROVIDER, ...JSON.parse(localStorage.getItem(LS_PROVIDER) || '{}') };
    } catch {
      return { ...DEFAULT_PROVIDER };
    }
  }

  function saveProvider(provider) {
    const next = { ...DEFAULT_PROVIDER, ...(provider || {}) };
    localStorage.setItem(LS_PROVIDER, JSON.stringify(next));
    return next;
  }

  function trimString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function splitAvailableModels(value) {
    return String(value || '')
      .split(/[\s,，]+/)
      .map(model => model.trim())
      .filter(model => model && !model.includes('*'));
  }

  function normalizeAvailableModels(seed) {
    const values = [];
    const addModel = (value) => {
      const model = trimString(value);
      if (model && !model.includes('*')) values.push(model);
    };
    if (Array.isArray(seed?.availableModels)) {
      seed.availableModels.forEach(addModel);
    }
    if (typeof seed?.modelPatterns === 'string') {
      values.push(...splitAvailableModels(seed.modelPatterns));
    }
    addModel(seed?.ANTHROPIC_MODEL);
    return Array.from(new Set(values));
  }

  function createProviderProfile(seed) {
    const now = Date.now();
    const source = seed || {};
    return {
      ANTHROPIC_AUTH_TOKEN: trimString(source.ANTHROPIC_AUTH_TOKEN) || DEFAULT_PROVIDER.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL: trimString(source.ANTHROPIC_BASE_URL) || DEFAULT_PROVIDER.ANTHROPIC_BASE_URL,
      id: trimString(source.id) || `provider-${now}`,
      name: trimString(source.name) || '默认供应商',
      availableModels: normalizeAvailableModels(source),
      enabled: source.enabled !== false,
      isDefault: source.isDefault === true,
      createdAt: Number(source.createdAt || now),
      updatedAt: Number(source.updatedAt || now),
    };
  }

  function defaultProfileFromLegacy() {
    const legacy = loadProvider();
    return createProviderProfile({
      ANTHROPIC_AUTH_TOKEN: legacy.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_BASE_URL: legacy.ANTHROPIC_BASE_URL,
      availableModels: legacy.ANTHROPIC_MODEL ? [legacy.ANTHROPIC_MODEL] : [],
      id: 'provider-default',
      name: '默认供应商',
      enabled: true,
      isDefault: true,
    });
  }

  function loadProviderProfiles() {
    try {
      const raw = localStorage.getItem(LS_PROVIDER_PROFILES);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const profiles = parsed
          .filter(item => item && typeof item === 'object')
          .map(createProviderProfile);
        if (profiles.length) return profiles;
      }
    } catch {}
    return [defaultProfileFromLegacy()];
  }

  function providerToEnv(profile, model) {
    return {
      ANTHROPIC_AUTH_TOKEN: trimString(profile?.ANTHROPIC_AUTH_TOKEN),
      ANTHROPIC_BASE_URL: trimString(profile?.ANTHROPIC_BASE_URL) || DEFAULT_PROVIDER.ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL: trimString(model),
    };
  }

  function providerMatchesModel(profile, model) {
    if (!trimString(model)) return profile?.isDefault === true;
    const normalizedModel = trimString(model).toLowerCase();
    return (profile?.availableModels || [])
      .map(value => trimString(value).toLowerCase())
      .filter(Boolean)
      .some(candidate => candidate === normalizedModel);
  }

  function resolveProviderForModel(model) {
    const profiles = loadProviderProfiles();
    const enabled = profiles.filter(profile => profile.enabled);
    const usable = enabled.length ? enabled : profiles;
    const matched = usable.find(profile => providerMatchesModel(profile, model || ''));
    const selected = matched
      || usable.find(profile => profile.isDefault)
      || usable[0]
      || defaultProfileFromLegacy();
    return {
      provider: providerToEnv(selected, model),
      matched: Boolean(matched || (!trimString(model) && selected?.isDefault)),
    };
  }

  function withProviderFallback(primary, fallback) {
    return {
      ANTHROPIC_AUTH_TOKEN: trimString(primary?.ANTHROPIC_AUTH_TOKEN) || trimString(fallback?.ANTHROPIC_AUTH_TOKEN),
      ANTHROPIC_BASE_URL: trimString(primary?.ANTHROPIC_BASE_URL) || trimString(fallback?.ANTHROPIC_BASE_URL) || DEFAULT_PROVIDER.ANTHROPIC_BASE_URL,
      ANTHROPIC_MODEL: trimString(primary?.ANTHROPIC_MODEL),
    };
  }

  function relativeTime(ts) {
    const value = Number(ts || 0);
    if (!value) return '刚刚';
    const diff = Math.max(0, Date.now() - value);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
    return `${Math.floor(diff / day)} 天前`;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
  }

  function mapAgent(raw, index) {
    const tools = normalizeArray(raw.tools);
    return {
      id: String(raw.id || `agent-${index}`),
      name: String(raw.name || `Agent ${index + 1}`),
      desc: String(raw.description || raw.systemPrompt || '未填写描述'),
      model: String(raw.model || ''),
      tools: tools.length ? tools : ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
      skills: normalizeArray(raw.skills),
      mcp: normalizeArray(raw.mcpServers),
      effort: String(raw.effort || 'high'),
      perm: String(raw.permissionMode || 'default'),
      runs: Number(raw.runs || 0),
      status: 'good',
      accent: index === 0,
      raw,
    };
  }

  function mapMessage(message) {
    return {
      role: message.role,
      text: String(message.content || ''),
      timestamp: Number(message.timestamp || Date.now()),
    };
  }

  function mapSession(raw, agentById) {
    const messages = Array.isArray(raw.messages) ? raw.messages.map(mapMessage) : [];
    const agent = agentById.get(raw.templateId);
    return {
      id: String(raw.id || crypto.randomUUID()),
      title: String(raw.title || messages[0]?.text?.slice(0, 40) || '新对话'),
      agent: agent?.name || String(raw.templateId || 'Agent'),
      msgs: messages.length,
      when: relativeTime(raw.updatedAt || raw.createdAt),
      pinned: raw.pinned === true,
      status: 'good',
      templateId: String(raw.templateId || agent?.id || ''),
      model: String(raw.model || agent?.model || ''),
      sdkSessionId: raw.sdkSessionId || '',
      sdkCwd: raw.sdkCwd || '',
      messages,
      raw,
    };
  }

  function messagesForApi(messages) {
    return messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.text || '' }));
  }

  function toStoredMessages(messages) {
    return messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role,
        content: message.text || '',
        timestamp: Number(message.timestamp || Date.now()),
      }));
  }

  async function hydrateData(D) {
    const me = await api('/api/auth/me');
    const user = {
      name: me.name || me.email || 'AgentMa',
      email: me.email || '',
      initial: (me.name || me.email || 'A').trim().slice(0, 1).toUpperCase(),
      tenant: me.tenantName || me.tenantId || '',
      plan: me.role || '',
      role: me.role || '',
      tenantId: me.tenantId || '',
    };
    localStorage.setItem('agentma_user', JSON.stringify({
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      role: user.role,
    }));
    D.user = user;

    const [agentsResult, sessionsResult, usageResult, hooksResult, permsResult, knowledgeResult] = await Promise.allSettled([
      api('/api/agents'),
      api('/api/chat-sessions'),
      api('/api/quota/usage'),
      api('/api/hook-rules'),
      api('/api/permission-rules'),
      api('/api/knowledge/sources'),
    ]);

    if (agentsResult.status === 'fulfilled' && Array.isArray(agentsResult.value) && agentsResult.value.length) {
      D.agents = agentsResult.value.map(mapAgent);
    }
    D.agentTemplates = Object.fromEntries((D.agents || []).map((agent) => [agent.id, agent.raw || agent]));
    const agentById = new Map((D.agents || []).map((agent) => [agent.id, agent]));

    if (sessionsResult.status === 'fulfilled' && Array.isArray(sessionsResult.value)) {
      D.sessions = sessionsResult.value.map((session) => mapSession(session, agentById));
      D.activeSessionId = D.sessions[0]?.id || '';
      D.transcript = D.sessions[0]?.messages?.length ? D.sessions[0].messages : [];
    }

    if (usageResult.status === 'fulfilled' && usageResult.value?.usage) {
      const usage = usageResult.value.usage;
      D.runtimeUsage = usage;
      D.runStats = {
        cost: Number(usage.totalCostUsd || 0).toFixed(3),
        dur: Math.round(Number(usage.totalDurationMs || 0) / 1000),
        inTok: String(usage.totalInputTokens || 0),
        outTok: String(usage.totalOutputTokens || 0),
      };
    }

    if (hooksResult.status === 'fulfilled' && Array.isArray(hooksResult.value) && hooksResult.value.length) {
      D.hooks = hooksResult.value.map((hook) => ({
        event: hook.eventName || hook.event || 'Hook',
        cat: hook.action || 'hook',
        desc: hook.ruleContent || hook.matcher || '',
        script: hook.message || hook.ruleContent || '已配置',
        on: hook.enabled !== false,
        runs: 0,
      }));
    }

    if (permsResult.status === 'fulfilled' && Array.isArray(permsResult.value) && permsResult.value.length) {
      D.perms = permsResult.value.map((rule) => ({
        rule: rule.toolName || rule.ruleContent || 'Rule',
        mode: rule.behavior || 'ask',
        note: rule.ruleContent || '',
      }));
    }

    if (knowledgeResult.status === 'fulfilled' && Array.isArray(knowledgeResult.value)) {
      D.knowledgeSources = knowledgeResult.value;
    }

    return D;
  }

  function renderAuth(message) {
    const app = document.getElementById('app');
    app.className = 'auth-shell';
    app.innerHTML = `
      <section class="card card-pad auth-card">
        <div class="row" style="gap:12px;margin-bottom:18px">
          <span class="mark" style="width:46px;height:46px">${window.mascot ? mascot('head') : ''}</span>
          <div class="col" style="gap:2px">
            <span class="word" style="font-size:22px">agentma</span>
            <span class="mono ghost" style="font-size:11px;letter-spacing:.16em">CONSOLE LOGIN</span>
          </div>
        </div>
        ${message ? `<div class="attn attn-bad" style="margin-bottom:14px">${message}</div>` : ''}
        <label class="field"><span class="field-label">邮箱</span><input class="input" id="auth-email" autocomplete="email" /></label>
        <label class="field"><span class="field-label">密码</span><input class="input" id="auth-password" type="password" autocomplete="current-password" /></label>
        <label class="field"><span class="field-label">名称</span><input class="input" id="auth-name" placeholder="注册时使用，登录可留空" /></label>
        <div class="row" style="gap:10px;margin-top:12px">
          <button class="btn btn-primary btn-squiggle" id="auth-login" style="flex:1;justify-content:center">登录</button>
          <button class="btn btn-ghost" id="auth-register" style="flex:1;justify-content:center">注册</button>
        </div>
      </section>`;
    document.getElementById('auth-login').addEventListener('click', () => submitAuth('login'));
    document.getElementById('auth-register').addEventListener('click', () => submitAuth('register'));
    document.getElementById('auth-password').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitAuth('login');
    });
  }

  async function submitAuth(mode) {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value.trim() || email.split('@')[0];
    try {
      const result = await readJson(await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { name, email, password } : { email, password }),
      }));
      setJwt(result.token);
      localStorage.setItem('agentma_user', JSON.stringify({
        email: result.email,
        name: result.name,
        tenantId: result.tenantId,
        role: result.role,
      }));
      location.href = '/';
    } catch (error) {
      renderAuth(error.message || '认证失败');
    }
  }

  async function ensureAuthenticated() {
    if (!getToken()) {
      renderAuth('');
      return false;
    }
    try {
      await api('/api/auth/me');
      return true;
    } catch {
      clearAuth();
      renderAuth('登录已失效，请重新登录');
      return false;
    }
  }

  async function saveChatSession(session, agent, messages, result) {
    const storedMessages = toStoredMessages(messages);
    const response = await api('/api/chat-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: session?.id,
        title: session?.title || storedMessages[0]?.content?.slice(0, 40) || '新对话',
        templateId: agent.id,
        model: agent.model,
        messages: storedMessages,
        sdkSessionId: result?.sdkSessionId || session?.sdkSessionId,
        sdkCwd: result?.sdkCwd || session?.sdkCwd,
      }),
    });
    return response;
  }

  async function streamChat({ agent, session, messages, onDelta, onResult, onError }) {
    const template = agent.raw || {};
    const model = agent.model || template.model || '';
    const resolved = resolveProviderForModel(model);
    const provider = resolved.matched
      ? withProviderFallback(resolved.provider, template.providerOverrides || {})
      : withProviderFallback(template.providerOverrides || {}, resolved.provider);
    provider.ANTHROPIC_MODEL = model || provider.ANTHROPIC_MODEL;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: messagesForApi(messages),
          systemPrompt: template.systemPrompt || undefined,
          model: agent.model || template.model || '',
          provider,
          providerProfiles: loadProviderProfiles(),
          tools: (agent.tools || []).map((name) => ({ name })),
        subagents: template.subagents || {},
        skills: template.skills || agent.skills || [],
        enableFileCheckpointing: template.enableFileCheckpointing || undefined,
        useKnowledge: template.useKnowledge || undefined,
        knowledgeSourceIds: template.knowledgeSourceIds || [],
        outputSchema: template.outputSchema || undefined,
        sdkSessionId: session?.sdkSessionId,
        sdkCwd: session?.sdkCwd,
      }),
    });
    if (!response.ok) {
      const data = await readJson(response).catch((error) => ({ error: error.message }));
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const reader = response.body && response.body.getReader();
    if (!reader) throw new Error('响应体为空');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let result = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'delta') {
            text += event.text || '';
            onDelta(text, event);
          } else if (event.type === 'result') {
            result = event;
            onResult(text || event.text || '', event);
          } else if (event.type === 'error') {
            onError(event.message || '运行失败');
          } else if (event.type === 'permission_request') {
            onDelta(`${text}\n\n[权限请求] ${event.toolName || event.displayName || 'tool'}`, event);
          } else if (event.type === 'ask_user_question') {
            onDelta(`${text}\n\n[需要回答] ${(event.questions || []).join(' / ')}`, event);
          }
        } catch {}
      }
    }
    return { text, result };
  }

  window.AgentMaApi = {
    api,
    ensureAuthenticated,
    hydrateData,
    loadProvider,
    saveProvider,
    saveChatSession,
    streamChat,
    logout() {
      clearAuth();
      location.href = '/';
    },
  };
})();
