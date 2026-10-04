"""
Safety Car aus Blender: britisch-grünes Sportcoupé (eigener Entwurf), per Querschnitts-Loft modelliert, mit Unterteilung,
Radhäusern per Boolean, Verglasung, Scheinwerfern/Rückleuchten, Dachlichtbalken (Bernstein/Grün), Spiegeln, Auspuff,
Diffusor, Felgen mit Bremsscheiben/-sätteln und Schriftzug "SAFETY CAR".
Aufruf: python tools/make_safetycar.py public/models/safetycar.glb
Koordinaten (Blender): +x vorn, +y links, +z oben, Boden bei z = 0; glTF dreht das nach +Y oben (x vorn, z rechts wie im Spiel).
Benannte Objekte: WheelFL/FR/RL/RR (Drehachse = Querachse), Materialien SCAmber (blinkt im Spiel), SCGreen, SCTail, SCHead.
"""
import math
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

out = sys.argv[1] if len(sys.argv) > 1 else 'safetycar.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def principled(name, base, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.05, emit=None, emit_k=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    for k in ('Coat Weight', 'Clearcoat'):
        if k in b.inputs:
            b.inputs[k].default_value = coat
    for k in ('Coat Roughness', 'Clearcoat Roughness'):
        if k in b.inputs:
            b.inputs[k].default_value = coat_rough
    if emit is not None:
        for k in ('Emission Color', 'Emission'):
            if k in b.inputs:
                b.inputs[k].default_value = (*emit, 1)
                break
        if 'Emission Strength' in b.inputs:
            b.inputs['Emission Strength'].default_value = emit_k
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    return m


M_PAINT = principled('SCPaint', (0.015, 0.16, 0.09), 0.28, 0.35, coat=1.0, coat_rough=0.03)
M_GLASS = principled('SCGlass', (0.01, 0.015, 0.02), 0.04, 0.2, coat=0.0, alpha=1.0)
M_BLACK = principled('SCBlack', (0.02, 0.02, 0.022), 0.55, 0.2)
M_CARBON = principled('SCCarbon', (0.03, 0.03, 0.035), 0.35, 0.4, coat=0.6)
M_CHROME = principled('SCChrome', (0.75, 0.77, 0.8), 0.18, 1.0)
M_RUBBER = principled('SCRubber', (0.025, 0.025, 0.028), 0.85)
M_AMBER = principled('SCAmber', (0.35, 0.18, 0.0), 0.3, emit=(1.0, 0.55, 0.05), emit_k=0.0)
M_GREEN = principled('SCGreen', (0.0, 0.25, 0.05), 0.3, emit=(0.1, 1.0, 0.2), emit_k=0.0)
M_TAIL = principled('SCTail', (0.3, 0.0, 0.0), 0.3, emit=(1.0, 0.05, 0.03), emit_k=0.6)
M_HEAD = principled('SCHead', (0.9, 0.92, 0.95), 0.1, emit=(1.0, 0.97, 0.9), emit_k=0.8)
M_DECAL = principled('SCDecal', (0.92, 0.93, 0.95), 0.5)
M_CAL = principled('SCCaliper', (0.75, 0.04, 0.03), 0.4, 0.2)
M_SILVER = principled('SCSilver', (0.55, 0.57, 0.6), 0.3, 0.9)


