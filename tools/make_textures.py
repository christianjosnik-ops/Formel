"""
Erzeugt kachelbare Bodentexturen (Albedo + Normalmap) für Gras, Kies, Asphalt und Erde als JPEG.
Aufruf: python tools/make_textures.py public/textures
Benötigt: bpy (zum JPEG-Speichern) und numpy. Alle Texturen sind nahtlos kachelbar (FFT-Rauschen, Wrap beim Zeichnen).
"""
import math
import os
import sys

import bpy
import numpy as np

out = sys.argv[1] if len(sys.argv) > 1 else 'textures'
os.makedirs(out, exist_ok=True)
S = 1024


def fnoise(size, beta, seed):
    """Kachelbares 1/f^beta-Rauschen, normiert auf 0..1."""
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f, f)
    k = np.sqrt(fx * fx + fy * fy)
    k[0, 0] = 1
    spec = (r.standard_normal((size, size)) + 1j * r.standard_normal((size, size))) / (k ** beta)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    n = (n - n.min()) / (n.max() - n.min() + 1e-9)
    return n


def cells(size, cell, seed):
    """Zellrauschen (Worley): Abstand zum nächsten Punkt, Zell-ID-Zufallswert. Kachelbar."""
    r = np.random.default_rng(seed)
    g = size // cell
    pts = (np.stack(np.meshgrid(np.arange(g), np.arange(g)), -1) + r.random((g, g, 2))) * cell
    vals = r.random((g, g))
    ys, xs = np.mgrid[0:size, 0:size]
    cy, cx = ys // cell, xs // cell
    best = np.full((size, size), 1e9)
    best2 = np.full((size, size), 1e9)
    bval = np.zeros((size, size))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            gy, gx = (cy + dy) % g, (cx + dx) % g
            px = pts[gy, gx, 0] + (cx + dx - gx) * cell
            py = pts[gy, gx, 1] + (cy + dy - gy) * cell
            d = np.hypot(xs - px, ys - py)
            upd = d < best
            best2 = np.where(upd, best, np.minimum(best2, d))
            bval = np.where(upd, vals[gy, gx], bval)
            best = np.where(upd, d, best)
    return best / cell, best2 / cell, bval


