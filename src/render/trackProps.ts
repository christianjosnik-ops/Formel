import * as THREE from 'three';
import type { Track } from '../world/track';

/**
 * Streckenausstattung wie an echten Kursen: Bremsmarkierungen (300/200/100 m), Kurvennummern,
 * Fangzäune an schnellen Kurven, Überführungen mit Werbebannern, Flutlichtmasten.
 */

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function idxAt(t: Track, s: number): number {
  return (Math.round((((s % t.length) + t.length) % t.length) / t.ds) + t.n) % t.n;
}

/** Kurvenscheitel: lokale Maxima der Kurvenschwere, mit Mindestabstand. */
export function findCorners(t: Track, minSev = 0.3, minGap = 160): number[] {
  const res: number[] = [];
  const n = t.n;
  for (let i = 0; i < n; i++) {
    const sv = t.sev[i];
    if (sv < minSev) continue;
    let isMax = true;
    for (let k = -25; k <= 25; k++) if (t.sev[(i + k + n) % n] > sv) isMax = false;
    if (!isMax) continue;
    if (res.some((r) => Math.min(Math.abs(t.s[r] - t.s[i]), t.length - Math.abs(t.s[r] - t.s[i])) < minGap)) continue;
    res.push(i);
  }
  return res.sort((a, b) => a - b);
}

