# 实现计划:深空星场 3D(登录 + 总览)

执行者:GPT。本计划可不做额外设计决策直接执行。
依据 spec:`dashboard/docs/superpowers/specs/2026-06-23-threejs-3d-login-overview-design.md`。
所有路径相对仓库根 `/Users/xiaoqin/agentma2`。工作目录基本都在 `dashboard/`。

## 前置约定

- 不要改动除本计划列出文件以外的任何文件。仓库当前有其它无关未提交改动,**不要 `git add -A`**,只 add 本计划涉及的文件。
- 深色样式只能通过 `.cosmic-route` / `.main-content.cosmic` 作用域生效,严禁泄漏到全局或其它路由。

---

## Step 1 — 安装依赖

```bash
cd dashboard
npm install three
npm install -D @types/three
```

验证:`dashboard/package.json` 出现 `three`(dependencies)与 `@types/three`(devDependencies)。

---

## Step 2 — 新增组件 `dashboard/src/components/CosmicBackground.tsx`

按以下实现(可直接采用;数值已调好):

```tsx
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface CosmicBackgroundProps {
  variant: 'login' | 'overview';
  fill?: 'fixed' | 'absolute';
  className?: string;
}

const PRESET = {
  login:    { count: 2600, speed: 1.0,  parallax: 1.0,  opacity: 1.0 },
  overview: { count: 1400, speed: 0.55, parallax: 0.5,  opacity: 0.7 },
} as const;

const STAR_COLORS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#dbe4ff'),
  new THREE.Color('#2563eb'), // 品牌蓝
  new THREE.Color('#ffd9a8'), // 暖色亮星
];

function pickColor() {
  const r = Math.random();
  if (r < 0.06) return STAR_COLORS[3];
  if (r < 0.24) return STAR_COLORS[2];
  if (r < 0.6) return STAR_COLORS[1];
  return STAR_COLORS[0];
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function CosmicBackground({ variant, fill = 'fixed', className }: CosmicBackgroundProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !hasWebGL()) return;

    const preset = PRESET[variant];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 640;
    const densityFactor = coarse ? 0.5 : 1;

    let width = mount.clientWidth || window.innerWidth;
    let height = mount.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    camera.position.z = 600;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // 3 层:远/中/近
    const LAYERS = [
      { depth: 1400, size: 1.4, speedMul: 0.4, parallaxMul: 0.3, frac: 0.5 },
      { depth: 900,  size: 2.2, speedMul: 0.8, parallaxMul: 0.6, frac: 0.3 },
      { depth: 500,  size: 3.2, speedMul: 1.4, parallaxMul: 1.0, frac: 0.2 },
    ];

    const groups: THREE.Points[] = [];
    const spread = 1600;
    LAYERS.forEach((layer) => {
      const n = Math.max(1, Math.floor(preset.count * layer.frac * densityFactor));
      const positions = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
        positions[i * 3 + 2] = Math.random() * layer.depth;
        const c = pickColor();
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: layer.size,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: preset.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.userData = layer;
      scene.add(points);
      groups.push(points);
    });

    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (!reduceMotion) window.addEventListener('pointermove', onPointer, { passive: true });

    let raf = 0;
    let running = true;
    const clock = new THREE.Clock();

    const renderOnce = () => renderer.render(scene, camera);

    const animate = () => {
      if (!running) return;
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      pointer.x += (target.x - pointer.x) * 0.04;
      pointer.y += (target.y - pointer.y) * 0.04;
      groups.forEach((pts) => {
        const layer = pts.userData as typeof LAYERS[number];
        const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        const adv = dt * 30 * preset.speed * layer.speedMul;
        for (let i = 2; i < arr.length; i += 3) {
          arr[i] -= adv;
          if (arr[i] < 0) arr[i] = layer.depth;
        }
        posAttr.needsUpdate = true;
        pts.position.x = pointer.x * 40 * preset.parallax * layer.parallaxMul;
        pts.position.y = -pointer.y * 40 * preset.parallax * layer.parallaxMul;
        pts.rotation.z += dt * 0.005;
      });
      renderOnce();
    };

    if (reduceMotion) {
      renderOnce(); // 静态一帧
    } else {
      animate();
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduceMotion) {
        running = true;
        clock.getDelta();
        animate();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const resize = () => {
      width = mount.clientWidth || window.innerWidth;
      height = mount.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (reduceMotion) renderOnce();
    };
    const ro = new ResizeObserver(resize);
    if (fill === 'absolute') ro.observe(mount);
    else window.addEventListener('resize', resize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      groups.forEach((pts) => {
        pts.geometry.dispose();
        (pts.material as THREE.Material).dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [variant, fill]);

  const style: React.CSSProperties = {
    position: fill,
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
  };

  return <div ref={mountRef} className={className} style={style} aria-hidden="true" />;
}
```

验证:`npx tsc --noEmit`(或现有 typecheck)通过;组件可被 import。

---

## Step 3 — 样式 `dashboard/src/App.css`(追加到文件末尾)

