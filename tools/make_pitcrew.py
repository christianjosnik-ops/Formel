"""
Boxenstopp-Crew aus Blender: 18 Mechaniker (gegliederte Menschenfiguren mit Overall, Helm, Handschuhen, Stiefeln),
Wagenheber, Schlagschrauber, Reifen und Löscher, dazu eine komplette Choreografie (Animation 'pitstop', 30 fps) nach dem
Ablauf echter Formel-1-Stopps: Crew läuft ein, Wagenheber vorn und hinten, pro Rad Schrauber / Rad ab / Rad an,
Frontflügel-Einsteller, Heckstabilisierer, Feuerlöscher, Freigabe, Rückzug.
Aufruf: python tools/make_pitcrew.py public/models/pitcrew.glb
Koordinaten (Blender): Auto im Ursprung, +x vorwärts, +y links (Garagenseite), +z oben; glTF dreht das nach +Y oben.
Benötigt: bpy, numpy.
"""
import math
import random
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

out = sys.argv[1] if len(sys.argv) > 1 else 'pitcrew.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

FPS = 30
T_PRE = 1.2
T_SERV = 2.6
T_POST = 1.2
T_TOTAL = T_PRE + T_SERV + T_POST

# ------------------------------------------------------------------------------------------------
# Materialien (Vertexfarben; 'Suit' wird im Spiel je Team eingefärbt, 'TyreRing' je Reifenmischung)
# ------------------------------------------------------------------------------------------------

