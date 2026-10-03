"""
Erzeugt realistische Szenerie-Assets mit Blender (bpy) und exportiert sie als Draco-GLB:
  - Laubbäume (3 Varianten) mit gewachsenem Stamm (Wurzelanlauf, Rindenrillen), Ästen und Blattkarten-Kronen
  - Nadelbäume (2 Varianten) mit Quirlästen
  - Grasbüschel (grün und trocken/Stroh) aus echten Halmen, Büsche
  - Tribünen-Modul mit Sitzreihen, Treppen, Geländern, Dach und Publikum
Aufruf: python tools/make_scenery.py public/models/scenery.glb
Benötigt: pip install bpy numpy
Alle Objekte stehen im Ursprung auf dem Boden; glTF: +Y oben, Meter.
"""
import math
import random
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

out = sys.argv[1] if len(sys.argv) > 1 else 'scenery.glb'
rng = random.Random(7)
nrng = np.random.default_rng(7)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ----------------------------------------------------------------------------------------------
# Texturen (numpy -> Blender-Bild)
# ----------------------------------------------------------------------------------------------

def make_image(name, arr):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels = arr.astype(np.float32).ravel().tolist()
    img.pack()
    img.file_format = 'PNG'
    return img


def value_noise(w, h, scale, seed):
    r = np.random.default_rng(seed)
    gw, gh = int(w / scale) + 2, int(h / scale) + 2
    g = r.random((gh, gw))
    ys = np.linspace(0, gh - 1.001, h)
    xs = np.linspace(0, gw - 1.001, w)
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def bark_texture():
    w, h = 256, 512
    n1 = value_noise(w, h, 64, 1)
    n2 = value_noise(w, h, 16, 2)
    # vertikale Rillen: Rauschen, stark in y gestreckt
    gr = value_noise(w, h, 6, 3)
    grooves = np.abs(np.sin((np.arange(w)[None, :] + 14 * value_noise(w, h, 40, 4)) * 0.33)) ** 0.6
    base = 0.28 + 0.25 * n1 + 0.12 * n2
    shade = base * (0.55 + 0.45 * grooves) * (0.85 + 0.3 * gr)
    img = np.zeros((h, w, 4), np.float32)
    img[..., 0] = shade * 1.0
    img[..., 1] = shade * 0.82
    img[..., 2] = shade * 0.64
    # moosige Grünstellen unten/seitlich
    moss = np.clip(value_noise(w, h, 48, 5) - 0.55, 0, 1) * 1.4
    img[..., 1] += moss * 0.10
    img[..., 0] -= moss * 0.05
    img[..., 3] = 1
    return np.clip(img, 0, 1)


def draw_ellipse(arr, cx, cy, rx, ry, ang, color, alpha=1.0):
    h, w, _ = arr.shape
    x0, x1 = int(max(0, cx - rx - ry - 2)), int(min(w, cx + rx + ry + 2))
    y0, y1 = int(max(0, cy - rx - ry - 2)), int(min(h, cy + rx + ry + 2))
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dx, dy = xs - cx, ys - cy
    ca, sa = math.cos(ang), math.sin(ang)
    u = (dx * ca + dy * sa) / rx
    v = (-dx * sa + dy * ca) / ry
    m = (u * u + v * v) <= 1.0
    # Mittelrippe heller
    rib = np.abs(v) < 0.09
    sub = arr[y0:y1, x0:x1]
    col = np.array(color, np.float32)
    px = np.where(rib[..., None], np.clip(col * 1.35, 0, 1), col)
    sub[m, :3] = px[m]
    sub[m, 3] = alpha


def foliage_broad():
    w = h = 512
    arr = np.zeros((h, w, 4), np.float32)
    r = random.Random(11)
    greens = [(0.20, 0.36, 0.12), (0.26, 0.46, 0.15), (0.17, 0.30, 0.10), (0.34, 0.54, 0.18), (0.22, 0.40, 0.13), (0.42, 0.55, 0.16)]
    lobes = [0.55 + r.random() * 0.4 for _ in range(8)]
    for _ in range(1500):
        ang = r.random() * math.tau
        lob = lobes[int(ang / math.tau * len(lobes)) % len(lobes)]
        rad = math.sqrt(r.random()) * 232 * lob
        cx, cy = w / 2 + math.cos(ang) * rad, h / 2 + math.sin(ang) * rad * 0.92
        c = greens[r.randrange(len(greens))]
        k = 0.8 + 0.4 * r.random()
        draw_ellipse(arr, cx, cy, 15 + r.random() * 16, 7 + r.random() * 7, r.random() * math.tau, (c[0] * k, c[1] * k, c[2] * k))
    return arr


