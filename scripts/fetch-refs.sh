#!/usr/bin/env bash
# Reference repositories for development (NOT game dependencies).
# Cloned outside the project into ../refs so Claude can read their source and
# examples. Nothing here is bundled into the game; a library goes into
# package.json only when a task actually uses it (see CLAUDE.md).
set -euo pipefail
DEST="${1:-$(cd "$(dirname "$0")/../.." && pwd)/refs}"
mkdir -p "$DEST" && cd "$DEST"
export GIT_LFS_SKIP_SMUDGE=1

clone() { # owner/repo [extra git args...]
  local r=$1; shift; local n=${r#*/}
  if [ -d "$n/.git" ]; then echo "ok   $n"; return; fi
  git -c advice.detachedHead=false clone -q --depth 1 "$@" "https://github.com/$r" "$n" && echo "new  $n"
}

clone pmndrs/postprocessing          # camera effects: SMAA, bloom, noise, vignette, tone mapping
clone N8python/n8ao                  # ambient occlusion: soft contact shadows in corners
clone donmccurdy/glTF-Transform      # model/texture optimisation (meshopt, KTX2, resize)
clone gkjohnson/three-mesh-bvh       # fast raycasts / collisions against meshes
clone GoogleChrome/modern-web-guidance # modern HTML/CSS/JS guides for menus & UI

# --- graphics ---
clone Ameobea/three-good-godrays     # volumetric light shafts (postprocessing pass)
clone gkjohnson/three-gpu-pathtracer # path-traced "ground truth" renders to tune baked lighting
clone protectwise/troika             # crisp SDF text in 3D (notes, signs) — troika-three-text
clone patriciogonzalezvivo/lygia     # shader reference (noise, grain, lighting). Prosperity licence: read, don't copy
# --- performance / phones ---
clone pmndrs/detect-gpu              # pick quality preset by device GPU
clone zeux/meshoptimizer             # mesh compression / vertex cache optimisation
clone BinomialLLC/basis_universal    # KTX2/Basis texture compression (less GPU memory on iPhone)
clone KhronosGroup/KTX-Software      # toktx CLI used by glTF-Transform for KTX2
clone BabylonJS/Spector.js           # WebGL frame capture: draw calls, shaders, state
# --- monster AI ---
clone Mugen87/yuka                   # game AI: perception, steering, state machines, navmesh
clone isaac-mason/recast-navigation-js # navmesh pathfinding (Recast/Detour WASM)
# --- sound / input ---
clone Tonejs/Tone.js                 # WebAudio synthesis & effects reference
clone chrisguttandin/standardized-audio-context # Safari/iOS WebAudio quirks
clone goldfire/howler.js             # audio playback library (allowed list)
clone yoannmoinet/nipplejs           # virtual joystick (allowed list)
# --- level generation ---
clone mxgmn/WaveFunctionCollapse     # procedural layout ideas (C#, reference only)

# three.js examples + manual, pinned to the version the game uses (0.160 = r160)
if [ ! -d three.js/.git ]; then
  git -c advice.detachedHead=false clone -q --depth 1 --branch r160 --filter=blob:none --sparse \
    https://github.com/mrdoob/three.js three.js
  git -C three.js sparse-checkout set --no-cone '/examples/*.html' '/manual/en/'
  echo "new  three.js (r160 examples + manual)"
else echo "ok   three.js"; fi