export function addTrackProps(scene: THREE.Scene, t: Track): void {
  const corners = findCorners(t);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  // ---- Bremsmarkierungen: drei Tafeln (300/200/100 m) links der Strecke vor jeder engen Kurve ----
  {
    const digits = ['300', '200', '100'];
    const mats = digits.map(
      (d) =>
        new THREE.MeshBasicMaterial({
          map: tex(128, 128, (g) => {
            g.fillStyle = '#f4f4f4';
            g.fillRect(0, 0, 128, 128);
            g.fillStyle = '#d10000';
            const bars = d === '300' ? 3 : d === '200' ? 2 : 1;
            for (let b = 0; b < bars; b++) g.fillRect(14 + b * 38, 10, 22, 108);
            g.fillStyle = '#111';
            g.font = '900 28px Arial';
            g.textAlign = 'center';
            g.fillText(d, 64, 124);
          }),
        }),
    );
    const geo = new THREE.PlaneGeometry(1.2, 1.2);
    for (const ci of corners) {
      if (t.sev[ci] < 0.45) continue;
      const side = t.curv[ci] > 0 ? 1 : -1; // Tafeln auf der Kurveninnenseite der Anfahrt
      digits.forEach((_, k) => {
        const i = idxAt(t, t.s[ci] - (300 - k * 100) - 35);
        const edge = side === 1 ? t.wl[i] + t.pitW[i] : t.wr[i];
        const o = edge + 1.6;
        const x = t.x[i] + t.nx(i) * side * o;
        const y = t.y[i] + t.ny(i) * side * o;
        const m = new THREE.Mesh(geo, mats[k]);
        m.position.set(x, t.elev[i] + 1.0, -y);
        m.rotation.y = t.hdg[i] + Math.PI / 2;
        scene.add(m);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 5), new THREE.MeshStandardMaterial({ color: 0x777b80 }));
        post.position.set(x, t.elev[i] + 0.5, -y);
        scene.add(post);
      });
    }
  }

  // ---- Kurvennummern am Scheitel, außen ----
  corners.forEach((ci, k) => {
    const side = t.curv[ci] > 0 ? -1 : 1;
    const edge = side === 1 ? t.wl[ci] + t.pitW[ci] + t.kerbL[ci] : t.wr[ci] + t.kerbR[ci];
    const off = (side === 1 ? t.barrierL[ci] : t.barrierR[ci]) + 1.4;
    const o = Math.max(edge + 2, (side === 1 ? t.wl[ci] : t.wr[ci]) + off);
    const map = tex(128, 128, (g) => {
      g.fillStyle = '#ffd200';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#111';
      g.lineWidth = 8;
      g.strokeRect(4, 4, 120, 120);
      g.fillStyle = '#111';
      g.font = '900 78px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(k + 1), 64, 70);
    });
    const x = t.x[ci] + t.nx(ci) * side * o;
    const y = t.y[ci] + t.ny(ci) * side * o;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
    sign.position.set(x, t.elev[ci] + 2.6, -y);
    // zur Strecke hin ausrichten
    sign.rotation.y = Math.atan2(-(t.nx(ci) * side), -(t.ny(ci) * side)) + Math.PI;
    scene.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x70757b }));
    post.position.set(x, t.elev[ci] + 1.3, -y);
    scene.add(post);
  });

  // ---- Fangzäune an schnellen Kurven (Außenseite) ----
  {
    const fenceTex = tex(128, 128, (g) => {
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(200,205,210,0.85)';
      g.lineWidth = 2;
      for (let k = -128; k < 256; k += 16) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + 128, 128);
        g.stroke();
        g.beginPath();
        g.moveTo(k + 128, 0);
        g.lineTo(k, 128);
        g.stroke();
      }
    });
    fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
    const fenceMat = new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 5, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6d7278, metalness: 0.5, roughness: 0.6 });
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const posts: Array<[number, number, number]> = [];
    let vc = 0;
    for (const ci of corners) {
      if (t.sev[ci] < 0.3) continue;
      const side: 1 | -1 = t.curv[ci] > 0 ? -1 : 1;
      const from = Math.round(-90 / t.ds);
      const to = Math.round(110 / t.ds);
      for (let k = from; k < to; k++) {
        const i = (ci + k + t.n) % t.n;
        const j = (i + 1) % t.n;
        const off = (a: number) => (side === 1 ? t.wl[a] + t.barrierL[a] : t.wr[a] + t.barrierR[a]) + 0.9;
        for (const [a, o] of [[i, off(i)], [j, off(j)]] as const) {
          const px = t.x[a] + t.nx(a) * side * o;
          const py = t.y[a] + t.ny(a) * side * o;
          pos.push(px, t.elev[a] + 0.2, -py, px, t.elev[a] + 5.0, -py);
          const u = (t.s[a] + (a < i ? t.length : 0)) / 4;
          uv.push(u, 0, u, 1.2);
        }
        idx.push(vc, vc + 1, vc + 2, vc + 1, vc + 3, vc + 2);
        vc += 4;
        if (k % 3 === 0) posts.push([t.x[i] + t.nx(i) * side * off(i), t.elev[i] + 2.5, -(t.y[i] + t.ny(i) * side * off(i))]);
      }
    }
    if (vc > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, fenceMat));
      const im = new THREE.InstancedMesh(postGeo, postMat, posts.length);
      posts.forEach((p, k) => {
        m4.makeTranslation(p[0], p[1], p[2]);
        im.setMatrixAt(k, m4);
      });
      scene.add(im);
    }
  }

  // ---- Überführungen mit Banner (zwei je Strecke) ----
  {
    const steel = new THREE.MeshStandardMaterial({ color: 0x4d5258, metalness: 0.6, roughness: 0.5 });
    const banner = (name: string) =>
      new THREE.MeshBasicMaterial({
        map: tex(1024, 128, (g) => {
          g.fillStyle = '#0d1016';
          g.fillRect(0, 0, 1024, 128);
          g.fillStyle = '#e10600';
          g.fillRect(0, 0, 1024, 10);
          g.fillStyle = '#fff';
          g.font = '800 76px Arial';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(name, 512, 70);
        }),
      });
    const spots = [0.37, 0.71].map((f) => idxAt(t, t.length * f));
    const names = ['APEX VELOCE', 'NOVA STRATOS'];
    spots.forEach((i, k) => {
      const hw = Math.max(t.wl[i], t.wr[i]) + 7;
      const grp = new THREE.Group();
      for (const s of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9.5, 0.8), steel);
        pillar.position.set(0, 4.75, s * hw);
        grp.add(pillar);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, hw * 2), steel);
      beam.position.set(0, 9.3, 0);
      grp.add(beam);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.7, 1.15), banner(names[k]));
      b.position.set(-0.65, 9.3, 0);
      b.rotation.y = -Math.PI / 2;
      grp.add(b);
      const b2 = b.clone();
      b2.position.x = 0.65;
      b2.rotation.y = Math.PI / 2;
      grp.add(b2);
      grp.position.set(t.x[i] + t.nx(i) * (t.wl[i] - t.wr[i]) * 0.5, t.elev[i], -(t.y[i] + t.ny(i) * (t.wl[i] - t.wr[i]) * 0.5));
      grp.rotation.y = t.hdg[i];
      scene.add(grp);
    });
  }

  // ---- Flutlichtmasten entlang der Start/Ziel-Geraden und an Tribünen ----
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.6, roughness: 0.5 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    const slots: number[] = [];
    for (let s = -380; s <= 340; s += 90) slots.push(idxAt(t, s));
    for (const ci of corners.slice(0, 5)) slots.push(ci);
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 22, 6), poleMat, slots.length * 2);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 0.5, 1.4), lampMat, slots.length * 2);
    let c = 0;
    for (const i of slots) {
      for (const side of [1, -1] as const) {
        const o = (side === 1 ? t.wl[i] + t.barrierL[i] : t.wr[i] + t.barrierR[i]) + 6;
        const x = t.x[i] + t.nx(i) * side * o;
        const y = t.y[i] + t.ny(i) * side * o;
        q.setFromAxisAngle(yAxis, t.hdg[i]);
        m4.compose(new THREE.Vector3(x, t.elev[i] + 11, -y), q, one);
        pole.setMatrixAt(c, m4);
        m4.compose(new THREE.Vector3(x, t.elev[i] + 22.2, -y), q, one);
        head.setMatrixAt(c, m4);
        c++;
      }
    }
    scene.add(pole, head);
  }
}
