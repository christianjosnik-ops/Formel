"""
Konvertiert das F1-Modell (.blend, Blender 2.83, ein einziges Mesh) in ein glTF/GLB für Three.js.

Ergebnis-Knoten:
  body        Karosserie (ohne Flügel und Räder), Ursprung = Schwerpunkt-Bodenpunkt
  wing_front  Frontflügel inkl. Nasenspitze (abbrechbar)
  wing_rear   Heckflügel (abbrechbar)
  wheel_FL/FR/RL/RR  Räder, Ursprung = Radmitte, Achse = Z
Zusätzlich <ausgabe>.json mit den gemessenen Fahrzeugmaßen (Spurweite, Radstand, Radradius, ...).

Koordinaten (glTF, Meter): +X vorn, +Y oben, +Z rechts. Skaliert auf Reglement-2026-Radstand (3.4 m).

Aufruf:  python tools/convert_model.py <eingabe.blend> <ausgabe.glb>
Benötigt: pip install bpy
"""
import json
import sys

import bpy  # muss vor bmesh importiert werden
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

src, dst = sys.argv[1], sys.argv[2]
WHEELBASE = 3.4          # m (Reglement 2026: max. 3400 mm)
FRONT_WEIGHT = 0.455     # Schwerpunkt liegt lr = 0.455 * L hinter der Vorderachse
TIRE_R = 0.345           # m, Zielrollradius der Räder im Spiel
WIDTH_SCALE = 0.95       # Reglement 2026: max. 1900 mm statt 2000 mm
FRONT_WING_X = 2.4       # m: alles davor gehört zum Frontflügel (inkl. Nasenspitze)
REAR_WING_X = -1.5       # m: alles dahinter und oberhalb von REAR_WING_Y gehört zum Heckflügel
REAR_WING_Y = 0.45

bpy.ops.wm.open_mainfile(filepath=src)
obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
for o in list(bpy.data.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)
obj.data.transform(obj.matrix_world)      # 90°-Rotation fest ins Mesh
obj.matrix_world = obj.matrix_world.Identity(4)
src_mesh = obj.data
materials = list(src_mesh.materials)
mat_names = [m.name for m in materials]
TIRE_MATS = {i for i, n in enumerate(mat_names) if n.startswith('Wheeldecal')}

# Blender-Koordinaten nach dem Anwenden: X = Länge (vorn +X), Y = -lokal z (Breite), Z = Höhe.
def to_bl(x, y, z):
    return Vector((x, -z, y))

# Startwerte aus der Voranalyse (lokale Modellkoordinaten)
guess = {
    'FL': to_bl(7.35, -1.1, -4.385), 'FR': to_bl(7.35, -1.1, 4.18),
    'RL': to_bl(-11.35, -1.1, -4.075), 'RR': to_bl(-11.35, -1.1, 4.515),
}
R_CYL = 2.05                      # Suchradius für Felge/Nabe/Abdeckung (Modelleinheiten)
R_TIRE = 2.45                     # Suchradius für Reifenflächen (Schulter ragt weiter heraus)
Z_HALF = {'F': 1.25, 'R': 1.7}


def assign_wheel(centers, poly_center, mat_index):
    """Liefert den Radschlüssel, zu dem die Fläche gehört, sonst None."""
    tire = mat_index in TIRE_MATS
    for k, c in centers.items():
        half = Z_HALF[k[0]] + (0.35 if tire else 0.0)
        if abs(poly_center.y - c.y) > half:
            continue
        r2 = (poly_center.x - c.x) ** 2 + (poly_center.z - c.z) ** 2
        if r2 <= (R_TIRE if tire else R_CYL) ** 2:
            return k
    return None


# --- Phase 1: Radmitten aus den Reifenflächen verfeinern (Bounding-Box-Mitte) ----------------
centers = dict(guess)
for _ in range(2):
    boxes = {k: [Vector((1e9,) * 3), Vector((-1e9,) * 3)] for k in centers}
    for p in src_mesh.polygons:
        if p.material_index not in TIRE_MATS:
            continue
        k = assign_wheel(centers, p.center, p.material_index)
        if k is None:
            continue
        for vi in p.vertices:
            v = src_mesh.vertices[vi].co
            for i in range(3):
                boxes[k][0][i] = min(boxes[k][0][i], v[i])
                boxes[k][1][i] = max(boxes[k][1][i], v[i])
    centers = {k: (b[0] + b[1]) / 2 for k, b in boxes.items()}
    diam = {k: (boxes[k][1].x - boxes[k][0].x, boxes[k][1].z - boxes[k][0].z, boxes[k][1].y - boxes[k][0].y) for k in boxes}