def new_obj(name, bm_or_mesh, mats):
    if isinstance(bm_or_mesh, bmesh.types.BMesh):
        me = bpy.data.meshes.new(name)
        bm_or_mesh.to_mesh(me)
        bm_or_mesh.free()
    else:
        me = bm_or_mesh
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------------------------------------
# Karosserie: Querschnitts-Loft
# ------------------------------------------------------------------------------------------------
ST = np.array([
    # x,     zt,   zb,   w,    taper, n
    [-2.30, 0.80, 0.30, 0.64, 0.86, 2.4],
    [-2.24, 0.94, 0.25, 0.82, 0.86, 2.6],
    [-2.10, 1.00, 0.21, 0.93, 0.80, 3.0],
    [-1.85, 1.04, 0.19, 0.98, 0.72, 3.2],
    [-1.50, 1.10, 0.19, 0.99, 0.66, 3.3],
    [-1.10, 1.20, 0.19, 0.99, 0.62, 3.4],
    [-0.70, 1.25, 0.19, 0.99, 0.61, 3.4],
    [-0.30, 1.25, 0.19, 0.99, 0.61, 3.4],
    [0.10, 1.19, 0.19, 0.995, 0.63, 3.4],
    [0.50, 1.04, 0.19, 0.995, 0.74, 3.3],
    [0.85, 0.94, 0.19, 0.995, 0.88, 3.1],
    [1.25, 0.88, 0.18, 0.985, 0.94, 3.0],
    [1.70, 0.82, 0.16, 0.94, 0.96, 2.8],
    [2.05, 0.73, 0.14, 0.83, 0.97, 2.6],
    [2.25, 0.61, 0.14, 0.64, 0.98, 2.4],
    [2.33, 0.46, 0.18, 0.34, 1.0, 2.2],
])
NR = 44


def ring(st):
    x, zt, zb, w, tp, n = st
    zm, hz = (zt + zb) / 2, (zt - zb) / 2
    pts = []
    for k in range(NR):
        th = k / NR * math.tau
        c, s = math.cos(th), math.sin(th)
        e = 2.0 / n
        y = w * math.copysign(abs(c) ** e, c)
        z = zm + hz * math.copysign(abs(s) ** e, s)
        if s > 0:
            y *= 1 - (1 - tp) * (s ** 1.4)
        pts.append((x, y, z))
    return pts


def body():
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in ring(st)] for st in ST]
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(NR):
            j = (k + 1) % NR
            bm.faces.new([a[k], a[j], b[j], b[k]])
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def assign_glass(bm):
    """Material je Fläche vor der Unterteilung: Fensterbänder entlang der Ringe, damit die Kanten nach dem Glätten sauber bleiben."""
    faces = [f for f in bm.faces if len(f.verts) == 4]
    # Faces wurden ring-weise erzeugt: Index = station * NR + k
    for idx, f in enumerate(faces):
        i, k = divmod(idx, NR)
        th = (k + 0.5) / NR * math.tau
        sn, cs = math.sin(th), math.cos(th)
        glass = False
        if 5 <= i <= 7 and 0.34 < sn < 0.93 and abs(cs) > 0.33:
            glass = True       # Seitenscheiben
        elif 4 <= i <= 4 and 0.4 < sn < 0.93 and abs(cs) > 0.4:
            glass = True       # hinteres Seitenfenster
        elif i in (8, 9) and sn > 0.84 and abs(cs) < 0.52:
            glass = True       # Frontscheibe
        elif i in (3, 4) and sn > 0.8 and abs(cs) < 0.55:
            glass = True       # Heckscheibe
        f.material_index = 1 if glass else 0


_bm = body()
assign_glass(_bm)
ob_body = new_obj('SCBody', _bm, [M_PAINT, M_GLASS, M_BLACK])
for f in ob_body.data.polygons:
    f.use_smooth = True
sub = ob_body.modifiers.new('sub', 'SUBSURF')
sub.levels = 2
sub.render_levels = 2
bpy.context.view_layer.objects.active = ob_body
bpy.ops.object.modifier_apply(modifier='sub')


# Radhaus-Ausschnitte (Boolean) mit schwarzem Innenraum
def cutter(cx, cy, r=0.46, ln=0.5):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=r, depth=ln, location=(cx, cy, 0.36), rotation=(math.pi / 2, 0, 0))
    c = bpy.context.active_object
    c.data.materials.append(M_BLACK)
    return c


