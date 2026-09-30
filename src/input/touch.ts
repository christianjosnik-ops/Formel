import type { Controls } from './controls';

/** Analoge Touch-Flächen: Lenkband (links), Bremse und Gas (rechts), mehrere Finger gleichzeitig. */
export function setupTouchPads(controls: Controls): void {
  const steerPad = document.getElementById('steerPad')!;
  const steerKnob = document.getElementById('steerKnob')!;
  const gasPad = document.getElementById('gasPad')!;
  const gasFill = document.getElementById('gasFill')!;
  const brakePad = document.getElementById('brakePad')!;
  const brakeFill = document.getElementById('brakeFill')!;

  // Lenkung: absolute Position im Band, federt beim Loslassen zur Mitte
  let steerTarget = 0;
  let steerId = -1;
  const setSteer = (e: PointerEvent) => {
    const r = steerPad.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; // 0..1
    const n = Math.max(-1, Math.min(1, (x - 0.5) / 0.44));
    steerTarget = -n; // links = positiv
  };
  steerPad.addEventListener('pointerdown', (e) => {
    if (steerId !== -1) return;
    steerId = e.pointerId;
    steerPad.setPointerCapture(e.pointerId);
    setSteer(e);
    e.preventDefault();
  });
  steerPad.addEventListener('pointermove', (e) => {
    if (e.pointerId === steerId) setSteer(e);
  });
  const steerEnd = (e: PointerEvent) => {
    if (e.pointerId !== steerId) return;
    steerId = -1;
    steerTarget = 0;
  };
  steerPad.addEventListener('pointerup', steerEnd);
  steerPad.addEventListener('pointercancel', steerEnd);

  // Gas/Bremse: Höhe der Berührung = Pedalstellung
  const pedal = (pad: HTMLElement, fill: HTMLElement, set: (v: number) => void) => {
    let id = -1;
    const apply = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (r.bottom - e.clientY) / (r.height * 0.88)));
      set(v);
      fill.style.height = `${v * 100}%`;
    };
    pad.addEventListener('pointerdown', (e) => {
      if (id !== -1) return;
      id = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      apply(e);
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) apply(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      set(0);
      fill.style.height = '0%';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  };
  pedal(gasPad, gasFill, (v) => (controls.touchThrottle = v));
  pedal(brakePad, brakeFill, (v) => (controls.touchBrake = v));

  // Pfeiltasten (rechts): digitale Lenkung mit Rampe, beide gedrückt = geradeaus
  let arrowL = 0;
  let arrowR = 0;
  const arrow = (id: string, set: (v: number) => void) => {
    const el = document.getElementById(id)!;
    const ids = new Set<number>();
    el.addEventListener('pointerdown', (e) => {
      ids.add(e.pointerId);
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      set(1);
      e.preventDefault();
    });
    const up = (e: PointerEvent) => {
      ids.delete(e.pointerId);
      if (ids.size === 0) {
        el.classList.remove('on');
        set(0);
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  arrow('btnLeft', (v) => (arrowL = v));
  arrow('btnRight', (v) => (arrowR = v));

  // Sanfte Glättung/Federung des Lenkwerts + Knopfdarstellung
  let cur = 0;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.body.classList.contains('arrows')) {
      const dir = arrowL - arrowR; // links = positiv
      if (dir !== 0) {
        const step = (Math.sign(dir) !== Math.sign(cur) && cur !== 0 ? 7 : 2.6) * dt;
        cur += Math.sign(dir - cur) * Math.min(Math.abs(dir - cur), step);
      } else cur -= Math.sign(cur) * Math.min(Math.abs(cur), 5.5 * dt);
    } else {
      const rate = steerId === -1 ? 9 : 28;
      cur += (steerTarget - cur) * Math.min(1, dt * rate);
    }
    controls.touchSteer = cur;
    steerKnob.style.left = `${50 - cur * 44}%`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Browser-Gesten unterdrücken (Zoom, Scrollen, Kontextmenü)
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('contextmenu', stop);
  document.addEventListener(
    'touchmove',
    (e) => {
      if ((e.target as HTMLElement).closest?.('.scroll')) return;
      stop(e);
    },
    { passive: false },
  );
}
