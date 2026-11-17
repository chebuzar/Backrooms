"""Батарейка для ліхтарика: дві радянські плоскі «3336Л» (4.5 В, 62×22×65 мм), бляшаний корпус у старій червоній фарбі
(справжня CC0-текстура Poly Haven metal_plate_02: одна пластина, перефарбована, подряпини до металу), латунні пелюстки-контакти.
  blender -b -P scripts/blender/make_battery.py -- --out .assets-src/models/battery.glb
Спершу: python3 -I scripts/assets/make-battery-tex.py; потім: npm run optimize-asset -- .assets-src/models/battery.glb --name battery --no-simplify --tex 512
"""
import sys, math, os
import bpy, bmesh

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[argv.index('--out') + 1] if '--out' in argv else '.assets-src/models/battery.glb'
# одна пластина metal_plate_02 (Poly Haven, CC0), перефарбована в червоне: scripts/assets/make-battery-tex.py
TEX = os.path.abspath('.assets-src/models/battery_tex')

bpy.ops.wm.read_factory_settings(use_empty=True)


def tex_node(nt, path, non_color=False):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(path)
    if non_color:
        n.image.colorspace_settings.name = 'Non-Color'
    return n


def paint_material():
    m = bpy.data.materials.new('battery_paint')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    c = tex_node(nt, f'{TEX}/diff.jpg')
    r = tex_node(nt, f'{TEX}/rough.jpg', True)
    n = tex_node(nt, f'{TEX}/nor_gl.jpg', True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = 0.0
    return m


def brass_material():
    m = bpy.data.materials.new('battery_brass')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.62, 0.45, 0.2, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.42
    return m


PAINT, BRASS = paint_material(), brass_material()


def box(name, sx, sy, sz, loc, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier='bevel')
    o.data.materials.append(mat)
    return o


def battery(x, rot):
    body = box('cell', 0.062, 0.022, 0.065, (0, 0, 0.0325), PAINT, 0.0025)
    # UV: кубічна проєкція в метрах × 6 — одна текстура на ~17 см, як потерта фарба на маленькій бляшанці
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=0.075)
    bpy.ops.object.mode_set(mode='OBJECT')
    # пелюстки: коротка й довга, загнута
    a = box('tab_s', 0.008, 0.0006, 0.012, (-0.016, 0, 0.071), BRASS)
    b = box('tab_l', 0.008, 0.0006, 0.026, (0.016, 0, 0.078), BRASS)
    b.rotation_euler = (math.radians(-18), 0, 0)
    for o in (body, a, b):
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.location.x = x
    body.rotation_euler = (0, 0, rot)
    return body


# дві поруч, одна лежить, друга стоїть — «кинуті» речі експедиції
s = battery(0.0, 0.25)
l = battery(0.07, -0.4)
l.rotation_euler = (math.radians(90), 0, -0.4)
l.location = (0.075, 0.03, 0.011)
for o in bpy.data.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = s
bpy.ops.object.join()
s.name = 'battery'
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
s.location.z -= min(v.co.z for v in s.data.vertices) + s.location.z - s.location.z
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
# поставити на підлогу (низ = 0), центр — у (0, 0)
zmin = min((s.matrix_world @ v.co).z for v in s.data.vertices)
s.location.z -= zmin
s.location.x = 0; s.location.y = 0
bpy.ops.object.transform_apply(location=True)
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True)
print('saved', out)