WHEELS = {'FL': (1.38, 0.81), 'FR': (1.38, -0.81), 'RL': (-1.32, 0.81), 'RR': (-1.32, -0.81)}
for key, (wx, wy) in WHEELS.items():
    c = cutter(wx, wy + (0.18 if wy > 0 else -0.18), 0.47 if wx > 0 else 0.48, 0.62)
    bpy.context.view_layer.objects.active = ob_body
    bo = ob_body.modifiers.new('bool_' + key, 'BOOLEAN')
    bo.operation = 'DIFFERENCE'
    bo.object = c
    bo.solver = 'EXACT'
    bpy.ops.object.modifier_apply(modifier=bo.name)
    bpy.data.objects.remove(c, do_unlink=True)

me = ob_body.data
bm_fix = bmesh.new()
bm_fix.from_mesh(me)
bmesh.ops.recalc_face_normals(bm_fix, faces=bm_fix.faces)
bm_fix.to_mesh(me)
bm_fix.free()
me.update()
ng = 0
for p in me.polygons:
    if p.material_index == 1:
        ng += 1
    elif p.center.z < 0.24 and abs(p.center.y) < 0.9:
        p.material_index = 2   # Unterboden
    p.use_smooth = True
print('Glasflächen', ng, 'von', len(me.polygons))

