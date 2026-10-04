"""
Vereinfachte Fassung des F1-Modells für KI-Autos (und große Entfernung): gleiche Knotennamen/Materialien wie f1car.glb,
aber stark ausgedünnt (Decimate), damit ein Auto statt ~160 000 nur ~20 000 Dreiecke kostet.
Aufruf: python tools/make_car_lod.py public/models/f1car.glb public/models/f1car_lod.glb
"""
import sys

import bpy

src = sys.argv[1] if len(sys.argv) > 1 else 'f1car.glb'
dst = sys.argv[2] if len(sys.argv) > 2 else 'f1car_lod.glb'
RATIO = {'body': 0.16, 'wing_front': 0.22, 'wing_rear': 0.22, 'wheel_FL': 0.2, 'wheel_FR': 0.2, 'wheel_RL': 0.2, 'wheel_RR': 0.2}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
before = after = 0
for o in list(bpy.data.objects):
    if o.name not in RATIO:
        bpy.data.objects.remove(o, do_unlink=True)  # ungenutzte Vollmodell-Kopie
        continue
    bpy.context.view_layer.objects.active = o
    before += len(o.data.polygons)
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = RATIO[o.name]
    mod.use_collapse_triangulate = True
    mod.delimit = {'MATERIAL'}
    bpy.ops.object.modifier_apply(modifier='dec')
    after += len(o.data.polygons)
    for p in o.data.polygons:
        p.use_smooth = True
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)
print('Polygone', before, '->', after)
