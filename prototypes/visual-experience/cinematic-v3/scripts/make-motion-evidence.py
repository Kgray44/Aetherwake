"""Encode actual native capturePage sequences; never generate missing frames.

Requires Pillow. Run after npm run verify. Raw PNGs remain ignored and lossless.
GIF timing uses measured capture intervals, with a 600ms final review hold.
These temporal samples are motion evidence, not presentation-rate measurements.
"""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
evidence = root / 'evidence'
report = json.loads((evidence / 'verification.json').read_text(encoding='utf-8'))
out = evidence / 'motion'
out.mkdir(exist_ok=True)
groups = {}
for entry in report['motionFrames']:
    groups.setdefault(entry['sequence'], []).append(entry)
manifest = []
for name, entries in groups.items():
    entries.sort(key=lambda x: x['index'])
    images = []
    durations = []
    for i, entry in enumerate(entries):
        with Image.open(evidence / entry['file']) as source:
            image = source.convert('RGB')
            image.thumbnail((960, 700), Image.Resampling.LANCZOS)
            if not images:
                images.append(image.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
            else:
                images.append(image.quantize(palette=images[0], dither=Image.Dither.NONE))
        duration = entries[i + 1]['at'] - entry['at'] if i + 1 < len(entries) else 600
        durations.append(max(20, duration))
    target = out / f'{name}.gif'
    images[0].save(target, save_all=True, append_images=images[1:], duration=durations, loop=0, disposal=1, optimize=True)
    manifest.append({'sequence': name, 'frames': len(entries), 'captureSpanMs': entries[-1]['at'] - entries[0]['at'], 'playbackMs': sum(durations), 'bytes': target.stat().st_size})
(out / 'manifest.json').write_text(json.dumps({'source': 'actual Electron native contents; synthetic application data', 'method': 'Measured sequential capture intervals; final 600ms hold; 960px maximum width; global 128-color GIF palette. Lossless full-resolution source PNGs remain local. Not presented FPS or real-time video.', 'sequences': manifest}, indent=2), encoding='utf-8')
print(json.dumps(manifest, indent=2))
