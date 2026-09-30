import * as THREE from 'three';
import { BODY_CONE, BODY_STRIDE, MAX_BODIES, S } from '../physics/layout';
import type { SurfaceKind, World2D } from '../world/provingGround';

const TILE = 8;

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function noiseTexture(base: [number, number, number], amp: number, speck: Array<[number, number, number]>, seed: number, size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    const n = (r() - 0.5) * amp + (r() - 0.5) * amp * 0.5;
    img.data[i * 4] += n;
    img.data[i * 4 + 1] += n;
    img.data[i * 4 + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < size * 6; i++) {
    const c2 = speck[Math.floor(r() * speck.length)];
    g.fillStyle = `rgba(${c2[0]},${c2[1]},${c2[2]},${0.1 + r() * 0.3})`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2.2, 1 + r() * 2.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const TEX: Record<SurfaceKind, () => THREE.CanvasTexture> = {
  asphalt: () =>
    noiseTexture([58, 60, 63], 34, [[150, 150, 150], [20, 20, 22], [190, 190, 190]], 1234, 1024),
  gravel: () => noiseTexture([150, 140, 122], 70, [[220, 210, 190], [90, 84, 72], [180, 170, 150]], 77),
  grass: () => noiseTexture([72, 104, 52], 36, [[40, 80, 30], [120, 150, 70], [90, 120, 50]], 91),
  sand: () => noiseTexture([206, 184, 140], 26, [[230, 210, 170], [170, 150, 110]], 5),
};

export function grassTexture(): THREE.CanvasTexture {
  return TEX.grass();
}

function concreteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b9bbbd';
  g.fillRect(0, 0, 256, 128);
  const r = rng(5);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${90 + r() * 90},${90 + r() * 90},${90 + r() * 90},0.12)`;
    g.fillRect(r() * 256, r() * 128, 2, 2);
  }
  // rot-weißes Band auf Kopfhöhe
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f1f1f1' : '#c4212a';
    g.fillRect(i * 32, 8, 32, 26);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 100, 256, 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export interface WorldVisuals {
  /** Setzt die Kegel gemäß Snapshot (bewegte Kegel) und stellt alle anderen an ihren Platz. */
  updateCones: (snap: Float64Array) => void;
}

/** Erzeugt die sichtbare Welt aus den Kartendaten (Untergründe, Wände, Kegel, Markierungen). */
export function buildWorldVisuals(scene: THREE.Scene, map: World2D): WorldVisuals {
  // ---- Untergründe ----
  const layer: Record<SurfaceKind, number> = { asphalt: 0.004, gravel: 0.007, sand: 0.008, grass: 0 };
  const texCache = new Map<SurfaceKind, THREE.CanvasTexture>();
  for (const r of map.surfaces) {
    if (!texCache.has(r.kind)) texCache.set(r.kind, TEX[r.kind]());
    const base = texCache.get(r.kind)!;
    const tex = base.clone();
    tex.needsUpdate = true;
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    tex.repeat.set(w / TILE, h / TILE);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: r.kind === 'asphalt' ? 0.9 : 1, metalness: 0 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.x0 + r.x1) / 2, layer[r.kind], -(r.y0 + r.y1) / 2);
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---- Markierungen auf der Hauptgerade ----
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  {
    const cvs = document.createElement('canvas');
    cvs.width = 128;
    cvs.height = 32;
    const g = cvs.getContext('2d')!;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const ct = new THREE.CanvasTexture(cvs);
    ct.colorSpace = THREE.SRGBColorSpace;
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 16), new THREE.MeshBasicMaterial({ map: ct }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.set(-1.0, 0.012, 0);
    scene.add(grid);
    for (const z of [-8.6, 8.6]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(1920, 0.25), white);
      line.rotation.x = -Math.PI / 2;
      line.position.set(440, 0.012, z);
      scene.add(line);
    }
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(6, 0.18), white, 160);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 160; i++) {
      m4.makeRotationX(-Math.PI / 2);
      m4.setPosition(-500 + i * 12, 0.012, 0);
      dash.setMatrixAt(i, m4);
    }
    scene.add(dash);
    // Entfernungstafeln
    for (let d = 100; d <= 1200; d += 100) {
      const c2 = document.createElement('canvas');
      c2.width = 256;
      c2.height = 128;
      const g2 = c2.getContext('2d')!;
      g2.fillStyle = '#ffffff';
      g2.fillRect(0, 0, 256, 128);
      g2.fillStyle = '#c00000';
      g2.fillRect(0, 0, 256, 14);
      g2.fillStyle = '#111';
      g2.font = 'bold 84px Arial';
      g2.textAlign = 'center';
      g2.textBaseline = 'middle';
      g2.fillText(String(d), 128, 72);
      const tex = new THREE.CanvasTexture(c2);
      tex.colorSpace = THREE.SRGBColorSpace;
      for (const side of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        board.position.set(d, 2.6, 11 * side);
        board.rotation.y = -Math.PI / 2;
        scene.add(board);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), new THREE.MeshBasicMaterial({ color: 0x333333 }));
        post.position.set(d, 1.3, 11 * side);
        scene.add(post);
      }
    }
  }

  // ---- Wände ----
  const concrete = map.walls.filter((w) => w.kind === 'concrete');
  const tires = map.walls.filter((w) => w.kind === 'tire');
  const armco = map.walls.filter((w) => w.kind === 'armco');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  if (concrete.length) {
    const ct = concreteTexture();
    const geo = new THREE.BoxGeometry(1, 1.05, 0.6);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: ct, roughness: 0.92 }), concrete.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    concrete.forEach((w, i) => {
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      const ang = Math.atan2(w.by - w.ay, w.bx - w.ax);
      pos.set((w.ax + w.bx) / 2 - w.nx * 0.3, 0.525, -((w.ay + w.by) / 2 - w.ny * 0.3));
      q.setFromAxisAngle(up, ang);
      scl.set(len, 1, 1);
      m4.compose(pos, q, scl);
      mesh.setMatrixAt(i, m4);
    });
    scene.add(mesh);
  }
  if (tires.length) {
    // gestapelte Reifen: 3 Reihen tief, 3 Lagen hoch
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10);
    const rows = 3;
    const layers = 3;
    let count = 0;
    for (const w of tires) count += Math.max(1, Math.round(Math.hypot(w.bx - w.ax, w.by - w.ay) / 0.72)) * rows * layers;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), count);
    mesh.castShadow = true;
    const colors = [0xd52027, 0xf2f2f2, 0x1d1d20, 0x1a4fb5];
    let k = 0;
    const col = new THREE.Color();
    for (const w of tires) {
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      const n = Math.max(1, Math.round(len / 0.72));
      const dx = (w.bx - w.ax) / len;
      const dy = (w.by - w.ay) / len;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * len;
        for (let r = 0; r < rows; r++) {
          const off = 0.4 + r * 0.72;
          for (let l = 0; l < layers; l++) {
            const px = w.ax + dx * t - w.nx * off;
            const py = w.ay + dy * t - w.ny * off;
            pos.set(px, 0.15 + l * 0.3, -py);
            q.identity();
            scl.set(1, 1, 1);
            m4.compose(pos, q, scl);
            mesh.setMatrixAt(k, m4);
            col.setHex(colors[(i + r + l) % colors.length]);
            mesh.setColorAt(k, col);
            k++;
          }
        }
      }
    }
    mesh.count = k;
    scene.add(mesh);
  }
  if (armco.length) {
    const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.34, 0.1), new THREE.MeshStandardMaterial({ color: 0xbfc3c6, metalness: 0.6, roughness: 0.4 }), armco.length);
    const postGeo = new THREE.BoxGeometry(0.1, 0.8, 0.1);
    let posts = 0;
    for (const w of armco) posts += Math.max(1, Math.round(Math.hypot(w.bx - w.ax, w.by - w.ay) / 2)) + 1;
    const postMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x55595c, metalness: 0.5, roughness: 0.6 }), posts);
    let pk = 0;
    armco.forEach((w, i) => {
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
      const ang = Math.atan2(w.by - w.ay, w.bx - w.ax);
      pos.set((w.ax + w.bx) / 2 - w.nx * 0.08, 0.6, -((w.ay + w.by) / 2 - w.ny * 0.08));
      q.setFromAxisAngle(up, ang);
      scl.set(len, 1, 1);
      m4.compose(pos, q, scl);
      rail.setMatrixAt(i, m4);
      const n = Math.max(1, Math.round(len / 2));
      for (let j = 0; j <= n; j++) {
        const t = (j / n) * len;
        pos.set(w.ax + ((w.bx - w.ax) / len) * t - w.nx * 0.16, 0.4, -(w.ay + ((w.by - w.ay) / len) * t - w.ny * 0.16));
        q.identity();
        scl.set(1, 1, 1);
        m4.compose(pos, q, scl);
        postMesh.setMatrixAt(pk++, m4);
      }
    });
    scene.add(rail, postMesh);
  }

  // ---- Kegel (beweglich) ----
  const nCones = map.cones.length;
  const coneGeo = new THREE.ConeGeometry(0.17, 0.5, 12).translate(0, 0.25, 0);
  const base = new THREE.BoxGeometry(0.4, 0.03, 0.4).translate(0, 0.015, 0);
  void base;
  const coneMesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), Math.max(1, nCones));
  coneMesh.castShadow = true;
  const colMap = { orange: 0xff5a1f, white: 0xf2f2f2, yellow: 0xffd21f } as const;
  const tmpC = new THREE.Color();
  map.cones.forEach((c, i) => {
    tmpC.setHex(colMap[c.color]);
    coneMesh.setColorAt(i, tmpC);
  });
  const restMat = map.cones.map((c) => new THREE.Matrix4().makeTranslation(c.x, 0, -c.y));
  restMat.forEach((mtx, i) => coneMesh.setMatrixAt(i, mtx));
  scene.add(coneMesh);
  const moved = new Uint8Array(Math.max(1, nCones));
  const nowMoved = new Uint8Array(Math.max(1, nCones));
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');

  return {
    updateCones: (snap) => {
      nowMoved.fill(0);
      const nb = Math.min(MAX_BODIES, snap[S.nBodies] | 0);
      for (let i = 0; i < nb; i++) {
        const o = S.bodies + i * BODY_STRIDE;
        if (snap[o] !== BODY_CONE) continue;
        const id = snap[o + 7] | 0;
        if (id < 0 || id >= nCones) continue;
        nowMoved[id] = 1;
        const tilt = snap[o + 5];
        // Kegel liegt nach dem Kippen: Rotation um die Querachse, Schwerpunkt nach unten
        eul.set(0, snap[o + 3], -tilt);
        q.setFromEuler(eul);
        pos.set(snap[o + 1], snap[o + 4] + Math.sin(Math.min(tilt, Math.PI / 2)) * 0.11, -snap[o + 2]);
        scl.set(1, 1, 1);
        m4.compose(pos, q, scl);
        coneMesh.setMatrixAt(id, m4);
      }
      let dirty = nb > 0;
      for (let i = 0; i < nCones; i++) {
        if (moved[i] && !nowMoved[i]) {
          coneMesh.setMatrixAt(i, restMat[i]);
          dirty = true;
        }
        moved[i] = nowMoved[i];
      }
      if (dirty) coneMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
