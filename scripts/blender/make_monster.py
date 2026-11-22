"""Монстр із тіла MakeHuman (CC0): спотворені пропорції, шкіра, одяг, ігровий скелет (game_engine, 53 кістки).
  blender -b -P scripts/blender/make_monster.py -- --preset watcher --out .assets-src/monsters/watcher.glb
Потрібен аддон MPFB2 і системні ассети MakeHuman (див. CLAUDE.md). Анімації додаються в грі (Quaternius UAL, retarget)."""
import argparse
import importlib
import os
import sys

import math

import addon_utils
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--preset", default="watcher")
ap.add_argument("--out", required=True)
ap.add_argument("--preview", default="", help="PNG передогляду (спереду й збоку)")
args = ap.parse_args(argv)

for mod in addon_utils.modules():
    if "mpfb" in mod.__name__:
        addon_utils.enable(mod.__name__, default_set=True)


def imp(pkg, key):
    for m in list(sys.modules):
        if m.endswith(pkg):
            return getattr(importlib.import_module(m), key)
    raise ValueError(pkg)


HS = imp("mpfb.services.humanservice", "HumanService")
HOP = imp("mpfb.entities.objectproperties", "HumanObjectProperties")
TS = imp("mpfb.services.targetservice", "TargetService")
LS = imp("mpfb.services.locationservice", "LocationService")

