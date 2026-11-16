import importlib, sys, os, bpy
def imp(pkg, key):
    for m in list(sys.modules):
        if m.endswith(pkg):
            return getattr(importlib.import_module(m), key)
    raise ValueError(pkg)
bpy.ops.wm.read_factory_settings(use_empty=False)
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
import addon_utils
for mod in addon_utils.modules():
    if 'mpfb' in mod.__name__:
        addon_utils.enable(mod.__name__, default_set=True)
HumanService = imp("mpfb.services.humanservice", "HumanService")
HOP = imp("mpfb.entities.objectproperties", "HumanObjectProperties")
TS = imp("mpfb.services.targetservice", "TargetService")
h = HumanService.create_human()
for k, v in (("gender", 1.0), ("height", 1.0), ("weight", 0.0), ("muscle", 0.3)):
    HOP.set_value(k, v, entity_reference=h)
TS.reapply_macro_details(h)
rig = HumanService.add_builtin_rig(h, "game_engine")
print("HUMAN", h.name, len(h.data.vertices), "verts; rig", rig.name if rig else None, len(rig.data.bones) if rig else 0)
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("EXPORTED", out, os.path.getsize(out))