# ------------------------------------------------------------------------------------------------
# Anbauteile
# ------------------------------------------------------------------------------------------------
def box(name, c, size, mat, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=c, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    if bevel:
        bv = o.modifiers.new('bv', 'BEVEL')
        bv.width = bevel
        bv.segments = 2
        bpy.ops.object.modifier_apply(modifier='bv')
    for f in o.data.polygons:
        f.use_smooth = True
    return o


def ell(name, c, r, mat, seg=14, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(6, seg // 2), location=c, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = r
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    for f in o.data.polygons:
        f.use_smooth = True
    return o


def hit(origin, direction):
    """Oberflächenpunkt der Karosserie entlang eines Strahls (Anbauteile sitzen so exakt auf dem Blech)."""
    ok, loc, nrm, _ = ob_body.ray_cast(Vector(origin), Vector(direction))
    return loc if ok else Vector(origin)


# Frontgrill + Lufteinlässe, Splitter, Diffusor, Seitenschweller
box('SCGrille', (2.27, 0, 0.36), (0.14, 1.0, 0.2), M_BLACK, bevel=0.03)
for sy in (-0.7, 0.7):
    box('SCIntake', (2.12, sy, 0.3), (0.2, 0.34, 0.14), M_BLACK, bevel=0.02)
box('SCSplitter', (2.2, 0, 0.13), (0.55, 1.55, 0.03), M_CARBON, bevel=0.01)
box('SCDiffuser', (-2.2, 0, 0.2), (0.5, 1.1, 0.05), M_BLACK, bevel=0.01)
for sy in (-1, 1):
    box('SCSkirt', (0.03, sy * 0.955, 0.21), (2.4, 0.09, 0.09), M_BLACK, bevel=0.03)
# Scheinwerfer (LED-Streifen), Tagfahrlicht
for sy in (-1, 1):
    hp = hit((3.0, sy * 0.62, 0.6), (-1, 0, 0))
    ell('SCHeadlight', (hp.x - 0.02, sy * 0.62, 0.6), (0.06, 0.22, 0.03), M_HEAD, rot=(0, 0, sy * -0.5))
    dp = hit((3.0, sy * 0.42, 0.5), (-1, 0, 0))
    box('SCDrl', (dp.x - 0.005, sy * 0.42, 0.5), (0.03, 0.26, 0.016), M_HEAD, rot=(0, 0, sy * -0.35))
# Rückleuchten: durchgehendes Band und Einzelleuchten
tb = hit((-3.0, 0.0, 0.9), (1, 0, 0))
box('SCTailBar', (tb.x + 0.012, 0, 0.9), (0.03, 0.8, 0.04), M_TAIL, bevel=0.01)
for sy in (-1, 1):
    tp = hit((-3.0, sy * 0.55, 0.84), (1, 0, 0))
    ell('SCTaillight', (tp.x + 0.015, sy * 0.55, 0.84), (0.035, 0.2, 0.045), M_TAIL, rot=(0, 0, sy * 0.35))
# Auspuffendrohre
for sy in (-1, 1):
    for dy in (0.33, 0.5):
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.055, depth=0.2, location=(-2.28, sy * dy + (0.22 if sy > 0 else -0.22) * 0, 0.27), rotation=(0, math.pi / 2, 0))
        o = bpy.context.active_object
        o.name = 'SCExhaust'
        o.data.materials.append(M_CHROME)
# Heckspoiler (Entenbürzel) und Dachfinne
box('SCSpoiler', (-2.12, 0, 1.05), (0.28, 1.5, 0.045), M_PAINT, rot=(0, -0.12, 0), bevel=0.012)
# Außenspiegel
for sy in (-1, 1):
    mh = hit((0.68, sy * 2.0, 0.86), (0, -sy, 0))
    box('SCMirrorStalk', (0.68, mh.y + sy * 0.07, 0.86), (0.1, 0.16, 0.035), M_BLACK, bevel=0.012)
    ell('SCMirror', (0.66, mh.y + sy * 0.17, 0.9), (0.1, 0.075, 0.055), M_PAINT)
# Türgriffe und Schlitze: dunkle Fugen
for sy in (-1, 1):
    dl = hit((0.05, sy * 2.0, 0.62), (0, -sy, 0))
    box('SCDoorLine', (0.05, dl.y + sy * 0.0, 0.62), (0.015, 0.014, 0.5), M_BLACK)
    dh = hit((-0.35, sy * 2.0, 0.82), (0, -sy, 0))
    box('SCDoorHandle', (-0.35, dh.y + sy * 0.006, 0.82), (0.16, 0.02, 0.025), M_SILVER, bevel=0.008)

# Dachlichtbalken: Gehäuse, Bernsteinlinsen, grüne Linsen (Spiel steuert die Emission)
roof_z = hit((-0.3, 0.0, 3.0), (0, 0, -1)).z - 0.03
box('SCBarBase', (-0.3, 0, roof_z + 0.02), (0.42, 1.18, 0.06), M_BLACK, bevel=0.015)
for sy in (-1, 1):
    box('SCBarAmber', (-0.3, sy * 0.33, roof_z + 0.08), (0.36, 0.5, 0.07), M_AMBER, bevel=0.02)
    box('SCBarGreen', (-0.3, sy * 0.62, roof_z + 0.07), (0.34, 0.12, 0.05), M_GREEN, bevel=0.015)
box('SCBarMid', (-0.3, 0, roof_z + 0.075), (0.3, 0.12, 0.05), M_BLACK, bevel=0.012)
for sy in (-1, 1):
    box('SCBarEnd', (-0.3, sy * 0.595, roof_z + 0.05), (0.38, 0.03, 0.09), M_BLACK, bevel=0.01)
# Zusätzliche Blitzer in der Front und im Heck (Bernstein)
for sx, nm in ((1.1, 'SCFlashF'), (-1.9, 'SCFlashR')):
    pass

# Schriftzug SAFETY CAR auf beiden Türen und der Haube-Front (weiß)


def text_mesh(txt, size, loc, rot, mat):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = txt
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.004
    ob = bpy.data.objects.new('SCText', cu)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.active_object
    ob.data.materials.append(mat)
    return ob


ty = hit((0.12, 2.0, 0.45), (0, -1, 0)).y
text_mesh('SAFETY CAR', 0.17, (0.12, ty + 0.004, 0.45), (math.pi / 2, 0, math.pi), M_DECAL)
ty2 = hit((0.12, -2.0, 0.45), (0, 1, 0)).y
text_mesh('SAFETY CAR', 0.17, (-0.12, ty2 - 0.004, 0.45), (math.pi / 2, 0, 0), M_DECAL)
tx = hit((-3.0, 0.0, 0.64), (1, 0, 0)).x
text_mesh('SAFETY CAR', 0.13, (tx + 0.004, 0, 0.64), (math.pi / 2, 0, -math.pi / 2), M_DECAL)

# ------------------------------------------------------------------------------------------------
# Räder: Reifen, Felge (5 Doppelspeichen), Bremsscheibe, Bremssattel
# ------------------------------------------------------------------------------------------------


def lathe_y(bm, prof, cy=0.0, seg=36):
    """Rotationskörper um die y-Achse: prof = [(radius, y)]."""
    rings = []
    for r, y in prof:
        rings.append([bm.verts.new((math.cos(k / seg * math.tau) * r, y + cy, math.sin(k / seg * math.tau) * r)) for k in range(seg)])
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            bm.faces.new([a[k], a[j], b[j], b[k]])
    return rings


def make_wheel(key, wx, wy):
    root = bpy.data.objects.new('Wheel' + key, None)
    scene.collection.objects.link(root)
    root.location = (wx, wy, 0.36)
    s = 1 if wy > 0 else -1
    wide = 0.28 if wx > 0 else 0.32
    # Reifen
    bm = bmesh.new()
    h = wide / 2
    prof = [(0.23, -h), (0.29, -h), (0.335, -h * 0.9), (0.358, -h * 0.5), (0.36, 0), (0.358, h * 0.5), (0.335, h * 0.9), (0.29, h), (0.23, h)]
    lathe_y(bm, prof, seg=44)
    ob = new_obj('Tyre' + key, bm, [M_RUBBER])
    for f in ob.data.polygons:
        f.use_smooth = True
    ob.parent = root
    # Felge: Schüssel + Speichen + Nabe
    bm = bmesh.new()
    yo = s * (h - 0.02)
    lathe_y(bm, [(0.235, -s * 0.06), (0.235, yo * 0.9), (0.215, yo), (0.15, yo * 0.7)], seg=40)
    lathe_y(bm, [(0.0, yo * 0.72), (0.06, yo * 0.74), (0.065, yo * 0.9)], seg=20)
    for sp in range(5):
        for off in (-0.035, 0.035):
            a = sp / 5 * math.tau + off
            v = []
            for r, w in ((0.07, 0.03), (0.225, 0.045)):
                for dz in (-w / 2, w / 2):
                    ca, sa = math.cos(a), math.sin(a)
                    px, pz = ca * r + -sa * dz, sa * r + ca * dz
                    v.append(bm.verts.new((px, yo * 0.88, pz)))
            bm.faces.new([v[0], v[1], v[3], v[2]])
    ob = new_obj('Rim' + key, bm, [M_CHROME])
    for f in ob.data.polygons:
        f.use_smooth = True
    ob.parent = root
    # Bremsscheibe (dreht mit) und Bremssattel (steht, hängt am Fahrzeug – hier einfach am Rad für die Optik)
    bm = bmesh.new()
    lathe_y(bm, [(0.1, s * 0.0), (0.2, s * 0.0), (0.2, s * 0.035), (0.1, s * 0.035)], cy=s * 0.0, seg=36)
    ob = new_obj('Disc' + key, bm, [M_SILVER])
    ob.parent = root
    cal = box('Caliper' + key, (wx, wy + s * 0.02, 0.36 + 0.17), (0.17, 0.07, 0.11), M_CAL, bevel=0.02)
    cal.parent = None
    return root


for key, (wx, wy) in WHEELS.items():
    make_wheel(key, wx, wy)

# Bernstein-Blitzer (Front/Heck) – kleine Linsen
for sy in (-0.3, 0.3):
    fh = hit((3.0, sy, 0.45), (-1, 0, 0))
    box('SCStrobe', (fh.x - 0.005, sy, 0.45), (0.03, 0.14, 0.03), M_AMBER, bevel=0.008)
    rh = hit((-3.0, sy, 1.0), (1, 0, 0))
    box('SCStrobe', (rh.x + 0.005, sy, 1.0), (0.03, 0.14, 0.03), M_AMBER, bevel=0.008)

# ------------------------------------------------------------------------------------------------
# Export
# ------------------------------------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT')
tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('Safety Car exportiert', out, 'Flächen', tris)
