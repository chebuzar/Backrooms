"""Музика/ембієнт через ACE-Step 1.5 на CPU (DiT-only, int8). Спершу: bash scripts/audio/ace-step-install.sh
  ~/tools/ACE-Step-1.5/.venv/bin/python scripts/audio/ace_generate.py --caption "dark ambient drone" --duration 20 --out .assets-src/music
Результат — WAV 48 кГц. Перед додаванням у гру записати в public/assets/CREDITS.md (модель ACE-Step 1.5, Apache-2.0)."""
import argparse
import os
import time

os.environ.setdefault("ACESTEP_INIT_LLM", "false")
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--caption", required=True)
ap.add_argument("--duration", type=float, default=20)
ap.add_argument("--steps", type=int, default=8)
ap.add_argument("--seed", type=int, default=-1)
ap.add_argument("--out", required=True)
ap.add_argument("--root", default=os.path.expanduser("~/tools/ACE-Step-1.5"))
a = ap.parse_args()

t = time.time()
dit = AceStepHandler()
dit.initialize_service(project_root=a.root, config_path="acestep-v15-turbo", device="cpu", quantization="int8_weight_only")
dit._get_auto_decode_chunk_size = lambda: 64  # декодування шматками: інакше на 16 ГБ RAM процес вбиває OOM
params = GenerationParams(caption=a.caption, lyrics="[Instrumental]", instrumental=True, duration=a.duration,
                          thinking=False, inference_steps=a.steps, seed=a.seed)
r = generate_music(dit, None, params, GenerationConfig(batch_size=1, audio_format="wav"), save_dir=os.path.abspath(a.out))
print("ok" if r.success else "FAILED", round(time.time() - t), "s", [x["path"] for x in r.audios] if r.success else r.error)
