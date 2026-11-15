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
# three.js examples + manual, pinned to the version the game uses (0.160 = r160)
if [ ! -d three.js/.git ]; then
  git -c advice.detachedHead=false clone -q --depth 1 --branch r160 --filter=blob:none --sparse \
    https://github.com/mrdoob/three.js three.js
  git -C three.js sparse-checkout set --no-cone '/examples/*.html' '/manual/en/'
  echo "new  three.js (r160 examples + manual)"
else echo "ok   three.js"; fi
