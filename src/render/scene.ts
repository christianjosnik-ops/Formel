import * as THREE from 'three';

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
  // Wolken
  g.fillStyle = 'rgba(255,255,255,0.55)';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const y = H * (0.08 + rnd() * 0.3);
    const rw = 25 + rnd() * 70;
    const rh = 6 + rnd() * 14;
    g.globalAlpha = 0.12 + rnd() * 0.22;
    g.beginPath();
    g.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function asphaltTexture(): THREE.CanvasTexture {
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3c3f';
  g.fillRect(0, 0, N, N);
  const img = g.getImageData(0, 0, N, N);
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * N; i++) {
    const n = (rnd() - 0.5) * 34 + (rnd() - 0.5) * 18;
    img.data[i * 4] += n;
    img.data[i * 4 + 1] += n;
    img.data[i * 4 + 2] += n * 1.03;
  }
  g.putImageData(img, 0, 0);
  // Helle Gesteinskörner
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${150 + rnd() * 80},${150 + rnd() * 80},${150 + rnd() * 80},${0.08 + rnd() * 0.14})`;
    g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Bitumenflecken
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(20,20,22,${0.04 + rnd() * 0.05})`;
    g.beginPath();
    g.ellipse(rnd() * N, rnd() * N, 20 + rnd() * 90, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Einfaches Testgelände: Startlinie, Längenmarken, Kegelslalom-Kreis (Skidpad). Wird in Phase 3 durch echte Strecken ersetzt. */
function buildProvingGround(scene: THREE.Scene): void {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dash = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  // Startlinie (Schachbrett)
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
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 14), new THREE.MeshBasicMaterial({ map: ct }));
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(-1.0, 0.012, 0);
  scene.add(grid);
  // Fahrbahnränder: durchgehende weiße Linien entlang der Gerade
  for (const z of [-7, 7]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(4000, 0.25), mat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(1900, 0.011, z);
    scene.add(line);
  }
  const mid = new THREE.InstancedMesh(new THREE.PlaneGeometry(6, 0.18), dash, 400);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 400; i++) {
    m4.makeRotationX(-Math.PI / 2);
    m4.setPosition(i * 12 + 4, 0.011, 0);
    mid.setMatrixAt(i, m4);
  }
  scene.add(mid);

  // Entfernungstafeln alle 100 m bis 1000 m (beide Seiten)
  for (let d = 100; d <= 1000; d += 100) {
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
  // Bremspunkt-Tafeln hinter 1000 m: 150, 100, 50
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3), mat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(1150 + i * 50, 0.011, -6);
    scene.add(w);
  }

  // Skidpad: Kegelring R = 50 m, Mittelpunkt links der Gerade
  const cones = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.22, 0.6, 10).translate(0, 0.3, 0),
    new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.6 }),
    72,
  );
  cones.castShadow = true;
  const R = 50;
  const cx = 60;
  const cz = -90;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    m4.makeTranslation(cx + Math.cos(a) * R, 0, cz + Math.sin(a) * R);
    cones.setMatrixAt(i, m4);
  }
  scene.add(cones);
  const inner = new THREE.InstancedMesh(cones.geometry, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }), 48);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    m4.makeTranslation(cx + Math.cos(a) * (R - 8), 0, cz + Math.sin(a) * (R - 8));
    inner.setMatrixAt(i, m4);
  }
  scene.add(inner);
  // Slalomgasse
  const slalom = new THREE.InstancedMesh(cones.geometry, new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.6 }), 20);
  for (let i = 0; i < 20; i++) {
    m4.makeTranslation(-150 - i * 18, 0, (i % 2 ? 1 : -1) * 4);
    slalom.setMatrixAt(i, m4);
  }
  scene.add(slalom);
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
  const tex = asphaltTexture();
  const size = 6000;
  tex.repeat.set(size / TILE, size / TILE);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  buildProvingGround(scene);

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
      ground.position.set(gx, 0, gz);
      tex.offset.set((gx / TILE) % 1, (-gz / TILE) % 1);
    },
  };
}
