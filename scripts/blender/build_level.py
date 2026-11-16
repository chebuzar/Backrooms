"""Побудова рівня з JSON-планування + запікання світла (lightmaps) + експорт GLB по шматках.

  blender -b -P scripts/blender/build_level.py -- --layout .assets-src/levels/level0-1987.json \
          --out .assets-src/levels/level0 [--chunks 0,0;1,0] [--size 512] [--samples 192] [--no-bake]

На виході в --out: chunk_X_Z.glb (геометрія, UV0 — метри для текстур, UV1 — карта світла,
матеріали за назвами wall/base/floor/ceil), lm_X_Z.png (світло, закодоване sqrt(E/LMAX)), manifest.json.
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
import bmesh
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--layout", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--chunks", default="")
ap.add_argument("--size", type=int, default=512)
ap.add_argument("--samples", type=int, default=192)
ap.add_argument("--no-bake", action="store_true")
ap.add_argument("--power", type=float, default=22.0)
args = ap.parse_args(argv)

L = json.load(open(args.layout))
CH = L["chunk"]
H = L["height"]
W = L["cols"] * L["cell"]
D = L["rows"] * L["cell"]
NX = math.ceil(W / CH)
NZ = math.ceil(D / CH)
LMAX = 4.0  # максимальна освітленість у карті (більше — обрізається)
THEME = L.get("theme") or {
    "id": "yellow", "paintH": 0, "plinth": True,
    "lamp": {"color": [1.0, 0.95, 0.8], "power": 22.0},
    "albedo": {"wall": [0.58, 0.47, 0.2], "wallLow": [0.58, 0.47, 0.2], "base": [0.3, 0.23, 0.12], "floor": [0.26, 0.19, 0.09], "ceil": [0.68, 0.66, 0.58]},
}
BASE_H = 0.09 if THEME["plinth"] else 0.0  # висота плінтуса
BASE_T = 0.014  # наскільки плінтус виступає
PAINT_H = float(THEME.get("paintH") or 0)  # межа нижньої фарбованої смуги стін
os.makedirs(args.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.sample_clamp_indirect = 6
scene.render.bake.margin = 6
scene.render.threads_mode = "AUTO"
scene.world = bpy.data.worlds.new("void")
scene.world.color = (0, 0, 0)


def material(name, rgb, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = 0.9
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


# альбедо, близькі до справжніх текстур: від них залежить колір відбитого світла (жовтий «суп» Закулисья)
A = THEME["albedo"]
MATS = {k: material(k, tuple(A[k])) for k in ("wall", "base", "floor", "ceil", "wallLow")}
SLOT = {"wall": 0, "base": 1, "floor": 2, "ceil": 3, "wallLow": 4}


def chunk_bounds(ix, iz):
    return ix * CH, min(W, (ix + 1) * CH), iz * CH, min(D, (iz + 1) * CH)


class MeshBuilder:
    """Збирає квадрати з UV0 (метри) і матеріалом."""

    def __init__(self):
        self.v = []
        self.f = []
        self.uv = []
        self.mat = []

    def quad(self, pts, uvs, mat):
        i = len(self.v)
        self.v.extend(pts)
        self.f.append((i, i + 1, i + 2, i + 3))
        self.uv.append(uvs)
        self.mat.append(SLOT[mat])

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        uv0 = me.uv_layers.new(name="UVMap")
        for poly, uvs in zip(me.polygons, self.uv):
            for li, uv in zip(poly.loop_indices, uvs):
                uv0.data[li].uv = uv
        for poly, m in zip(me.polygons, self.mat):
            poly.material_index = m
        ob = bpy.data.objects.new(name, me)
        for k in ("wall", "base", "floor", "ceil", "wallLow"):
            me.materials.append(MATS[k])
        scene.collection.objects.link(ob)
        return ob


EPS = 1e-4


def wall_faces(boxes, y0, y1):
    """Видимі бічні грані набору осьових блоків (стін/колон/плінтусів).
    Прибирає частини граней, сховані всередині сусіднього блоку або звернені в нього, а з двох граней в одній площині
    (торець стіни на поверхні іншої) лишає одну — інакше вони «борються» за пікселі (z-fighting, мерехтлива смуга в кутах)
    і запікання світла дає темну пляму. Повертає [(вісь нормалі, знак, площина, a, b)]: вісь 'x'|'z', відрізок [a, b] уздовж іншої осі."""
    out = []
    for i, b in enumerate(boxes):
        x0, x1, z0, z1, thin = b
        for axis, sign, c, a0, a1 in (("z", 1, z1, x0, x1), ("z", -1, z0, x0, x1), ("x", 1, x1, z0, z1), ("x", -1, x0, z0, z1)):
            prio = 2 if thin in (axis, "both") else 1  # довга грань важливіша за торець
            hidden = []
            for j, o in enumerate(boxes):
                if j == i:
                    continue
                ox0, ox1, oz0, oz1, othin = o
                n0, n1, p0, p1 = (oz0, oz1, ox0, ox1) if axis == "z" else (ox0, ox1, oz0, oz1)
                lo, hi = max(a0, p0), min(a1, p1)
                if hi - lo <= EPS:
                    continue
                inside = n0 + EPS < c < n1 - EPS
                into = (sign < 0 and abs(c - n1) <= EPS) or (sign > 0 and abs(c - n0) <= EPS)
                coinc = (sign < 0 and abs(c - n0) <= EPS) or (sign > 0 and abs(c - n1) <= EPS)
                if inside or into:
                    hidden.append((lo, hi))
                elif coinc:
                    oprio = 2 if othin in (axis, "both") else 1
                    if (oprio, -j) > (prio, -i):
                        hidden.append((lo, hi))
            hidden.sort()
            cur = a0
            for lo, hi in hidden:
                if lo > cur + 1e-3:
                    out.append((axis, sign, c, cur, lo))
                cur = max(cur, hi)
            if a1 > cur + 1e-3:
                out.append((axis, sign, c, cur, a1))
    return out


def face_quad(mb, f, y0, y1, mat):
    axis, sign, c, a, b = f

    def P(x, y, z):
        return (x, -z, y)
    if axis == "z" and sign > 0:
        mb.quad([P(a, y0, c), P(b, y0, c), P(b, y1, c), P(a, y1, c)], [(a, y0), (b, y0), (b, y1), (a, y1)], mat)
    elif axis == "z":
        mb.quad([P(b, y0, c), P(a, y0, c), P(a, y1, c), P(b, y1, c)], [(-b, y0), (-a, y0), (-a, y1), (-b, y1)], mat)
    elif sign < 0:
        mb.quad([P(c, y0, a), P(c, y0, b), P(c, y1, b), P(c, y1, a)], [(a, y0), (b, y0), (b, y1), (a, y1)], mat)
    else:
        mb.quad([P(c, y0, b), P(c, y0, a), P(c, y1, a), P(c, y1, b)], [(-b, y0), (-a, y0), (-a, y1), (-b, y1)], mat)


def boxes_of(walls, grow=0.0):
    out = []
    for w in walls:
        thin = "both" if w["kind"] == "pillar" else ("z" if w["w"] >= w["d"] else "x")
        out.append((w["x"] - w["w"] / 2 - grow, w["x"] + w["w"] / 2 + grow, w["z"] - w["d"] / 2 - grow, w["z"] + w["d"] / 2 + grow, thin))
    return out


def split_by_chunks(f):
    """Розрізати грань межами шматків і віддати пари (ключ шматка, грань)."""
    axis, sign, c, a, b = f
    if c < -EPS and sign < 0 or c > (D if axis == "z" else W) + EPS and sign > 0:
        return []  # зовнішній бік зовнішньої стіни — ніхто не побачить
    nN = NZ if axis == "z" else NX
    kn = min(nN - 1, max(0, int(math.floor(c / CH))))
    nA = NX if axis == "z" else NZ
    res = []
    cuts = [a] + [k * CH for k in range(1, nA) if a + 1e-3 < k * CH < b - 1e-3] + [b]
    for p, q in zip(cuts[:-1], cuts[1:]):
        ka = min(nA - 1, max(0, int(math.floor((p + q) / 2 / CH))))
        key = (ka, kn) if axis == "z" else (kn, ka)
        res.append((key, (axis, sign, c, p, q)))
    return res


WALL_FACES = {}
_wf = wall_faces(boxes_of(L["walls"]), BASE_H, H)
_pf = wall_faces(boxes_of(L["walls"], BASE_T), 0, BASE_H) if BASE_H > 0 else []
for f in _wf:
    for key, g in split_by_chunks(f):
        WALL_FACES.setdefault(key, []).append(("wall", g))
for f in _pf:
    for key, g in split_by_chunks(f):
        WALL_FACES.setdefault(key, []).append(("base", g))
print(f"WALL FACES: {len(_wf)} wall pieces, {len(_pf)} plinth pieces")


def build_chunk(ix, iz):
    cx0, cx1, cz0, cz1 = chunk_bounds(ix, iz)
    mb = MeshBuilder()

    def P(x, y, z):
        return (x, -z, y)
    # підлога й стеля (сіткою 2×2 м — кращий розподіл UV1 і менше «пливе» світло)
    step = 2.4
    xs = np.arange(cx0, cx1 + 1e-6, step).tolist()
    zs = np.arange(cz0, cz1 + 1e-6, step).tolist()
    if xs[-1] < cx1 - 1e-6:
        xs.append(cx1)
    if zs[-1] < cz1 - 1e-6:
        zs.append(cz1)
    for a, b in zip(xs[:-1], xs[1:]):
        for c, d in zip(zs[:-1], zs[1:]):
            mb.quad([P(a, 0, d), P(b, 0, d), P(b, 0, c), P(a, 0, c)], [(a, d), (b, d), (b, c), (a, c)], "floor")
            mb.quad([P(a, H, c), P(b, H, c), P(b, H, d), P(a, H, d)], [(a, c), (b, c), (b, d), (a, d)], "ceil")
    for kind, f in WALL_FACES.get((ix, iz), []):
        if kind == "wall":
            if PAINT_H > BASE_H + 0.01:
                face_quad(mb, f, BASE_H, PAINT_H, "wallLow")
                face_quad(mb, f, PAINT_H, H, "wall")
            else:
                face_quad(mb, f, BASE_H, H, "wall")
        else:
            face_quad(mb, f, 0, BASE_H, "base")
            # верх плінтуса — смужка між гранню плінтуса й стіною (лише видимі ділянки, тож стики не накладаються)
            axis, sign, c, a, b = f
            c2 = c - sign * BASE_T
            if axis == "z":
                lo, hi = (c2, c) if sign > 0 else (c, c2)
                a2, b2 = a - BASE_T, b + BASE_T  # z-грані закривають і кутові квадратики
                mb.quad([P(a2, BASE_H, hi), P(b2, BASE_H, hi), P(b2, BASE_H, lo), P(a2, BASE_H, lo)], [(a2, hi), (b2, hi), (b2, lo), (a2, lo)], "base")
            else:
                lo, hi = (c2, c) if sign > 0 else (c, c2)
                mb.quad([P(lo, BASE_H, b), P(hi, BASE_H, b), P(hi, BASE_H, a), P(lo, BASE_H, a)], [(lo, b), (hi, b), (hi, a), (lo, a)], "base")
    ob = mb.to_object(f"chunk_{ix}_{iz}")
    # друга розгортка — під карту світла
    me = ob.data
    lm = me.uv_layers.new(name="Lightmap")
    me.uv_layers.active = lm
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.012, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers.active = me.uv_layers["UVMap"]
    for i, uvl in enumerate(me.uv_layers):
        uvl.active_render = i == 0
    return ob


def add_lights():
    col = tuple(THEME["lamp"]["color"])
    for p in L["lights"]:
        if p["state"] == "off":
            continue
        ld = bpy.data.lights.new("lamp", type="AREA")
        ld.shape = "RECTANGLE"
        ld.size = p["w"]
        ld.size_y = p["d"]
        ld.energy = float(THEME["lamp"].get("power", args.power)) * (p["w"] * p["d"] / 0.72) ** 0.5 * (0.75 if p["state"] == "flicker" else 1.0)
        ld.color = col
        ob = bpy.data.objects.new("lamp", ld)
        ob.location = (p["x"], -p["z"], H - 0.012)
        scene.collection.objects.link(ob)


t0 = time.time()
chunks = {}
for iz in range(NZ):
    for ix in range(NX):
        chunks[(ix, iz)] = build_chunk(ix, iz)
add_lights()
print(f"BUILT {len(chunks)} chunks in {time.time() - t0:.1f}s")

todo = list(chunks.keys())
if args.chunks:
    todo = [tuple(int(v) for v in c.split(",")) for c in args.chunks.split(";")]

manifest = {"chunk": CH, "nx": NX, "nz": NZ, "height": H, "lmax": LMAX, "size": args.size, "chunks": []}
for key in todo:
    ob = chunks[key]
    ix, iz = key
    name = f"{ix}_{iz}"
    if not args.no_bake:
        img = bpy.data.images.new(f"lm_{name}", args.size, args.size, float_buffer=True)
        for m in MATS.values():
            nt = m.node_tree
            node = nt.nodes.get("BakeTarget") or nt.nodes.new("ShaderNodeTexImage")
            node.name = "BakeTarget"
            node.image = img
            nt.nodes.active = node
        ob.data.uv_layers.active = ob.data.uv_layers["Lightmap"]
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        tb = time.time()
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True, margin=6)
        ob.data.uv_layers.active = ob.data.uv_layers["UVMap"]
        px = np.array(img.pixels[:], dtype=np.float32).reshape(args.size, args.size, 4)
        rgb = px[:, :, :3] * math.pi  # Blender віддає E/π; у грі множимо альбедо на E/π, тож зберігаємо E
        # легке згладжування шуму (3×3, лише серед запечених текселів)
        valid = (px[:, :, 3] > 0.5).astype(np.float32)[..., None]
        acc = np.zeros_like(rgb)
        wsum = np.zeros_like(valid)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(rgb * valid, dy, 0), dx, 1)
                wsum += np.roll(np.roll(valid, dy, 0), dx, 1)
        smooth = np.where(wsum > 0, acc / np.maximum(wsum, 1e-6), rgb)
        enc = np.sqrt(np.clip(smooth / LMAX, 0, 1))
        out = np.concatenate([enc, np.ones_like(enc[:, :, :1])], axis=2)
        img2 = bpy.data.images.new(f"lmo_{name}", args.size, args.size)
        img2.pixels[:] = out.ravel().tolist()
        img2.filepath_raw = os.path.join(args.out, f"lm_{name}.png")
        img2.file_format = "PNG"
        img2.save()
        print(f"BAKED {name} in {time.time() - tb:.1f}s, mean E {float(smooth.mean()):.3f}, max {float(smooth.max()):.2f}")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, f"chunk_{name}.glb"), export_format="GLB", use_selection=True,
                              export_texcoords=True, export_normals=True, export_materials="PLACEHOLDER", export_yup=True)
    manifest["chunks"].append({"x": ix, "z": iz, "glb": f"chunk_{name}.glb", "lm": f"lm_{name}.png"})

json.dump(manifest, open(os.path.join(args.out, "manifest.json"), "w"), indent=1)
print(f"DONE in {time.time() - t0:.1f}s")
