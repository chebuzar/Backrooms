"""Bake lighting into textures with Blender (headless) and export a GLB.

Usage:
  blender -b -P scripts/blender/bake.py -- --out out.glb [--in scene.blend|model.glb]
          [--size 1024] [--samples 128]

Without --in a small demo room (floor, walls, glowing ceiling lamp) is built,
which is what `npm run blender-test` uses to check that Blender works.
For every mesh: a lightmap UV is unwrapped, Cycles bakes diffuse light
(direct + indirect + colour) into an image, the image becomes the material's
base colour and the result is exported as GLB with embedded textures.
"""
import argparse
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="src")
ap.add_argument("--out", required=True)
ap.add_argument("--size", type=int, default=1024)
ap.add_argument("--samples", type=int, default=128)
args = ap.parse_args(argv)


def demo_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def mat(name, rgb, emit=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*rgb, 1)
        if emit:
            b.inputs["Emission Color"].default_value = (1, 0.95, 0.8, 1)
            b.inputs["Emission Strength"].default_value = emit
        return m
    wall = mat("Wallpaper", (0.75, 0.68, 0.38))
    carpet = mat("Carpet", (0.45, 0.38, 0.2))
    lamp = mat("Lamp", (1, 1, 1), emit=25)
    def box(name, loc, scale, m):
        bpy.ops.mesh.primitive_cube_add(location=loc)
        o = bpy.context.active_object
        o.name = name
        o.scale = scale
        o.data.materials.append(m)
        bpy.ops.object.transform_apply(scale=True)
        return o
    box("Floor", (0, 0, -0.05), (4, 4, 0.05), carpet)
    box("Ceiling", (0, 0, 2.85), (4, 4, 0.05), wall)
    box("WallN", (0, 4, 1.4), (4, 0.05, 1.4), wall)
    box("WallE", (4, 0, 1.4), (0.05, 4, 1.4), wall)
    box("Pillar", (-1, -1, 1.4), (0.3, 0.3, 1.4), wall)
    box("Lamp", (0.8, 0.8, 2.78), (0.6, 0.15, 0.02), lamp)


def load(src):
    if src.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(src))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))


if args.src:
    load(args.src)
else:
    demo_scene()

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = False
scene.render.bake.margin = 4

meshes = [o for o in scene.objects if o.type == "MESH"]
for o in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    uv = o.data.uv_layers.get("Lightmap") or o.data.uv_layers.new(name="Lightmap")
    o.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new(o.name + "_baked", args.size, args.size)
    # Make every material slot of this object bake into its image.
    if not o.data.materials:
        o.data.materials.append(bpy.data.materials.new(o.name + "_mat"))
    for i, m in enumerate(o.data.materials):
        m = m.copy()
        o.data.materials[i] = m
        m.use_nodes = True
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.name = "BakeTarget"
        m.node_tree.nodes.active = node
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True)

    # Baked image becomes the colour; emission is already inside the bake.
    for m in o.data.materials:
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        tex = nt.nodes["BakeTarget"]
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "Lightmap"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        if bsdf:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if "Emission Strength" in bsdf.inputs and bsdf.inputs["Emission Strength"].default_value > 0:
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
                bsdf.inputs["Emission Strength"].default_value = 1.0
    img.pack()
    px = img.pixels[:]
    lum = sum(px[i] + px[i + 1] + px[i + 2] for i in range(0, len(px), 4 * 97)) / (3 * len(px[::4 * 97]))
    print(f"BAKED {o.name}: {args.size}px, mean brightness {lum:.3f}")

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.out), export_format="GLB", export_image_format="AUTO")
print("EXPORTED", os.path.abspath(args.out), os.path.getsize(args.out), "bytes")
