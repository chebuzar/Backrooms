"""Монстр із тіла MakeHuman (CC0): спотворені пропорції, шкіра, одяг, ігровий скелет (game_engine, 53 кістки).
  blender -b -P scripts/blender/make_monster.py -- --preset watcher --out .assets-src/monsters/watcher.glb
Потрібен аддон MPFB2 і системні ассети MakeHuman (див. CLAUDE.md). Анімації додаються в грі (Quaternius UAL, retarget)."""
import argparse
import importlib
import os
import sys

import addon_utils
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--preset", default="watcher")
ap.add_argument("--out", required=True)
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
eyes = os.path.join(udata, "eyes", "low-poly", "low-poly.mhclo")
if os.path.exists(eyes):
    HS.add_mhclo_asset(eyes, h, asset_type="Eyes", subdiv_levels=0)

rig.scale = (P["scale"],) * 3
print("MONSTER", args.preset, "verts", len(h.data.vertices), "bones", len(rig.data.bones), "objects", [o.name for o in bpy.data.objects])
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.out), export_format="GLB", export_apply=True, export_skins=True, export_animations=False)
print("EXPORTED", args.out, os.path.getsize(args.out))