def blades(size, count, seed, length=(8, 20), cols=None, hgt=None):
    """Zeichnet Halme als kurze, leicht gebogene Striche (kachelbar) in ein RGB- und ein Höhenfeld."""
    r = np.random.default_rng(seed)
    img = np.zeros((size, size, 3), np.float32)
    wsum = np.zeros((size, size), np.float32)
    h = np.zeros((size, size), np.float32)
    x0 = r.random(count) * size
    y0 = r.random(count) * size
    ang = (-math.pi / 2) + r.normal(0, 0.55, count)
    ln = r.uniform(*length, count)
    bend = r.normal(0, 0.5, count)
    cidx = r.integers(0, len(cols), count)
    cols = np.array(cols, np.float32)
    steps = 14
    for s in range(steps):
        t = s / (steps - 1)
        a = ang + bend * t
        x = x0 + np.cos(a) * ln * t
        y = y0 + np.sin(a) * ln * t
        xi = (x.astype(int)) % size
        yi = (y.astype(int)) % size
        shade = 0.55 + 0.6 * t
        c = cols[cidx] * shade[None] if False else cols[cidx] * shade
        np.add.at(img, (yi, xi), c)
        np.add.at(wsum, (yi, xi), 1)
        np.add.at(h, (yi, xi), t)
        # etwas Breite
        np.add.at(img, (yi, (xi + 1) % size), c * 0.6)
        np.add.at(wsum, (yi, (xi + 1) % size), 0.6)
    return img, wsum, h


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)  # +Y = nach oben im Bild (glTF/three-Konvention: Bildy wächst nach oben beim Speichern)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def save(name, arr, quality=88):
    arr = np.clip(arr, 0, 1)
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr
    img.pixels = rgba.ravel().tolist()
    img.file_format = 'JPEG'
    path = os.path.join(out, name + '.jpg')
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = quality
    scene.render.image_settings.color_mode = 'RGB'
    img.save_render(path, scene=scene)
    print(path, os.path.getsize(path) // 1024, 'kB')


def save_rgba(name, arr):
    arr = np.clip(arr, 0, 1)
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels = arr.astype(np.float32).ravel().tolist()
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.compression = 90
    path = os.path.join(out, name + '.png')
    img.save_render(path, scene=scene)
    print(path, os.path.getsize(path) // 1024, 'kB')


# ------------------------------------------------------------------------------------------ Gras
def grass():
    macro = fnoise(S, 2.2, 1)
    meso = fnoise(S, 1.6, 2)
    micro = fnoise(S, 0.6, 3)
    base = np.zeros((S, S, 3), np.float32)
    dark = np.array([0.075, 0.14, 0.045], np.float32)
    mid = np.array([0.17, 0.30, 0.08], np.float32)
    light = np.array([0.30, 0.43, 0.12], np.float32)
    straw = np.array([0.40, 0.36, 0.17], np.float32)
    t = np.clip(macro * 1.5 - 0.15, 0, 1)[..., None]
    base = dark * (1 - t) + mid * t
    base = base * (0.78 + 0.45 * meso[..., None])
    # trockene Stellen
    dry = np.clip((fnoise(S, 2.0, 4) - 0.62) * 4, 0, 1)[..., None] * 0.45
    base = base * (1 - dry) + straw * dry
    cols = [(0.10, 0.20, 0.05), (0.18, 0.34, 0.08), (0.30, 0.46, 0.12), (0.42, 0.52, 0.16), (0.46, 0.42, 0.18), (0.14, 0.26, 0.06)]
    img, wsum, hh = blades(S, 90000, 5, (6, 18), cols)
    cov = np.clip(wsum, 0, 1)[..., None]
    avg = img / np.maximum(wsum, 1e-3)[..., None]
    base = base * (1 - cov * 0.8) + avg * cov * 0.8
    img2, w2, h2 = blades(S, 60000, 6, (4, 12), cols)
    cov2 = np.clip(w2, 0, 1)[..., None]
    base = base * (1 - cov2 * 0.7) + (img2 / np.maximum(w2, 1e-3)[..., None]) * cov2 * 0.7
    base *= (0.9 + 0.2 * micro[..., None])
    height = 0.5 * meso + 0.5 * np.clip(hh + h2, 0, 3) / 3 + 0.2 * micro
    # Niederfrequenz-Anteil weitgehend entfernen: die großflächige Variation kommt später aus dem Welt-Shader,
    # sonst wiederholt sich das Kachelmuster als sichtbare Bänder
    f = np.fft.fftfreq(S)
    k2 = f[None, :] ** 2 + f[:, None] ** 2
    lp = np.exp(-k2 / (2 * 0.012 ** 2))
    for c in range(3):
        low = np.real(np.fft.ifft2(np.fft.fft2(base[..., c]) * lp))
        base[..., c] = base[..., c] - 0.85 * (low - low.mean())
    return base * 1.5, height


# ------------------------------------------------------------------------------------------ Kies
def gravel():
    d, d2, v = cells(S, 11, 11)
    d_b, d2_b, v_b = cells(S, 5, 12)
    # große Steine mit Kuppelshading + dunkle Fugen
    dome = np.clip(1 - d * 1.15, 0, 1) ** 0.6
    gap = np.clip((d2 - d) * 6, 0, 1)
    cols = np.array([[0.58, 0.54, 0.46], [0.47, 0.44, 0.38], [0.68, 0.64, 0.55], [0.40, 0.38, 0.34], [0.62, 0.50, 0.38], [0.52, 0.52, 0.5]], np.float32)
    ci = (v * len(cols)).astype(int) % len(cols)
    c = cols[ci]
    small = np.clip(1 - d_b * 1.1, 0, 1) ** 0.6
    shade = 0.45 + 0.6 * dome * (0.7 + 0.3 * small)
    base = c * shade[..., None] * (0.35 + 0.65 * gap[..., None])
    base *= 0.85 + 0.3 * fnoise(S, 1.2, 13)[..., None]
    height = 0.8 * dome * gap + 0.2 * small
    return base, height


# ------------------------------------------------------------------------------------------ Asphalt
def asphalt():
    d, d2, v = cells(S, 4, 21)
    d_b, d2_b, v_b = cells(S, 9, 22)
    mott = fnoise(S, 2.0, 23)
    gap = np.clip((d2 - d) * 4, 0, 1)
    stone = 0.28 + 0.22 * v + 0.10 * v_b
    stone *= 0.75 + 0.35 * np.clip(1 - d * 1.2, 0, 1)
    binder = 0.13
    lum = binder + (stone - binder) * (0.35 + 0.65 * gap)
    lum *= 0.82 + 0.38 * mott
    lum *= 0.92 + 0.16 * fnoise(S, 0.7, 24)
    base = np.stack([lum * 0.97, lum * 0.99, lum * 1.06], -1)
    # Risse und Fugen
    r = np.random.default_rng(25)
    crack = np.zeros((S, S), np.float32)
    for _ in range(14):
        x, y = r.random() * S, r.random() * S
        a = r.random() * math.tau
        for _s in range(220):
            a += r.normal(0, 0.25)
            x += math.cos(a) * 2.2
            y += math.sin(a) * 2.2
            xi, yi = int(x) % S, int(y) % S
            crack[yi, xi] = 1
            crack[(yi + 1) % S, xi] = max(crack[(yi + 1) % S, xi], 0.5)
    base *= (1 - crack[..., None] * 0.7)
    height = 0.6 * (1 - gap) * 0 + 0.7 * np.clip(1 - d * 1.2, 0, 1) * gap + 0.3 * mott - crack * 0.5
    return base * 1.1, height


# ------------------------------------------------------------------------------------------ Erde
def dirt():
    macro = fnoise(S, 2.0, 31)
    d, d2, v = cells(S, 14, 32)
    crack = np.clip((d2 - d) * 5, 0, 1)
    c0 = np.array([0.27, 0.23, 0.18], np.float32)
    c1 = np.array([0.44, 0.38, 0.29], np.float32)
    t = macro[..., None]
    base = c0 * (1 - t) + c1 * t
    base *= (0.9 + 0.1 * crack[..., None]) * (0.9 + 0.2 * v[..., None])
    base *= 0.9 + 0.2 * fnoise(S, 0.8, 33)[..., None]
    # Steinchen
    d3, d32, v3 = cells(S, 6, 34)
    pebbles = (v3 > 0.82) & (d3 < 0.55)
    base[pebbles] = base[pebbles] * 0.4 + 0.45 * 0.6
    height = 0.25 * crack + 0.5 * macro + 0.35 * pebbles
    return base, height




def marbles():
    """Gummikrümel ("Marbles") neben der Ideallinie: dunkle Körner, dicht in der Mitte (u=0.5 ≈ Streifenmitte), nach außen dünner."""
    W_, H_ = 256, 1024
    r = np.random.default_rng(81)
    a = np.zeros((H_, W_), np.float32)
    n = 5200
    ys = r.integers(0, H_, n)
    xs = np.clip(r.normal(W_ * 0.5, W_ * 0.2, n), 0, W_ - 1).astype(int)
    sz = r.choice([1, 1, 2, 2, 3], n)
    val = r.uniform(0.35, 0.95, n)
    for y, x, z, v in zip(ys, xs, sz, val):
        a[y % H_, x] = max(a[y % H_, x], v)
        if z > 1:
            a[(y + 1) % H_, x] = max(a[(y + 1) % H_, x], v * 0.8)
            a[y % H_, min(W_ - 1, x + 1)] = max(a[y % H_, min(W_ - 1, x + 1)], v * 0.8)
        if z > 2:
            a[(y + 1) % H_, min(W_ - 1, x + 1)] = max(a[(y + 1) % H_, min(W_ - 1, x + 1)], v * 0.7)
    # Schlieren aus Gummiabrieb (längliche, weiche Bänder)
    smear = fnoise(H_, 2.2, 82)[:, :W_ // 1] if False else None
    band = np.exp(-((np.arange(W_) - W_ * 0.5) / (W_ * 0.28)) ** 2)[None, :]
    base = fnoise(1024, 2.0, 83)[:H_, :W_]
    smear = np.clip((base - 0.55) * 2.0, 0, 1) * band * 0.22
    alpha = np.clip(a * 0.85 + smear, 0, 1)
    rgba = np.zeros((H_, W_, 4), np.float32)
    rgba[..., :3] = 0.035
    rgba[..., 3] = alpha
    return rgba


def patches():
    """Fahrbahn-Ausbesserungen, Längsrisse, Ölflecken und Bremsspuren als Overlay (quer über die ganze Fahrbahnbreite)."""
    W_, H_ = 512, 1024
    r = np.random.default_rng(91)
    rgba = np.zeros((H_, W_, 4), np.float32)
    ys, xs = np.mgrid[0:H_, 0:W_]
    def stamp(mask, col, alpha):
        rgba[..., :3] = np.where(mask[..., None], col, rgba[..., :3])
        rgba[..., 3] = np.maximum(rgba[..., 3], np.where(mask, alpha, 0))
    # Flickstellen: rechteckig, dunkler oder heller als der Rand, leicht ungerade Kanten
    for _ in range(9):
        cx, cy = r.uniform(40, W_ - 40), r.uniform(0, H_)
        w, h = r.uniform(40, 150), r.uniform(60, 240)
        rot = r.normal(0, 0.03)
        dx, dy = xs - cx, ((ys - cy + H_ / 2) % H_) - H_ / 2
        u = dx * math.cos(rot) + dy * math.sin(rot)
        v = -dx * math.sin(rot) + dy * math.cos(rot)
        m = (np.abs(u) < w / 2) & (np.abs(v) < h / 2)
        dark = r.random() < 0.65
        stamp(m, 0.02 if dark else 0.3, 0.32 if dark else 0.12)
        edge = m & ((np.abs(u) > w / 2 - 2.5) | (np.abs(v) > h / 2 - 2.5))
        stamp(edge, 0.01, 0.55)  # Fugenband (Teer)
    # Ölflecken: weiche dunkle Ellipsen
    for _ in range(7):
        cx, cy = r.uniform(30, W_ - 30), r.uniform(0, H_)
        rx, ry = r.uniform(8, 26), r.uniform(14, 60)
        dx, dy = xs - cx, ((ys - cy + H_ / 2) % H_) - H_ / 2
        d = (dx / rx) ** 2 + (dy / ry) ** 2
        a = np.clip(1 - d, 0, 1) ** 1.5 * 0.5
        rgba[..., 3] = np.maximum(rgba[..., 3], a)
    # Längsrisse
    for _ in range(5):
        x = r.uniform(20, W_ - 20)
        for y in range(0, H_, 2):
            x += r.normal(0, 0.7)
            xi = int(x) % W_
            rgba[y % H_, xi, 3] = max(rgba[y % H_, xi, 3], 0.7)
            rgba[(y + 1) % H_, xi, 3] = max(rgba[(y + 1) % H_, xi, 3], 0.7)
    # Bremsspuren (Blockierer): dünne dunkle Bögen
    for _ in range(4):
        x0 = r.uniform(60, W_ - 60)
        y0 = r.uniform(0, H_)
        curve = r.normal(0, 0.0004)
        for t in range(0, 380):
            y = (y0 + t) % H_
            x = x0 + curve * t * t * 40
            for off in (-3, 3):
                xi = int(x + off) % W_
                rgba[int(y), xi, 3] = max(rgba[int(y), xi, 3], 0.45 * (1 - t / 380))
    rgba[..., :3] = np.where(rgba[..., 3:4] > 0, rgba[..., :3], 0.02)
    return rgba


def paintwear():
    """Abgenutzte weiße Linienfarbe: Alpha mit Lücken und Körnung (Kachel quer schmal, längs lang)."""
    W_, H_ = 64, 512
    r = np.random.default_rng(95)
    n = fnoise(512, 1.5, 96)[:H_, :W_]
    g = r.random((H_, W_))
    a = np.clip(0.95 - 0.55 * np.clip((n - 0.45) * 3, 0, 1) - 0.3 * (g > 0.82), 0.1, 1)
    rgba = np.ones((H_, W_, 4), np.float32)
    rgba[..., :3] = 0.9 + 0.08 * r.random((H_, W_, 1))
    rgba[..., 3] = a
    return rgba

def gravelrake():
    """Geharkter Kies: parallele, leicht wellige dunkle Furchen mit hellem Grat (Linien in Fahrtrichtung)."""
    W_, H_ = 256, 256
    r = np.random.default_rng(97)
    rgba = np.zeros((H_, W_, 4), np.float32)
    ys = np.arange(H_)
    for x0 in range(4, W_, 8):
        ph = r.uniform(0, 6.28)
        amp = r.uniform(0.6, 1.8)
        xs = (x0 + amp * np.sin(ys / 256 * 6.28318 * 2 + ph)).astype(int) % W_
        for dx, a, c in ((0, 0.42, 0.05), (1, 0.26, 0.05), (-1, 0.22, 0.75), (2, 0.14, 0.75)):
            xx = (xs + dx) % W_
            rgba[ys, xx, 3] = np.maximum(rgba[ys, xx, 3], a * r.uniform(0.7, 1.0, H_))
            rgba[ys, xx, :3] = c
    # Unterbrechungen: Furchen verlaufen nicht überall
    mask = fnoise(256, 1.8, 98) > 0.35
    rgba[..., 3] *= mask
    return rgba


save_rgba('marbles', marbles())
save_rgba('patches', patches())
save_rgba('paintwear', paintwear())
save_rgba('gravelrake', gravelrake())

for name, fn, strength in (('grass', grass, 5.0), ('gravel', gravel, 6.0), ('asphalt', asphalt, 3.0), ('dirt', dirt, 4.0)):
    alb, hgt = fn()
    save(name, alb, 82)
    nm = normal_from_height(hgt.astype(np.float32), strength)
    nm = nm.reshape(S // 2, 2, S // 2, 2, 3).mean(axis=(1, 3))   # Normalmap in halber Auflösung
    save(name + '_n', nm, 80)
