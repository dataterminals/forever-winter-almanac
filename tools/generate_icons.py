#!/usr/bin/env python3
"""Generate the PWA icons (gunmetal plate + amber reticle + 'FW'). Requires Pillow."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "icons")
BG, PLATE, AMBER, OLIVE = (22, 22, 18), (38, 40, 34), (211, 176, 92), (150, 165, 90)

def font(sz):
    for name in ("consolab.ttf", "arialbd.ttf", "seguisb.ttf", "Arial.ttf"):
        try: return ImageFont.truetype(name, sz)
        except Exception: pass
    return ImageFont.load_default()

def draw(size, maskable=False):
    img = Image.new("RGBA", (size, size), BG + (255,))
    d = ImageDraw.Draw(img)
    pad = int(size * (0.14 if maskable else 0.06))
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.10), fill=PLATE)
    cx = cy = size / 2
    r = (size / 2 - pad) * 0.62
    lw = max(2, int(size * 0.018))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=AMBER, width=lw)
    for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        d.line([cx + dx * r * 0.55, cy + dy * r * 0.55, cx + dx * r * 1.02, cy + dy * r * 1.02], fill=AMBER, width=lw)
    d.ellipse([cx - lw, cy - lw, cx + lw, cy + lw], fill=OLIVE)
    f = font(int(size * 0.20)); tb = d.textbbox((0, 0), "FW", font=f)
    d.text((cx - (tb[2] - tb[0]) / 2 - tb[0], size - pad - (tb[3] - tb[1]) * 1.7 - tb[1]), "FW", font=f, fill=OLIVE)
    return img

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for sz in (192, 512): draw(sz).save(f"{OUT}/icon-{sz}.png")
    draw(512, maskable=True).save(f"{OUT}/icon-maskable-512.png")
    draw(180).save(f"{OUT}/apple-touch-icon.png")
    draw(64).save(f"{OUT}/favicon.png")
    print("icons ->", os.path.relpath(OUT))
