import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { makePlanetTexture } from '../utils/planet';

interface CosmicBackgroundProps {
  variant: 'login' | 'overview';
  fill?: 'fixed' | 'absolute';
  hero?: boolean;
  className?: string;
}

const PRESET = {
  login: { count: 2600, speed: 1.0, parallax: 1.0, opacity: 1.0 },
  overview: { count: 1400, speed: 0.55, parallax: 0.5, opacity: 0.7 },
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

function makeStarTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface LayerConfig {
  depth: number;
  size: number;
  speedMul: number;
  parallaxMul: number;
  frac: number;
}

export default function CosmicBackground({ variant, fill = 'fixed', hero = false, className }: CosmicBackgroundProps) {
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

    const LAYERS: LayerConfig[] = [
      { depth: 1400, size: 1.4, speedMul: 0.4, parallaxMul: 0.3, frac: 0.5 },
      { depth: 900, size: 2.2, speedMul: 0.8, parallaxMul: 0.6, frac: 0.3 },
      { depth: 500, size: 3.2, speedMul: 1.4, parallaxMul: 1.0, frac: 0.2 },
    ];

    const starTexture = makeStarTexture();
    const spread = 1600;
    const groups: THREE.Points[] = [];
    LAYERS.forEach((layer) => {
      const n = Math.max(1, Math.floor(preset.count * layer.frac * densityFactor));
      const positions = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
        positions[i * 3 + 2] = Math.random() * layer.depth;
        const c = pickColor();
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: layer.size * 2.4,
        map: starTexture,
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

    // 3D 主体:带贴图的气态巨行星 + 大气辉光 + 扁平光环 + 卫星
    let planetGroup: THREE.Group | null = null;
    let heroSphere: THREE.Mesh | null = null;
    let heroMoon: THREE.Mesh | null = null;
    let heroMoonAngle = Math.random() * Math.PI * 2;
    const heroDisposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
    if (hero) {
      planetGroup = new THREE.Group();
      const R = 132;

      const planetTex = makePlanetTexture('gas', '#3b5bd0');
      const planetGeo = new THREE.SphereGeometry(R, 64, 64);
      const planetMat = new THREE.MeshStandardMaterial({ map: planetTex, roughness: 0.85, metalness: 0.15 });
      heroSphere = new THREE.Mesh(planetGeo, planetMat);
      planetGroup.add(heroSphere);

      const atmoGeo = new THREE.SphereGeometry(R * 1.16, 64, 64);
      const atmoMat = new THREE.MeshBasicMaterial({
        color: 0x6aa0ff, transparent: true, opacity: 0.22,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      planetGroup.add(new THREE.Mesh(atmoGeo, atmoMat));

      const ringGeo = new THREE.RingGeometry(R * 1.45, R * 2.25, 128);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xc98a5a, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 - 0.42;
      planetGroup.add(ring);

      const moonTex = makePlanetTexture('rock', '#cbb89a');
      const moonGeo = new THREE.SphereGeometry(R * 0.18, 32, 32);
      const moonMat = new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.95 });
      heroMoon = new THREE.Mesh(moonGeo, moonMat);
      planetGroup.add(heroMoon);

      planetGroup.rotation.z = 0.28;
      if (variant === 'login') planetGroup.position.set(40, 250, -60);
      else planetGroup.position.set(380, 150, -80);
      planetGroup.scale.setScalar(variant === 'login' ? 1 : 0.66);
      scene.add(planetGroup);

      const dir = new THREE.DirectionalLight(0xffffff, 2.0);
      dir.position.set(-0.8, 0.4, 1);
      scene.add(dir);
      scene.add(new THREE.AmbientLight(0x33406a, 0.55));

      heroDisposables.push(planetTex, planetGeo, planetMat, atmoGeo, atmoMat, ringGeo, ringMat, moonTex, moonGeo, moonMat);
    }

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
        const layer = pts.userData as LayerConfig;
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
      if (planetGroup) {
        if (heroSphere) heroSphere.rotation.y += dt * 0.07;
        if (heroMoon) {
          heroMoonAngle += dt * 0.5;
          heroMoon.position.set(Math.cos(heroMoonAngle) * 258, Math.sin(heroMoonAngle) * 20, Math.sin(heroMoonAngle) * 90);
        }
        planetGroup.rotation.y += (pointer.x * 0.2 - planetGroup.rotation.y) * 0.04;
      }
      renderOnce();
    };

    if (reduceMotion) {
      renderOnce();
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
      heroDisposables.forEach((d) => d.dispose());
      starTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [variant, fill, hero]);

  const style: React.CSSProperties = {
    position: fill,
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
  };

  return <div ref={mountRef} className={className} style={style} aria-hidden="true" />;
}