# пресет: макро-параметри, цілі (можна > 1 — неприродне перебільшення), шкіра, одяг
PRESETS = {
    # «Наблюдатель» — Лисицин, перший, хто пройшов крізь Шов. Дуже високий, виснажений, руки до колін.
    "watcher": {
        "macro": {"gender": 1.0, "age": 0.62, "height": 1.0, "weight": 0.0, "muscle": 0.15, "proportions": 0.0},
        "targets": {
            "arms/measure-upperarm-length-incr": 1.6, "arms/measure-lowerarm-length-incr": 1.9,
            "arms/l-upperarm-fat-decr": 1.0, "arms/r-upperarm-fat-decr": 1.0, "arms/l-lowerarm-fat-decr": 1.0, "arms/r-lowerarm-fat-decr": 1.0,
            "legs/l-lowerleg-fat-decr": 1.0, "legs/r-lowerleg-fat-decr": 1.0,
            "head/head-scale-horiz-decr": 0.8, "head/head-scale-vert-incr": 0.6, "head/head-fat-decr": 1.0, "head/head-age-incr": 1.0,
            "neck/neck-scale-vert-incr": 1.2, "neck/neck-scale-horiz-decr": 0.6,
            "torso/torso-scale-horiz-decr": 0.6, "stomach/stomach-pregnant-decr": 1.0,
        },
        "skin": "old_caucasian_male",
        "clothes": ["male_worksuit01"],
        "scale": 1.12,
    },
    # «Фигура» — Лисицин у прогумованому захисному костюмі Л-1 з протигазом. Дуже високий, вузький, руки довші за норму.
    "figure": {
        "macro": {"gender": 1.0, "age": 0.5, "height": 1.0, "weight": 0.0, "muscle": 0.12, "proportions": 0.0},
        "targets": {
            "arms/measure-upperarm-length-incr": 1.3, "arms/measure-lowerarm-length-incr": 1.6,
            "arms/l-upperarm-fat-decr": 1.0, "arms/r-upperarm-fat-decr": 1.0, "arms/l-lowerarm-fat-decr": 1.0, "arms/r-lowerarm-fat-decr": 1.0,
            "neck/neck-scale-vert-incr": 1.0, "neck/neck-scale-horiz-decr": 0.7,
            "torso/torso-scale-horiz-decr": 0.7, "stomach/stomach-pregnant-decr": 1.0,
            "legs/l-lowerleg-fat-decr": 1.0, "legs/r-lowerleg-fat-decr": 1.0,
        },
        "skin": "old_caucasian_male",
        "clothes": ["male_worksuit01"],
        "scale": 0.95,  # макро-зріст MakeHuman уже ~2.5 м; разом ≈ 2.35 м
        "rubber": (0.085, 0.1, 0.072),
        "mask": ".assets-src/polyhaven/old_gas_mask/old_gas_mask.gltf",
    },
    # «Слепой» (рівень 2) — виснажений, голий, без очей (порожні очниці), дуже довгі руки й пальці; полює на звук.
    "blind": {
        "macro": {"gender": 1.0, "age": 0.75, "height": 0.9, "weight": 0.0, "muscle": 0.0, "proportions": 0.0},
        "targets": {
            "arms/measure-upperarm-length-incr": 1.8, "arms/measure-lowerarm-length-incr": 2.0,
            "arms/l-upperarm-fat-decr": 1.0, "arms/r-upperarm-fat-decr": 1.0, "arms/l-lowerarm-fat-decr": 1.0, "arms/r-lowerarm-fat-decr": 1.0,
            "legs/l-lowerleg-fat-decr": 1.0, "legs/r-lowerleg-fat-decr": 1.0, "legs/l-upperleg-fat-decr": 1.0, "legs/r-upperleg-fat-decr": 1.0,
            "head/head-fat-decr": 1.0, "head/head-age-incr": 1.0, "head/head-scale-horiz-decr": 0.5,
            "neck/neck-scale-vert-incr": 1.4, "neck/neck-scale-horiz-decr": 0.8,
            "torso/torso-scale-horiz-decr": 0.9, "torso/torso-scale-depth-decr": 0.8, "stomach/stomach-pregnant-decr": 1.0,
        },
        "skin": "old_caucasian_male",
        "clothes": [],
        "noeyes": True,
        "scale": 1.0,
    },
    # «Улыбака» (рівень 3) — «воспитатель»: дуже висока, вузька, у білому халаті; рот розтягнутий у неприродну усмішку.
    "smiler": {
        "macro": {"gender": 0.0, "age": 0.45, "height": 1.0, "weight": 0.0, "muscle": 0.1, "proportions": 0.0},
        "targets": {
            "arms/measure-upperarm-length-incr": 1.2, "arms/measure-lowerarm-length-incr": 1.5,
            "arms/l-upperarm-fat-decr": 1.0, "arms/r-upperarm-fat-decr": 1.0, "arms/l-lowerarm-fat-decr": 1.0, "arms/r-lowerarm-fat-decr": 1.0,
            "legs/l-lowerleg-fat-decr": 1.0, "legs/r-lowerleg-fat-decr": 1.0,
            "neck/neck-scale-vert-incr": 1.6, "neck/neck-scale-horiz-decr": 0.8,
            "torso/torso-scale-horiz-decr": 0.8, "stomach/stomach-pregnant-decr": 1.0,
            "head/head-fat-decr": 1.0, "head/head-scale-vert-incr": 0.4,
            "mouth/mouth-laugh-lines-in": 1.5, "mouth/mouth-dimples-in": 1.0,
            "cheek/l-cheek-bones-incr": 1.0, "cheek/r-cheek-bones-incr": 1.0,
        },
        "skin": "young_caucasian_female",
        "clothes": ["female_elegantsuit01"],
        "hair": "bob01",
        "teeth": "teeth_base",
        "grin": float(os.environ.get("GRIN", "1.0")),
        "scale": 1.0,
    },
    # «Утопленник» (рівень 4) — роздутий, важкий, у купальній шапочці; руки звисають, шкіра сіро-синя.
    "drowned": {
        "macro": {"gender": 1.0, "age": 0.55, "height": 0.55, "weight": 1.0, "muscle": 0.0, "proportions": 0.0},
        "targets": {
            "stomach/stomach-pregnant-incr": 0.9, "head/head-fat-incr": 1.0, "neck/neck-scale-horiz-incr": 0.8,
            "torso/torso-scale-horiz-incr": 0.5, "torso/torso-scale-depth-incr": 0.6,
            "arms/l-upperarm-fat-incr": 0.8, "arms/r-upperarm-fat-incr": 0.8, "arms/measure-lowerarm-length-incr": 0.8,
            "legs/l-upperleg-fat-incr": 0.8, "legs/r-upperleg-fat-incr": 0.8,
            "eyes/l-eye-bag-incr": 1.0, "eyes/r-eye-bag-incr": 1.0, "mouth/mouth-angles-down": 1.4, "mouth/mouth-scale-vert-incr": 0.6,
        },
        "skin": "middleage_caucasian_male",
        "clothes": [],
        "hair": "short02",
        "scale": 1.0,
    },
}
P = PRESETS[args.preset]

