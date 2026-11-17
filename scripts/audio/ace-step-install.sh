#!/bin/bash
# ACE-Step 1.5 (генератор музики, Apache-2.0) у ~/tools/ACE-Step-1.5 — лише на вимогу: ~10 ГБ бібліотек + 6 ГБ моделей.
# Без відеокарти працює на CPU: 10 с музики ≈ 1 хв. Мовна модель (LM 1.7B) не завантажується — режим DiT-only.
set -e
D=~/tools/ACE-Step-1.5
[ -d "$D" ] || git clone -q --depth 1 https://github.com/ace-step/ACE-Step-1.5.git "$D"
cd "$D" && uv sync
HF_HUB_DISABLE_TELEMETRY=1 .venv/bin/hf download ACE-Step/Ace-Step1.5 --local-dir ./checkpoints \
  --include "acestep-v15-turbo/*" "vae/*" "Qwen3-Embedding-0.6B/*" "config.json"
echo "ACE-Step ready: ~/tools/ACE-Step-1.5/.venv/bin/python scripts/audio/ace_generate.py --caption '...' --duration 20 --out .assets-src/music"