def foliage_needle():
    w = h = 512
    arr = np.zeros((h, w, 4), np.float32)
    r = random.Random(13)
    greens = [(0.07, 0.20, 0.10), (0.10, 0.27, 0.14), (0.06, 0.17, 0.09), (0.14, 0.32, 0.17)]
    # Zweig als Fächer: Mittelachse horizontal, Nadeln seitlich
    for _ in range(2000):
        t = r.random()
        x = 20 + t * 470
        spread = (1 - t * 0.55) * 120
        y = h / 2 + (r.random() - 0.5) * 2 * spread * (0.4 + 0.6 * r.random())
        ang = (-0.9 if y < h / 2 else 0.9) * (0.5 + 0.5 * r.random()) + (r.random() - 0.5) * 0.4
        c = greens[r.randrange(4)]
        k = 0.85 + 0.35 * r.random()
        draw_ellipse(arr, x, y, 22 + r.random() * 16, 2.3 + r.random() * 1.6, ang, (c[0] * k, c[1] * k, c[2] * k))
    # Zweigachse
    for xx in range(15, 495):
        yy = int(h / 2 + math.sin(xx / 70) * 4)
        arr[yy - 2:yy + 3, xx, :3] = (0.22, 0.15, 0.08)
        arr[yy - 2:yy + 3, xx, 3] = 1
    return arr


def crowd_texture():
    w, h = 512, 128
    arr = np.zeros((h, w, 4), np.float32)
    r = random.Random(21)
    shirts = [(0.85, 0.12, 0.12), (0.12, 0.28, 0.75), (0.95, 0.95, 0.95), (0.95, 0.75, 0.1), (0.1, 0.1, 0.12), (0.15, 0.55, 0.28), (0.9, 0.45, 0.1), (0.55, 0.55, 0.6)]
    skins = [(0.93, 0.78, 0.65), (0.78, 0.58, 0.44), (0.55, 0.38, 0.28), (0.42, 0.28, 0.2)]
    x = 4
    while x < w - 10:
        sh = shirts[r.randrange(len(shirts))]
        sk = skins[r.randrange(len(skins))]
        sx = 20 + r.random() * 5
        top = 30 + r.random() * 18
        # Oberkörper
        arr[int(top + 18):int(top + 60), int(x - sx * 0.55):int(x + sx * 0.55), :3] = sh
        arr[int(top + 18):int(top + 60), int(x - sx * 0.55):int(x + sx * 0.55), 3] = 1
        draw_ellipse(arr, x, top + 20, sx * 0.62, sx * 0.5, 0, sh)
        # Kopf
        draw_ellipse(arr, x, top + 4, sx * 0.34, sx * 0.4, 0, sk)
        if r.random() < 0.35:  # Mütze/Haare
            draw_ellipse(arr, x, top - 3, sx * 0.36, sx * 0.2, 0, shirts[r.randrange(len(shirts))])
        x += sx * (0.75 + r.random() * 0.45)
    arr[..., :3] *= 0.9
    return arr


img_bark = make_image('bark', bark_texture())
img_fol_b = make_image('foliage_broad', foliage_broad())
img_fol_n = make_image('foliage_needle', foliage_needle())
img_crowd = make_image('crowd', crowd_texture())


# ----------------------------------------------------------------------------------------------
# Materialien
# ----------------------------------------------------------------------------------------------

