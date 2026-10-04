import * as THREE from 'three';
import type { RacingLine } from '../race/line';
import type { Track } from '../world/track';

/**
 * Ideallinie als Fahrhilfe: ein flaches Band auf der Strecke entlang der berechneten Ideallinie, eingefärbt nach dem
 * Geschwindigkeitsprofil – grün: Gas, gelb: leicht lupfen, orange/rot: bremsen (die Farbe zeigt, was vor dir liegt).
 */
export class RacingLineVis {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, track: Track, line: RacingLine) {
    const n = line.n;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    const look = Math.round(70 / track.ds); // Bremsvorschau ~70 m
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = line.x[j] - line.x[i];
      const dy = line.y[j] - line.y[i];
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      const h = track.elev[i] + 0.07;
      const w = 0.5;
      pos.set([line.x[i] + nx * w, h, -(line.y[i] + ny * w)], i * 6);
      pos.set([line.x[i] - nx * w, h, -(line.y[i] - ny * w)], i * 6 + 3);
      // geringste Geschwindigkeit in der Vorschau gegenüber jetzt
      let vmin = line.speed[i];
      for (let k = 1; k <= look; k++) vmin = Math.min(vmin, line.speed[(i + k) % n]);
      const drop = line.speed[i] - vmin;
      if (drop > 14) c.setRGB(0.95, 0.12, 0.08);
      else if (drop > 6) c.setRGB(1.0, 0.45, 0.05);
      else if (drop > 2) c.setRGB(1.0, 0.85, 0.1);
      else c.setRGB(0.15, 0.9, 0.35);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
      const a = i * 2;
      const b = j * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }
}
