# 深空星场 3D 效果 — 登录页 & 总览页(Three.js)

- 日期:2026-06-23
- 状态:已确认,待实现
- 范围:仅 `dashboard/` 前端,仅登录页(`/login`)与总览页(`/`)两条路由

## 1. 目标与边界

给登录页和总览页加上 **满屏沉浸式「深空星场 + 粒子视差」** 3D 背景(Three.js)。

明确不做:

- 不引入整站深色模式;深色仅作用于这两条路由。
- 不动侧边栏、topbar 之外的任何共享组件;不动其它 18 条路由。
- 不做 shader 星云、不做 warp 穿越(只做克制的星场漂移 + 鼠标视差)。
- 不新增除 `three` 外的运行时依赖(不引入 `@react-three/fiber` / `drei`)。

## 2. 关键约束(必须遵守)

1. **现有应用是浅色主题**(`--bg:#fafaf9`、`--ink:#1c1917`、`--accent:#2563eb`)。星空是深色,因此这两页在视觉上变为深色,但深色样式 **必须** 用作用域类 `.cosmic-route` 限定,绝不能泄漏到全局或其它路由。
2. **登录页 `/login` 独立挂载**(无 `Layout`、无侧边栏)→ 星空铺满整个窗口。
3. **总览页 `/` 挂载在 `<Layout>` 内**,内容进 `<main class="main-content">`,上方有共享 `console-topbar`,左侧有共享 `sidebar`。星空 **必须锁在 `.main-content` 内部**(含 topbar、不盖侧边栏),侧边栏保持浅色作为锚点。
4. 背景画布 `pointer-events:none`、`aria-hidden="true"`,不可聚焦,不拦截任何交互。
5. 必须可靠清理:组件卸载时停止动画循环、`dispose` 所有 GPU 资源、移除所有事件监听。

## 3. 组件设计:`CosmicBackground`

新增文件:`dashboard/src/components/CosmicBackground.tsx`

### Props

```ts
interface CosmicBackgroundProps {
  variant: 'login' | 'overview';   // 调密度/速度/亮度预设
  fill?: 'fixed' | 'absolute';     // 默认 'fixed'(整窗);'absolute' 填充定位父元素
  className?: string;
}
```

### 预设(按 variant 取值)

| 参数 | login | overview |
|---|---|---|
| 星总数(桌面) | ~2600 | ~1400 |
| 漂移速度系数 | 1.0 | 0.55 |
| 视差强度 | 1.0 | 0.5 |
| 整体亮度/透明度 | 1.0 | 0.7 |

> 总览更低密度、更慢、更暗,确保 KPI / 代码块文字可读。

### 渲染实现要点

- React 函数组件:`useRef<HTMLDivElement>` 作为挂载容器,`useEffect` 内一次性初始化 Three.js,`return` 清理函数。组件 DOM:一个 `<div ref>`,内部由 Three.js 注入 `<canvas>`。容器样式由 `fill` 决定:
  - `fixed`:`position:fixed; inset:0; z-index:0; pointer-events:none;`
  - `absolute`:`position:absolute; inset:0; z-index:0; pointer-events:none;`
- `Scene`、`PerspectiveCamera(60, w/h, 0.1, 2000)`、`WebGLRenderer({ alpha:true, antialias:true, powerPreference:'high-performance' })`。
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`。
- **3 层 `THREE.Points`**(远/中/近),各自:
  - `BufferGeometry`,随机分布在一个深度盒内(x/y 覆盖视口、z 分层),每层赋不同 z 区间。
  - 颜色:per-vertex color。主体冷白(`#ffffff`/`#dbe4ff`),约 18% 掺品牌蓝 `#2563eb`,约 6% 暖色亮星(`#ffd9a8`)。
  - `PointsMaterial({ size, sizeAttenuation:true, vertexColors:true, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false })`。近层 size 大、远层 size 小。
