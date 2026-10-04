"""
Erzeugt einen Himmel (Equirectangular, JPEG) mit Verlauf, Dunst am Horizont, Sonnenschein und Cumulus-Wolken
mit Beleuchtung (Sonnenseite hell, Unterseite grau).
Aufruf: python tools/make_sky.py public/textures/sky.jpg [sunny|overcast|evening]
Die Sonne steht je Stimmung bei Richtung SUN (wie im Spiel, src/render/scene.ts, WEATHER).
"""
import math
import os
import sys

import bpy
import numpy as np

out = sys.argv[1] if len(sys.argv) > 1 else 'sky.jpg'
mode = sys.argv[2] if len(sys.argv) > 2 else 'sunny'
SUN = {'sunny': (-0.55, 0.78, 0.30), 'overcast': (-0.55, 0.78, 0.30), 'evening': (-0.85, 0.26, 0.45)}[mode]
W, H = 2048, 1024


def fnoise(size, beta, seed):
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f, f)
    k = np.sqrt(fx * fx + fy * fy)
    k[0, 0] = 1
    spec = (r.standard_normal((size, size)) + 1j * r.standard_normal((size, size))) / (k ** beta)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    return (n - n.min()) / (n.max() - n.min() + 1e-9)


def sample(n, u, v):
    s = n.shape[0]
    x = (u % 1.0) * s
    y = (v % 1.0) * s
    x0 = np.floor(x).astype(int) % s
    y0 = np.floor(y).astype(int) % s
    x1, y1 = (x0 + 1) % s, (y0 + 1) % s
    fx, fy = x - np.floor(x), y - np.floor(y)
    return (n[y0, x0] * (1 - fx) * (1 - fy) + n[y0, x1] * fx * (1 - fy) + n[y1, x0] * (1 - fx) * fy + n[y1, x1] * fx * fy)


# Blickrichtung je Pixel (three.js: u = atan2(z, x)/2pi + 0.5, v = acos(y)/pi von oben)
us = (np.arange(W) + 0.5) / W
vs = (np.arange(H) + 0.5) / H
U, V = np.meshgrid(us, vs)
phi = (U - 0.5) * 2 * math.pi
theta = V * math.pi
dx = np.sin(theta) * np.cos(phi)
dz = np.sin(theta) * np.sin(phi)
dy = np.cos(theta)
sun = np.array(SUN)
sun /= np.linalg.norm(sun)
cos_s = dx * sun[0] + dy * sun[1] + dz * sun[2]

el = np.clip(dy, 0, 1)
if mode == 'overcast':
    zen, mid, hor = np.array([0.46, 0.50, 0.56]), np.array([0.58, 0.62, 0.67]), np.array([0.72, 0.75, 0.78])
elif mode == 'evening':
    zen, mid, hor = np.array([0.10, 0.17, 0.38]), np.array([0.42, 0.40, 0.55]), np.array([0.98, 0.62, 0.38])
else:
    zen, mid, hor = np.array([0.04, 0.16, 0.50]), np.array([0.16, 0.40, 0.80]), np.array([0.66, 0.78, 0.90])
t1 = np.clip(el / 0.35, 0, 1)[..., None]
t2 = np.clip((el - 0.15) / 0.85, 0, 1)[..., None]
sky = hor * (1 - t1) + mid * t1
sky = sky * (1 - t2 * 0.8) + zen * (t2 * 0.8)
# Dunst am Horizont und Mie-Streuung um die Sonne
haze = np.exp(-el * 9.0)[..., None]
hc = np.array([0.98, 0.64, 0.40]) if mode == 'evening' else np.array([0.86, 0.89, 0.92])
sky = sky * (1 - haze * 0.45) + hc * haze * 0.45
gk = {'sunny': 0.55, 'overcast': 0.05, 'evening': 1.1}[mode]
glow = (np.clip(cos_s, 0, 1) ** 24)[..., None] * np.array([1.0, 0.78 if mode == 'evening' else 0.86, 0.45 if mode == 'evening' else 0.62]) * gk
glow2 = (np.clip(cos_s, 0, 1) ** 4)[..., None] * np.array([1.0, 0.92, 0.8]) * 0.12
if mode == 'evening':
    glow2 = glow2 + (np.clip(cos_s, 0, 1) ** 7)[..., None] * np.array([1.0, 0.5, 0.2]) * 0.55
