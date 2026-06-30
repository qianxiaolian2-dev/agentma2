import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import LineIcon from './LineIcon';
import type { LineIconName } from './LineIcon';
import { makePlanetTexture, mix, type PlanetKind } from '../utils/planet';

export interface UniverseSection {
  path: string;
  title: string;
  desc: string;
  color: string;
  icon: LineIconName;
}

interface PlanetStyle {
  kind: PlanetKind;
  size: number;
  ring: boolean;
  moons: number;
  tilt: number;
}

const STYLES: PlanetStyle[] = [
  { kind: 'gas', size: 18, ring: false, moons: 0, tilt: 0.18 },
  { kind: 'metal', size: 16, ring: true, moons: 0, tilt: 0.42 },
  { kind: 'ocean', size: 15, ring: false, moons: 1, tilt: 0.14 },
  { kind: 'rock', size: 13, ring: false, moons: 0, tilt: 0.3 },
  { kind: 'swirl', size: 17, ring: false, moons: 1, tilt: 0.24 },
  { kind: 'gas', size: 15, ring: false, moons: 0, tilt: 0.5 },
  { kind: 'rock', size: 14, ring: false, moons: 2, tilt: 0.2 },
  { kind: 'ice', size: 14, ring: true, moons: 0, tilt: 0.62 },
  { kind: 'lava', size: 16, ring: false, moons: 0, tilt: 0.32 },
  { kind: 'metal', size: 13, ring: false, moons: 0, tilt: 0.4 },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function CapabilityUniverse({ sections }: { sections: UniverseSection[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const [webgl] = useState(() => hasWebGL());

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !webgl) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = mount.clientWidth || 800;
    let height = mount.clientHeight || 560;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 5000);
    camera.position.set(0, 240, 560);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.cursor = 'grab';
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 240;
    controls.maxDistance = 1100;
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.45;
    controls.minPolarAngle = Math.PI * 0.16;
    controls.maxPolarAngle = Math.PI * 0.84;

    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const texs: THREE.Texture[] = [];

    // 中心恒星
    const sunTex = makePlanetTexture('lava', '#ffcc66');
    texs.push(sunTex);
    const sunGeo = new THREE.SphereGeometry(34, 48, 48);
    const sunMat = new THREE.MeshBasicMaterial({ map: sunTex, color: 0xffe0a0 });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sun);
    geos.push(sunGeo); mats.push(sunMat);
    [54, 78].forEach((r, i) => {
      const g = new THREE.SphereGeometry(r, 40, 40);
      const m = new THREE.MeshBasicMaterial({
        color: 0xffb060, transparent: true, opacity: i ? 0.06 : 0.16,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      scene.add(new THREE.Mesh(g, m));
      geos.push(g); mats.push(m);
    });

    const light = new THREE.PointLight(0xfff0d0, 2.6, 0, 1.0);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x3a4470, 0.75));

    interface Moon { mesh: THREE.Mesh; angle: number; radius: number; speed: number; }
    interface Planet {
      group: THREE.Group;
      sphere: THREE.Mesh;
      moons: Moon[];
      angle: number;
      radius: number;
      speed: number;
      spin: number;
      label: HTMLButtonElement;
      section: UniverseSection;
    }
    const planets: Planet[] = [];

    const labelLayer = document.createElement('div');
    labelLayer.className = 'universe-labels';
    mount.appendChild(labelLayer);

    sections.forEach((s, i) => {
      const style = STYLES[i % STYLES.length];
      const radius = 116 + i * 42;
      const color = new THREE.Color(s.color);
      const group = new THREE.Group();
      group.rotation.z = style.tilt;

      const tex = makePlanetTexture(style.kind, s.color);
      texs.push(tex);
      const geo = new THREE.SphereGeometry(style.size, 40, 40);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: style.kind === 'metal' ? 0.35 : 0.8,
        metalness: style.kind === 'metal' ? 0.7 : 0.15,
        emissive: style.kind === 'lava' ? color : new THREE.Color(0x000000),
        emissiveMap: style.kind === 'lava' ? tex : null,
        emissiveIntensity: style.kind === 'lava' ? 1.1 : 0,
      });
      const sphere = new THREE.Mesh(geo, mat);
      group.add(sphere);
      geos.push(geo); mats.push(mat);

      if (style.ring) {
        const rGeo = new THREE.RingGeometry(style.size * 1.5, style.size * 2.4, 64);
        const rMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = Math.PI / 2 - 0.3;
        group.add(ring);
        geos.push(rGeo); mats.push(rMat);
      }

      const moons: Moon[] = [];
      for (let m = 0; m < style.moons; m++) {
        const mGeo = new THREE.SphereGeometry(style.size * 0.28, 16, 16);
        const mMat = new THREE.MeshStandardMaterial({ color: mix(s.color, '#ffffff', 0.4), roughness: 0.9 });
        const moon = new THREE.Mesh(mGeo, mMat);
        group.add(moon);
        geos.push(mGeo); mats.push(mMat);
        moons.push({ mesh: moon, angle: Math.random() * Math.PI * 2, radius: style.size * (2 + m * 0.8), speed: 1.2 + m * 0.5 });
      }

      // 轨道环
      const orbGeo = new THREE.RingGeometry(radius - 0.4, radius + 0.4, 180);
      const orbMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
      const orbit = new THREE.Mesh(orbGeo, orbMat);
      orbit.rotation.x = Math.PI / 2;
      scene.add(orbit);
      geos.push(orbGeo); mats.push(orbMat);

      scene.add(group);

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'planet-tag';
      label.style.setProperty('--c', s.color);
      label.innerHTML =
        `<span class="planet-tag-code">${ROMAN[i] ?? i + 1}</span>` +
        `<span class="planet-tag-name">${s.title}</span>` +
        `<span class="planet-tag-desc">${s.desc}</span>`;
      label.addEventListener('click', () => navRef.current(s.path));
      labelLayer.appendChild(label);

      planets.push({
        group, sphere, moons, label, section: s,
        angle: (i / sections.length) * Math.PI * 2,
        radius,
        speed: 2.4 / Math.sqrt(radius),
        spin: 0.2 + Math.random() * 0.4,
      });
    });

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered: Planet | null = null;
    const setHover = (p: Planet | null) => {
      if (hovered === p) return;
      if (hovered) hovered.label.classList.remove('is-hover');
      hovered = p;
      if (hovered) hovered.label.classList.add('is-hover');
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    };
    const onMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(planets.map((p) => p.sphere))[0];
      setHover(hit ? planets.find((p) => p.sphere === hit.object) ?? null : null);
    };
    const onClick = () => { if (hovered) navRef.current(hovered.section.path); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('click', onClick);

    const clock = new THREE.Clock();
    const proj = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let raf = 0;
    let running = true;

    const animate = () => {
      if (!running) return;
      raf = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      planets.forEach((p) => {
        if (!reduce) p.angle += dt * p.speed * 0.12;
        p.group.position.set(Math.cos(p.angle) * p.radius, Math.sin(p.angle * 1.4) * 7, Math.sin(p.angle) * p.radius);
        p.sphere.rotation.y += dt * p.spin;
        p.moons.forEach((mn) => {
          if (!reduce) mn.angle += dt * mn.speed;
          mn.mesh.position.set(Math.cos(mn.angle) * mn.radius, Math.sin(mn.angle * 1.6) * 2, Math.sin(mn.angle) * mn.radius);
        });
        const t = hovered === p ? 1.35 : 1;
        p.group.scale.lerp(scl.set(t, t, t), 0.15);
        proj.copy(p.group.position).project(camera);
        const px = (proj.x * 0.5 + 0.5) * width;
        const py = (-proj.y * 0.5 + 0.5) * height;
        p.label.style.transform = `translate(-50%, -160%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
        p.label.style.opacity = proj.z < 1 ? '1' : '0';
      });
      sun.rotation.y += dt * 0.12;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      width = mount.clientWidth || 800;
      height = mount.clientHeight || 560;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const onVisibility = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; clock.getDelta(); animate(); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      controls.dispose();
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      renderer.dispose();
      labelLayer.remove();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [sections, webgl]);

  if (!webgl) {
    return (
      <div className="grid-3 mb-4">
        {sections.map((s) => (
          <Link key={s.path} to={s.path} style={{ textDecoration: 'none' }}>
            <div className="tool-card" style={{ borderTop: `3px solid ${s.color}` }}>
              <div className="overview-module-icon" style={{ color: s.color }}>
                <LineIcon name={s.icon} />
              </div>
              <div className="tool-card-name" style={{ color: s.color }}>{s.title}</div>
              <div className="tool-card-desc">{s.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="universe-wrap">
      <div ref={mountRef} className="universe-stage" />
      <div className="universe-hint">拖动旋转 · 滚轮缩放 · 点击行星进入</div>
    </div>
  );
}
