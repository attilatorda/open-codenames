"""Deck pipeline, step 2: keep black-and-white prints and build labelled contact sheets for review.

Usage: python -I scripts/deck/survey.py
Writes deck-src/met/survey.json (colorfulness per image) and deck-src/sheets/sheet-NN.jpg.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont, ImageStat

ROOT = os.path.join(os.getcwd(), "deck-src")
MET = os.path.join(ROOT, "met")
SHEETS = os.path.join(ROOT, "sheets")
COLS, ROWS, CELL = 6, 5, 230


def colorfulness(img):
    """Mean saturation of the HSV image (0-255); hand-colored prints score high."""
    hsv = img.convert("RGB").resize((200, 200)).convert("HSV")
    return ImageStat.Stat(hsv).mean[1]


def main():
    meta = json.load(open(os.path.join(MET, "meta.json"), encoding="utf-8"))
    survey = {}
    for key, m in meta.items():
        if m.get("skip"):
            continue
        path = os.path.join(MET, f"{key}.jpg")
        if not os.path.exists(path):
            continue
        img = Image.open(path)
        survey[key] = {"sat": round(colorfulness(img), 1), "size": img.size, "title": m["title"]}
    json.dump(survey, open(os.path.join(MET, "survey.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    bw = sorted([k for k, v in survey.items() if v["sat"] < 40], key=int)
    print(f"{len(survey)} images, {len(bw)} black-and-white (saturation < 40)")

    os.makedirs(SHEETS, exist_ok=True)
    font = ImageFont.load_default(size=16)
    per = COLS * ROWS
    for s in range(0, len(bw), per):
        sheet = Image.new("RGB", (COLS * CELL, ROWS * CELL), "white")
        draw = ImageDraw.Draw(sheet)
        for i, key in enumerate(bw[s : s + per]):
            img = Image.open(os.path.join(MET, f"{key}.jpg")).convert("RGB")
            img.thumbnail((CELL - 10, CELL - 30))
            x, y = (i % COLS) * CELL, (i // COLS) * CELL
            sheet.paste(img, (x + (CELL - img.width) // 2, y + 4))
            draw.rectangle([x + 2, y + CELL - 24, x + 90, y + CELL - 4], fill="black")
            draw.text((x + 6, y + CELL - 23), key, fill="white", font=font)
        out = os.path.join(SHEETS, f"sheet-{s // per + 1:02d}.jpg")
        sheet.save(out, quality=82)
        print(out)


if __name__ == "__main__":
    main()