- **漂移**:在 RAF 中令每层沿 +z 缓慢移动(近层快、远层慢);星越过相机近平面后把其 z 回绕到远端(模拟无尽穿行)。叠加极慢的整体 y 轴微旋转。
- **视差**:监听 `pointermove`,把归一化指针位置 lerp 到一个目标偏移,每帧把相机(或星层 group)按 `parallax` 系数偏移;近层偏移大、远层小。移动端可选监听 `deviceorientation`(无权限/不支持时静默跳过)。
- **resize**:监听 `window.resize`(`fixed`)或用 `ResizeObserver` 观察父容器(`absolute`),更新相机 aspect 与 renderer size。

### 清理(useEffect return)

`cancelAnimationFrame`;移除 `pointermove`/`resize`/`visibilitychange`/`deviceorientation` 监听;断开 `ResizeObserver`;`geometry.dispose()` + `material.dispose()`(每层)+ `renderer.dispose()`;从 DOM 移除 canvas。

## 4. 静态深空底 + 无 WebGL 兜底

画布背后铺一层廉价 CSS 径向渐变,作为氛围底,同时是无 WebGL 时的兜底(此时组件 `return null`,只剩 CSS 底):

```css
.cosmic-route {
  background:
    radial-gradient(120% 120% at 50% 30%, #141a33 0%, #0b1020 45%, #05060d 100%);
}
```

WebGL 能力检测:尝试获取 `webgl`/`webgl2` 上下文失败时,组件 `return null`,不抛错。

## 5. 换肤:作用域 token 覆盖(核心简化手段)

不逐个改卡片样式,而是在 `.cosmic-route` 作用域内 **重映射现有 CSS 变量**,使依赖这些变量的现有类自动适配深色。新增到 `dashboard/src/App.css`:

```css
.cosmic-route {
  --bg: transparent;
  --bg-card: rgba(18, 22, 40, .55);
  --bg-hover: rgba(255, 255, 255, .06);
  --ink: #f5f5f4;
  --ink-secondary: #c7c9d1;
  --ink-muted: #8b8fa3;
  --border: rgba(255, 255, 255, .12);
  /* --accent / --accent-hover 保持不变,蓝色在深色上仍清晰 */
}

/* 玻璃拟态:卡片透出星空 */
.cosmic-route .login-card,
.cosmic-route .kpi-card,
.cosmic-route .tool-card,
.cosmic-route .card {
  background: var(--bg-card);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-color: var(--border);
}
```

> 代码块本来就是深色(`--bg-code:#1e1e1e`),不需要改。accent 蓝按钮在深色上对比度足够,不改。

## 6. 两页集成

### 6.1 登录页 `dashboard/src/pages/Login.tsx`

- 最外层 `<div className="login-page">` 追加 `cosmic-route` 类。
- 在该 div 内、`login-shell` 之前渲染 `<CosmicBackground variant="login" fill="fixed" />`。
- `login-shell` 需 `position:relative; z-index:1`(浮在画布之上)。
- CSS(`.cosmic-route` 作用域内,App.css):
  - `.cosmic-route .login-page` 背景透明(让 CSS 深空底/画布透出);移除原有米白点阵底。
  - `.login-card` 变玻璃(已由第 5 节覆盖);input 背景改 `rgba(255,255,255,.06)`、文字 `var(--ink)`、placeholder `var(--ink-muted)`。
  - `.login-word` / `.login-mark` 加柔光(`filter: drop-shadow(0 0 12px rgba(120,150,255,.5))` 之类),`.login-tag` 用 `--ink-secondary`。
  - `.login-error`、`.login-switch`、`.login-tab` 颜色适配深色背景。

### 6.2 总览页 `dashboard/src/pages/Overview.tsx`

- 最外层包一个 `<div className="cosmic-route cosmic-overview">` 包裹现有全部内容。
- 在该 div 内首个子元素渲染 `<CosmicBackground variant="overview" fill="absolute" />`。
- 现有内容包一层 `position:relative; z-index:1` 的容器,确保浮在画布上。

