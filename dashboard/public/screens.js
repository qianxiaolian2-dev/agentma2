/* ════════════════════════════════════════════════════════════
   agentma · screen renderers
   window.SCREENS[route]()         -> html string
   window.SCREEN_INIT[route]()     -> post-render wiring (optional)
   window.SCREEN_ACTIONS[route]()  -> topbar action buttons html
   window.ACTION_INIT[route]()     -> wire topbar buttons (optional)
   ════════════════════════════════════════════════════════════ */
(function () {
  const D = window.DATA;
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const statusLabel = { good: '运行正常', warn: '需要留意', bad: '已拦截', idle: '空闲' };
  const dotFor = s => `<span class="dot dot-${s==='good'?'good':s==='warn'?'warn':s==='bad'?'bad':'idle'} ${s==='good'||s==='warn'||s==='bad'?'dot-live':''}"></span>`;
  const modelName = v => (D.models.find(m => m.value === v) || {}).name || v;

  window.SCREENS = {};
  window.SCREEN_INIT = {};
  window.SCREEN_ACTIONS = {};
  window.ACTION_INIT = {};

  /* ───────────────────────── OVERVIEW ───────────────────────── */
  SCREENS.overview = function () {
    const kpis = [
      { num: '7', unit: '', label: 'AGENT 在岗', sub: '6 正常 · 1 已拦截', tone: 'good' },
      { num: '1.2', unit: 'k', label: '今日运行', sub: '+18% 较昨日', tone: 'accent' },
      { num: '4.81', unit: '$', label: '今日花费', sub: '预算 $20 · 24%', tone: 'ink' },
      { num: '3', unit: '', label: '待你审批', sub: '2 权限 · 1 提问', tone: 'warn' },
    ];
    return `
    <div class="ov-grid">
      <section class="ov-kpis">
        ${kpis.map(k => `
          <div class="card card-pad kpi-card">
            <div class="kpi-label">${k.label}</div>
            <div class="kpi-num" style="${k.tone==='accent'?'color:var(--accent)':k.tone==='warn'?'color:var(--warn)':''}">${k.num}${k.unit?`<span class="unit">${k.unit}</span>`:''}</div>
            <div class="muted" style="font-size:13px;font-family:var(--mono)">${k.sub}</div>
          </div>`).join('')}
      </section>

      <section class="ov-main card card-pad">
        <div class="spread" style="margin-bottom:14px">
          <h2 class="section-h"><span class="section-num">01</span>最近会话</h2>
          <a class="btn btn-ghost btn-sm" href="#conversations">全部 ${icon('arrowR')}</a>
        </div>
        <div class="ov-sessions">
          ${D.sessions.slice(0,5).map(s => `
            <a class="ov-session" href="#conversations">
              ${dotFor(s.status)}
              <span class="ov-session-title">${esc(s.title)}</span>
              <span class="badge badge-maroon">${esc(s.agent)}</span>
              <span class="mono ghost" style="font-size:11px;white-space:nowrap">${s.msgs} 条 · ${s.when}</span>
            </a>`).join('')}
        </div>
      </section>

      <aside class="ov-side card card-pad">
        <h2 class="section-h" style="margin-bottom:4px"><span class="section-num">02</span>需要你过目</h2>
        <p class="muted" style="font-size:13px;margin:0 0 14px">不处理它不会自己消失。</p>

        <div class="attn attn-bad">
          <div class="row" style="gap:8px;margin-bottom:4px"><span class="dot dot-bad dot-live"></span><b class="mono" style="font-size:12px">凌晨 3:12 · 数据迁移助手</b></div>
          <div style="font-size:14.5px;line-height:1.4">它想在凌晨连<b>生产 Stripe</b>。被权限规则 <span class="mono" style="font-size:12px">deny WebFetch(*.stripe.com)</span> 拦下了。</div>
          <div class="row" style="gap:6px;margin-top:10px">
            <button class="btn btn-sm btn-ghost">查看会话</button>
            <button class="btn btn-sm">封禁 1 小时</button>
          </div>
        </div>

        <div class="attn attn-warn">
          <div class="row" style="gap:8px;margin-bottom:4px"><span class="dot dot-warn dot-live"></span><b class="mono" style="font-size:12px">权限请求 ×2 · 待批</b></div>
          <div style="font-size:14.5px;line-height:1.4"><b>测试工程师</b> 想 <span class="mono" style="font-size:12px">Write(tests/**)</span>,<b>调研员</b> 想 <span class="mono" style="font-size:12px">WebFetch</span>。</div>
          <div class="row" style="gap:6px;margin-top:10px">
            <button class="btn btn-sm btn-primary">逐个审批</button>
            <button class="btn btn-sm btn-ghost">全部放行</button>
          </div>
        </div>
      </aside>

      <section class="ov-roster card card-pad">
        <div class="spread" style="margin-bottom:14px">
          <h2 class="section-h"><span class="section-num">03</span>Agent 花名册</h2>
          <a class="btn btn-ghost btn-sm" href="#agents">Agent 市场 ${icon('arrowR')}</a>
        </div>
        <div class="roster-grid">
          ${D.agents.map(a => `
            <a class="roster-chip" href="#agents" title="${esc(a.desc)}">
              <span class="agent-avatar sm pumpkin">${mascot('head')}</span>
              <span class="col" style="min-width:0;gap:1px">
                <span class="row" style="gap:6px"><b style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</b></span>
                <span class="status-line ${'tone-'+a.status}" style="font-size:11px;color:var(--ink-faint)">${dotFor(a.status)}${a.runs} 次运行</span>
              </span>
            </a>`).join('')}
        </div>
      </section>
    </div>`;
  };

  /* ───────────────────────── CONVERSATIONS ───────────────────────── */
  SCREENS.conversations = function () {
    const activeSession = D.activeSessionId === '__new__'
      ? null
      : D.sessions.find(s => s.id === D.activeSessionId) || D.sessions[0] || null;
    const agent = D.agents.find(a => a.id === activeSession?.templateId) || D.agents[0];
    const transcript = activeSession?.messages?.length ? activeSession.messages : [];
    return `
    <div class="chat-shell">
      <!-- session list -->
      <div class="chat-sessions">
        <div class="chat-sessions-top">
          <button class="btn btn-primary btn-squiggle" id="new-conversation" style="width:100%;justify-content:center">${icon('plus')} 新对话</button>
          <div class="chat-search">
            <span class="ic">${icon('search')}</span>
            <input class="input" placeholder="搜索会话…" style="border:none;background:transparent;box-shadow:none;padding:6px 0" />
          </div>
        </div>
        <div class="chat-session-list">
          ${D.sessions.map((s,i) => `
            <div class="chat-session ${s.id===(activeSession?.id || D.activeSessionId) || (!activeSession && i===0)?'active':''}" data-sid="${s.id}">
              <div class="row spread" style="margin-bottom:3px">
                <span class="row" style="gap:7px;min-width:0">${dotFor(s.status)}<b style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</b></span>
                ${s.pinned ? `<span class="ghost" style="width:14px;flex-shrink:0">${icon('pin')}</span>` : ''}
              </div>
              <div class="spread mono" style="font-size:11px;color:var(--ink-ghost)">
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.agent)}</span>
                <span style="white-space:nowrap">${s.msgs} 条 · ${s.when}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <!-- chat main -->
      <div class="chat-main">
        <div class="chat-head">
          <span class="agent-avatar sm pumpkin">${mascot('head')}</span>
          <div class="col" style="gap:2px;flex:1;min-width:0">
            <b style="font-size:16px">${esc(agent.name)}</b>
            <span class="status-line" style="font-size:11px;color:var(--good)">${dotFor('good')}运行正常 · 规划模式(只读)</span>
          </div>
          <div class="wrap-tags" style="justify-content:flex-end">
            <span class="badge badge-ink">${modelName(agent.model)}</span>
            <span class="badge">工具 ×${agent.tools.length}</span>
            <span class="badge badge-good">MCP · github</span>
            <span class="badge badge-accent">code-review</span>
          </div>
        </div>

        <div class="chat-stream" id="chat-stream">
          ${renderTranscript(transcript)}
          ${renderRunReceipt(D.runStats)}
        </div>

        <div class="chat-composer">
          <div class="composer-box">
            <button class="icon-btn" title="附件" style="border:none">${icon('paperclip')}</button>
            <textarea class="composer-input" id="composer" rows="1" placeholder="给「${esc(agent.name)}」发消息 — Enter 发送,Shift+Enter 换行"></textarea>
            <button class="btn btn-primary composer-send" id="send-btn">${icon('send')} 发送</button>
          </div>
          <div class="composer-meta mono">
            <span>${dotFor('good')} 已连后端 · /api/chat (SSE)</span>
            <span class="ghost">规划模式下不会写盘 — 切到「接受编辑」才动文件</span>
          </div>
        </div>
      </div>
    </div>`;
  };

  function renderTranscript(items) {
    return items.map(m => {
      if (m.role === 'user') {
        return `<div class="msg msg-user"><div class="bubble bubble-user">${esc(m.text)}</div></div>`;
      }
      if (m.role === 'permission') {
        return `
        <div class="msg msg-assistant">
          <div class="perm-card">
            <div class="row" style="gap:8px;margin-bottom:6px"><span class="dot dot-warn"></span><b class="mono" style="font-size:12px">权限请求 · ${esc(m.tool)}</b></div>
            <div style="font-size:15px;margin-bottom:2px"><b>${esc(m.title)}</b></div>
            <div class="muted" style="font-size:13.5px;margin-bottom:4px">${esc(m.desc)}</div>
            <div class="dashed mono" style="padding:7px 11px;font-size:12px;margin:8px 0 12px;color:var(--ink-soft)">${esc(m.input)}</div>
            <div class="row" style="gap:8px">
              <button class="btn btn-sm btn-primary">${icon('check')} 放行一次</button>
              <button class="btn btn-sm btn-ghost">总是允许</button>
              <button class="btn btn-sm btn-danger btn-ghost">${icon('x')} 拒绝</button>
            </div>
          </div>
        </div>`;
      }
      // assistant
      let inner = '';
      if (m.think) inner += `
        <details class="think" open>
          <summary>${icon('spark')} 思考</summary>
          <div class="think-body">${esc(m.think)}</div>
        </details>`;
      if (m.steps) inner += `<div class="tool-trace">${m.steps.map(st => `
        <div class="tool-step">
          <span class="ts mono">${st.ts}</span>
          <span class="tool-name mono">${esc(st.tool)}</span>
          <span class="tool-input mono">${esc(st.input)}</span>
          <span class="tool-result mono ${st.ok?'ok':'err'}">${st.ok?icon('check'):icon('x')} ${esc(st.result)}</span>
        </div>`).join('')}</div>`;
      if (m.text) inner += `<div class="assistant-text">${mdLite(m.text)}</div>`;
      return `
        <div class="msg msg-assistant">
          <span class="agent-avatar sm pumpkin" style="width:30px;height:30px">${mascot('head')}</span>
          <div class="assistant-body">${inner}</div>
        </div>`;
    }).join('');
  }

  function renderRunReceipt(s) {
    return `
    <div class="run-receipt dashed mono">
      <span>${icon('coin')} $${s.cost}</span><span class="sep">·</span>
      <span>${icon('clock')} ${s.dur}s</span><span class="sep">·</span>
      <span>↑ ${s.inTok}</span><span class="sep">·</span>
      <span>↓ ${s.outTok}</span><span class="sep">·</span>
      <span class="ghost">本次运行回执</span>
    </div>`;
  }

  // tiny markdown: **bold** and `code`
  function mdLite(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  SCREEN_INIT.conversations = function () {
    // session switching (visual only)
    document.querySelectorAll('.chat-session').forEach(el => {
      el.addEventListener('click', () => {
        D.activeSessionId = el.dataset.sid || '';
        if (window.renderRoute) window.renderRoute('conversations');
      });
    });
    // composer autosize
    const ta = document.getElementById('composer');
    if (ta) {
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
      });
    }
    const sb = document.getElementById('send-btn');
    if (sb) sb.addEventListener('click', sendChat);
    async function sendChat() {
      const v = ta.value.trim(); if (!v) return;
      const stream = document.getElementById('chat-stream');
      const recp = stream.querySelector('.run-receipt');
      const activeSession = D.activeSessionId === '__new__'
        ? null
        : D.sessions.find(s => s.id === D.activeSessionId) || D.sessions[0] || null;
      const agent = D.agents.find(a => a.id === activeSession?.templateId) || D.agents[0];
      if (!agent) return;
      const baseMessages = activeSession?.messages?.length ? activeSession.messages : [];
      const userMessage = { role: 'user', text: v, timestamp: Date.now() };
      const assistantMessage = { role: 'assistant', text: '', timestamp: Date.now() };
      const nextMessages = [...baseMessages, userMessage, assistantMessage];
      const u = document.createElement('div');
      u.className = 'msg msg-user'; u.innerHTML = `<div class="bubble bubble-user">${esc(v)}</div>`;
      stream.insertBefore(u, recp);
      ta.value = ''; ta.style.height = 'auto';
      const thinking = document.createElement('div');
      thinking.className = 'msg msg-assistant';
      thinking.innerHTML = `<span class="agent-avatar sm pumpkin" style="width:30px;height:30px">${mascot('head')}</span><div class="assistant-body"><div class="typing"><span></span><span></span><span></span></div></div>`;
      stream.insertBefore(thinking, recp);
      stream.scrollTop = stream.scrollHeight;
      const body = thinking.querySelector('.assistant-body');
      const setAssistantText = (text) => {
        assistantMessage.text = text;
        body.innerHTML = `<div class="assistant-text">${mdLite(text || '...')}</div>`;
        stream.scrollTop = stream.scrollHeight;
      };
      try {
        const run = await window.AgentMaApi.streamChat({
          agent,
          session: activeSession,
          messages: nextMessages,
          onDelta: setAssistantText,
          onResult: setAssistantText,
          onError: message => setAssistantText(`错误: ${message}`),
        });
        const saved = await window.AgentMaApi.saveChatSession(activeSession, agent, nextMessages, run.result || {});
        const mapped = {
          id: saved.id,
          title: saved.title,
          agent: agent.name,
          msgs: saved.messages?.length || nextMessages.length,
          when: '刚刚',
          pinned: saved.pinned === true,
          status: 'good',
          templateId: saved.templateId || agent.id,
          model: saved.model || agent.model,
          sdkSessionId: saved.sdkSessionId || '',
          sdkCwd: saved.sdkCwd || '',
          messages: nextMessages,
          raw: saved,
        };
        D.sessions = [mapped, ...D.sessions.filter(s => s.id !== mapped.id)];
        D.activeSessionId = mapped.id;
      } catch (error) {
        setAssistantText(`连接失败: ${error.message || error}`);
      }
      stream.scrollTop = stream.scrollHeight;
    }
    document.getElementById('new-conversation')?.addEventListener('click', () => {
      D.activeSessionId = '__new__';
      if (window.renderRoute) window.renderRoute('conversations');
    });
  };

  /* ───────────────────────── AGENTS MARKET ───────────────────────── */
  SCREENS.agents = function () {
    return `
    <div class="agent-grid">
      ${D.agents.map(a => `
        <article class="card card-hover agent-card ${a.accent?'agent-card-accent':''}">
          <div class="agent-card-top">
            <span class="agent-avatar pumpkin">${mascot('head')}</span>
            <div class="col" style="flex:1;min-width:0;gap:3px">
              <div class="spread"><b style="font-size:17px">${esc(a.name)}</b>${dotFor(a.status)}</div>
              <span class="status-line mono" style="font-size:11px;color:var(--ink-faint)">${statusLabel[a.status]} · ${a.runs} 次运行</span>
            </div>
          </div>
          <p class="agent-desc">${esc(a.desc)}</p>
          <div class="wrap-tags" style="margin:12px 0 14px">
            <span class="badge badge-ink">${modelName(a.model)}</span>
            <span class="badge">工具 ×${a.tools.length}</span>
            ${a.mcp.map(m => `<span class="badge badge-good">MCP·${m}</span>`).join('')}
            ${a.skills.map(s => `<span class="badge badge-accent">${s}</span>`).join('')}
          </div>
          <div class="divider" style="margin:0 -22px 12px"></div>
          <div class="row" style="gap:8px">
            <a class="btn btn-sm btn-primary" href="#conversations" style="flex:1;justify-content:center">${icon('chat')} 对话</a>
            <button class="btn btn-sm btn-ghost edit-agent" data-id="${a.id}">${icon('edit')} 编辑</button>
          </div>
        </article>`).join('')}

      <button class="card agent-card-new" id="new-agent-card">
        <span class="pumpkin" style="width:64px;height:64px;opacity:.45">${mascot('full')}</span>
        <b class="hand" style="font-size:28px;color:var(--ink-soft)">养一只新的</b>
        <span class="muted" style="font-size:13.5px;max-width:220px">配好模型、工具、技能和权限 — 然后放它出去干活。</span>
        <span class="btn btn-sm">${icon('plus')} 新建 Agent</span>
      </button>
    </div>`;
  };
  SCREEN_ACTIONS.agents = () => `<button class="btn btn-primary btn-squiggle" id="ta-new-agent">${icon('plus')} 新建 Agent</button>`;
  function wireAgentDrawer() {
    const open = () => openDrawer(agentDrawerHTML());
    const ta = document.getElementById('ta-new-agent'); if (ta) ta.addEventListener('click', open);
    document.getElementById('new-agent-card')?.addEventListener('click', open);
    document.querySelectorAll('.edit-agent').forEach(b => b.addEventListener('click', () => {
      const a = D.agents.find(x => x.id === b.dataset.id); openDrawer(agentDrawerHTML(a));
    }));
  }
  SCREEN_INIT.agents = wireAgentDrawer;
  ACTION_INIT.agents = () => { const ta = document.getElementById('ta-new-agent'); if (ta) ta.addEventListener('click', () => openDrawer(agentDrawerHTML())); };

  function agentDrawerHTML(a) {
    const editing = !!a;
    const allTools = ['Read','Write','Edit','Glob','Grep','Bash','WebSearch','WebFetch','Agent','Skill'];
    const sel = a ? a.tools : ['Read','Write','Edit','Bash','Grep','Glob'];
    return `
    <div class="drawer-head">
      <div class="col" style="gap:2px">
        <span class="mono ghost" style="font-size:11px;letter-spacing:.15em">${editing?'编辑 AGENT':'新建 AGENT'}</span>
        <h2 class="hand" style="font-size:34px;margin:0;color:var(--maroon)">${editing?esc(a.name):'还没起名字'}</h2>
      </div>
      <button class="icon-btn" data-close>${icon('x')}</button>
    </div>
    <div class="drawer-body">
      <label class="field"><span class="field-label">名称</span><input class="input" value="${editing?esc(a.name):''}" placeholder="比如:代码审查官"/></label>
      <label class="field"><span class="field-label">一句话描述</span><input class="input" value="${editing?esc(a.desc):''}" placeholder="它擅长什么 / 替你省了什么事"/></label>
      <label class="field"><span class="field-label">系统提示词</span><textarea class="textarea" rows="4" placeholder="你是一位资深…">${editing?'你是一位资深代码审查专家。审查代码变更,关注安全性、性能与代码质量。只读,不修改文件。':''}</textarea></label>
      <div class="row" style="gap:14px">
        <label class="field" style="flex:1"><span class="field-label">模型</span>
          <select class="select">${D.models.map(m => `<option ${a&&a.model===m.value?'selected':''}>${m.name}</option>`).join('')}</select></label>
        <label class="field" style="flex:1"><span class="field-label">权限模式</span>
          <select class="select">${D.permModes.map(p => `<option ${a&&a.perm===p.value?'selected':''}>${p.label} — ${p.desc}</option>`).join('')}</select></label>
      </div>
      <div class="field">
        <span class="field-label">工具背包</span>
        <div class="wrap-tags">
          ${allTools.map(t => `<button class="chip ${sel.includes(t)?'chip-on':''}" data-chip>${t}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="field-label">挂载技能</span>
        <div class="wrap-tags">
          ${D.skills.slice(0,6).map(s => `<button class="chip ${a&&a.skills.includes(s.name)?'chip-on':''}" data-chip>${s.name}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-ghost" data-close>取消</button>
      <button class="btn btn-primary btn-squiggle" data-close>${icon('check')} ${editing?'保存':'创建并放出去'}</button>
    </div>`;
  }
  // chip toggling inside drawers (delegated)
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-chip]'); if (c) c.classList.toggle('chip-on');
  });

  /* ───────────────────────── PLAYGROUND ───────────────────────── */
  SCREENS.playground = function () {
    return `
    <div class="pg-grid">
      <div class="card card-pad">
        <h2 class="section-h" style="margin-bottom:14px"><span class="section-num">in</span>请求</h2>
        <div class="row" style="gap:14px">
          <label class="field" style="flex:1"><span class="field-label">模型</span><select class="select">${D.models.map(m=>`<option>${m.name}</option>`).join('')}</select></label>
          <label class="field" style="flex:1"><span class="field-label">努力程度</span><select class="select"><option>高(默认)</option><option>中</option><option>低</option><option>极高</option></select></label>
        </div>
        <label class="field"><span class="field-label">系统提示词</span><textarea class="textarea" rows="3">你是一个简洁、克制的助手。能不啰嗦就不啰嗦。</textarea></label>
        <label class="field"><span class="field-label">用户消息</span><textarea class="textarea" rows="5">用 3 句话解释什么是 MCP。</textarea></label>
        <button class="btn btn-primary btn-squiggle" id="pg-run">${icon('play')} 运行 · 流式</button>
      </div>
      <div class="card card-pad pg-out">
        <div class="spread" style="margin-bottom:12px"><h2 class="section-h"><span class="section-num">out</span>原始流</h2><span class="badge badge-good">${'<'}span class="dot dot-good dot-live">${'<'}/span> SSE</span></div>
        <pre class="pg-stream mono" id="pg-stream"><span class="ghost">点「运行」开始 — 这里逐行打印 <span style="color:var(--accent)">data:</span> 事件。</span></pre>
      </div>
    </div>`;
  };
  SCREEN_INIT.playground = function () {
    const btn = document.getElementById('pg-run'), out = document.getElementById('pg-stream');
    if (!btn) return;
    const lines = [
      'data: {"type":"delta","text":"MCP"}',
      'data: {"type":"delta","text":"(Model Context Protocol)"}',
      'data: {"type":"delta","text":" 是一套开放协议,"}',
      'data: {"type":"delta","text":"让 agent 用统一方式接外部工具和数据。"}',
      'data: {"type":"delta","text":"你接一次 server,所有 agent 都能用。"}',
      'data: {"type":"delta","text":"省去给每个模型单独写胶水代码。"}',
      'data: {"type":"result","cost_usd":0.0021,"duration_ms":2140,"usage":{"input_tokens":48,"output_tokens":62}}',
    ];
    btn.addEventListener('click', () => {
      out.innerHTML = ''; let i = 0;
      const iv = setInterval(() => {
        if (i >= lines.length) { clearInterval(iv); return; }
        const isResult = lines[i].includes('"result"');
        const div = document.createElement('div');
        div.innerHTML = lines[i].replace('data:', '<span style="color:var(--accent)">data:</span>');
        div.style.color = isResult ? 'var(--good)' : 'var(--ink)';
        out.appendChild(div); out.scrollTop = out.scrollHeight; i++;
      }, 240);
    });
  };

  /* ───────────────────────── TOOLS ───────────────────────── */
  SCREENS.tools = function () {
    const cats = [...new Set(D.tools.map(t => t.cat))];
    return `
    <div class="cfg-layout">
      <div class="cfg-main">
        ${cats.map(cat => `
          <div class="cfg-group">
            <div class="cfg-group-head"><span class="mono ghost" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase">${esc(cat)}</span><span class="divider" style="flex:1"></span></div>
            ${D.tools.filter(t => t.cat === cat).map(t => `
              <div class="cfg-row">
                <span class="cfg-mark">${icon(t.builtin?'tools':'globe')}</span>
                <div class="col" style="flex:1;min-width:0;gap:1px">
                  <span class="row" style="gap:8px"><b class="mono" style="font-size:14px">${esc(t.name)}</b>${t.builtin?'<span class="badge">内置</span>':'<span class="badge badge-good">MCP</span>'}</span>
                  <span class="muted" style="font-size:13.5px">${esc(t.desc)}</span>
                </div>
                <span class="toggle ${t.on?'on':''}" data-toggle></span>
              </div>`).join('')}
          </div>`).join('')}
      </div>
      <aside class="cfg-side card card-pad">
        <h3 class="hand" style="font-size:26px;margin:0 0 4px">MCP 服务器</h3>
        <p class="muted" style="font-size:13px;margin:0 0 14px">接进来的工具来自这些服务。</p>
        ${D.mcp.map(s => `
          <div class="mcp-row">
            <span class="status-line"><span class="dot dot-${s.status==='connected'?'good':s.status==='failed'?'bad':s.status==='needs-auth'?'warn':'idle'} ${s.status==='connected'||s.status==='failed'?'dot-live':''}"></span></span>
            <div class="col" style="flex:1;min-width:0;gap:1px">
              <span class="row spread"><b class="mono" style="font-size:13px">${esc(s.name)}</b><span class="ghost mono" style="font-size:10px">v${s.version}</span></span>
              <span class="muted" style="font-size:12px">${esc(s.note)}${s.tools?` · ${s.tools} 工具`:''}</span>
            </div>
          </div>`).join('')}
        <button class="btn btn-sm btn-ghost" style="width:100%;justify-content:center;margin-top:12px">${icon('plus')} 接入服务器</button>
      </aside>
    </div>`;
  };
  SCREEN_ACTIONS.tools = () => `<button class="btn btn-ghost btn-sm">${icon('search')} 搜索工具</button>`;

  /* ───────────────────────── SKILLS ───────────────────────── */
  SCREENS.skills = function () {
    const groups = [['用户','用户级 · 全局可用'],['项目','项目级 · 跟着仓库走'],['插件','插件级 · 随插件安装']];
    return `
    <div class="cfg-main wide">
      ${groups.map(([loc, sub]) => `
        <div class="cfg-group">
          <div class="cfg-group-head"><span class="hand" style="font-size:24px;color:var(--ink)">${loc}技能</span><span class="muted mono" style="font-size:11px">${sub}</span><span class="divider" style="flex:1"></span></div>
          ${D.skills.filter(s => s.loc === loc).map(s => `
            <div class="cfg-row">
              <span class="cfg-mark">${icon('spark')}</span>
              <div class="col" style="flex:1;min-width:0;gap:2px">
                <span class="row" style="gap:8px"><b class="mono" style="font-size:14px">${esc(s.name)}</b>${s.on?'<span class="badge badge-good">启用</span>':'<span class="badge">停用</span>'}</span>
                <span class="muted" style="font-size:13.5px">${esc(s.desc)}</span>
                <span class="ghost mono" style="font-size:11px">${esc(s.path)}</span>
              </div>
              <span class="toggle ${s.on?'on':''}" data-toggle></span>
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
  };

  /* ───────────────────────── HOOKS ───────────────────────── */
  SCREENS.hooks = function () {
    return `
    <div class="cfg-main wide">
      <div class="hook-rail">
        ${D.hooks.map(h => `
          <div class="card card-flat hook-card ${h.on?'':'hook-off'}">
            <div class="spread" style="margin-bottom:8px">
              <span class="row" style="gap:8px"><b class="mono" style="font-size:14.5px">${esc(h.event)}</b><span class="badge badge-maroon">${esc(h.cat)}</span></span>
              <span class="toggle ${h.on?'on':''}" data-toggle></span>
            </div>
            <p class="muted" style="font-size:13.5px;margin:0 0 10px">${esc(h.desc)}</p>
            <div class="dashed mono" style="padding:8px 11px;font-size:12px;color:var(--ink-soft);display:flex;align-items:center;gap:8px">
              ${icon('terminal')}<span style="flex:1">${esc(h.script)}</span>
              ${h.runs ? `<span class="ghost">${h.runs} 次触发</span>` : `<span class="ghost">未配置</span>`}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  };
  SCREEN_ACTIONS.hooks = () => `<button class="btn btn-primary btn-squiggle">${icon('plus')} 新建 Hook</button>`;

  /* ───────────────────────── SUBAGENTS ───────────────────────── */
  SCREENS.subagents = function () {
    return `
    <div class="sub-grid">
      ${D.subagents.map(s => `
        <article class="card card-flat card-hover sub-card">
          <span class="agent-avatar sm pumpkin">${mascot('head')}</span>
          <div class="col" style="gap:3px;flex:1;min-width:0">
            <b class="mono" style="font-size:14.5px">${esc(s.name)}</b>
            <span class="muted" style="font-size:13.5px">${esc(s.desc)}</span>
          </div>
          <span class="ghost">${icon('arrowR')}</span>
        </article>`).join('')}
    </div>`;
  };
  SCREEN_ACTIONS.subagents = () => `<button class="btn btn-primary btn-squiggle">${icon('plus')} 新建子代理</button>`;

  /* ───────────────────────── PERMISSIONS ───────────────────────── */
  SCREENS.permissions = function () {
    const modeColor = { allow: 'good', deny: 'bad', ask: 'warn' };
    const modeLabel = { allow: '允许', deny: '拒绝', ask: '询问' };
    return `
    <div class="cfg-layout">
      <div class="cfg-main">
        <div class="cfg-group">
          <div class="cfg-group-head"><span class="mono ghost" style="font-size:11px;letter-spacing:.14em">规则表 · 自上而下匹配</span><span class="divider" style="flex:1"></span></div>
          ${D.perms.map(p => `
            <div class="cfg-row perm-row">
              <span class="badge badge-${modeColor[p.mode]}" style="min-width:52px;justify-content:center">${modeLabel[p.mode]}</span>
              <b class="mono" style="font-size:14px;flex:1;min-width:0">${esc(p.rule)}</b>
              <span class="muted" style="font-size:13px">${esc(p.note)}</span>
              <button class="icon-btn" style="border-color:var(--rule)">${icon('trash')}</button>
            </div>`).join('')}
          <button class="btn btn-sm btn-ghost" style="margin-top:12px">${icon('plus')} 添加规则</button>
        </div>
      </div>
      <aside class="cfg-side card card-pad">
        <h3 class="hand" style="font-size:26px;margin:0 0 4px">默认权限模式</h3>
        <p class="muted" style="font-size:13px;margin:0 0 14px">没命中规则时,按这个来。</p>
        ${D.permModes.map((m,i) => `
          <label class="mode-opt ${i===0?'mode-on':''}">
            <span class="radio ${i===0?'radio-on':''}"></span>
            <span class="col" style="gap:1px"><b style="font-size:14.5px">${m.label}</b><span class="muted" style="font-size:12.5px">${m.desc}</span></span>
          </label>`).join('')}
        <div class="attn attn-bad" style="margin-top:14px">
          <div class="row" style="gap:7px"><span class="dot dot-bad"></span><b class="mono" style="font-size:12px">绕过权限 = 没有刹车</b></div>
          <div style="font-size:13px;margin-top:4px">凌晨那次连生产 Stripe,就是它差点闯进去 — 别全局开。</div>
        </div>
      </aside>
    </div>`;
  };
  SCREEN_INIT.permissions = function () {
    document.querySelectorAll('.mode-opt').forEach(o => o.addEventListener('click', () => {
      document.querySelectorAll('.mode-opt').forEach(x => { x.classList.remove('mode-on'); x.querySelector('.radio').classList.remove('radio-on'); });
      o.classList.add('mode-on'); o.querySelector('.radio').classList.add('radio-on');
    }));
  };

  /* ───────────────────────── KNOWLEDGE ───────────────────────── */
  SCREENS.knowledge = function () {
    const sources = D.knowledgeSources || [];
    return `
    <div class="cfg-layout">
      <div class="cfg-main">
        <div class="cfg-group">
          <div class="cfg-group-head"><span class="hand" style="font-size:24px;color:var(--ink)">已导入知识库</span><span class="divider" style="flex:1"></span></div>
          ${sources.length ? sources.map(source => `
            <div class="cfg-row">
              <span class="cfg-mark">${icon('book')}</span>
              <div class="col" style="flex:1;min-width:0;gap:2px">
                <span class="row" style="gap:8px"><b style="font-size:15px">${esc(source.name || '知识库')}</b>${source.enabled !== false ? '<span class="badge badge-good">可选</span>' : '<span class="badge">停用</span>'}</span>
                <span class="ghost mono" style="font-size:11px;overflow-wrap:anywhere">${esc(source.path || '')}</span>
              </div>
            </div>`).join('') : `
            <div class="empty">
              <span class="ghost-mark">${mascot('head')}</span>
              <h3>还没有知识库</h3>
              <p>上传一个 markdown/txt 文件夹后，就能在 Agent 中绑定使用。</p>
            </div>`}
        </div>
      </div>
      <aside class="cfg-side card card-pad">
        <h3 class="hand" style="font-size:26px;margin:0 0 4px">上传文件夹</h3>
        <p class="muted" style="font-size:13px;margin:0 0 14px">只读取 markdown / txt 文件。数量和单文件大小由管理员配额控制。</p>
        <input id="knowledge-folder" type="file" multiple style="display:none" webkitdirectory directory />
        <label class="field"><span class="field-label">知识库名称</span><input class="input" id="knowledge-name" placeholder="上传知识库" /></label>
        <button class="btn btn-primary btn-squiggle" id="knowledge-open" style="width:100%;justify-content:center">${icon('file')} 打开文件夹</button>
        <button class="btn btn-ghost" id="knowledge-upload" style="width:100%;justify-content:center;margin-top:10px" disabled>${icon('plus')} 上传选中文件</button>
        <div id="knowledge-status" class="muted" style="font-size:13px;margin-top:12px"></div>
        <div id="knowledge-files" style="margin-top:12px;max-height:280px;overflow:auto"></div>
      </aside>
    </div>`;
  };
  SCREEN_INIT.knowledge = function () {
    const input = document.getElementById('knowledge-folder');
    const open = document.getElementById('knowledge-open');
    const upload = document.getElementById('knowledge-upload');
    const filesHost = document.getElementById('knowledge-files');
    const status = document.getElementById('knowledge-status');
    const nameInput = document.getElementById('knowledge-name');
    let files = [];

    function fmt(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    function renderFiles() {
      upload.disabled = !files.some(file => file.selected);
      filesHost.innerHTML = files.map((file, index) => `
        <label class="mcp-row" style="cursor:pointer">
          <input type="checkbox" data-k-file="${index}" ${file.selected ? 'checked' : ''} style="width:auto" />
          <span class="col" style="gap:1px;min-width:0">
            <b style="font-size:13px">${esc(file.file.name)}</b>
            <span class="ghost mono" style="font-size:11px;overflow-wrap:anywhere">${esc(file.relativePath)}</span>
          </span>
          <span class="badge">${fmt(file.file.size)}</span>
        </label>`).join('');
      filesHost.querySelectorAll('[data-k-file]').forEach(box => {
        box.addEventListener('change', () => {
          files[Number(box.dataset.kFile)].selected = box.checked;
          renderFiles();
        });
      });
    }
    open?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      const picked = Array.from(input.files || []).filter(file => /\.(md|markdown|txt)$/i.test(file.name));
      files = picked.map(file => ({
        file,
        selected: true,
        relativePath: file.webkitRelativePath || file.name,
      }));
      const first = files[0]?.relativePath || '';
      if (first && !nameInput.value) nameInput.value = first.includes('/') ? first.split('/')[0] : '上传知识库';
      status.textContent = files.length ? `已选择 ${files.length} 个文本文件` : '这个文件夹里没有 markdown/txt 文件';
      renderFiles();
      input.value = '';
    });
    upload?.addEventListener('click', async () => {
      const selected = files.filter(file => file.selected);
      if (!selected.length) return;
      upload.disabled = true;
      status.textContent = '上传中...';
      try {
        const quota = await window.AgentMaApi.api('/api/quota');
        const limit = D.user.role === 'tenant_admin' ? quota.knowledgeUploadAdminMaxFiles : quota.knowledgeUploadMemberMaxFiles;
        const maxFileBytes = quota.knowledgeUploadMaxFileBytes || 1024 * 1024;
        if (selected.length > limit) throw new Error(`当前账号单次最多上传 ${limit} 个文件`);
        const oversized = selected.find(item => item.file.size > maxFileBytes);
        if (oversized) throw new Error(`单个文档不能超过 ${fmt(maxFileBytes)}：${oversized.relativePath}`);
        const payloadFiles = await Promise.all(selected.map(async item => ({
          relativePath: item.relativePath,
          content: await item.file.text(),
        })));
        const saved = await window.AgentMaApi.api('/api/knowledge/sources/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nameInput.value.trim() || '上传知识库', files: payloadFiles }),
        });
        D.knowledgeSources = saved;
        status.textContent = `已上传 ${selected.length} 个文件`;
        files = [];
        if (window.renderRoute) window.renderRoute('knowledge');
      } catch (error) {
        status.textContent = error.message || '上传失败';
        upload.disabled = false;
      }
    });
  };

  /* ───────────────────────── SETTINGS ───────────────────────── */
  SCREENS.settings = function () {
    const provider = window.AgentMaApi?.loadProvider?.() || {};
    return `
    <div class="cfg-main wide">
      <div class="cfg-group">
        <div class="cfg-group-head"><span class="hand" style="font-size:24px;color:var(--ink)">供应商配置</span><span class="divider" style="flex:1"></span></div>
        <div class="row" style="gap:14px;align-items:flex-start">
          <label class="field" style="flex:1"><span class="field-label">ANTHROPIC_BASE_URL</span><input class="input mono" id="set-base-url" value="${esc(provider.ANTHROPIC_BASE_URL || '')}" /></label>
          <label class="field" style="flex:1"><span class="field-label">ANTHROPIC_MODEL</span><input class="input mono" id="set-model" value="${esc(provider.ANTHROPIC_MODEL || '')}" /></label>
        </div>
        <label class="field"><span class="field-label">ANTHROPIC_AUTH_TOKEN</span><input class="input mono" id="set-token" type="password" value="${esc(provider.ANTHROPIC_AUTH_TOKEN || '')}" /></label>
        <div class="row" style="gap:10px">
          <button class="btn btn-primary btn-squiggle" id="set-save">${icon('check')} 保存配置</button>
          <span class="muted" id="set-status" style="font-size:13px"></span>
        </div>
      </div>
    </div>`;
  };
  SCREEN_INIT.settings = function () {
    document.getElementById('set-save')?.addEventListener('click', () => {
      window.AgentMaApi.saveProvider({
        ANTHROPIC_BASE_URL: document.getElementById('set-base-url').value.trim(),
        ANTHROPIC_MODEL: document.getElementById('set-model').value.trim(),
        ANTHROPIC_AUTH_TOKEN: document.getElementById('set-token').value.trim(),
      });
      document.getElementById('set-status').textContent = '已保存';
    });
  };

  /* ───────────────────────── OBSERVABILITY ───────────────────────── */
  SCREENS.observability = function () {
    const bars = [3.2,4.8,4.1,6.7,5.2,7.9,4.8];
    const days = ['周一','周二','周三','周四','周五','周六','今天'];
    const max = Math.max(...bars);
    const runs = [
      { agent: '代码审查官', cost: '0.014', dur: '38s', tok: '14.2k', status: 'good' },
      { agent: 'Minecraft 守夜人', cost: '0.002', dur: '4s', tok: '1.1k', status: 'good' },
      { agent: '数据迁移助手', cost: '0.000', dur: '2s', tok: '0.4k', status: 'bad' },
      { agent: '调研员', cost: '0.031', dur: '1m12s', tok: '28.7k', status: 'good' },
      { agent: '文档撰写者', cost: '0.019', dur: '52s', tok: '19.0k', status: 'good' },
      { agent: '测试工程师', cost: '0.008', dur: '21s', tok: '8.3k', status: 'warn' },
    ];
    return `
    <div class="obs-grid">
      <div class="obs-kpis">
        ${[['本周花费','$36.7','预算 $140 · 26%'],['总运行','8,412','次 · 7 个 agent'],['平均时长','41.2s','中位数 22s'],['错误率','0.6%','本周 51 次拦截']].map(([l,n,s])=>`
          <div class="card card-pad kpi-card"><div class="kpi-label">${l}</div><div class="kpi-num">${n}</div><div class="muted mono" style="font-size:12px">${s}</div></div>`).join('')}
      </div>
      <div class="card card-pad obs-chart">
        <div class="spread" style="margin-bottom:18px"><h2 class="section-h"><span class="section-num">$</span>每日花费</h2><span class="muted mono" style="font-size:12px">单位 USD · 近 7 天</span></div>
        <div class="bars">
          ${bars.map((b,i)=>`<div class="bar-col"><div class="bar" style="height:${(b/max*100).toFixed(0)}%"><span class="bar-val mono">${b}</span></div><span class="bar-lab mono">${days[i]}</span></div>`).join('')}
        </div>
      </div>
      <div class="card card-pad obs-runs">
        <h2 class="section-h" style="margin-bottom:14px"><span class="section-num">≡</span>最近运行</h2>
        <div class="run-table">
          <div class="run-head mono"><span>AGENT</span><span>花费</span><span>时长</span><span>TOKEN</span><span>状态</span></div>
          ${runs.map(r=>`<div class="run-line"><span class="row" style="gap:7px"><span class="agent-avatar sm pumpkin" style="width:24px;height:24px;box-shadow:none">${mascot('head')}</span>${esc(r.agent)}</span><span class="mono">$${r.cost}</span><span class="mono">${r.dur}</span><span class="mono">${r.tok}</span><span>${dotFor(r.status)}</span></div>`).join('')}
        </div>
      </div>
    </div>`;
  };

})();
