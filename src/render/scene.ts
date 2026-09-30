import * as THREE from 'three';
import { grassTexture } from './worldVisuals';

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
  resize: () => void;
  setPixelRatio: (r: number) => void;
  updateEnvironment: (carX: number, carZ: number) => void;
}

const TILE = 8; // Meter pro Texturkachel

function skyTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, '#2f6fc7');
  grad.addColorStop(0.35, '#6fa6e3');
  grad.addColorStop(0.495, '#cfe3f5');
  grad.addColorStop(0.5, '#b9c4ca');
  grad.addColorStop(0.62, '#7d8489');
  grad.addColorStop(1.0, '#4d5256');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Sonnenschein
  const sx = W * 0.27;
  const sy = H * 0.22;
  const sun = g.createRadialGradient(sx, sy, 2, sx, sy, 140);
  sun.addColorStop(0, 'rgba(255,250,235,1)');
  sun.addColorStop(0.15, 'rgba(255,244,214,0.85)');
  sun.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // Wolken: weiche Cumulus-Haufen aus vielen Radialverläufen, unten flach und leicht grau
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let cl = 0; cl < 26; cl++) {
    const cx = rnd() * W;
    const cy = H * (0.1 + rnd() * 0.26);
    const size = 0.6 + rnd() * 1.1;
    for (let k = 0; k < 14; k++) {
      const x = cx + (rnd() - 0.5) * 120 * size;
      const y = cy + (rnd() - 0.65) * 26 * size;
      const rad = (16 + rnd() * 34) * size;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const shade = 232 + Math.round((y - cy) * -0.4);
      grd.addColorStop(0, `rgba(255,255,255,${0.42 + rnd() * 0.2})`);
      grd.addColorStop(0.6, `rgba(${shade},${shade},${shade + 6},0.2)`);
      grd.addColorStop(1, 'rgba(240,244,250,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // graue Unterseite
    const by = cy + 10 * size;
    const bg = g.createLinearGradient(0, by - 6, 0, by + 6);
    bg.addColorStop(0, 'rgba(150,160,175,0)');
    bg.addColorStop(1, 'rgba(150,160,175,0.18)');
    g.fillStyle = bg;
    g.fillRect(cx - 70 * size, by - 6, 140 * size, 12);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const sky = skyTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(sky);
  scene.environment = envRT.texture;
  scene.background = sky;
  scene.environmentIntensity = 1.0;
  scene.fog = new THREE.Fog(0xb9c4ca, 350, 2000);
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x55504a, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -7;
  sc.right = 7;
  sc.top = 7;
  sc.bottom = -7;
  sc.near = 1;
  sc.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // Boden: folgt dem Auto in ganzen Kachelschritten, damit die Textur nicht rutscht
  const tex = grassTexture();
  const size = 6000;
  tex.repeat.set(size / TILE, size / TILE);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.003;
  ground.receiveShadow = true;
  scene.add(ground);

  const sunDir = new THREE.Vector3(-0.55, 0.78, 0.3).normalize();
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();

  return {
    renderer,
    scene,
    camera,
    sun,
    ground,
    resize,
    setPixelRatio: (r: number) => {
      renderer.setPixelRatio(r);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    },
    updateEnvironment: (cx: number, cz: number) => {
      sun.position.set(cx + sunDir.x * 30, sunDir.y * 30, cz + sunDir.z * 30);
      sun.target.position.set(cx, 0, cz);
      // Boden in ganzen Kacheln nachführen. Textur-Offset ausgleichen, damit sie auf der Welt stehen bleibt.
      const gx = Math.round(cx / TILE) * TILE;
      const gz = Math.round(cz / TILE) * TILE;
      ground.position.set(gx, -0.003, gz);
      tex.offset.set((gx / TILE) % 1, (-gz / TILE) % 1);
    },
  };
}
