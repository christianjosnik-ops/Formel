import * as THREE from 'three';
import { S } from '../physics/layout';
import type { CarModel } from './carModel';

export type CameraMode = 'chase' | 'tcam' | 'cockpit' | 'nose' | 'tv' | 'side' | 'heli' | 'showroom';
export const CAMERA_MODES: CameraMode[] = ['chase', 'tcam', 'cockpit', 'nose', 'tv', 'side', 'heli', 'showroom'];

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
  private readonly look2 = new THREE.Vector3();
  private readonly lookS = new THREE.Vector3();
  private lookValid = false;
  private shakeT = 0;
  private prevSpeed = 0;
  private accel = 0;
  private lat = 0;
  private tvSwitch = 0;
  private tvSide = 1;

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
    this.lookValid = false;
    car.setFirstPerson(m === 'cockpit');
  }

  update(snap: Float64Array, dt: number, car: CarModel): void {
    const cam = this.camera;
    const px = snap[S.x];
    const pz = -snap[S.y];
    const psi = snap[S.psi];
    const speed = snap[S.speedKmh] / 3.6;
    this.accel += ((speed - this.prevSpeed) / Math.max(dt, 1e-3) - this.accel) * Math.min(1, dt * 4);
    this.prevSpeed = speed;
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
        this.yaw += d * Math.min(1, dt * 4.2);
        const fx = Math.cos(this.yaw);
        const fz = -Math.sin(this.yaw);
        const sx = -fz; // seitlich (rechts)
        const sz = fx;
        const ay = snap[S.ay];
        this.lat += (ay - this.lat) * Math.min(1, dt * 3);
        const dist = 9.6 + Math.min(speed, 95) * 0.022 - Math.max(0, this.accel) * 0.12;
        const h = 2.7 + Math.min(speed, 95) * 0.007;
        // in Kurven wandert die Kamera nach außen, der Blick geht in die Kurve
        const off = -this.lat * 0.55;
        this.pos.set(px - fx * dist + sx * off, h, pz - fz * dist + sz * off);
        const aheadL = 8 + Math.min(speed, 95) * 0.1;
        this.look.set(px + fx * aheadL + sx * this.lat * 0.9, 0.7, pz + fz * aheadL + sz * this.lat * 0.9);
        targetFov = 56 + Math.min(speed, 100) * 0.16 + Math.max(0, this.accel) * 0.25;
        break;
      }
      case 'tcam': {
        car.attach(0.05, 1.12, 0, this.pos);
        car.attach(24, 0.75, 0, this.look);
        targetFov = 80 + Math.min(speed, 100) * 0.05;
        break;
      }
      case 'nose': {
        car.attach(2.75, 0.33, 0, this.pos);
        car.attach(30, 0.3, 0, this.look);
        targetFov = 92;
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
      case 'tv':
      case 'side': {
        // Regie: feste Kameras am Streckenrand, die dem Auto folgen; Wechsel, wenn es vorbei ist
        const low = this.mode === 'side';
        const fx = Math.cos(psi);
        const fz = -Math.sin(psi);
        const here = this.tmp.set(px, 1, pz);
        const gone = this.tvPos.distanceTo(here);
        const behind = (px - this.tvPos.x) * fx + (pz - this.tvPos.z) * fz;
        if (!this.tvValid || gone > (low ? 70 : 140) || (behind > 10 && gone > 14)) {
          this.tvSwitch++;
          this.tvSide = this.tvSwitch % 2 ? 1 : -1;
          const ahead = low ? 38 + Math.min(speed, 90) * 0.35 : 75 + Math.min(speed, 90) * 0.8;
          const lat = low ? 6.5 : 14 + (this.tvSwitch % 3) * 6;
          this.tvPos.set(px + fx * ahead - fz * lat * this.tvSide, low ? 0.55 : 2.2 + (this.tvSwitch % 3) * 2.2, pz + fz * ahead + fx * lat * this.tvSide);
          this.tvValid = true;
          this.lookValid = false;
        }
        this.pos.copy(this.tvPos);
        this.look2.set(px + fx * speed * 0.06, 0.6, pz + fz * speed * 0.06);
        if (!this.lookValid) {
          this.lookS.copy(this.look2);
          this.lookValid = true;
        }
        this.lookS.lerp(this.look2, Math.min(1, dt * (low ? 9 : 6)));
        this.look.copy(this.lookS);
        const dd = this.pos.distanceTo(this.look);
        targetFov = low ? Math.max(24, Math.min(70, 1500 / Math.max(dd, 10))) : Math.max(11, Math.min(50, 1300 / Math.max(dd, 14)));
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
    // Fahrtwind-Vibration bei hohem Tempo (Onboard-Kameras stärker)
    if (this.mode !== 'showroom' && this.mode !== 'heli' && speed > 40) {
      this.shakeT += dt * 55;
      const onboard = this.mode === 'tcam' || this.mode === 'nose' || this.mode === 'cockpit';
      const a = (speed - 40) / 60 * (onboard ? 0.012 : 0.004);
      cam.position.x += Math.sin(this.shakeT * 1.3) * a;
      cam.position.y += Math.sin(this.shakeT * 1.9 + 1) * a;
      cam.rotation.z += Math.sin(this.shakeT * 0.7) * a * 0.15;
    }
  }
}