def mat_image(name, img, alpha=False, rough=0.9, vc=False, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out_n = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    if vc:
        cattr = nt.nodes.new('ShaderNodeVertexColor')
        cattr.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(tex.outputs['Color'], mix.inputs['A'])
        nt.links.new(cattr.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    else:
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
    nt.links.new(bsdf.outputs['BSDF'], out_n.inputs['Surface'])
    return m


def mat_color(name, rgb, rough=0.7, metal=0.0, vc=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if vc:
        cattr = nt.nodes.new('ShaderNodeVertexColor')
        cattr.layer_name = 'Col'
        nt.links.new(cattr.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    return m


M_BARK = mat_image('Bark', img_bark, rough=0.95, vc=True)
M_LEAF = mat_image('LeafBroad', img_fol_b, alpha=True, rough=0.8, vc=True)
M_NEEDLE = mat_image('LeafNeedle', img_fol_n, alpha=True, rough=0.8, vc=True)
M_CROWD = mat_image('Crowd', img_crowd, alpha=True, rough=0.9, vc=False)
M_GRASS = mat_color('Grass', (1, 1, 1), rough=0.85, vc=True)
M_CONC = mat_color('Concrete', (0.62, 0.63, 0.65), rough=0.95)
M_STEEL = mat_color('Steel', (0.55, 0.58, 0.62), rough=0.45, metal=0.7)
M_SEAT = mat_color('Seat', (1, 1, 1), rough=0.6, vc=True)
M_ROOF = mat_color('Roof', (0.9, 0.92, 0.94), rough=0.55)
M_DARK = mat_color('Dark', (0.08, 0.09, 0.1), rough=0.8)


# ----------------------------------------------------------------------------------------------
# Geometrie-Helfer (bmesh)
# ----------------------------------------------------------------------------------------------

class Builder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat_index(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def finish(self, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        ob = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = location
        return ob


def set_col(bm, face_or_verts, rgb, layer_name='Col'):
    layer = bm.loops.layers.color.get(layer_name) or bm.loops.layers.color.new(layer_name)
    return layer


def add_tube(b, pts, radii, segs, mat, color=(1, 1, 1), ridge=0.0, uv_v=1.0, seed=0, close_top=True):
    """Röhre entlang pts (Liste Vector) mit Radien; Rindenrillen ridge. Gibt Ringe zurück."""
    bm = b.bm
    mi = b.mat_index(mat)
    uv = bm.loops.layers.uv.verify()
    col = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    n = len(pts)
    # lokales Koordinatensystem entlang der Kurve
    rings = []
    prev_u = None
    length = 0.0
    lens = [0.0]
    for i in range(1, n):
        length += (pts[i] - pts[i - 1]).length
        lens.append(length)
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.95 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        v = t.cross(u).normalized()
        ring = []
        for k in range(segs):
            a = k / segs * math.tau
            rr = radii[i] * (1 + ridge * math.sin(a * 6 + lens[i] * 1.3 + seed) + ridge * 0.5 * math.sin(a * 11 - lens[i] * 2.1))
            p = pts[i] + (u * math.cos(a) + v * math.sin(a)) * rr
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            f = bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
            f.material_index = mi
            circ = 2 * math.pi * radii[i]
            for li, (kk, ii) in zip(f.loops, ((k, i), (k2, i), (k2, i + 1), (k, i + 1))):
                uu = (kk if kk != 0 or li is f.loops[0] else segs) / segs
                if li is f.loops[1] and k2 == 0:
                    uu = 1.0
                if li is f.loops[2] and k2 == 0:
                    uu = 1.0
                li[uv].uv = (uu, lens[ii] * uv_v)
                shade = 0.8 + 0.2 * (lens[ii] / max(length, 1e-3))
                li[col] = (color[0] * shade, color[1] * shade, color[2] * shade, 1)
    if close_top:
        f = bm.faces.new(rings[-1])
        f.material_index = mi
        for li in f.loops:
            li[uv].uv = (0.5, 0.5)
            li[col] = (color[0] * 0.8, color[1] * 0.8, color[2] * 0.8, 1)
    return rings


def add_card(b, center, size, normal, up_hint, mat, color, uv_rect=(0, 0, 1, 1)):
    bm = b.bm
    mi = b.mat_index(mat)
    uv = bm.loops.layers.uv.verify()
    col = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    n = normal.normalized()
    r = up_hint.cross(n)
    if r.length < 1e-4:
        r = Vector((1, 0, 0)).cross(n)
    r = r.normalized()
    u = n.cross(r).normalized()
    hw, hh = size[0] / 2, size[1] / 2
    vs = [bm.verts.new(center + r * x + u * y) for x, y in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
    f = bm.faces.new(vs)
    f.material_index = mi
    uvs = [(uv_rect[0], uv_rect[1]), (uv_rect[2], uv_rect[1]), (uv_rect[2], uv_rect[3]), (uv_rect[0], uv_rect[3])]
    for li, uvc in zip(f.loops, uvs):
        li[uv].uv = uvc
        li[col] = (*color, 1)
    return f


def finish_smooth_foliage(ob, center, up_bias=0.35):
    """Kugelnormalen (mit Aufwärtsanteil) nur für Blattflächen; Stamm/Äste behalten ihre echten Normalen."""
    me = ob.data
    leaf_verts = set()
    for poly in me.polygons:
        m = me.materials[poly.material_index]
        if m and m.name in ('LeafBroad', 'LeafNeedle'):
            leaf_verts.update(poly.vertices)
    normals = []
    for v in me.vertices:
        if v.index in leaf_verts:
            d = Vector(v.co) - center
            d = d.normalized() if d.length > 1e-4 else Vector((0, 0, 1))
            d = (d + Vector((0, 0, up_bias))).normalized()
            normals.append(d)
        else:
            normals.append(Vector(v.normal))
    try:
        me.normals_split_custom_set_from_vertices(normals)
    except Exception as e:
        print('normals failed', e)


def noise3(p, seed=0):
    return math.sin(p.x * 1.7 + seed) * math.cos(p.y * 1.3 - seed * 0.7) + math.sin(p.z * 2.1 + seed * 1.3)


# ----------------------------------------------------------------------------------------------
# Laubbaum
# ----------------------------------------------------------------------------------------------

def broad_tree(name, seed, height=14.0, trunk_r=0.32, crown_r=4.6, lean=0.0):
    r = random.Random(seed)
    b = Builder(name)
    trunk_h = height * 0.38
    # Stammkurve mit leichter Biegung, Wurzelanlauf
    pts, radii = [], []
    nr = 12
    bend = Vector((r.uniform(-1, 1), r.uniform(-1, 1), 0)).normalized() * (0.25 + lean)
    for i in range(nr):
        t = i / (nr - 1)
        z = -0.25 + t * (trunk_h + 0.25)
        off = bend * (t ** 1.6) * 1.2 + Vector((math.sin(t * 5 + seed) * 0.06, math.cos(t * 4 + seed) * 0.06, 0))
        pts.append(Vector((off.x, off.y, z)))
        flare = 1 + 1.15 * math.exp(-max(z, 0) / 0.55)
        radii.append(trunk_r * (1 - 0.45 * t) * flare)
    add_tube(b, pts, radii, 12, M_BARK, color=(1, 1, 1), ridge=0.07, uv_v=0.5, seed=seed)
    # Hauptäste
    tips = []

    def branch(start, direction, length, radius, depth):
        p = [start]
        d = direction.normalized()
        steps = 5
        cur = start.copy()
        radii_b = []
        for i in range(steps):
            t = i / (steps - 1)
            d = (d + Vector((r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.15), 0.06))).normalized()
            cur = cur + d * (length / steps)
            p.append(cur.copy())
        radii_b = [radius * (1 - 0.8 * i / steps) for i in range(steps + 1)]
        add_tube(b, p, radii_b, 7, M_BARK, ridge=0.05, uv_v=0.6, seed=r.random() * 9)
        tips.append((cur.copy(), d))
        if depth > 0:
            for _ in range(2 + (depth > 1)):
                k = r.randrange(2, steps)
                dd = (d + Vector((r.uniform(-0.8, 0.8), r.uniform(-0.8, 0.8), r.uniform(-0.1, 0.5)))).normalized()
                branch(p[k], dd, length * r.uniform(0.5, 0.7), radius * 0.45, depth - 1)

    nb = 6 + int(r.random() * 3)
    for i in range(nb):
        t = r.uniform(0.62, 1.0)
        idx = min(nr - 1, int(t * (nr - 1)))
        start = pts[idx]
        az = (i / nb) * math.tau + r.uniform(-0.3, 0.3)
        el = r.uniform(0.55, 1.1)
        dirn = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el) + 0.25))
        branch(start, dirn, height * r.uniform(0.28, 0.4), trunk_r * 0.45 * (1.15 - t * 0.4), 1)
    # Krone aus Blattkarten: um die Astspitzen und im Volumen einer abgeflachten Kugel
    crown_c = Vector((pts[-1].x, pts[-1].y, trunk_h + height * 0.30))
    def shade_at(c):
        rel = (c - crown_c)
        dist = min(1.0, rel.length / crown_r)
        top = max(0.0, min(1.0, (rel.z / crown_r + 0.6) / 1.5))
        return 0.78 + 0.45 * top + 0.12 * dist
    for (tip, d) in tips:
        for _ in range(7):
            c = tip + Vector((r.uniform(-1.3, 1.3), r.uniform(-1.3, 1.3), r.uniform(-0.8, 1.1)))
            rel = c - crown_c
            rel.z *= 1.15
            if rel.length > crown_r * 1.08:
                c = crown_c + rel.normalized() * crown_r * 1.05
            sh = shade_at(c) * r.uniform(0.92, 1.08)
            s = r.uniform(1.5, 2.3)
            nrm = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.2, 1))).normalized()
            add_card(b, c, (s, s * 0.9), nrm, Vector((0, 0, 1)), M_LEAF, (sh, sh, sh))
    for _ in range(95):
        a = r.random() * math.tau
        el = math.asin(r.uniform(-0.55, 1.0))
        rr = crown_r * (0.35 + 0.65 * r.random() ** 0.5)
        c = crown_c + Vector((math.cos(a) * math.cos(el) * rr, math.sin(a) * math.cos(el) * rr, math.sin(el) * rr * 0.85))
        sh = shade_at(c) * r.uniform(0.92, 1.08)
        s = r.uniform(1.6, 2.5)
        nrm = (c - crown_c).normalized() * 0.7 + Vector((r.uniform(-0.5, 0.5), r.uniform(-0.5, 0.5), r.uniform(0, 0.6)))
        add_card(b, c, (s, s * 0.9), nrm, Vector((0, 0, 1)), M_LEAF, (sh, sh, sh))
    ob = b.finish()
    finish_smooth_foliage(ob, crown_c)
    return ob