bpy.ops.wm.read_factory_settings(use_empty=True)
for k in list(bpy.data.objects):
    bpy.data.objects.remove(k)
h = HS.create_human()
for k, v in P["macro"].items():
    HOP.set_value(k, v, entity_reference=h)
TS.reapply_macro_details(h)
troot = LS.get_mpfb_data("targets")
for t, w in P["targets"].items():
    path = os.path.join(troot, t + ".target.gz")
    if os.path.exists(path):
        TS.load_target(h, path, weight=w)
    else:
        print("NO TARGET", t)
TS.bake_targets(h) if hasattr(TS, "bake_targets") else None

rig = HS.add_builtin_rig(h, "game_engine")
udata = LS.get_user_data()
skin = os.path.join(udata, "skins", P["skin"], P["skin"] + ".mhmat")
if os.path.exists(skin):
    HS.set_character_skin(skin, h)
for c in P["clothes"]:
    mhclo = os.path.join(udata, "clothes", c, c + ".mhclo")
    if os.path.exists(mhclo):
        HS.add_mhclo_asset(mhclo, h, asset_type="Clothes", subdiv_levels=0)
for kind, key in (("hair", "hair"), ("teeth", "teeth")):
    if P.get(key):
        f = os.path.join(udata, kind, P[key], P[key] + ".mhclo")
        if os.path.exists(f):
            HS.add_mhclo_asset(f, h, asset_type=kind.capitalize(), subdiv_levels=0)
        else:
            print("NO", kind, f)
eyes = os.path.join(udata, "eyes", "low-poly", "low-poly.mhclo")
if os.path.exists(eyes) and not P.get("noeyes"):
    HS.add_mhclo_asset(eyes, h, asset_type="Eyes", subdiv_levels=0)

if P.get("grin"):
    # усмішка «до вух»: розсунути кутики рота вбік і вгору, розімкнути губи (видно зуби й темряву за ними)
    import mathutils
    teeth = next(o for o in bpy.data.objects if "teeth" in o.name.lower())
    tw = [teeth.matrix_world @ v.co for v in teeth.data.vertices]
    mc = sum(tw, mathutils.Vector()) / len(tw)
    front = min(v.y for v in tw)
    fz = [v.z for v in tw if v.y < front + 0.004]
    mc = mathutils.Vector((mc.x, mc.y, sum(fz) / len(fz)))  # лінія змикання зубів ≈ лінія губ
    print("MOUTH", tuple(round(c, 3) for c in mc), "front", round(front, 3))
    g = P["grin"]

    def grin(co):
        dx, dz = co.x - mc.x, co.z - mc.z
        if co.y > mc.y + 0.01:
            return co
        r = math.hypot(dx / 0.06, dz / 0.04)
        if r >= 1:
            return co
        w = (1 - r * r) ** 2 * g
        n = co.copy()
        n.x += dx * 1.0 * w
        n.z += (abs(dx) / 0.025) ** 2 * 0.013 * w
        lip = math.exp(-((abs(dx) / 0.022) ** 2))  # губи розходяться посередині сильніше
        if dz > 0.0:
            n.z += 0.005 * w * lip
        else:
            n.z -= 0.009 * w * lip
        return n

    body = h
    mw, mi = body.matrix_world, body.matrix_world.inverted()
    ks = body.data.shape_keys
    print("KEYS", [(k.name, round(k.value, 2), k.relative_key.name) for k in ks.key_blocks] if ks else None)
    if body.data.shape_keys:
        for kb in body.data.shape_keys.key_blocks:
            for v in kb.data:
                v.co = mi @ grin(mw @ v.co)
    L = R = 0
    for v in body.data.vertices:
        a = mw @ v.co
        b = grin(a)
        if (b - a).length > 1e-5:
            if a.x < mc.x: L += 1
            else: R += 1
        v.co = mi @ b
    print("GRIN L/R", L, R, "mw", [tuple(round(x, 3) for x in r) for r in mw])
    # зуби — ширші, щоб заповнили розтягнутий рот
    tm, ti = teeth.matrix_world, teeth.matrix_world.inverted()
    for v in teeth.data.vertices:
        c = tm @ v.co
        c.x = mc.x + (c.x - mc.x) * 1.5
        c.z += (abs(c.x - mc.x) / 0.025) ** 2 * 0.006
        v.co = ti @ c
    bpy.context.view_layer.update()

