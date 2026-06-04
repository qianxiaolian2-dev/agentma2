/* ════════════════════════════════════════════════════════════
   agentma · console shell + router
   ════════════════════════════════════════════════════════════ */
(async function () {
  const D = window.DATA;
  installMascot();
  if (window.AgentMaApi) {
    const authenticated = await window.AgentMaApi.ensureAuthenticated();
    if (!authenticated) return;
    try {
      await window.AgentMaApi.hydrateData(D);
    } catch (error) {
      console.warn('failed to hydrate console data', error);
    }
  }

  // logo + user
  document.getElementById('logo-mark').innerHTML = mascot('head');
  document.getElementById('user-initial').textContent = D.user.initial;
  document.getElementById('user-name').textContent = D.user.name;
  document.getElementById('user-mail').textContent = D.user.email;
  document.getElementById('logout').innerHTML = icon('logout');
  document.getElementById('logout').addEventListener('click', () => {
    if (window.AgentMaApi) window.AgentMaApi.logout();
  });
  document.getElementById('mobile-menu').innerHTML = icon('menu');

  // ── sidebar nav ──
  const nav = document.getElementById('nav');
  nav.innerHTML = D.nav.map(group => `
    <div class="sidebar-section">
      <div class="sidebar-section-title">${group.group}</div>
      ${group.items.map(it => `
        <a class="nav-link" data-route="${it.id}" href="#${it.id}">
          <span class="ic">${icon(it.icon)}</span>
          <span>${it.label}</span>
          ${it.count ? `<span class="count">${it.count}</span>` : ''}
        </a>`).join('')}
    </div>`).join('');

  // ── topbar meta per route ──
  const META = {
    overview:      { eyebrow: 'DASHBOARD · 蒲公英智能', title: '总览', lede: '七个 agent 在岗。一个昨夜想连生产 Stripe — 已拦下。' },
    conversations: { eyebrow: 'LIVE · 实时会话', title: '会话', lede: '和你的 agent 对话。每一步工具调用都看得见、拦得住。' },
    agents:        { eyebrow: 'MARKETPLACE · 7 个模板', title: 'Agent 市场', lede: '一个生物，多种养法。配好工具、技能、权限,放出去干活。' },
    playground:    { eyebrow: 'SANDBOX · 流式 API', title: 'Playground', lede: '不存历史的草稿纸 — 直接打后端,看原始流。' },
    tools:         { eyebrow: 'OPS · 工具背包', title: '工具背包', lede: '内置工具 + MCP 接进来的工具。给谁用,在 agent 里挑。' },
    skills:        { eyebrow: 'CORE · 技能背包', title: '技能背包', lede: '用户级、项目级、插件级技能。一处开关,处处生效。' },
    hooks:         { eyebrow: 'OPS · Hook 系统', title: 'Hook 系统', lede: '在生命周期的节点上挂脚本 — 审计、守护、通知。' },
    subagents:     { eyebrow: 'OPS · 子代理', title: '子代理管理', lede: '可被主 agent 唤起的专职小弟。各管一段。' },
    permissions:   { eyebrow: 'OPS · 权限系统', title: '权限系统', lede: '它能碰什么、不能碰什么、碰之前要不要问 — 写在这。' },
    observability: { eyebrow: 'OPS · 可观测性', title: '可观测性', lede: '花了多少钱、跑了多久、谁在报错 — 一屏看清。' },
    knowledge:     { eyebrow: 'CORE · 知识库', title: '知识库', lede: '租户共享的只读文档源。上传、绑定、再交给 agent 使用。' },
    settings:      { eyebrow: 'OPS · 供应商配置', title: '全局设置', lede: '配置供应商 API 凭据。模型由 Agent 模板选择。' },
  };

  const content = document.getElementById('content');
  const topbar = {
    eyebrow: document.getElementById('page-eyebrow'),
    title: document.getElementById('page-title'),
    lede: document.getElementById('page-lede'),
    actions: document.getElementById('page-actions'),
  };

  function setRoute(route) {
    if (!META[route]) route = 'overview';
    // nav active
    document.querySelectorAll('.nav-link').forEach(a =>
      a.classList.toggle('active', a.dataset.route === route));
    // topbar
    const m = META[route];
    topbar.eyebrow.innerHTML = `<span class="dot dot-good dot-live"></span>${m.eyebrow}`;
    topbar.title.textContent = m.title;
    topbar.lede.textContent = m.lede;
    topbar.actions.innerHTML = (window.SCREEN_ACTIONS[route] || (() => ''))();
    // chat screen runs flush (no content padding)
    content.classList.toggle('flush', route === 'conversations');
    // render
    content.innerHTML = `<div class="view">${window.SCREENS[route]()}</div>`;
    if (window.SCREEN_INIT[route]) window.SCREEN_INIT[route]();
    // wire any action buttons
    if (window.ACTION_INIT[route]) window.ACTION_INIT[route]();
    content.scrollTop = 0;
    document.getElementById('sidebar').classList.remove('open');
  }

  // hash router
  function current() { return (location.hash || '#overview').slice(1); }
  window.addEventListener('hashchange', () => setRoute(current()));
  window.go = (route) => { location.hash = route; };
  window.renderRoute = setRoute;

  // mobile menu
  document.getElementById('mobile-menu').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open'));
  function checkMobile() {
    document.getElementById('mobile-menu').style.display = window.innerWidth <= 920 ? 'grid' : 'none';
  }
  window.addEventListener('resize', checkMobile);
  checkMobile();

  // ── overlay (drawer) helper ──
  const host = document.getElementById('overlay-host');
  window.openDrawer = function (html) {
    host.innerHTML = `
      <div class="drawer-scrim" id="scrim"></div>
      <div class="drawer" id="drawer">${html}</div>`;
    requestAnimationFrame(() => {
      document.getElementById('scrim').classList.add('show');
      document.getElementById('drawer').classList.add('show');
    });
    document.getElementById('scrim').addEventListener('click', closeDrawer);
    host.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
  };
  window.closeDrawer = function () {
    const s = document.getElementById('scrim'), d = document.getElementById('drawer');
    if (!s) return;
    s.classList.remove('show'); d.classList.remove('show');
    setTimeout(() => { host.innerHTML = ''; }, 240);
  };
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  // boot
  setRoute(current());
})();
