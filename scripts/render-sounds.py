"""Render QuotaDeck's UI sounds from the earshot sound bank (https://github.com/Leonxlnx/earshot, MIT).

    python scripts/render-sounds.py --earshot path/to/earshot

Edit scripts/sounds.json to pick other sounds or levels, then run this again. Only numpy, scipy and
soundfile are needed (pip install numpy scipy soundfile): the bank is pure DSP, earshot's model
dependencies (torch, transformers) are not used.
"""

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--earshot", required=True, help="path to a checkout of github.com/Leonxlnx/earshot")
    ap.add_argument("--config", default=os.path.join(HERE, "sounds.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "src", "renderer", "src", "assets", "sounds"))
    args = ap.parse_args()

    sys.path.insert(0, os.path.abspath(args.earshot))
    from earshot.forge import bank  # noqa: E402  (needs the path above)
    import soundfile as sf  # noqa: E402

    with open(args.config, encoding="utf-8") as f:
        sounds = json.load(f)["sounds"]
    os.makedirs(args.out, exist_ok=True)
    sr = bank.SR

    for name, spec in sounds.items():
        y, _meta = bank.render(spec["id"], seed=spec.get("seed"), dur=spec.get("dur"), peak_db=spec.get("peak_db", -12.0))
        y = np.asarray(y, dtype=np.float32)
        if y.ndim == 2:
            y = y.mean(axis=1)
        # Drop the silent tail (60 dB below the peak) and end with a 5 ms fade so nothing clicks.
        peak = float(np.max(np.abs(y))) or 1e-9
        loud = np.where(np.abs(y) > peak * 10 ** (-60 / 20))[0]
        if len(loud):
            y = y[: min(len(y), int(loud[-1] + 0.01 * sr))]
        fade = min(len(y), int(0.005 * sr))
        if fade:
            y[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        path = os.path.join(args.out, f"{name}.wav")
        sf.write(path, y, sr, subtype="PCM_16")
        print(f"{name:10s} {spec['id']:24s} {len(y) / sr * 1000:6.0f} ms {os.path.getsize(path) / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