# ----------------------------------------------------------------------------------------------
# Nadelbaum
# ----------------------------------------------------------------------------------------------

def conifer(name, seed, height=18.0, trunk_r=0.28, width=3.2):
    r = random.Random(seed)
    b = Builder(name)
    pts = [Vector((math.sin(i * 0.7 + seed) * 0.05, math.cos(i * 0.5 + seed) * 0.05, i / 11 * height * 0.98 - 0.2)) for i in range(12)]
    radii = [trunk_r * (1 + 0.9 * math.exp(-max(p.z, 0) / 0.5)) * (1 - 0.88 * (i / 11)) for i, p in enumerate(pts)]
    add_tube(b, pts, radii, 10, M_BARK, color=(0.9, 0.85, 0.8), ridge=0.08, uv_v=0.45, seed=seed)
    tiers = 17
    cc = Vector((0, 0, height * 0.5))
    for i in range(tiers):
        t = i / (tiers - 1)
        z = 1.6 + t * (height - 2.4)
        rad = (width * (1 - t) ** 0.9 + 0.25)
        n = 8 if t < 0.75 else 6
        for k in range(n):
            a = (k / n) * math.tau + t * 2.3 + r.uniform(-0.18, 0.18)
            ca, sa = math.cos(a), math.sin(a)
            drop = 0.55 + 0.25 * (1 - t)
            # Zweigmitte: halb draußen, hängt nach unten
            center = Vector((ca * rad * 0.52, sa * rad * 0.52, z - drop * rad * 0.26))
            tangent = Vector((-sa, ca, 0))
            axis = Vector((ca, sa, -drop)).normalized()      # Zweigrichtung
            shade = 0.72 + 0.5 * t + r.uniform(-0.05, 0.05)
            length = rad * 1.08 + 0.35
            # zwei Karten pro Zweig: leicht gegeneinander verdreht (Fächer von oben und von der Seite)
            for tw in (0.0, 1.0):
                nrm = (tangent * (1 - tw) + Vector((0, 0, 1)) * (0.9 * tw + 0.15)).normalized()
                add_card(b, center, (length, length * 0.75), nrm, axis, M_NEEDLE, (shade, shade, shade))
    ob = b.finish()
    finish_smooth_foliage(ob, cc, 2.2)
    return ob