print('Radmitten (Modell)', {k: tuple(round(x, 2) for x in v) for k, v in centers.items()})
print('Reifen Durchmesser x/z, Breite', {k: tuple(round(x, 2) for x in v) for k, v in diam.items()})

model_radius = sum(0.5 * (d[0] + d[1]) / 2 for d in diam.values()) / 4
front_x = (centers['FL'].x + centers['FR'].x) / 2
rear_x = (centers['RL'].x + centers['RR'].x) / 2
s = WHEELBASE / (front_x - rear_x)
lf = WHEELBASE * (1 - FRONT_WEIGHT)
y_mid = sum(c.y for c in centers.values()) / 4            # Mittellinie (Blender Y)
z_ground = sum(c.z for c in centers.values()) / 4          # Radmittenhöhe (Blender Z)
print('Modellradius', round(model_radius, 3), 'Skala', round(s, 5))


def xform(v):
    return Vector((
        (v.x - front_x) * s + lf,
        (v.y - y_mid) * s * WIDTH_SCALE,
        (v.z - z_ground) * s + TIRE_R,
    ))


# --- Phase 2: Flächen zuordnen, in Meter umrechnen, in Objekte zerlegen ------------------------
groups = {}     # Name -> Liste der Polygonindizes
for p in src_mesh.polygons:
    k = assign_wheel(centers, p.center, p.material_index)
    if k is not None:
        groups.setdefault('wheel_' + k, []).append(p.index)
        continue
    c = xform(p.center)     # Meter (Blender-Achsen: X vorn, Y breit, Z hoch)
    if c.x > FRONT_WING_X:
        groups.setdefault('wing_front', []).append(p.index)
    elif c.x < REAR_WING_X and c.z > REAR_WING_Y:
        groups.setdefault('wing_rear', []).append(p.index)
    else:
        groups.setdefault('body', []).append(p.index)
print({k: len(v) for k, v in groups.items()})

out_objs = {}
for name, idx in groups.items():
    keep = set(idx)
    m = src_mesh.copy()
    m.name = name
    b = bmesh.new()
    b.from_mesh(m)
    b.faces.ensure_lookup_table()
    drop = [f for f in b.faces if f.index not in keep]
    bmesh.ops.delete(b, geom=drop, context='FACES')
    loose = [v for v in b.verts if not v.link_faces]
    bmesh.ops.delete(b, geom=loose, context='VERTS')
    b.to_mesh(m)
    b.free()
    for v in m.vertices:
        v.co = xform(v.co)
    if name.startswith('wheel_'):
        k = name[6:]
        c = xform(centers[k])
        wscale = TIRE_R / (model_radius * s)
        for v in m.vertices:
            v.co = (v.co - c) * wscale
        origin = c
    else:
        origin = Vector((0, 0, 0))
    m.update()
    o = bpy.data.objects.new(name, m)
    o.location = origin
    bpy.context.scene.collection.objects.link(o)
    out_objs[name] = o


# --- Maße ausgeben ---------------------------------------------------------------------------
def bbox(o):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for v in o.data.vertices:
        w = v.co + o.location
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
    return mn, mx


allmn = Vector((1e9,) * 3)
allmx = Vector((-1e9,) * 3)
for o in out_objs.values():
    mn, mx = bbox(o)
    for i in range(3):
        allmn[i] = min(allmn[i], mn[i])
        allmx[i] = max(allmx[i], mx[i])
half_track = {k: abs(xform(centers[k]).y) for k in centers}
info = {
    'wheelbase': WHEELBASE,
    'scale': s,
    'tireRadius': TIRE_R,
    'trackFront': round(2 * (half_track['FL'] + half_track['FR']) / 2, 4),
    'trackRear': round(2 * (half_track['RL'] + half_track['RR']) / 2, 4),
    'tireWidthFront': round(diam['FL'][2] * s * 0.98, 3),
    'tireWidthRear': round(diam['RL'][2] * s * 0.98, 3),
    'lf': lf,
    'lr': WHEELBASE - lf,
    'bboxMin': [round(allmn.x, 3), round(allmn.z, 3), round(-allmx.y, 3)],
    'bboxMax': [round(allmx.x, 3), round(allmx.z, 3), round(-allmn.y, 3)],
}
print(json.dumps(info, indent=1))
with open(dst.rsplit('.', 1)[0] + '.json', 'w') as fh:
    json.dump(info, fh, indent=1)

# Fehlende Texturen entfernen: Materialien behalten nur ihre Basisfarbe
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    for n in list(m.node_tree.nodes):
        if n.type == 'TEX_IMAGE':
            m.node_tree.nodes.remove(n)
for img in list(bpy.data.images):
    bpy.data.images.remove(img)

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)
print('OK', dst)