### 6.3 布局 `dashboard/src/components/Layout.tsx`

- 唯一改动:当 `location.pathname === '/'` 时给 `<main>` 追加 `cosmic` 修饰类:
  `className={\`main-content${isVizPreview ? ' visual-preview-main' : ''}${isOverview ? ' cosmic' : ''}\`}`(`const isOverview = location.pathname === '/'`)。
- CSS:`.main-content.cosmic { position: relative; overflow: hidden; }`,使 `fill="absolute"` 的画布锁在内容面板内(含 topbar、不盖侧边栏)。
- topbar 在 `.main-content.cosmic` 下需设 `position:relative; z-index:1` 并适配深色(背景透明/玻璃、文字用 `--ink`/`--ink-secondary`)。
- **不改 `Sidebar`,不改其它路由**。

## 7. 性能 / 降级 / 无障碍

- **可见性**:`document.hidden` 时暂停 RAF,`visible` 时恢复。
- **移动端 / 低能力**:`window.matchMedia('(pointer: coarse)')` 或窗口宽度 `< 640` 时,星数按系数(如 0.5)下调;`deviceorientation` 不可用则静默回退为无视差。
- **无 WebGL**:组件 `return null`,保留 CSS 深空底(第 4 节)。
- **`prefers-reduced-motion: reduce`**:不漂移、不视差,只渲染一帧静态星空;若也想更稳,可直接只用 CSS 静态底。用 `window.matchMedia('(prefers-reduced-motion: reduce)')` 判断,并监听其 change。
- **可读性**:玻璃卡片背板不透明度需保证文字对比度达 WCAG AA;若实测偏低,调高 `--bg-card` 的 alpha。

## 8. 改动清单

- `dashboard/package.json`:依赖加 `three`;devDependencies 加 `@types/three`。
- 新增 `dashboard/src/components/CosmicBackground.tsx`。
- `dashboard/src/App.css`:新增 `.cosmic-route` 作用域块(token 覆盖 + 玻璃卡片 + 静态深空底 + 登录深色微调 + `.main-content.cosmic` 容器与 topbar 适配)。
- `dashboard/src/pages/Login.tsx`:加 `cosmic-route` + 渲染 `CosmicBackground`(fixed)。
- `dashboard/src/pages/Overview.tsx`:包 `cosmic-route` 容器 + 渲染 `CosmicBackground`(absolute)+ 内容层 z-index。
- `dashboard/src/components/Layout.tsx`:仅 `/` 路由给 `main-content` 加 `cosmic` 类。

## 9. 验收标准

- [ ] `/login` 全窗深空星场,星星缓慢穿行,鼠标移动产生多层视差;登录卡为玻璃面板,文字清晰。
- [ ] `/` 内容面板内呈现星场(更暗更慢),侧边栏仍为浅色;KPI 数值、模块网格、SDK 代码块全部清晰可读。
- [ ] 其它任意路由(如 `/agents`、`/skills`)外观与改造前完全一致,无深色泄漏。
- [ ] 切到后台标签页动画暂停;返回恢复。
- [ ] `prefers-reduced-motion` 开启时无动画。
- [ ] 关闭 WebGL(或不支持)时两页仍显示静态深空底,不报错、不白屏。
- [ ] 路由进出登录/总览多次,无内存增长(GPU 资源被 dispose)、无控制台报错。
- [ ] `npm run build`(或现有 lint/tsc)通过。

## 10. 风险

- `backdrop-filter` 在个别旧浏览器不支持 → 已带 `-webkit-` 前缀;不支持时玻璃退化为半透明纯色,仍可读。
- 总览页玻璃 + 大量 DOM + 画布同屏可能掉帧 → 已用低密度/低 pixelRatio/隐藏暂停缓解;若仍重,可进一步降星数或在总览改用 CSS 静态底。
- token 覆盖可能波及作用域内未预期的元素 → 验收第 3 条专门回归其它路由确认无泄漏(因作用域类只挂这两页,理论上隔离)。