def mat(name, rough=0.7, metal=0.0, vc=True, base=(1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if vc:
        c = m.node_tree.nodes.new('ShaderNodeVertexColor')
        c.layer_name = 'Col'
        m.node_tree.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*base, 1)
    return m


M_SUIT = mat('Suit', 0.65)
M_MISC = mat('CrewMisc', 0.55, 0.15)
M_METAL = M_MISC
M_RUBBER = M_MISC
M_ACC = mat('SuitAccent', 0.6)
M_RING = mat('TyreRing', 0.5)
M_RING_OLD = mat('TyreRingOld', 0.5)


class Mesh:
    """Kleiner bmesh-Builder mit Materialindizes und Vertexfarben."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.col = self.bm.loops.layers.color.new('Col')

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def paint(self, faces, m, color):
        mi = self.mi(m)
        for f in faces:
            f.material_index = mi
            f.smooth = True
            for l in f.loops:
                l[self.col] = (*color, 1)

    def finish(self, parent=None, loc=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        ob.location = loc
        return ob


def lathe(mesh, pts, m, color, seg=12, axis='z', center=(0, 0, 0), scale=(1, 1, 1), cap0=True, cap1=True):
    """Rotationskörper aus Profilpunkten (radius, hoehe) entlang einer Achse."""
    bm = mesh.bm
    rings = []
    for (r, h) in pts:
        ring = []
        for k in range(seg):
            a = k / seg * math.tau
            x, y, z = math.cos(a) * r * scale[0], math.sin(a) * r * scale[1], h * scale[2]
            if axis == 'x':
                x, y, z = z, x, y
            elif axis == 'y':
                x, y, z = y, z, x
            ring.append(bm.verts.new((x + center[0], y + center[1], z + center[2])))
        rings.append(ring)
    faces = []
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            faces.append(bm.faces.new([a[k], a[j], b[j], b[k]]))
    if cap0 and pts[0][0] > 1e-6:
        faces.append(bm.faces.new(rings[0][::-1]))
    if cap1 and pts[-1][0] > 1e-6:
        faces.append(bm.faces.new(rings[-1]))
    mesh.paint(faces, m, color)
    return faces


def box(mesh, c, size, m, color, rot=None):
    bm = mesh.bm
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    vs = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                p = Vector((dx * sx, dy * sy, dz * sz))
                if rot:
                    p = rot @ p
                vs.append(bm.verts.new(p + Vector(c)))
    # Indizes: (dx,dy,dz) -> 0..7 mit dx major
    idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = [bm.faces.new([vs[i] for i in q]) for q in idx]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    mesh.paint(faces, m, color)
    for f in faces:
        f.smooth = False
    return faces


def capsule(mesh, a, b, r0, r1, m, color, seg=10, rings=6):
    """Kapsel von a nach b mit Radien r0 (bei a) und r1 (bei b), Kugelkappen."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    z = d.normalized()
    ref = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    x = z.cross(ref).normalized()
    y = z.cross(x)
    bm = mesh.bm
    prof = []
    for i in range(rings + 1):
        t = i / rings
        ang = (1 - t) * math.pi / 2
        prof.append((-r0 * math.sin(ang), r0 * math.cos(ang) * 0 + r0 * math.cos(ang)))
    # explizites Profil: untere Halbkugel, Schaft, obere Halbkugel
    pts = []
    for i in range(rings):
        t = i / rings
        ang = -math.pi / 2 + t * math.pi / 2
        pts.append((r0 * math.cos(ang), r0 * math.sin(ang)))
    pts.append((r0, 0.0))
    pts.append((r1, L))
    for i in range(1, rings + 1):
        t = i / rings
        ang = t * math.pi / 2
        pts.append((r1 * math.cos(ang), L + r1 * math.sin(ang)))
    rings_v = []
    for (r, h) in pts:
        ring = []
        for k in range(seg):
            ph = k / seg * math.tau
            p = a + x * (math.cos(ph) * r) + y * (math.sin(ph) * r) + z * h
            ring.append(bm.verts.new(p))
        rings_v.append(ring)
    faces = []
    for r1_, r2_ in zip(rings_v[:-1], rings_v[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            faces.append(bm.faces.new([r1_[k], r1_[j], r2_[j], r2_[k]]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    mesh.paint(faces, m, color)
    return faces


def ellipsoid(mesh, c, radii, m, color, seg=12, rings=8, rot=None):
    bm = mesh.bm
    res = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    verts = res['verts']
    for v in verts:
        p = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        if rot:
            p = rot @ p
        v.co = p + Vector(c)
    faces = list({f for v in verts for f in v.link_faces})
    mesh.paint(faces, m, color)
    return faces


# ------------------------------------------------------------------------------------------------
# Mensch: Skelett aus Empties (Pivots), Mesh-Teile als Kinder
# ------------------------------------------------------------------------------------------------

GLOVE = (0.05, 0.05, 0.055)
BOOT = (0.07, 0.07, 0.08)
HELMET_W = (0.93, 0.93, 0.95)
SUIT_TRIM = (0.92, 0.92, 0.94)
SKIN = (0.7, 0.55, 0.45)


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    e.rotation_mode = 'QUATERNION'
    return e


class Human:
    """Gegliederte Figur. Maße in Metern, Größe über scale (1.0 = 1,78 m)."""

    def __init__(self, name, s=1.0, helmet=HELMET_W, seed=0):
        self.name = name
        self.s = s
        r = random.Random(seed)
        self.thigh = 0.44 * s
        self.shin = 0.43 * s
        self.ankle = 0.085 * s
        self.hip_y = 0.095 * s
        self.torso_h = 0.52 * s
        self.sh_y = 0.205 * s
        self.upper = 0.29 * s
        self.fore = 0.27 * s
        self.root = empty(f'{name}', None)
        self.pelvis = empty(f'{name}_pelvis', self.root, (0, 0, 0.95 * s))
        self.spine = empty(f'{name}_spine', self.pelvis, (0, 0, 0.0))
        self.neck = empty(f'{name}_neck', self.spine, (0.0, 0, self.torso_h + 0.06 * s))
        self.head = empty(f'{name}_head', self.neck, (0, 0, 0.0))
        self.hip = {1: empty(f'{name}_hipL', self.pelvis, (0, self.hip_y, -0.04 * s)), -1: empty(f'{name}_hipR', self.pelvis, (0, -self.hip_y, -0.04 * s))}
        self.knee = {1: empty(f'{name}_kneeL', self.hip[1], (0, 0, -self.thigh)), -1: empty(f'{name}_kneeR', self.hip[-1], (0, 0, -self.thigh))}
        self.ankle_j = {1: empty(f'{name}_ankleL', self.knee[1], (0, 0, -self.shin)), -1: empty(f'{name}_ankleR', self.knee[-1], (0, 0, -self.shin))}
        self.shoulder = {1: empty(f'{name}_shoulderL', self.spine, (0, self.sh_y, self.torso_h)), -1: empty(f'{name}_shoulderR', self.spine, (0, -self.sh_y, self.torso_h))}
        self.elbow = {1: empty(f'{name}_elbowL', self.shoulder[1], (0, 0, -self.upper)), -1: empty(f'{name}_elbowR', self.shoulder[-1], (0, 0, -self.upper))}
        self.wrist = {1: empty(f'{name}_wristL', self.elbow[1], (0, 0, -self.fore)), -1: empty(f'{name}_wristR', self.elbow[-1], (0, 0, -self.fore))}
        self.joints = [self.pelvis, self.spine, self.neck, self.head]
        for sd in (1, -1):
            self.joints += [self.hip[sd], self.knee[sd], self.ankle_j[sd], self.shoulder[sd], self.elbow[sd], self.wrist[sd]]
        self._build_meshes(helmet, r)

    # -- Geometrie ------------------------------------------------------------------------------
    def _build_meshes(self, helmet, r):
        s = self.s
        # Becken + Rumpf (Overall, Teamfarbe)
        m = Mesh(f'{self.name}_pelvisMesh')
        ellipsoid(m, (0, 0, 0.0), (0.12 * s, 0.17 * s, 0.11 * s), M_SUIT, (1, 1, 1))
        m.finish(self.pelvis)
        m = Mesh(f'{self.name}_torsoMesh')
        # Brustkorb: oben breit, Taille schmaler
        lathe(m, [(0.14, 0.0), (0.15, 0.12), (0.17, 0.3), (0.165, 0.42), (0.13, 0.5), (0.05, 0.54)], M_SUIT, (1, 1, 1), seg=24, scale=(0.8 * s, 1.18 * s, s))
        # Brust-Sponsorfeld und Reißverschluss (Trimm)
        box(m, (0.135 * s, 0.07 * s, 0.34 * s), (0.01, 0.12 * s, 0.07 * s), M_ACC, (1, 1, 1))
        ellipsoid(m, (0.0, 0.0, 0.47 * s), (0.11 * s, 0.2 * s, 0.045 * s), M_ACC, (1, 1, 1), seg=18, rings=6)  # Schulterpasse
        box(m, (0.136 * s, 0.0, 0.25 * s), (0.008, 0.012, 0.3 * s), M_MISC, (0.2, 0.2, 0.22))
        # Schulterblätter / Rucksack-Rundung am Rücken
        ellipsoid(m, (-0.085 * s, 0, 0.33 * s), (0.05 * s, 0.15 * s, 0.13 * s), M_SUIT, (0.95, 0.95, 0.95), seg=16, rings=8)
        m.finish(self.spine)
        # Hals / Kopf mit Sturmhaube, Helm, Visier, Headset
        m = Mesh(f'{self.name}_headMesh')
        capsule(m, (0, 0, 0.0), (0, 0, 0.06 * s), 0.05 * s, 0.05 * s, M_MISC, (0.1, 0.1, 0.12), seg=8, rings=3)
        ellipsoid(m, (0.005 * s, 0, 0.13 * s), (0.095 * s, 0.085 * s, 0.115 * s), M_MISC, (0.12, 0.12, 0.14), seg=10, rings=7)  # Sturmhaube
        # Helm: Kuppel + Kinnbügel
        ellipsoid(m, (0.0, 0, 0.16 * s), (0.125 * s, 0.112 * s, 0.125 * s), M_MISC, helmet, seg=14, rings=9)
        ellipsoid(m, (0.085 * s, 0, 0.155 * s), (0.055 * s, 0.1 * s, 0.05 * s), M_METAL, (0.02, 0.03, 0.05), seg=10, rings=6)  # Visier (dunkel, glänzend)
        box(m, (0.05 * s, 0, 0.1 * s), (0.04 * s, 0.14 * s, 0.03 * s), M_MISC, helmet)  # Kinnteil
        box(m, (0.0, 0, 0.235 * s), (0.1 * s, 0.015 * s, 0.01 * s), M_MISC, (0.85, 0.1, 0.1))  # Helmstreifen
        for sd in (1, -1):
            box(m, (-0.01 * s, sd * 0.118 * s, 0.14 * s), (0.04 * s, 0.015 * s, 0.05 * s), M_MISC, (0.08, 0.08, 0.1))  # Funk-Kopfhörer
        m.finish(self.head)
        # Beine: Oberschenkel, Unterschenkel, Stiefel
        for sd in (1, -1):
            m = Mesh(f'{self.name}_legMesh{sd}')
            capsule(m, (0, 0, 0), (0, 0, -self.thigh), 0.088 * s, 0.065 * s, M_SUIT, (1, 1, 1))
            box(m, (0.0, sd * 0.082 * s, -0.22 * s), (0.025, 0.012, 0.3 * s), M_ACC, (1, 1, 1))  # Seitenstreifen
            m.finish(self.hip[sd])
            m = Mesh(f'{self.name}_shinMesh{sd}')
            capsule(m, (0, 0, 0), (0, 0, -self.shin), 0.062 * s, 0.05 * s, M_SUIT, (0.97, 0.97, 0.97))
            box(m, (0, 0, -0.25 * s), (0.02, 0.13 * s, 0.05 * s), M_MISC, SUIT_TRIM)  # Reflexband
            m.finish(self.knee[sd])
            m = Mesh(f'{self.name}_footMesh{sd}')
            ellipsoid(m, (0.06 * s, 0, -0.03 * s), (0.14 * s, 0.055 * s, 0.05 * s), M_MISC, BOOT, seg=10, rings=6)
            box(m, (0.065 * s, 0, -0.082 * s), (0.25 * s, 0.095 * s, 0.014 * s), M_MISC, (0.03, 0.03, 0.035))
            m.finish(self.ankle_j[sd])
        # Arme: Oberarm, Unterarm, Handschuh
        for sd in (1, -1):
            m = Mesh(f'{self.name}_upperMesh{sd}')
            ellipsoid(m, (0, 0, 0), (0.062 * s, 0.062 * s, 0.062 * s), M_SUIT, (1, 1, 1), seg=10, rings=6)  # Schultergelenk
            capsule(m, (0, 0, 0), (0, 0, -self.upper), 0.052 * s, 0.043 * s, M_SUIT, (1, 1, 1))
            box(m, (0, sd * 0.05 * s, -0.12 * s), (0.02, 0.012, 0.2 * s), M_ACC, (1, 1, 1))
            m.finish(self.shoulder[sd])
            m = Mesh(f'{self.name}_foreMesh{sd}')
            capsule(m, (0, 0, 0), (0, 0, -self.fore), 0.043 * s, 0.036 * s, M_SUIT, (0.97, 0.97, 0.97))
            m.finish(self.elbow[sd])
            m = Mesh(f'{self.name}_handMesh{sd}')
            ellipsoid(m, (0.0, 0, -0.045 * s), (0.04 * s, 0.032 * s, 0.062 * s), M_MISC, GLOVE, seg=8, rings=6)  # Handfläche
            for fi in range(4):
                capsule(m, (0.012 * s, (fi - 1.5) * 0.017 * s, -0.09 * s), (0.012 * s, (fi - 1.5) * 0.017 * s, -0.135 * s), 0.0095 * s, 0.0085 * s, M_MISC, GLOVE, seg=5, rings=2)
            capsule(m, (0.025 * s, -sd * 0.025 * s, -0.05 * s), (0.04 * s, -sd * 0.03 * s, -0.095 * s), 0.011 * s, 0.009 * s, M_MISC, GLOVE, seg=5, rings=2)  # Daumen
            m.finish(self.wrist[sd])
        # Reflexstreifen um die Taille
        m = Mesh(f'{self.name}_belt')
        lathe(m, [(0.152, 0.07), (0.152, 0.095)], M_MISC, SUIT_TRIM, seg=14, scale=(0.8 * s, 1.18 * s, s))
        m.finish(self.spine)


# ------------------------------------------------------------------------------------------------
# Requisiten
# ------------------------------------------------------------------------------------------------

def make_tyre(name, ring=None):
    ring = ring or M_RING
    root = empty(name, None)
    m = Mesh(name + '_mesh')
    # Gummi: Achse entlang y (Blender), Profil (Radius, y)
    lathe(m, [(0.20, -0.15), (0.30, -0.15), (0.345, -0.125), (0.36, -0.05), (0.36, 0.05), (0.345, 0.125), (0.30, 0.15), (0.20, 0.15)], M_RUBBER, (0.04, 0.04, 0.045), seg=22, axis='y')
    # Felge: zwei Scheiben mit Speichen, Mittelmutter
    lathe(m, [(0.0, 0.0), (0.205, 0.0)], M_METAL, (0.25, 0.26, 0.28), seg=20, axis='y', center=(0, 0.1, 0))
    lathe(m, [(0.0, 0.0), (0.205, 0.0)], M_METAL, (0.25, 0.26, 0.28), seg=20, axis='y', center=(0, -0.1, 0))
    for k in range(5):
        a = k / 5 * math.tau
        c = (math.cos(a) * 0.1, 0.152, math.sin(a) * 0.1)
        box(m, c, (0.05, 0.02, 0.17), M_METAL, (0.55, 0.57, 0.6), rot=Euler((0, -a + math.pi / 2, 0)).to_matrix())
    lathe(m, [(0.035, 0.0), (0.035, 0.05)], M_METAL, (0.85, 0.7, 0.2), seg=8, axis='y', center=(0, 0.15, 0))
    # Farbring der Reifenmischung (beide Flanken)
    lathe(m, [(0.285, 0.0), (0.325, 0.0)], ring, (1, 1, 1), seg=24, axis='y', center=(0, 0.1505, 0), cap0=False, cap1=False)
    lathe(m, [(0.285, 0.0), (0.325, 0.0)], ring, (1, 1, 1), seg=24, axis='y', center=(0, -0.1505, 0), cap0=False, cap1=False)
    m.finish(root)
    return root


def make_gun(name):
    root = empty(name, None)
    m = Mesh(name + '_mesh')
    box(m, (0.0, 0, 0.0), (0.26, 0.085, 0.095), M_METAL, (0.12, 0.45, 0.22))
    capsule(m, (-0.04, 0, -0.04), (-0.07, 0, -0.17), 0.028, 0.026, M_MISC, (0.06, 0.06, 0.07), seg=8, rings=3)
    lathe(m, [(0.034, 0.0), (0.034, 0.12)], M_METAL, (0.7, 0.72, 0.75), seg=10, axis='y', center=(0.17, 0.0, 0.0))  # Nuss
    capsule(m, (-0.13, 0, 0.0), (-0.3, 0, -0.1), 0.012, 0.012, M_MISC, (0.05, 0.05, 0.05), seg=6, rings=2)  # Schlauch
    m.finish(root)
    return root


def make_jack(name, front):
    root = empty(name, None)
    base = Mesh(name + '_base')
    box(base, (0, 0, 0.05), (0.62, 0.46, 0.09), M_METAL, (0.75, 0.1, 0.1))
    for sx in (-0.24, 0.24):
        for sy in (-0.2, 0.2):
            lathe(base, [(0.04, 0.0), (0.04, 0.03)], M_MISC, (0.05, 0.05, 0.05), seg=8, axis='y', center=(sx, sy, 0.04))
    box(base, (0, 0, 0.22), (0.14, 0.14, 0.26), M_METAL, (0.55, 0.57, 0.6))
    base.finish(root)
    ram = empty(name + '_ram', root, (0, 0, 0.3))
    rm = Mesh(name + '_ramMesh')
    lathe(rm, [(0.035, 0.0), (0.035, 0.28)], M_METAL, (0.8, 0.82, 0.85), seg=10)
    box(rm, (0, 0, 0.3), (0.2, 0.34, 0.05), M_MISC, (0.07, 0.07, 0.08))  # Aufnahme
    rm.finish(ram)
    handle = empty(name + '_handle', root, (0, 0, 0.22))
    hm = Mesh(name + '_handleMesh')
    sgn = 1.0 if front else -1.0
    capsule(hm, (0, 0, 0), (sgn * 0.9, 0, 0.3), 0.02, 0.02, M_METAL, (0.6, 0.62, 0.65), seg=8, rings=2)
    capsule(hm, (sgn * 0.9, -0.14, 0.3), (sgn * 0.9, 0.14, 0.3), 0.022, 0.022, M_MISC, (0.05, 0.05, 0.05), seg=8, rings=2)
    hm.finish(handle)
    return root, ram, handle


def make_extinguisher(name):
    root = empty(name, None)
    m = Mesh(name + '_mesh')
    lathe(m, [(0.0, 0.0), (0.075, 0.0), (0.08, 0.05), (0.08, 0.38), (0.05, 0.43), (0.025, 0.45)], M_METAL, (0.78, 0.08, 0.06), seg=12)
    box(m, (0.0, 0, 0.5), (0.04, 0.16, 0.03), M_MISC, (0.1, 0.1, 0.1))
    capsule(m, (0.0, 0, 0.46), (0.3, 0, 0.3), 0.012, 0.012, M_MISC, (0.05, 0.05, 0.05), seg=6, rings=2)
    m.finish(root)
    return root


def make_hextool(name):
    root = empty(name, None)
    m = Mesh(name + '_mesh')
    capsule(m, (0, 0, 0), (0.18, 0, 0), 0.008, 0.008, M_METAL, (0.8, 0.8, 0.82), seg=6, rings=2)
    capsule(m, (0, 0, 0), (0, 0, 0.07), 0.008, 0.008, M_METAL, (0.8, 0.8, 0.82), seg=6, rings=2)
    m.finish(root)
    return root


# ------------------------------------------------------------------------------------------------
# Inverse Kinematik (zweigliedrig) und Posen
# ------------------------------------------------------------------------------------------------

def rotz(a):
    return Matrix.Rotation(a, 3, 'Z')


def roty(a):
    return Matrix.Rotation(a, 3, 'Y')


def qalign(v0, v1):
    return Vector(v0).normalized().rotation_difference(Vector(v1).normalized())


def two_bone(S, T, L1, L2, pole):
    """Gibt (E, T') zurück: Ellbogenposition und (ggf. gekürzte) Zielposition."""
    d = T - S
    D = d.length
    if D < 1e-6:
        d = Vector((0, 0, -1))
        D = 1e-6
    u = d / D
    Dc = min(max(D, abs(L1 - L2) + 0.01), (L1 + L2) * 0.999)
    Tn = S + u * Dc
    cosa = (L1 * L1 + Dc * Dc - L2 * L2) / (2 * L1 * Dc)
    a = math.acos(max(-1.0, min(1.0, cosa)))
    perp = pole - u * pole.dot(u)
    if perp.length < 1e-5:
        perp = Vector((0, 1, 0)).cross(u)
    perp.normalize()
    E = S + u * (L1 * math.cos(a)) + perp * (L1 * math.sin(a))
    return E, Tn


class Pose:
    """Vollständig aufgelöste Pose in Weltkoordinaten (Ziele für Hände und Füße)."""

    def __init__(self, x, y, yaw, h, lean=0.0, twist=0.0, look=0.0, hand=(None, None), foot=(None, None), head_yaw=0.0):
        self.x, self.y, self.yaw, self.h = x, y, yaw, h
        self.lean, self.twist, self.look, self.head_yaw = lean, twist, look, head_yaw
        self.hand = list(hand)  # [links, rechts]
        self.foot = list(foot)

    def copy(self):
        return Pose(self.x, self.y, self.yaw, self.h, self.lean, self.twist, self.look, tuple(self.hand), tuple(self.foot), self.head_yaw)


def pelvis_pos(P):
    return Vector((P.x, P.y, P.h))


def chest_rot(P):
    return rotz(P.yaw) @ roty(P.lean) @ rotz(P.twist)


def default_hand(hu, P, sd):
    """Hängende Hand neben dem Oberschenkel (Weltkoordinaten)."""
    Rp = rotz(P.yaw)
    Rc = chest_rot(P)
    S = pelvis_pos(P) + Rc @ Vector((0, sd * hu.sh_y, hu.torso_h))
    return S + Rp @ Vector((0.03 * hu.s, sd * 0.045, -0.6 * hu.s))


def default_foot(hu, P, sd):
    Rp = rotz(P.yaw)
    return Vector((P.x, P.y, 0)) + Rp @ Vector((0.0, sd * 0.115 * hu.s, 0))


def apply_pose(hu, P, frame):
    """Setzt Wurzel und alle Gelenkrotationen der Figur für ein Bild und keyt sie."""
    s = hu.s
    root = hu.root
    root.location = (P.x, P.y, 0)
    root.rotation_mode = 'QUATERNION'
    root.rotation_quaternion = Quaternion((0, 0, 1), P.yaw)
    hu.pelvis.location = (0, 0, P.h)
    hu.spine.rotation_quaternion = (roty(P.lean) @ rotz(P.twist)).to_quaternion()
    Rp = rotz(P.yaw)
    Rc = chest_rot(P)
    Rp_q = Rp.to_quaternion()
    Rc_q = Rc.to_quaternion()
    # Kopf: Blick unabhängig von Rumpfneigung
    hq = (roty(P.look - P.lean * 0.6) @ rotz(P.head_yaw - P.twist * 0.6)).to_quaternion()
    hu.neck.rotation_quaternion = (roty(-P.lean * 0.4) @ rotz(-P.twist * 0.4)).to_quaternion()
    hu.head.rotation_quaternion = hq
    Pp = pelvis_pos(P)
    for sd in (1, -1):
        idx = 0 if sd == 1 else 1
        # --- Arm ---
        S = Pp + Rc @ Vector((0, sd * hu.sh_y, hu.torso_h))
        T = P.hand[idx] if P.hand[idx] is not None else default_hand(hu, P, sd)
        pole = Rc @ Vector((-0.2, sd * 0.9, -0.5))
        E, Tn = two_bone(S, T, hu.upper, hu.fore, pole)
        qu = qalign((0, 0, -1), E - S)
        qf = qalign((0, 0, -1), Tn - E)
        hu.shoulder[sd].rotation_quaternion = Rc_q.inverted() @ qu
        hu.elbow[sd].rotation_quaternion = qu.inverted() @ qf
        hu.wrist[sd].rotation_quaternion = Quaternion((1, 0, 0, 0))
        # --- Bein ---
        H = Pp + Rp @ Vector((0, sd * hu.hip_y, -0.04 * s))
        F = P.foot[idx] if P.foot[idx] is not None else default_foot(hu, P, sd)
        A = Vector((F.x, F.y, F.z + hu.ankle))
        polek = Rp @ Vector((1.0, sd * 0.12, 0.1))
        K, An = two_bone(H, A, hu.thigh, hu.shin, polek)
        qt = qalign((0, 0, -1), K - H)
        qs = qalign((0, 0, -1), An - K)
        hu.hip[sd].rotation_quaternion = Rp_q.inverted() @ qt
        hu.knee[sd].rotation_quaternion = qt.inverted() @ qs
        # Fuß flach: Welt-Ausrichtung = Yaw der Figur (leicht gedreht beim Gehen egal)
        fq = Quaternion((0, 0, 1), P.yaw)
        hu.ankle_j[sd].rotation_quaternion = qs.inverted() @ fq
    for j in hu.joints:
        j.keyframe_insert('rotation_quaternion', frame=frame)
    root.keyframe_insert('location', frame=frame)
    root.keyframe_insert('rotation_quaternion', frame=frame)
    hu.pelvis.keyframe_insert('location', frame=frame)

# ------------------------------------------------------------------------------------------------
# Segment-Tracks: Gehen entlang Wegpunkten, Posen-Übergänge, Halten (mit optionalen Hand-/Fuß-Funktionen)
# ------------------------------------------------------------------------------------------------

def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def lerp_ang(a, b, u):
    d = (b - a + math.pi) % math.tau - math.pi
    return a + d * u


def lerp_vec(a, b, u):
    return a + (b - a) * u


def full(hu, P):
    Q = P.copy()
    for i, sd in enumerate((1, -1)):
        if Q.hand[i] is None:
            Q.hand[i] = default_hand(hu, Q, sd)
        if Q.foot[i] is None:
            Q.foot[i] = default_foot(hu, Q, sd)
    return Q


def blend(hu, A, B, u):
    P = Pose(
        lerp_vec(A.x, B.x, u), lerp_vec(A.y, B.y, u), lerp_ang(A.yaw, B.yaw, u), lerp_vec(A.h, B.h, u),
        lerp_vec(A.lean, B.lean, u), lerp_vec(A.twist, B.twist, u), lerp_vec(A.look, B.look, u), head_yaw=lerp_vec(A.head_yaw, B.head_yaw, u),
    )
    for i in range(2):
        P.hand[i] = lerp_vec(A.hand[i], B.hand[i], u)
        P.foot[i] = lerp_vec(A.foot[i], B.foot[i], u)
    return P


class Track:
    def __init__(self, hu, start):
        self.hu = hu
        self.segs = []
        self.cur = full(hu, start)
        self.t = 0.0

    def hold(self, t1, hands=None, feet=None):
        self.segs.append(dict(kind='lerp', t0=self.t, t1=t1, a=self.cur, b=self.cur, hands=hands, feet=feet))
        self.t = t1

    def pose(self, t1, P, hands=None, feet=None, ease=True):
        b = full(self.hu, P)
        self.segs.append(dict(kind='lerp', t0=self.t, t1=t1, a=self.cur, b=b, hands=hands, feet=feet, ease=ease))
        self.cur = b
        self.t = t1

    def walk(self, t1, pts, yaw_end=None, h=None, hands=None, lean=0.08):
        """Geht entlang der Wegpunkte (xy). Endpose: stehend an der letzten Stelle."""
        hu = self.hu
        a = self.cur
        pl = [Vector((a.x, a.y))] + [Vector(p) for p in pts]
        L = sum((pl[i + 1] - pl[i]).length for i in range(len(pl) - 1))
        last = pl[-1] - pl[-2] if len(pl) > 1 else Vector((1, 0))
        ye = yaw_end if yaw_end is not None else math.atan2(last.y, last.x)
        hh = h if h is not None else 0.97 * hu.s
        end = Pose(pl[-1].x, pl[-1].y, ye, hh)
        self.segs.append(dict(kind='walk', t0=self.t, t1=t1, a=a, pl=pl, L=L, ye=ye, h=hh, hands=hands, lean=lean))
        self.cur = full(hu, end)
        self.t = t1

    def eval(self, t):
        hu = self.hu
        if not self.segs:
            return self.cur
        if t <= self.segs[0]['t0']:
            return self.segs[0]['a']
        for sg in self.segs:
            if sg['t0'] <= t <= sg['t1']:
                return self._seg(sg, t)
        return self.cur

    def _seg(self, sg, t):
        hu = self.hu
        u = (t - sg['t0']) / max(1e-6, sg['t1'] - sg['t0'])
        if sg['kind'] == 'lerp':
            P = blend(hu, sg['a'], sg['b'], smooth(u) if sg.get('ease', True) else u)
        else:
            a = sg['a']
            su = smooth(u)
            s_ = sg['L'] * su
            pl = sg['pl']
            acc = 0.0
            pos = pl[-1]
            d = pl[-1] - pl[-2] if len(pl) > 1 else Vector((1, 0))
            for i in range(len(pl) - 1):
                sl = (pl[i + 1] - pl[i]).length
                if acc + sl >= s_ or i == len(pl) - 2:
                    f = (s_ - acc) / max(1e-6, sl)
                    pos = pl[i] + (pl[i + 1] - pl[i]) * min(1.0, max(0.0, f))
                    d = pl[i + 1] - pl[i]
                    break
                acc += sl
            ydir = math.atan2(d.y, d.x) if d.length > 1e-6 else a.yaw
            ye = sg['ye']
            # zu Beginn aus Anfangsrichtung eindrehen, zum Ende auf Endrichtung
            yaw = lerp_ang(a.yaw, ydir, smooth(u * 6))
            yaw = lerp_ang(yaw, ye, smooth((u - 0.7) / 0.3))
            moving = 0.03 < su < 0.97
            stride = 0.62
            th = math.pi * s_ / stride
            bob = 0.022 * abs(math.sin(th)) if moving else 0.0
            h = sg['h'] - bob
            P = Pose(pos.x, pos.y, yaw, h, lean=sg['lean'] * (smooth(u * 8) * (1 - smooth((u - 0.85) / 0.15))))
            rp = rotz(ydir)
            for i, sd in enumerate((1, -1)):
                ph = 0.0 if sd > 0 else math.pi
                f_fwd = 0.34 * math.sin(th + ph) if moving else 0.0
                lift = 0.10 * max(0.0, math.cos(th + ph)) if moving else 0.0
                base = Vector((pos.x, pos.y, 0)) + rp @ Vector((f_fwd * (1 if moving else 0), sd * 0.115, 0))
                base.z = lift
                P.foot[i] = base
                hang = default_hand(hu, P, sd)
                sw = -0.22 * math.sin(th + ph) if moving else 0.0
                P.hand[i] = hang + rp @ Vector((sw, 0, 0.04 if moving else 0.0))
            # an Anfang/Ende zur Haltung der Nachbarposen überblenden (Hände/Füße)
            k0 = smooth(u * 10)
            k1 = 1 - smooth((u - 0.9) / 0.1)
            kk = min(k0, k1)
            Pa = a
            Pb = full(hu, Pose(pos.x, pos.y, yaw, sg['h']))
            for i in range(2):
                P.foot[i] = lerp_vec(lerp_vec(Pa.foot[i], P.foot[i], k0), Pb.foot[i] if u > 0.9 else P.foot[i], 1 - k1)
                P.hand[i] = lerp_vec(lerp_vec(Pa.hand[i], P.hand[i], k0), P.hand[i], 1)
        # externe Hand-/Fußvorgaben (z. B. Werkzeug greifen)
        hf = sg.get('hands')
        if hf:
            for i in range(2):
                if hf[i] is not None:
                    v = hf[i](t, P)
                    if v is not None:
                        P.hand[i] = v
        ff = sg.get('feet')
        if ff:
            for i in range(2):
                if ff[i] is not None:
                    v = ff[i](t, P)
                    if v is not None:
                        P.foot[i] = v
        return P


# ------------------------------------------------------------------------------------------------
# Choreografie
# ------------------------------------------------------------------------------------------------
WHEELS = {'FL': (1.853, 1), 'FR': (1.853, -1), 'RL': (-1.547, 1), 'RR': (-1.547, -1)}
HUB_Z = 0.34
HUB_Y = 0.74
LIFT = 0.09
PI = math.pi


def tt(s):
    return T_PRE + s


def ramp(t, a, b):
    return smooth((t - a) / max(1e-6, b - a))


def lift_at(t):
    s = t - T_PRE
    return LIFT * (ramp(s, 0.30, 0.60) - ramp(s, 1.50, 1.80))


def wheel_hidden(t):
    s = t - T_PRE
    return 0.50 <= s < 1.10


class Rig:
    def __init__(self, name, hu, track):
        self.name, self.hu, self.track = name, hu, track
        self.ov = []  # (hand_index, fn(t,P)->Vector, weight_fn(t))

    def hand(self, i, fn, w=lambda t: 1.0):
        self.ov.append((i, fn, w))


def win(a, b, fi=0.12, fo=0.12):
    """Gewicht 1 zwischen a und b mit weichen Rändern."""
    return lambda t: ramp(t, a - fi, a) * (1 - ramp(t, b, b + fo))


RIGS = {}
PROPS = {}  # name -> (obj, fn(t) -> (pos, yaw, scale))


def new_human(name, x, y, yaw, h=0.97, s=1.0, seed=0, helmet=HELMET_W):
    hu = Human(name, s, helmet, seed)
    tr = Track(hu, Pose(x, y, yaw, h * s))
    RIGS[name] = Rig(name, hu, tr)
    return RIGS[name]


def base(name, t):
    return RIGS[name].track.eval(t)


def rot_p(yaw):
    return rotz(yaw)


def carry_pos(P, fwd=0.45, lat=0.0, z=None):
    Rp = rotz(P.yaw)
    v = Vector((P.x, P.y, 0)) + Rp @ Vector((fwd, lat, 0))
    v.z = z if z is not None else max(0.36, P.h * 0.62)
    return v


def build():
    rnd = random.Random(7)
    sizes = [0.97, 1.0, 1.03, 1.06, 0.98, 1.02]
    helm = [HELMET_W, (0.92, 0.92, 0.94), (0.85, 0.86, 0.9), (0.95, 0.9, 0.85)]
    idx = 0

    def mk(name, x, y, yaw, h=0.97):
        nonlocal idx
        idx += 1
        return new_human(name, x, y, yaw, h, sizes[idx % len(sizes)], idx, helm[idx % len(helm)])

    for w, (xw, sd) in WHEELS.items():
        yc = -sd * PI / 2
        yo = sd * PI / 2
        front = xw > 0
        # Anlaufwege: linke Seite gerade, rechte Seite um Nase bzw. Heck herum
        def route(tx, ty, ystart):
            if sd > 0:
                return [(tx, ty)]
            if front:
                return [(4.3, 0.9), (4.3, -1.9), (tx, ty)]
            return [(-4.4, 0.9), (-4.4, -1.9), (tx, ty)]

        def start(dx, dy=0.0):
            if sd > 0:
                return (xw + dx, 4.6 + dy)
            return (5.6 if front else -5.6, 2.0 + dy + dx * 0.4)

        # ---------------- Schrauber (Gun) ----------------
        sx, sy = start(-0.1)
        G = mk(f'{w}_gun', sx, sy, yc if sd > 0 else -PI / 4)
        trk = G.track
        gx, gy = xw - 0.15, sd * 1.55
        trk.walk(tt(-0.05), route(gx, gy, 0), yaw_end=yc, h=0.82, lean=0.2)
        trk.pose(tt(0.12), Pose(xw, sd * 1.3, yc, 0.60, lean=0.82))              # hockt ans Rad
        trk.hold(tt(0.70))
        trk.pose(tt(0.95), Pose(xw - 0.62, sd * 1.5, yc, 0.78, lean=0.4))        # macht Platz
        trk.hold(tt(1.12))
        trk.pose(tt(1.28), Pose(xw, sd * 1.3, yc, 0.60, lean=0.82))              # zurück ans Rad
        trk.hold(tt(1.62))
        trk.pose(tt(1.78), Pose(xw, sd * 1.35, yc, 0.9, lean=0.15))              # aufrichten, Hand hoch
        trk.hold(tt(2.12))
        trk.walk(tt(2.62), [(xw - 0.2, sd * 2.1)], yaw_end=yc, h=0.97)
        trk.walk(T_TOTAL, [(xw, sd * 4.6)] if sd > 0 else [(xw, sd * 2.2), (xw - 0.5 + 0.0, 3.0), (xw, 4.6)], h=0.97)

        # ---------------- Rad ab ----------------
        ox = xw + 0.72
        sx, sy = start(0.55)
        O = mk(f'{w}_off', sx, sy, yc if sd > 0 else -PI / 4)
        trk = O.track
        trk.walk(tt(0.0), route(ox, sd * 1.75, 0), yaw_end=yc, h=0.9, lean=0.2)
        trk.hold(tt(0.38))
        trk.pose(tt(0.58), Pose(ox - 0.18, sd * 1.5, yc, 0.8, lean=0.45))        # greift das Rad
        trk.pose(tt(0.95), Pose(ox - 0.18, sd * 1.62, yc, 0.9, lean=0.25))       # zieht ab
        trk.walk(tt(1.38), [(ox + 0.05, sd * 3.0)], yaw_end=yo, h=0.8, lean=0.35)  # trägt das Rad weg
        trk.pose(tt(1.58), Pose(ox + 0.05, sd * 3.0, yo, 0.97, lean=0.05))
        trk.hold(tt(2.5))
        trk.walk(T_TOTAL, [(ox, sd * 4.4)] if sd > 0 else [(ox, sd * 3.0), (ox, 4.4)], h=0.97)

        # ---------------- Rad an ----------------
        sx, sy = start(0.0, 0.5)
        N = mk(f'{w}_on', sx, sy, yc if sd > 0 else -PI / 4)
        trk = N.track
        nx = xw + 0.05
        trk.walk(tt(0.0), route(nx, sd * 2.35, 0), yaw_end=yc, h=0.95, lean=0.1)
        trk.hold(tt(0.55))
        trk.pose(tt(0.95), Pose(nx, sd * 1.62, yc, 0.84, lean=0.3))              # drückt das neue Rad auf
        trk.hold(tt(1.12))
        trk.pose(tt(1.34), Pose(nx, sd * 2.2, yc, 0.97, lean=0.05))              # tritt zurück
        trk.hold(tt(2.0))
        trk.walk(T_TOTAL, [(nx, sd * 4.5)] if sd > 0 else [(nx, sd * 2.5), (nx, 4.5)], h=0.97)

    # ---------------- Wagenheber ----------------
    for key, sgn in (('F', 1), ('R', -1)):
        mx = 3.6 if sgn > 0 else -3.4
        h0 = (7.0 if sgn > 0 else -6.8, 0.0)
        J = mk(f'{key}_jack', h0[0], h0[1], PI if sgn > 0 else 0.0)
        yaw = PI if sgn > 0 else 0.0
        trk = J.track
        trk.walk(tt(0.05), [(mx, 0.0)], yaw_end=yaw, h=0.88, lean=0.25)
        trk.pose(tt(0.32), Pose(mx, 0.0, yaw, 0.84, lean=0.3))
        trk.pose(tt(0.62), Pose(mx, 0.0, yaw, 0.74, lean=0.55))                  # pumpt hoch
        trk.hold(tt(1.5))
        trk.pose(tt(1.8), Pose(mx, 0.0, yaw, 0.88, lean=0.25))                   # senkt ab
        trk.hold(tt(1.98))
        far = (mx + sgn * 2.4, 0.0)
        trk.walk(tt(2.45), [far], yaw_end=yaw, h=0.9, lean=0.2)                   # zieht den Heber zurück
        trk.walk(T_TOTAL, [(far[0] + sgn * 0.5, 3.0), (far[0], 4.6)] if True else [], h=0.97)
        jr, ram, handle = make_jack(f'{key}_jackProp', sgn > 0)
        PROPS[f'{key}_jackProp'] = (jr, ram, handle, sgn, J)

    # ---------------- Frontflügel ----------------
    for sd in (1, -1):
        nm = 'FW_L' if sd > 0 else 'FW_R'
        sx, sy = (3.6, 4.4) if sd > 0 else (5.8, 2.4)
        yc = -sd * PI / 2
        W = mk(nm, sx, sy, yc if sd > 0 else -PI / 4)
        trk = W.track
        route_ = [(3.35, sd * 1.35)] if sd > 0 else [(4.3, 0.9), (4.3, -1.5), (3.35, sd * 1.35)]
        trk.walk(tt(0.0), route_, yaw_end=yc, h=0.9, lean=0.2)
        trk.hold(tt(0.6))
        trk.pose(tt(0.85), Pose(3.2, sd * 1.15, yc, 0.58, lean=0.85))            # hockt am Flügel
        trk.hold(tt(1.5))
        trk.pose(tt(1.75), Pose(3.25, sd * 1.4, yc, 0.95, lean=0.1))
        trk.hold(tt(2.1))
        trk.walk(T_TOTAL, [(3.35, sd * 2.6), (3.6, 4.5)] if sd > 0 else [(3.9, sd * 2.2), (4.4, 0.9), (3.7, 4.5)], h=0.97)

    # ---------------- Heck-Stabilisierer ----------------
    St = mk('RW_stab', -5.0, 4.0, -PI / 2)
    trk = St.track
    trk.walk(tt(0.0), [(-3.0, 1.1)], yaw_end=-0.35, h=0.95, lean=0.15)
    trk.pose(tt(0.3), Pose(-3.05, 1.0, 0.0, 0.93, lean=0.3))
    trk.hold(tt(1.9))
    trk.pose(tt(2.2), Pose(-3.05, 1.2, -0.3, 0.97, lean=0.05))
    trk.walk(T_TOTAL, [(-3.6, 3.0), (-3.6, 4.6)], h=0.97)

    # ---------------- Feuerlöscher ----------------
    Fx = mk('FIRE', -3.4, 4.8, -PI / 2)
    trk = Fx.track
    trk.walk(tt(0.0), [(-2.2, 2.6)], yaw_end=-1.1, h=0.9, lean=0.1)
    trk.hold(tt(2.1))
    trk.walk(T_TOTAL, [(-2.5, 4.7)], h=0.97)


# ------------------------------------------------------------------------------------------------
# Requisiten-Zustände, Hand-Zuordnung, Animation, Export
# ------------------------------------------------------------------------------------------------
def hub_pos(w, t):
    xw, sd = WHEELS[w]
    return Vector((xw, sd * HUB_Y, HUB_Z + lift_at(t)))


def tyre_state_old(w, t):
    s = t - T_PRE
    xw, sd = WHEELS[w]
    if s < 0.50 or s > 3.9:
        return None
    O = base(f'{w}_off', t)
    hub = hub_pos(w, t)
    carry = carry_pos(O, 0.45)
    if s < 0.98:
        u = ramp(s, 0.55, 0.98)
        pos = hub.lerp(carry, u)
        return pos
    if s < 1.40:
        return carry
    if s < 1.62:   # absetzen
        c = carry_pos(O, 0.45, z=max(0.36, O.h * 0.62))
        return Vector((c.x, c.y, lerp_vec(carry.z, 0.36, ramp(s, 1.4, 1.6))))
    O2 = base(f'{w}_off', tt(1.62))
    c = carry_pos(O2, 0.45)
    return Vector((c.x, c.y, 0.36))


def tyre_state_new(w, t):
    s = t - T_PRE
    xw, sd = WHEELS[w]
    if s > 1.16:
        return None
    N = base(f'{w}_on', t)
    carry = carry_pos(N, 0.45, z=max(0.42, N.h * 0.66))
    hub = hub_pos(w, t)
    u = ramp(s, 0.80, 1.08)
    return carry.lerp(hub, u)


def gun_wnut(s):
    return (ramp(s, -0.15, 0.08) * (1 - ramp(s, 0.66, 0.9))) + ramp(s, 1.1, 1.26) * (1 - ramp(s, 1.60, 1.78))


def gun_state(w, t):
    s = t - T_PRE
    xw, sd = WHEELS[w]
    G = base(f'{w}_gun', t)
    yaw = 0.0 if sd < 0 else PI
    Rg = rotz(yaw)
    carry = Vector((G.x, G.y, G.h - 0.1)) + rotz(G.yaw) @ Vector((0.3, -0.2, 0.0))
    nut = Vector((xw - 0.17 * (1 if sd < 0 else -1), sd * 1.04, HUB_Z + lift_at(t)))
    wn = min(1.0, gun_wnut(s))
    vib = 0.0
    if (0.18 < s < 0.62) or (1.32 < s < 1.55):
        vib = 0.006 * math.sin(t * 95.0)
    pos = carry.lerp(nut, wn) + Vector((vib, 0, vib * 0.5))
    ang = lerp_ang(G.yaw, yaw, wn)
    return pos, ang, wn


def grip_pts(pos, ang):
    Rg = rotz(ang)
    return pos + Rg @ Vector((-0.055, 0, -0.10)), pos + Rg @ Vector((0.05, 0, 0.055))


def jack_tip(key, sgn, t):
    s = t - T_PRE
    J = base(f'{key}_jack', t)
    root_x = J.x - sgn * 1.25
    L = lift_at(t)
    psi = sgn * 5.0 * L
    tip = Vector((root_x, 0, 0.22)) + roty(psi) @ Vector((sgn * 0.9, 0, 0.3))
    return root_x, psi, tip, J


def setup_overrides():
    for w, (xw, sd) in WHEELS.items():
        # Schrauber: rechte Hand am Griff, linke stützt (nur wenn Werkzeug am Rad)
        G = RIGS[f'{w}_gun']
        G.hand(1, lambda t, P, w=w: grip_pts(*gun_state(w, t)[:2])[0])
        G.hand(0, lambda t, P, w=w: grip_pts(*gun_state(w, t)[:2])[1], lambda t, w=w: min(1.0, gun_state(w, t)[2] * 1.3))
        # Hand-Signal nach dem Anziehen (linke Hand hoch)
        G.hand(0, lambda t, P, w=w: Vector((P.x, P.y, P.h + 0.95)) + rotz(P.yaw) @ Vector((0.05, 0.1, 0.0)), win(tt(1.72), tt(2.1), 0.15, 0.2))
        # Rad ab / an: beide Hände am Reifen
        for role, fn in (('off', tyre_state_old), ('on', tyre_state_new)):
            R = RIGS[f'{w}_{role}']
            for i in (0, 1):
                sdi = 1 if i == 0 else -1
                R.hand(i, lambda t, P, w=w, fn=fn, sdi=sdi: (lambda c: None if c is None else c + rotz(P.yaw) @ Vector((0.0, sdi * 0.30, 0.03)))(fn(w, t)),
                       lambda t, w=w, fn=fn, role=role: (ramp(t - T_PRE, 0.42, 0.55) * (1 - ramp(t - T_PRE, 1.4, 1.5)) if role == 'off' else (1 - ramp(t - T_PRE, 1.1, 1.2)) * ramp(t - T_PRE, -1.2, -1.1)))
    for key, sgn in (('F', 1), ('R', -1)):
        J = RIGS[f'{key}_jack']
        for i in (0, 1):
            sdi = 1 if i == 0 else -1
            J.hand(i, lambda t, P, key=key, sgn=sgn, sdi=sdi: jack_tip(key, sgn, t)[2] + rotz(P.yaw) @ Vector((0, sdi * 0.13, 0.0)), lambda t: ramp(t, 0.0, 0.1) * (1 - ramp(t, tt(2.0), tt(2.12))))
        # nach dem Absenken Daumen hoch (nur vorn): rechte Hand hoch
        if sgn > 0:
            J.hand(1, lambda t, P: Vector((P.x, P.y, P.h + 0.9)) + rotz(P.yaw) @ Vector((0.0, -0.18, 0.0)), win(tt(1.82), tt(1.98), 0.1, 0.1))
    for sd in (1, -1):
        nm = 'FW_L' if sd > 0 else 'FW_R'
        W = RIGS[nm]
        for i in (0, 1):
            sdi = 1 if i == 0 else -1
            W.hand(i, lambda t, P, sd=sd, sdi=sdi: Vector((2.78 + sdi * 0.12 * sd, sd * (0.55 + 0.12 * abs(math.sin((t - T_PRE) * 7.0))), 0.22 + 0.04 * math.sin((t - T_PRE) * 7.0))), win(tt(0.78), tt(1.55), 0.1, 0.15))
    S = RIGS['RW_stab']
    S.hand(1, lambda t, P: Vector((-2.38, 0.35, 0.84)), win(tt(0.25), tt(2.0), 0.15, 0.2))
    S.hand(0, lambda t, P: Vector((-2.38, 0.75, 0.84)), win(tt(0.25), tt(2.0), 0.15, 0.2))
    F = RIGS['FIRE']
    fe = lambda t: (lambda P: (Vector((P.x, P.y, P.h - 0.5)) + rotz(P.yaw) @ Vector((0.38, -0.12, 0.0)), P.yaw))(base('FIRE', t))
    F.hand(1, lambda t, P: fe(t)[0] + rotz(P.yaw) @ Vector((0, 0, 0.5)))
    F.hand(0, lambda t, P: fe(t)[0] + rotz(P.yaw) @ Vector((0.3, 0, 0.3)))


def quat_yaw(a):
    return Quaternion((0, 0, 1), a)


def set_vis(ob, vis, frame):
    v = 1.0 if vis else 0.0
    ob.scale = (v, v, v) if vis else (0.0001, 0.0001, 0.0001)
    ob.keyframe_insert('scale', frame=frame)


def main():
    build()
    setup_overrides()
    # Requisiten anlegen
    tyres_old, tyres_new, guns = {}, {}, {}
    for w in WHEELS:
        tyres_old[w] = make_tyre(f'TyreOld_{w}', M_RING_OLD)
        tyres_new[w] = make_tyre(f'TyreNew_{w}')
        guns[w] = make_gun(f'Gun_{w}')
        for ob in (tyres_old[w], tyres_new[w], guns[w]):
            ob.rotation_mode = 'QUATERNION'
    ext = make_extinguisher('Extinguisher')
    ext.rotation_mode = 'QUATERNION'
    lift_e = empty('CarLift')
    wvis = {w: empty(f'WheelVis_{w}') for w in WHEELS}
    N = int(round(T_TOTAL * FPS))
    scene.frame_start = 0
    scene.frame_end = N
    last_hidden = {w: None for w in WHEELS}
    vis_state = {}

    def put(ob, pos, yaw, frame, vis=True):
        ob.location = pos
        ob.rotation_quaternion = quat_yaw(yaw)
        ob.keyframe_insert('location', frame=frame)
        ob.keyframe_insert('rotation_quaternion', frame=frame)
        # Sichtbarkeit nur bei Änderung keyen (Sprung über ein Bild)
        key = ob.name
        if vis_state.get(key) != vis:
            if key in vis_state:
                prev = vis_state[key]
                ob.scale = (1, 1, 1) if prev else (0.0001,) * 3
                ob.keyframe_insert('scale', frame=frame - 1)
            ob.scale = (1, 1, 1) if vis else (0.0001,) * 3
            ob.keyframe_insert('scale', frame=frame)
            vis_state[key] = vis
        elif frame == 0:
            ob.scale = (1, 1, 1) if vis else (0.0001,) * 3
            ob.keyframe_insert('scale', frame=frame)

    for f in range(N + 1):
        t = f / FPS
        # Auto-Hub und Radsichtbarkeit
        lift_e.location = (0, 0, lift_at(t))
        lift_e.keyframe_insert('location', frame=f)
        for w, e in wvis.items():
            hid = wheel_hidden(t)
            key = e.name
            sc = 0.0 if hid else 1.0
            if vis_state.get(key) != hid:
                if key in vis_state:
                    e.scale = (1.0 - sc,) * 3
                    e.keyframe_insert('scale', frame=f - 1)
                e.scale = (sc,) * 3
                e.keyframe_insert('scale', frame=f)
                vis_state[key] = hid
            elif f == 0:
                e.scale = (sc,) * 3
                e.keyframe_insert('scale', frame=f)
        # Reifen und Schrauber
        for w in WHEELS:
            po = tyre_state_old(w, t)
            put(tyres_old[w], po if po is not None else Vector((0, 0, -5)), 0.0, f, po is not None)
            pn = tyre_state_new(w, t)
            put(tyres_new[w], pn if pn is not None else Vector((0, 0, -5)), 0.0, f, pn is not None)
            gp, ga, _ = gun_state(w, t)
            put(guns[w], gp, ga, f)
        # Feuerlöscher
        P = base('FIRE', t)
        ep = Vector((P.x, P.y, P.h - 0.5)) + rotz(P.yaw) @ Vector((0.38, -0.12, 0.0))
        put(ext, ep, P.yaw, f)
        # Wagenheber
        for key, (jr, ram, handle, sgn, J) in PROPS.items():
            k = key[0]
            rx, psi, tip, Jp = jack_tip(k, sgn, t)
            jr.location = (rx, 0, 0)
            jr.rotation_mode = 'QUATERNION'
            jr.keyframe_insert('location', frame=f)
            ram.location = (0, 0, 0.0 + lift_at(t))
            ram.keyframe_insert('location', frame=f)
            handle.rotation_mode = 'QUATERNION'
            handle.rotation_quaternion = roty(psi).to_quaternion()
            handle.keyframe_insert('rotation_quaternion', frame=f)
        # Menschen
        for name, rig in RIGS.items():
            P = rig.track.eval(t).copy()
            for i, fn, wf in rig.ov:
                wgt = wf(t)
                if wgt <= 1e-4:
                    continue
                v = fn(t, P)
                if v is None:
                    continue
                P.hand[i] = lerp_vec(P.hand[i], v, min(1.0, wgt))
            apply_pose(rig.hu, P, f)
    # lineare Interpolation (Posen sind bereits dicht abgetastet)
    for act in bpy.data.actions:
        for fc in act.fcurves if hasattr(act, 'fcurves') else []:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    scene.name = 'pitstop'
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', export_animations=True, export_animation_mode='ACTIVE_ACTIONS',
        export_vertex_color='MATERIAL', export_apply=False, export_yup=True,
    )
    print('exported', out)


if __name__ == '__main__':
    main()