# ----------------------------------------------------------------------------------------------
# Gras
# ----------------------------------------------------------------------------------------------

def grass_tuft(name, seed, dry=False, blades=11):
    r = random.Random(seed)
    b = Builder(name)
    bm = b.bm
    mi = b.mat_index(M_GRASS)
    col = bm.loops.layers.color.new('Col')
    if dry:
        base_c, tip_c = (0.42, 0.36, 0.16), (0.88, 0.76, 0.40)
    else:
        base_c, tip_c = (0.07, 0.16, 0.04), (0.42, 0.62, 0.17)
    for _ in range(blades):
        a = r.random() * math.tau
        rad = r.random() * 0.07
        x0, y0 = math.cos(a) * rad, math.sin(a) * rad
        h = r.uniform(0.28, 0.6) * (0.75 if dry else 1.0)
        w = r.uniform(0.018, 0.03)
        lean_a = a + r.uniform(-0.6, 0.6)
        lean = r.uniform(0.04, 0.22) * h
        face = r.random() * math.tau
        fx, fy = math.cos(face), math.sin(face)
        tint = r.uniform(0.8, 1.15)
        segs = 3
        prev = None
        for s in range(segs + 1):
            t = s / segs
            bend = (t ** 1.8) * lean
            cx = x0 + math.cos(lean_a) * bend
            cy = y0 + math.sin(lean_a) * bend
            cz = h * t
            ww = w * (1 - t * 0.92) * (0.5 if s == segs else 1)
            vL = bm.verts.new((cx - fy * ww, cy + fx * ww, cz))
            vR = bm.verts.new((cx + fy * ww, cy - fx * ww, cz))
            if prev:
                f = bm.faces.new((prev[0], prev[1], vR, vL))
                f.material_index = mi
                t0 = (s - 1) / segs
                for li, tt in zip(f.loops, (t0, t0, t, t)):
                    k = 0.45 + 0.55 * tt
                    li[col] = ((base_c[0] + (tip_c[0] - base_c[0]) * tt) * tint, (base_c[1] + (tip_c[1] - base_c[1]) * tt) * tint, (base_c[2] + (tip_c[2] - base_c[2]) * tt) * tint, 1)
            prev = (vL, vR)
    return b.finish()


