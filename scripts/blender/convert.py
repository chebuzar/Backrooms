"""Convert any model Blender can read (FBX, OBJ, DAE, STL, PLY, BLEND, glTF) to GLB.

Usage: blender -b -P scripts/blender/convert.py -- <input> <output.glb>
Used by scripts/optimize-asset.mjs for non-glTF inputs.
"""
import os
import sys

import bpy

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
src = os.path.abspath(src)
ext = os.path.splitext(src)[1].lower()
if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    importers = {
        ".fbx": lambda: bpy.ops.import_scene.fbx(filepath=src),
        ".obj": lambda: bpy.ops.wm.obj_import(filepath=src),
        ".dae": lambda: bpy.ops.wm.collada_import(filepath=src),
        ".stl": lambda: bpy.ops.wm.stl_import(filepath=src),
        ".ply": lambda: bpy.ops.wm.ply_import(filepath=src),
        ".glb": lambda: bpy.ops.import_scene.gltf(filepath=src),
        ".gltf": lambda: bpy.ops.import_scene.gltf(filepath=src),
    }
    if ext not in importers:
        sys.exit(f"unsupported format: {ext}")
    importers[ext]()
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format="GLB")
print("CONVERTED", out)
