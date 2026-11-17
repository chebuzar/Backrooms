"""Радянський дисковий телефон (у дусі ТА-68): червоний бакелітовий корпус зі скошеним передом, кремовий номеронабирач
із десятьма отворами, трубка на важелях, кручений шнур. Пластик — однотонний PBR (бакеліт без малюнка).
  blender -b -P scripts/blender/make_phone.py -- --out .assets-src/models/phone.glb
  npm run optimize-asset -- .assets-src/models/phone.glb --name phone --no-simplify --no-ktx
"""
import sys, os, math
import bpy, bmesh

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[argv.index('--out') + 1] if '--out' in argv else '.assets-src/models/phone.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m


RED, CREAM, BLACK, STEEL = mat('bakelite', (0.2, 0.012, 0.012), 0.22), mat('dial', (0.72, 0.66, 0.54), 0.45), mat('wheel', (0.03, 0.028, 0.026), 0.18), mat('steel', (0.6, 0.6, 0.58), 0.3, 1)
parts = []


def add(o, m):
    o.data.materials.append(m); parts.append(o); return o


def bevel(o, w, seg=3):
    bpy.context.view_layer.objects.active = o
    md = o.modifiers.new('b', 'BEVEL'); md.width = w; md.segments = seg; bpy.ops.object.modifier_apply(modifier='b')


# корпус: коробка 0.21 × 0.11 × 0.23, передня верхня грань скошена вниз
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.055))
body = bpy.context.object; body.scale = (0.2, 0.22, 0.09); bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new(); bm.from_mesh(body.data)
for v in bm.verts:
    if v.co.z > 0.05 and v.co.y < 0: v.co.z -= 0.035  # перед нижчий: скіс під диск
bm.to_mesh(body.data); bm.free()
bevel(body, 0.01); add(body, RED)
# номеронабирач: диск на скосі
tilt = math.atan2(0.045, 0.115)
bpy.ops.mesh.primitive_cylinder_add(radius=0.068, depth=0.012, vertices=48, location=(0, -0.055, 0.085))
dial = bpy.context.object; dial.rotation_euler = (tilt, 0, 0); add(dial, CREAM)
# пальцевий диск: темне коло з десятьма наскрізними отворами (булеве віднімання), під ним кремова основа
bpy.ops.mesh.primitive_cylinder_add(radius=0.066, depth=0.006, vertices=64, location=(0, -0.055, 0.0905))
wheel = bpy.context.object; wheel.rotation_euler = (tilt, 0, 0)
for k in range(10):
    a = math.radians(-60 + k * 27)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0095, depth=0.03, vertices=24, location=(math.cos(a) * 0.047, -0.055 + math.sin(a) * 0.047 * math.cos(tilt), 0.0905 + math.sin(a) * 0.047 * math.sin(tilt)))
    cut = bpy.context.object; cut.rotation_euler = (tilt, 0, 0)
    md = wheel.modifiers.new(f'h{k}', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = cut
    bpy.context.view_layer.objects.active = wheel; bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.data.objects.remove(cut, do_unlink=True)
add(wheel, BLACK)
bpy.ops.mesh.primitive_cylinder_add(radius=0.02, depth=0.006, vertices=24, location=(0, -0.055, 0.0945))
c = bpy.context.object; c.rotation_euler = (tilt, 0, 0); add(c, STEEL)
# важелі під трубку
for sx in (-0.075, 0.075):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sx, 0.045, 0.098)); w = bpy.context.object; w.scale = (0.03, 0.05, 0.02); bpy.ops.object.transform_apply(scale=True); bevel(w, 0.006); add(w, RED)
# трубка: дві чашки + ручка
for sx in (-0.09, 0.09):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.045, vertices=32, location=(sx, 0.045, 0.125))
    e = bpy.context.object; bevel(e, 0.008); add(e, RED)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.045, 0.148)); hh = bpy.context.object; hh.scale = (0.2, 0.034, 0.026); bpy.ops.object.transform_apply(scale=True); bevel(hh, 0.011); add(hh, RED)
# кручений шнур: гвинтова лінія від трубки до боку корпусу
curve = bpy.data.curves.new('cord', 'CURVE'); curve.dimensions = '3D'; curve.bevel_depth = 0.0035; curve.bevel_resolution = 2
sp = curve.splines.new('POLY'); pts = []
for i in range(160):
    t = i / 159
    bx, by, bz = -0.12 + t * 0.02, 0.045 - t * 0.12, 0.11 - t * 0.09
    pts.append((bx + 0.008 * math.cos(t * 60), by, bz + 0.008 * math.sin(t * 60)))
sp.points.add(len(pts) - 1)
for p, q in zip(sp.points, pts): p.co = (*q, 1)
cord = bpy.data.objects.new('cord', curve); bpy.context.collection.objects.link(cord)
bpy.context.view_layer.objects.active = cord; cord.select_set(True); bpy.ops.object.convert(target='MESH'); cord.data.materials.append(BLACK); parts.append(cord)
for o in bpy.data.objects: o.select_set(o in parts)
bpy.context.view_layer.objects.active = body; bpy.ops.object.join(); body.name = 'phone'
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True)
print('saved', out)