def bush(name, seed):
    r = random.Random(seed)
    b = Builder(name)
    for _ in range(26):
        a = r.random() * math.tau
        rr = r.random() ** 0.6 * 0.9
        c = Vector((math.cos(a) * rr, math.sin(a) * rr, 0.45 + r.random() * 0.7))
        shade = 0.6 + 0.4 * (c.z / 1.2)
        add_card(b, c, (1.1, 1.0), Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(0, 1))), Vector((0, 0, 1)), M_LEAF, (shade, shade, shade))
    ob = b.finish()
    finish_smooth_foliage(ob, Vector((0, 0, 0.5)))
    return ob


# ----------------------------------------------------------------------------------------------
# Tribüne (Modul 8 m lang, x = Längsrichtung, y = Tiefe nach hinten, z = oben)
# ----------------------------------------------------------------------------------------------

def box(b, x0, y0, z0, x1, y1, z1, mat, color=None):
    bm = b.bm
    mi = b.mat_index(mat)
    uv = bm.loops.layers.uv.verify()
    col = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        f = bm.faces.new([v[i] for i in idx])
        f.material_index = mi
        for li in f.loops:
            li[col] = (*(color or (1, 1, 1)), 1)
            li[uv].uv = (0, 0)


def grandstand_module(name, length=8.0):
    b = Builder(name)
    rows = 11
    rise, run = 0.42, 0.85
    depth = rows * run
    palette = [(0.78, 0.1, 0.12), (0.12, 0.3, 0.72), (0.9, 0.9, 0.92), (0.1, 0.1, 0.12)]
    # Betonstufen
    for i in range(rows):
        y0 = i * run
        box(b, 0, y0, 0, length, y0 + run, 1.0 + (i + 1) * rise, M_CONC)
    # Sitzschalen und Publikum
    cr = random.Random(5)
    for i in range(rows):
        y0 = i * run + 0.18
        z = 1.0 + (i + 1) * rise
        seats = 14
        for s in range(seats):
            x = (s + 0.5) * length / seats
            pc = palette[(s + i) % 4] if (s // 3 + i // 2) % 2 == 0 else palette[1]
            box(b, x - 0.2, y0, z, x + 0.2, y0 + 0.4, z + 0.05, M_SEAT, pc)
            box(b, x - 0.2, y0 + 0.36, z + 0.05, x + 0.2, y0 + 0.42, z + 0.52, M_SEAT, pc)
        # Publikumsstreifen (Karte stehend, texturiert)
        add_card(b, Vector((length / 2, y0 + 0.5, z + 0.62)), (length, 1.0), Vector((0, -1, 0)), Vector((0, 0, 1)), M_CROWD, (1, 1, 1), uv_rect=(cr.random() * 0.5, 0, 0.5 + cr.random() * 0.5, 1))
    # Treppen-Gänge und Geländer
    box(b, -0.06, 0, 0, 0.06, depth, 1.0 + rows * rise + 0.9, M_STEEL)
    box(b, length - 0.06, 0, 0, length + 0.06, depth, 1.0 + rows * rise + 0.9, M_STEEL)
    # vordere Brüstung mit Holm
    box(b, 0, -0.2, 0, length, -0.1, 1.15, M_CONC)
    box(b, 0, -0.2, 1.15, length, -0.05, 1.22, M_STEEL)
    for k in range(5):
        x = (k + 0.5) * length / 5
        box(b, x - 0.03, -0.18, 1.2, x + 0.03, -0.12, 2.0, M_STEEL)
    box(b, 0, -0.18, 2.0, length, -0.1, 2.06, M_STEEL)
    # Dach: Stützen und schräge Fläche mit Streben
    top = 1.0 + rows * rise
    for xs in (0.0, length):
        for ys, hh in ((depth + 0.2, top + 6.2), (-0.6, top + 4.2)):
            box(b, xs - 0.12, ys - 0.12, 0, xs + 0.12, ys + 0.12, hh, M_STEEL)
    box(b, -0.1, -0.7, top + 4.2, length + 0.1, depth + 0.3, top + 4.45, M_ROOF)
    # Dachneigung durch zwei Platten
    box(b, -0.1, depth * 0.45, top + 4.4, length + 0.1, depth + 0.3, top + 6.35, M_ROOF)
    box(b, -0.1, -0.7, top + 4.0, length + 0.1, -0.5, top + 4.5, M_STEEL)
    for k in range(3):
        x = (k + 0.5) * length / 3
        box(b, x - 0.05, -0.6, top + 3.9, x + 0.05, depth + 0.1, top + 4.05, M_STEEL)
    ob = b.finish()
    return ob


# ----------------------------------------------------------------------------------------------
# Szene bauen und exportieren
# ----------------------------------------------------------------------------------------------
objs = []
objs.append(broad_tree('tree_broad_1', 1, 14.0, 0.34, 4.8))
objs.append(broad_tree('tree_broad_2', 2, 17.0, 0.40, 5.6, lean=0.1))
objs.append(broad_tree('tree_broad_3', 3, 11.5, 0.28, 4.0))
objs.append(conifer('tree_conifer_1', 4, 19.0, 0.30, 3.4))
objs.append(conifer('tree_conifer_2', 5, 15.0, 0.25, 2.9))
objs.append(grass_tuft('grass_green_1', 11, False, 12))
objs.append(grass_tuft('grass_green_2', 12, False, 10))
objs.append(grass_tuft('grass_dry_1', 13, True, 12))
objs.append(grass_tuft('grass_dry_2', 14, True, 9))
objs.append(bush('bush_1', 21))
objs.append(bush('bush_2', 22))
objs.append(grandstand_module('grandstand_module', 8.0))

# Material-Einstellungen für glTF: Blattkarten als Alpha-Clip
for m in (M_LEAF, M_NEEDLE, M_CROWD):
    try:
        m.blend_method = 'CLIP'
        m.alpha_threshold = 0.5
    except Exception:
        pass

bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_vertex_color='MATERIAL',
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_draco_color_quantization=8,
)
for o in objs:
    print(o.name, len(o.data.polygons), 'faces')