rig.scale = (P["scale"],) * 3
bpy.context.view_layer.update()

if "rubber" in P:
    # увесь костюм, рукавиці й капюшон — одна тьмяна прогумована тканина (Л-1); очі не видно під маскою
    rub = bpy.data.materials.new("rubber")
    rub.use_nodes = True
    bsdf = rub.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*P["rubber"], 1)
    bsdf.inputs["Roughness"].default_value = 0.42
    rub.diffuse_color = (*P["rubber"], 1)
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        if "eye" in o.name.lower():
            bpy.data.objects.remove(o)
            continue
        o.data.materials.clear()
        o.data.materials.append(rub)

if "mask" in P and os.path.exists(P["mask"]):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(P["mask"]))
    parts = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    for o in [o for o in bpy.data.objects if o not in before and o.type != "MESH"]:
        for c in o.children:
            m = c.matrix_world.copy(); c.parent = None; c.matrix_world = m
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    mask = bpy.context.view_layer.objects.active
    mask.name = "gasmask"
    # ГП-5 — шолом-маска на всю голову, справжнього розміру (ширина 0.21 м), шланг звисає вниз; початок координат — центр голови
    hb = rig.data.bones["head"]
    head_w = rig.matrix_world @ hb.head_local
    tail_w = rig.matrix_world @ hb.tail_local
    sc = P["scale"] * 1.32  # голова MakeHuman трохи більша за ГП-5 — маска має повністю її охопити
    mask.scale = (sc, sc, sc)
    import mathutils
    mask.location = head_w + (tail_w - head_w) * 0.45 + mathutils.Vector((0, -0.045, -0.035))
    bpy.context.view_layer.update()
    print("MASK", tuple(round(v, 3) for v in mask.dimensions), "head", tuple(round(v, 3) for v in head_w), tuple(round(v, 3) for v in tail_w))
    m = mask.matrix_world.copy()
    mask.parent = rig
    mask.parent_type = "BONE"
    mask.parent_bone = "head"
    mask.matrix_world = m

if args.preview:
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 600, 800
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    import mathutils
    top = max((rig.matrix_world @ b.tail_local).z for b in rig.data.bones)
    for name, loc, rot in (("front", (0, -6.5, top * 0.55), (math.radians(90), 0, 0)), ("side", (6.5, 0, top * 0.55), (math.radians(90), 0, math.radians(90))),
                           ("face", (0, -1.4, top * 0.93), (math.radians(90), 0, 0))):
        cam.location = loc
        cam.rotation_euler = rot
        cam.data.lens = 50 if name != "face" else float(os.environ.get("FACE_LENS", "55"))
        sc.render.filepath = os.path.abspath(args.preview.replace(".png", f"-{name}.png"))
        bpy.ops.render.render(write_still=True)
    print("PREVIEW", args.preview, "height", round(top, 2))
print("MONSTER", args.preset, "verts", len(h.data.vertices), "bones", len(rig.data.bones), "objects", [o.name for o in bpy.data.objects])
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.out), export_format="GLB", export_apply=True, export_skins=True, export_animations=False)
print("EXPORTED", args.out, os.path.getsize(args.out))
