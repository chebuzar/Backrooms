"""Сталеві шафки роздягальні бази «Глубина-1» (пара, 2×0.5 м, висота 1.85 м): емаль сіро-зеленого кольору
(справжня CC0-текстура Poly Haven metal_plate_02, перефарбована — scripts/assets/make-locker-tex.py), жалюзі-щілини
на дверцятах (крізь них гравець бачить кімнату, коли ховається), ручки-засувки, ніжки.
  blender -b -P scripts/blender/make_locker.py -- --out .assets-src/models/locker.glb
  npm run optimize-asset -- .assets-src/models/locker.glb --name locker --no-simplify --tex 1024
"""
import sys, os, math
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[argv.index('--out') + 1] if '--out' in argv else '.assets-src/models/locker.glb'
TEX = os.path.abspath('.assets-src/models/locker_tex')
bpy.ops.wm.read_factory_settings(use_empty=True)


def mat_paint():
    m = bpy.data.materials.new('locker_paint'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    def img(n, nc=False):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(f'{TEX}/{n}.jpg')
        if nc: t.image.colorspace_settings.name = 'Non-Color'
        return t
    c, r, n = img('diff'), img('rough', True), img('nor_gl', True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(c.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(r.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = 0.0
    return m


def mat_flat(name, rgb, rough, metal):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m


PAINT, DARK, STEEL = mat_paint(), mat_flat('locker_slot', (0.01, 0.01, 0.01), 0.9, 0), mat_flat('locker_steel', (0.55, 0.55, 0.52), 0.4, 1)
parts = []


def box(sx, sy, sz, loc, mat, bevel=0.0, uv=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = (sx, sy, sz); bpy.ops.object.transform_apply(scale=True)
    if bevel:
        md = o.modifiers.new('b', 'BEVEL'); md.width = bevel; md.segments = 2; bpy.ops.object.modifier_apply(modifier='b')
    o.data.materials.append(mat)
    if uv:
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.cube_project(cube_size=uv); bpy.ops.object.mode_set(mode='OBJECT')
    parts.append(o)
    return o


W, D, H, LEG = 0.5, 0.5, 1.85, 0.06
for k in range(2):
    x = (k - 0.5) * W
    box(W - 0.006, D, H - LEG, (x, 0, LEG + (H - LEG) / 2), PAINT, 0.004, uv=0.9)          # корпус
    box(W - 0.05, 0.008, H - LEG - 0.06, (x, -D / 2 - 0.003, LEG + (H - LEG) / 2), PAINT, 0.002, uv=0.9)  # дверцята
    for row in range(6):                                                                    # жалюзі вгорі й унизу
        for y0 in (1.48, 0.22):
            box(W * 0.56, 0.006, 0.011, (x, -D / 2 - 0.008, y0 + row * 0.03), DARK)
    box(0.02, 0.025, 0.12, (x + W * 0.36, -D / 2 - 0.018, 1.0), STEEL, 0.003)              # засувка
    for lx in (-1, 1):
        for ly in (-1, 1):
            box(0.03, 0.03, LEG, (x + lx * (W / 2 - 0.04), ly * (D / 2 - 0.04), LEG / 2), STEEL)  # ніжки
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
parts[0].name = 'locker'
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True)
print('saved', out)
