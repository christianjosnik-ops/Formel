import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
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
  /** Rendert mit Nachbearbeitung (Bloom, Farbkorrektur, Vignette), falls aktiv. */
  render: () => void;
  setPost: (on: boolean) => void;
  postOn: () => boolean;
  /** Schattenkarte: Auflösung und halbe Kantenlänge [m]. */
  setShadow: (size: number, half: number) => void;
  /** Wetter/Tageszeit: Himmel, Sonne, Umgebungslicht, Belichtung und Nebel. */
  setWeather: (w: Weather, fogColor: number, fogNear: number, fogFar: number) => void;
}

export type Weather = 'sunny' | 'overcast' | 'evening';

/** Lichtstimmungen (Himmelstextur aus tools/make_sky.py mit gleicher Sonnenrichtung). */
const WEATHER: Record<Weather, { sky: string; dir: [number, number, number]; sun: number; sunInt: number; hemiSky: number; hemiGround: number; hemiInt: number; exposure: number; env: number; fog: number | null; fogK: number; bloom?: number }> = {
  sunny: { sky: 'sky.jpg', dir: [-0.55, 0.78, 0.3], sun: 0xfff1dc, sunInt: 2.6, hemiSky: 0xcfe4ff, hemiGround: 0x55504a, hemiInt: 0.55, exposure: 1.0, env: 1.0, fog: null, fogK: 1 },
  overcast: { sky: 'sky_overcast.jpg', dir: [-0.55, 0.78, 0.3], sun: 0xe8eef5, sunInt: 0.85, hemiSky: 0xd5dde8, hemiGround: 0x6d7077, hemiInt: 1.25, exposure: 1.05, env: 1.15, fog: 0xaeb6bf, fogK: 0.5 },
  evening: { sky: 'sky_evening.jpg', dir: [-0.85, 0.26, 0.45], sun: 0xffa45c, sunInt: 3.1, hemiSky: 0x9fb4e0, hemiGround: 0x5a4a44, hemiInt: 0.38, exposure: 0.95, env: 0.8, fog: 0xd8a98a, fogK: 0.8 },
};

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
  const skyCache = new Map<string, THREE.Texture>();
  const loadSky = (file: string, done: (t: THREE.Texture) => void) => {
    const hit = skyCache.get(file);
    if (hit) {
      done(hit);
      return;
    }
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${file}`, (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      skyCache.set(file, t);
      done(t);
    });
  };
  let envRTcur: THREE.WebGLRenderTarget = envRT;
  const applySky = (t: THREE.Texture) => {
    const rt = pmrem.fromEquirectangular(t);
    scene.environment = rt.texture;
    scene.background = t;
    if (envRTcur !== rt) envRTcur.dispose();
    envRTcur = rt;
  };
  loadSky('sky.jpg', (t) => {
    if (!weatherSet) applySky(t);
  });
  let weatherSet = false;

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x55504a, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const sc = sun.shadow.camera;
  sc.left = -34;
  sc.right = 34;
  sc.top = 34;
  sc.bottom = -34;
  sc.near = 10;
  sc.far = 150;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2.5;
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

  // Nachbearbeitung: HDR-Rendertarget mit MSAA, Bloom, leichte Farbkorrektur und Vignette, dann Tone-Mapping
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.55, 0.92);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uVig: { value: 0.28 }, uSat: { value: 1.06 }, uCon: { value: 1.07 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform float uCon; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, uSat);
  c.rgb = (c.rgb - 0.18) * uCon + 0.18;
  vec2 d = vUv - 0.5; d.x *= 1.15;
  c.rgb *= 1.0 - uVig * smoothstep(0.35, 0.95, length(d) * 1.35);
  gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
}`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  let post = true;
  const sunDir = new THREE.Vector3(-0.55, 0.78, 0.3).normalize();
  let curWeather: Weather = 'sunny';
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
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
      composer.setPixelRatio(r);
      composer.setSize(window.innerWidth, window.innerHeight);
    },
    render: () => {
      if (post) composer.render();
      else renderer.render(scene, camera);
    },
    setPost: (on: boolean) => {
      post = on;
    },
    postOn: () => post,
    setShadow: (size: number, half: number) => {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.updateProjectionMatrix();
    },
    setWeather: (w: Weather, fogColor: number, fogNear: number, fogFar: number) => {
      const p = WEATHER[w];
      curWeather = w;
      weatherSet = true;
      loadSky(p.sky, (t) => {
        if (curWeather === w) applySky(t);
      });
      sunDir.set(...p.dir).normalize();
      sun.color.setHex(p.sun);
      sun.intensity = p.sunInt;
      hemi.color.setHex(p.hemiSky);
      hemi.groundColor.setHex(p.hemiGround);
      hemi.intensity = p.hemiInt;
      renderer.toneMappingExposure = p.exposure;
      scene.environmentIntensity = p.env;
      const fog = scene.fog as THREE.Fog;
      fog.color.setHex(p.fog ?? fogColor);
      fog.near = fogNear * (p.fogK < 1 ? 0.5 : 1);
      fog.far = fogFar * p.fogK;
    },
    updateEnvironment: (cx: number, cz: number) => {
      sun.position.set(cx + sunDir.x * 70, sunDir.y * 70, cz + sunDir.z * 70);
      sun.target.position.set(cx, 0, cz);
      // Boden in ganzen Kacheln nachführen. Textur-Offset ausgleichen, damit sie auf der Welt stehen bleibt.
      const gx = Math.round(cx / TILE) * TILE;
      const gz = Math.round(cz / TILE) * TILE;
      ground.position.set(gx, -0.003, gz);
      tex.offset.set((gx / TILE) % 1, (-gz / TILE) % 1);
    },
  };
}
