import * as THREE from 'three';

export type PlanetKind = 'gas' | 'rock' | 'ocean' | 'ice' | 'lava' | 'metal' | 'swirl';

export function mix(hex: string, target: string, t: number) {
  return new THREE.Color(hex).lerp(new THREE.Color(target), t).getStyle();
}

/** 程序化生成行星表面贴图(canvas → CanvasTexture)。 */
export function makePlanetTexture(kind: PlanetKind, hex: string): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d')!;
  const rnd = () => Math.random();

  if (kind === 'gas' || kind === 'swirl') {
    x.fillStyle = mix(hex, '#000000', 0.5);
    x.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      const h = 6 + rnd() * 22;
      x.fillStyle = mix(hex, rnd() > 0.5 ? '#ffffff' : '#000000', 0.15 + rnd() * 0.4);
      if (kind === 'swirl') {
        x.save();
        x.translate(s / 2, s / 2);
        x.rotate((y / s) * 0.6);
        x.fillRect(-s, y - s / 2, s * 2, h);
        x.restore();
      } else {
        x.fillRect(0, y, s, h);
      }
      y += h;
    }
  } else if (kind === 'rock') {
    x.fillStyle = mix(hex, '#000000', 0.42);
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const r = 2 + rnd() * 12;
      x.beginPath();
      x.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
      x.fillStyle = mix(hex, '#000000', 0.5 + rnd() * 0.3);
      x.fill();
      x.lineWidth = 1;
      x.strokeStyle = mix(hex, '#ffffff', 0.25);
      x.stroke();
    }
  } else if (kind === 'ocean') {
    x.fillStyle = mix(hex, '#06203f', 0.35);
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      x.beginPath();
      const px = rnd() * s;
      const py = rnd() * s;
      x.fillStyle = mix(hex, rnd() > 0.5 ? '#3a7d44' : '#caa66a', 0.5);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const rr = 12 + rnd() * 26;
        const lx = px + Math.cos(ang) * rr;
        const ly = py + Math.sin(ang) * rr;
        a === 0 ? x.moveTo(lx, ly) : x.lineTo(lx, ly);
      }
      x.closePath();
      x.fill();
    }
  } else if (kind === 'ice') {
    x.fillStyle = mix(hex, '#ffffff', 0.55);
    x.fillRect(0, 0, s, s);
    x.strokeStyle = mix(hex, '#5b8bd8', 0.4);
    for (let i = 0; i < 26; i++) {
      x.beginPath();
      x.lineWidth = 0.6 + rnd();
      let px = rnd() * s;
      let py = rnd() * s;
      x.moveTo(px, py);
      for (let k = 0; k < 4; k++) {
        px += (rnd() - 0.5) * 60;
        py += (rnd() - 0.5) * 60;
        x.lineTo(px, py);
      }
      x.stroke();
    }
  } else if (kind === 'lava') {
    x.fillStyle = mix(hex, '#000000', 0.78);
    x.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      x.beginPath();
      x.lineWidth = 0.8 + rnd() * 2.4;
      x.strokeStyle = rnd() > 0.5 ? mix(hex, '#ffb84d', 0.6) : '#ff5a2c';
      let px = rnd() * s;
      let py = rnd() * s;
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) {
        px += (rnd() - 0.5) * 44;
        py += (rnd() - 0.5) * 44;
        x.lineTo(px, py);
      }
      x.stroke();
    }
  } else {
    // metal
    const grad = x.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, mix(hex, '#ffffff', 0.3));
    grad.addColorStop(0.5, mix(hex, '#000000', 0.35));
    grad.addColorStop(1, mix(hex, '#ffffff', 0.15));
    x.fillStyle = grad;
    x.fillRect(0, 0, s, s);
    x.strokeStyle = mix(hex, '#000000', 0.5);
    for (let i = 0; i < 40; i++) {
      x.beginPath();
      x.lineWidth = 0.5;
      const y = rnd() * s;
      x.moveTo(0, y);
      x.lineTo(s, y + (rnd() - 0.5) * 8);
      x.stroke();
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
