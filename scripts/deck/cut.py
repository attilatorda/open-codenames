"""Deck pipeline, step 3: find the illustrations on each scanned page and cut them into candidate cards.

Each page is binarized; ink is dilated so a drawing becomes one blob while separate figures and caption
lines stay apart. Every sufficiently large, drawing-shaped blob becomes a candidate card (so plates with
several figures are split into several cards). Captions and page numbers are thin wide blobs and are dropped.

Usage: python -P scripts/deck/cut.py
Writes deck-src/candidates/<source>-<key>-<n>.jpg, candidates.json and review sheets.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage

ROOT = os.path.join(os.getcwd(), "deck-src")
OUT = os.path.join(ROOT, "candidates")
CARD = 640


def sources():
    met = json.load(open(os.path.join(ROOT, "met", "meta.json"), encoding="utf-8"))
    survey = json.load(open(os.path.join(ROOT, "met", "survey.json"), encoding="utf-8"))
    for key, m in met.items():
        if m.get("skip") or survey.get(key, {}).get("sat", 99) >= 40:
            continue
        yield "met", key, os.path.join(ROOT, "met", f"{key}.jpg")
    cpath = os.path.join(ROOT, "commons", "meta.json")
    if os.path.exists(cpath):
        for key, m in json.load(open(cpath, encoding="utf-8")).items():
            if m.get("skip"):
                continue
            p = os.path.join(ROOT, "commons", f"{key}.jpg")
            if os.path.exists(p):
                yield "commons", key, p


def paper_box(a, paper):
    """Bounding box of the paper area, dropping dark scanner beds, gutters and page edges."""
    bright = a > paper - 45
    def run(frac):
        good = frac > 0.55
        best, cur, start, best_span = 0, 0, 0, (0, len(frac))
        for i, g in enumerate(good):
            if g:
                if cur == 0:
                    start = i
                cur += 1
                if cur > best:
                    best, best_span = cur, (start, i + 1)
            else:
                cur = 0
        return best_span
    y0, y1 = run(bright.mean(axis=1))
    x0, x1 = run(bright.mean(axis=0))
    return x0, y0, x1, y1


def textness(ink_region, scale):
    """Share of ink in letter-sized connected pieces: high for typeset text, low for engravings."""
    labels, n = ndimage.label(ink_region, structure=np.ones((3, 3)))
    if n == 0:
        return 1.0
    sizes = np.bincount(labels.ravel())[1:]
    small = sizes < 160 * scale
    return float(sizes[small].sum()) / float(sizes.sum())


def find_blobs(gray):
    """Return bounding boxes (x0, y0, x1, y1) of drawing-like ink regions in a grayscale page."""
    full = np.asarray(gray, dtype=np.float32)
    paper = np.percentile(full, 90)
    px0, py0, px1, py1 = paper_box(full, paper)
    a = full[py0:py1, px0:px1]
    h, w = a.shape
    if h < 50 or w < 50:
        return []
    scale = (min(h, w) / 900.0) ** 2
    ink = a < paper - 55
    k = max(3, int(min(h, w) * 0.012))
    blob = ndimage.binary_closing(ink, structure=np.ones((k, k)), iterations=2)
    blob = ndimage.binary_dilation(blob, structure=np.ones((k, k)))
    labels, n = ndimage.label(blob)
    boxes = []
    page_area = h * w
    for sl in ndimage.find_objects(labels):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        bw, bh = x1 - x0, y1 - y0
        area = bw * bh
        if area < page_area * 0.035:
            continue  # specks, page numbers
        if bh < h * 0.08 or bw / max(bh, 1) > 4.5 or bh / max(bw, 1) > 4.5:
            continue  # caption lines, rules, slivers
        region = ink[y0:y1, x0:x1]
        if region.mean() < 0.04:
            continue  # mostly empty
        if textness(region, scale) > 0.5:
            continue  # typeset text
        boxes.append((x0 + px0, y0 + py0, x1 + px0, y1 + py0))
    return boxes


def to_card(img, box, margin=0.04):
    x0, y0, x1, y1 = box
    w, h = img.size
    mx, my = int((x1 - x0) * margin), int((y1 - y0) * margin)
    crop = img.crop((max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my)))
    crop = ImageOps.autocontrast(crop.convert("L"), cutoff=1)
    side = max(crop.size)
    card = Image.new("L", (side, side), 255)
    card.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return card.resize((CARD, CARD), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    found = []
    for src, key, path in sources():
        img = Image.open(path).convert("RGB")
        gray = img.convert("L")
        for n, box in enumerate(find_blobs(gray)):
            name = f"{src}-{key}-{n}"
            to_card(img, box).save(os.path.join(OUT, f"{name}.jpg"), quality=88)
            found.append({"name": name, "source": src, "key": key, "box": box, "page": img.size})
    json.dump(found, open(os.path.join(OUT, "candidates.json"), "w"), indent=1)
    print(f"{len(found)} candidates")

    # Review sheets.
    font = ImageFont.load_default(size=15)
    cols, rows, cell = 7, 5, 200
    sheets = os.path.join(ROOT, "candidate-sheets")
    os.makedirs(sheets, exist_ok=True)
    per = cols * rows
    for s in range(0, len(found), per):
        sheet = Image.new("RGB", (cols * cell, rows * cell), "white")
        d = ImageDraw.Draw(sheet)
        for i, c in enumerate(found[s : s + per]):
            t = Image.open(os.path.join(OUT, f"{c['name']}.jpg")).resize((cell - 8, cell - 8))
            x, y = (i % cols) * cell, (i // cols) * cell
            sheet.paste(t, (x + 4, y + 4))
            label = f"{s + i}"
            d.rectangle([x + 4, y + 4, x + 44, y + 22], fill="black")
            d.text((x + 7, y + 5), label, fill="white", font=font)
        sheet.save(os.path.join(sheets, f"c-{s // per + 1:02d}.jpg"), quality=80)
    print(f"sheets in {sheets}")


if __name__ == "__main__":
    main()