```css
/* ===== Cosmic 3D 作用域(仅登录页 + 总览页) ===== */
.cosmic-route {
  --bg: transparent;
  --bg-card: rgba(18, 22, 40, .55);
  --bg-hover: rgba(255, 255, 255, .06);
  --ink: #f5f5f4;
  --ink-secondary: #c7c9d1;
  --ink-muted: #8b8fa3;
  --border: rgba(255, 255, 255, .12);
  background:
    radial-gradient(120% 120% at 50% 30%, #141a33 0%, #0b1020 45%, #05060d 100%);
}

.cosmic-route .login-card,
.cosmic-route .kpi-card,
.cosmic-route .tool-card,
.cosmic-route .card {
  background: var(--bg-card);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-color: var(--border);
}

/* 登录页:让画布/深空底透出,内容浮层 */
.cosmic-route.login-page { background: transparent; }
.cosmic-route .login-shell { position: relative; z-index: 1; }
.cosmic-route .login-card input {
  background: rgba(255, 255, 255, .06);
  color: var(--ink);
  border-color: var(--border);
}
.cosmic-route .login-card input::placeholder { color: var(--ink-muted); }
.cosmic-route .login-word { filter: drop-shadow(0 0 12px rgba(120, 150, 255, .5)); }
.cosmic-route .login-tag { color: var(--ink-secondary); }

/* 总览:画布锁在内容面板内 */
.main-content.cosmic { position: relative; overflow: hidden; }
.main-content.cosmic .console-topbar { position: relative; z-index: 1; background: transparent; }
.cosmic-overview > .cosmic-content { position: relative; z-index: 1; }
```

> 说明:`.cosmic-route` 的径向渐变同时充当无 WebGL 兜底底。若实测玻璃卡片文字对比度偏低,把 `--bg-card` 的 alpha 从 `.55` 上调至 `.7`。

---

## Step 4 — 登录页 `dashboard/src/pages/Login.tsx`

1. 顶部加 import:`import CosmicBackground from '../components/CosmicBackground';`
2. 最外层 div 加类:`<div className="login-page cosmic-route">`
3. 在该 div 内、`<div className="login-shell">` 之前插入:
   `<CosmicBackground variant="login" fill="fixed" />`

---

## Step 5 — 总览页 `dashboard/src/pages/Overview.tsx`

1. 顶部加 import:`import CosmicBackground from '../components/CosmicBackground';`
2. 把现有 `return ( <div> ... </div> )` 最外层改为:
   ```tsx
   return (
     <div className="cosmic-route cosmic-overview">
       <CosmicBackground variant="overview" fill="absolute" />
       <div className="cosmic-content">
         {/* 原有全部内容(page-header、grid-4、section 等)原样放这里 */}
       </div>
     </div>
   );
   ```
   即:用 `cosmic-route cosmic-overview` 包裹,首子元素是画布,其余原内容包进 `cosmic-content`。

---

## Step 6 — 布局 `dashboard/src/components/Layout.tsx`

1. 在组件内已有 `const location = useLocation();` 之后加:
   `const isOverview = location.pathname === '/';`
2. 找到 `<main className={\`main-content${isVizPreview ? ' visual-preview-main' : ''}\`}>`,改为:
   `<main className={\`main-content${isVizPreview ? ' visual-preview-main' : ''}${isOverview ? ' cosmic' : ''}\`}>`
3. 不做其它改动(不碰 Sidebar)。

---

## Step 7 — 构建与验证

```bash
cd dashboard
npm run build   # 或现有 lint + tsc
```

逐条核对 spec §9 验收标准:

- [ ] `/login` 全窗星场 + 视差 + 玻璃登录卡,文字清晰。
- [ ] `/` 内容面板内星场(更暗更慢),侧边栏仍浅色;KPI/网格/代码块可读。
- [ ] 其它路由(`/agents`、`/skills` 等)外观与改造前一致,无深色泄漏。
- [ ] 后台标签页动画暂停,返回恢复。
- [ ] `prefers-reduced-motion` 开启时无动画(只静态一帧)。
- [ ] 模拟无 WebGL:两页显示静态深空底,不白屏不报错。
- [ ] 多次进出登录/总览,无控制台报错(资源已 dispose)。
- [ ] 构建通过。

---

## Step 8 — 提交

只提交本计划涉及文件,不要 `git add -A`:

```bash
git add dashboard/package.json dashboard/package-lock.json \
        dashboard/src/components/CosmicBackground.tsx \
        dashboard/src/App.css \
        dashboard/src/pages/Login.tsx \
        dashboard/src/pages/Overview.tsx \
        dashboard/src/components/Layout.tsx
git commit -m "feat(dashboard): deep-space 3D background on login + overview (Three.js)"
```

---

## 交付后(Claude 负责验收)

- 跑起前端,实机看 `/login` 与 `/`,核对 §9 全部验收点。
- 回归至少 2 个其它路由确认无深色泄漏。
- 检查控制台无报错、进出页面无 GPU 资源泄漏。
```