sky = sky + glow + glow2
disk = np.clip((cos_s - 0.99965) / 0.00035, 0, 1)[..., None] * (0.0 if mode == 'overcast' else 1.0)
sky = sky * (1 - disk) + (np.array([6.0, 3.4, 1.4]) if mode == 'evening' else np.array([6.0, 5.5, 4.8])) * disk

# Wolken: Projektion auf eine Ebene, FBM mit Schwellwert, Beleuchtung durch Verschiebung zur Sonne
N = 1024
base = 0.55 * fnoise(N, 2.4, 71) + 0.30 * fnoise(N, 1.7, 72) + 0.15 * fnoise(N, 1.0, 73)
den = (dy + 0.12)
pu = dx / den * 0.22
pv = dz / den * 0.22
dens = sample(base, pu + 0.31, pv + 0.17)
cover = {'sunny': 0.43, 'overcast': 0.16, 'evening': 0.40}[mode]
cl = np.clip((dens - cover) / 0.16, 0, 1)
cl = cl * cl * (3 - 2 * cl)
# Beleuchtung: Dichte an um die Sonnenrichtung verschobener Stelle (dünn = Sonne scheint durch)
sx, sz = sun[0] / (sun[1] + 0.12) * 0.22, sun[2] / (sun[1] + 0.12) * 0.22
sh = sample(base, pu + 0.31 + sx * 0.02, pv + 0.17 + sz * 0.02)
lit = np.clip(0.5 + (dens - sh) * 7.0, 0, 1)
if mode == 'overcast':
    cloud_col = (np.array([0.62, 0.65, 0.70]) * (1 - 0.35 * lit[..., None]) + np.array([0.82, 0.84, 0.88]) * 0.35 * lit[..., None]) * (0.78 + 0.5 * (dens[..., None] - 0.4))
elif mode == 'evening':
    cloud_col = np.array([0.36, 0.30, 0.42]) * (1 - lit[..., None]) + np.array([1.0, 0.62, 0.38]) * lit[..., None]
else:
    cloud_col = (np.array([0.58, 0.62, 0.70]) * (1 - lit[..., None]) + np.array([1.0, 0.98, 0.95]) * lit[..., None])
cloud_col = cloud_col * (0.80 + 0.2 * np.clip(el * 3, 0, 1))[..., None]
fade = np.clip(el * 5.0 - 0.15, 0, 1)  # zum Horizont hin ausblenden
if mode == 'overcast':
    fade = np.clip(el * 8.0 + 0.25, 0, 1)
a = (cl * fade)[..., None]
sky = sky * (1 - a) + cloud_col * a

# unter dem Horizont: neutrales Grau (selten sichtbar)
below = np.clip(-dy * 12, 0, 1)[..., None]
sky = sky * (1 - below) + np.array([0.36, 0.40, 0.40]) * below

# Tone-Mapping-freundlich: leicht komprimieren, dann als sRGB speichern
sky = np.clip(sky, 0, 1) ** (1 / 2.0)
rgba = np.ones((H, W, 4), np.float32)
rgba[..., :3] = np.flipud(sky)  # Blender-Bilder: y=0 unten
img = bpy.data.images.new('sky', W, H, alpha=False)
img.pixels = rgba.ravel().tolist()
scene = bpy.context.scene
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 88
scene.render.image_settings.color_mode = 'RGB'
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
img.save_render(out, scene=scene)
print(out, os.path.getsize(out) // 1024, 'kB')
