import * as THREE from 'three';
import { S } from '../physics/layout';
import type { CarModel } from './carModel';

export type CameraMode = 'chase' | 'cockpit' | 'tv' | 'heli' | 'showroom';
export const CAMERA_MODES: CameraMode[] = ['chase', 'cockpit', 'tv', 'heli', 'showroom'];

export class CameraRig {
  mode: CameraMode = 'chase';
  private yaw = 0;
  private yawInit = false;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tvPos = new THREE.Vector3();
  private tvValid = false;
  // Showroom
  private az = 0.9;
  private el = 0.22;
  private dist = 7.2;
  private idle = 0;
  private fov = 62;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
  ) {
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const pinch = new Map<number, { x: number; y: number }>();
    let pd = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'showroom') return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.mode !== 'showroom') return;
      if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pd) this.dist = Math.min(14, Math.max(3.2, this.dist * (pd / d)));
        pd = d;
        return;
      }
      if (!dragging) return;
      this.az -= (e.clientX - lx) * 0.008;
      this.el = Math.min(1.4, Math.max(-0.05, this.el + (e.clientY - ly) * 0.006));
      lx = e.clientX;
      ly = e.clientY;
      this.idle = 0;
    });
    const up = (e: PointerEvent) => {
      dragging = false;
      pinch.delete(e.pointerId);
      pd = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'showroom') return;
        this.dist = Math.min(14, Math.max(3.2, this.dist * (1 + e.deltaY * 0.001)));
      },
      { passive: true },
    );
  }

  cycle(car: CarModel): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length], car);
    return this.mode;
  }

  setMode(m: CameraMode, car: CarModel): void {
    this.mode = m;
    this.yawInit = false;
    this.tvValid = false;
    car.setFirstPerson(m === 'cockpit');
  }

  update(snap: Float64Array, dt: number, car: CarModel): void {
    const cam = this.camera;
    const px = snap[S.x];
    const pz = -snap[S.y];
    const psi = snap[S.psi];
    const speed = snap[S.speedKmh] / 3.6;
    let targetFov = 62;

    switch (this.mode) {
      case 'chase': {
        // Kamera-Gieren folgt dem Fahrzeug weich (Drift bleibt sichtbar)
        if (!this.yawInit) {
          this.yaw = psi;
          this.yawInit = true;
        }
        let d = psi - this.yaw;
        d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        this.yaw += d * Math.min(1, dt * 5);
        const fx = Math.cos(this.yaw);
        const fz = -Math.sin(this.yaw);
        const dist = 6.8 + Math.min(speed, 90) * 0.012;
        const h = 1.9 + Math.min(speed, 90) * 0.004;
        this.pos.set(px - fx * dist, h, pz - fz * dist);
        this.look.set(px + fx * 3.0, 0.75, pz + fz * 3.0);
        targetFov = 60 + Math.min(speed, 100) * 0.14;
        break;
      }
      case 'cockpit': {
        car.eyeWorld(this.pos);
        const fx = Math.cos(psi);
        const fz = -Math.sin(psi);
        this.look.set(this.pos.x + fx * 20, this.pos.y - 0.4 + snap[S.pitch] * 6, this.pos.z + fz * 20);
        targetFov = 78;
        break;
      }
      case 'tv': {
        const fx = Math.cos(psi);
        const fz = -Math.sin(psi);
        if (!this.tvValid || this.tvPos.distanceTo(this.tmp.set(px, 1.5, pz)) > 90) {
          const side = (Math.floor(snap[S.x] / 97) & 1) === 0 ? 1 : -1;
          this.tvPos.set(px + fx * 55 - fz * 10 * side, 1.6, pz + fz * 55 + fx * 10 * side);
          this.tvValid = true;
        }
        // Wenn das Auto die Kamera fast erreicht hat, weiter vorn neu setzen
        if (this.tvPos.distanceTo(this.tmp.set(px, 1.5, pz)) < 6) this.tvValid = false;
        this.pos.copy(this.tvPos);
        this.look.set(px, 0.6, pz);
        const dd = this.pos.distanceTo(this.look);
        targetFov = Math.max(14, Math.min(55, 1200 / Math.max(dd, 12)));
        break;
      }
      case 'heli': {
        if (!this.yawInit) {
          this.yaw = psi;
          this.yawInit = true;
        }
        let d = psi - this.yaw;
        d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        this.yaw += d * Math.min(1, dt * 1.6);
        const fx = Math.cos(this.yaw);
        const fz = -Math.sin(this.yaw);
        this.pos.set(px - fx * 70, 48 + Math.min(speed, 90) * 0.15, pz - fz * 70);
        this.look.set(px + fx * 25, 0, pz + fz * 25);
        targetFov = 52;
        break;
      }
      case 'showroom': {
        this.idle += dt;
        if (this.idle > 2.5) this.az += dt * 0.25;
        const cy = 0.45;
        this.pos.set(
          px + Math.cos(this.az + psi) * Math.cos(this.el) * this.dist,
          cy + Math.sin(this.el) * this.dist,
          pz - Math.sin(this.az + psi) * Math.cos(this.el) * this.dist,
        );
        this.look.set(px, cy, pz);
        targetFov = 38;
        break;
      }
    }
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
  }
}
