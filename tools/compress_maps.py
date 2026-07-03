#!/usr/bin/env python3
"""
Recompress the bundled map imagery in place to shrink the GitHub Pages payload.

The aerial overlays were exported at near-lossless webp (5-15 MB each); re-encoding
at quality 80 drops them ~90% with little visible loss. JPEG map tiles are nudged
to quality 82. Filenames and pixel dimensions are unchanged, so marker placement
and every data reference stay valid; a file is only rewritten if it gets smaller.
PNG icons/screenshots are left alone (lossless — re-saving wouldn't help).

    python tools/compress_maps.py
"""
import io, os, glob
from PIL import Image

IMG = os.path.join(os.path.dirname(__file__), "..", "assets", "img")
WEBP_Q, JPEG_Q = 80, 82


def encode(im, ext):
    buf = io.BytesIO()
    if ext == ".webp":
        im.save(buf, "WEBP", quality=WEBP_Q, method=6)
    else:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.save(buf, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    return buf.getvalue()


def main():
    before = after = 0
    changed = 0
    for path in sorted(glob.glob(os.path.join(IMG, "*"))):
        ext = os.path.splitext(path)[1].lower()
        if ext not in (".webp", ".jpg", ".jpeg"):
            continue
        b0 = os.path.getsize(path); before += b0
        try:
            im = Image.open(path); im.load()
            data = encode(im, ext)
        except Exception as e:
            print("  ! skip", os.path.basename(path), e); after += b0; continue
        if len(data) < b0:                       # only keep it if it actually shrank
            with open(path, "wb") as f:
                f.write(data)
            after += len(data); changed += 1
        else:
            after += b0
    pct = 100 * (before - after) / before if before else 0
    print(f"\n  recompressed {changed} images: {before/1e6:.0f} MB -> {after/1e6:.0f} MB ({pct:.0f}% smaller)")


if __name__ == "__main__":
    main()
