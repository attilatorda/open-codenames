"""Deck pipeline, step 4: build the shipped standard deck from the selected candidates.

Re-cuts each selected illustration from the full-resolution original (same relative box as the
candidate), normalizes it to a square grayscale card and writes resources/deck/ (cards + deck.json).

Usage: python -P scripts/deck/build_deck.py
Selection and captions live in scripts/deck/selection.json.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 400_000_000
ROOT = os.getcwd()
SRC = os.path.join(ROOT, "deck-src")
ORIG = os.path.join(SRC, "originals")
OUT = os.path.join(ROOT, "resources", "decks", "grandville")
UA = {"User-Agent": "OpenCodenames-deck-builder/0.1 (offline game asset pipeline; public-domain artwork)"}
CARD = 768


def fetch(url, path):
    """Download once (cached), backing off politely on HTTP 429."""
    if os.path.exists(path):
        return
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            time.sleep(1.5)
            return
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4:
                raise
            time.sleep(15 * (attempt + 1))


def split_met_title(title):
    """'He has each…, from "Scenes from the Private and Public Life of Animals"' → (title, work)."""
    m = re.match(r'^(.*?),?\s+from\s+["“](.+?)["”]\s*$', title or "")
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return (title or "Untitled").strip(), None


def card_from(original, box, page, margin=0.04):
    sx, sy = original.width / page[0], original.height / page[1]
    x0, y0, x1, y1 = box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    crop = original.crop((max(0, int(x0 - mx)), max(0, int(y0 - my)), min(original.width, int(x1 + mx)), min(original.height, int(y1 + my))))
    gray = crop.convert("L")
    # Levels: ink stays black, the (often grey or yellowed) paper becomes clean white.
    hist = gray.histogram()
    total = sum(hist)
    def pct(q):
        acc = 0
        for v, n in enumerate(hist):
            acc += n
            if acc >= total * q:
                return v
        return 255
    black, paper = pct(0.01), pct(0.80)
    span = max(1, paper - black)
    crop = gray.point(lambda v: max(0, min(255, int((v - black) * 250 / span))))
    side = max(crop.size)
    square = Image.new("L", (side, side), 255)
    square.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return square.resize((CARD, CARD), Image.LANCZOS)


def main():
    os.makedirs(ORIG, exist_ok=True)
    os.makedirs(os.path.join(OUT, "cards"), exist_ok=True)
    candidates = json.load(open(os.path.join(SRC, "candidates", "candidates.json")))
    met = json.load(open(os.path.join(SRC, "met", "meta.json"), encoding="utf-8"))
    commons = json.load(open(os.path.join(SRC, "commons", "meta.json"), encoding="utf-8"))
    selection = json.load(open(os.path.join(ROOT, "scripts", "deck", "selection.json"), encoding="utf-8"))

    cards = []
    for n, sel in enumerate(selection["cards"], start=1):
        cand = candidates[sel["candidate"]]
        card_id = f"d{n:03d}"
        if cand["source"] == "met":
            m = met[cand["key"]]
            url = m["image"]
            title, work = split_met_title(m["title"])
            credit = {
                "title": sel.get("title") or title,
                "artist": "J. J. Grandville",
                "year": m.get("date") or "",
                "work": work or "Scènes de la vie privée et publique des animaux",
                "source": "The Metropolitan Museum of Art",
                "sourceURL": m["objectURL"],
                "license": "Public domain (CC0 — The Met Open Access)",
            }
        else:
            m = commons[cand["key"]]
            # Wikimedia asks automated clients to use standard thumbnail sizes (https://w.wiki/GHai).
            url = re.sub(r"/\d+px-", "/1920px-", m["thumb"]).split("?")[0]
            credit = {
                "title": sel.get("title") or "[Untitled vignette]",
                "artist": "J. J. Grandville",
                "year": (m.get("date") or "1844")[:4],
                "work": "Un Autre Monde",
                "source": "Wikimedia Commons",
                "sourceURL": m["sourceURL"],
                "license": "Public domain",
            }
        ext = os.path.splitext(url.split("?")[0])[1].lower() or ".jpg"
        orig_path = os.path.join(ORIG, f"{cand['source']}-{cand['key']}{ext}")
        try:
            fetch(url, orig_path)
            original = Image.open(orig_path)
        except Exception as e:  # noqa: BLE001 — fall back to the working copy
            print(f"  {card_id}: original unavailable ({e}); using working copy")
            original = Image.open(os.path.join(SRC, cand["source"], f"{cand['key']}.jpg"))
        card = card_from(original, sel.get("box", cand["box"]), cand["page"])
        file = f"cards/{card_id}.jpg"
        card.save(os.path.join(OUT, file), quality=88, optimize=True)
        cards.append({"id": card_id, "file": file, "caption": sel.get("caption", ""), **credit})
        print(f"  {card_id} ← candidate {sel['candidate']} ({cand['source']} {cand['key']}) {original.size}")

    manifest = {
        "version": 1,
        "id": "grandville",
        "name": "Grandville’s Other World",
        "description": (
            "The standard deck: black-and-white wood engravings by J. J. Grandville (1803–1847) — animals living as people, "
            "and the dreamlike inventions of Un Autre Monde (1844) — cut into picture cards. All artwork is in the public domain."
        ),
        "cards": cards,
    }
    json.dump(manifest, open(os.path.join(OUT, "deck.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(cards)} cards → {OUT}")
    write_credits()



def write_credits():
    """docs/DECK_CREDITS.md — shipped with the game next to the README."""
    deck = json.load(open(os.path.join(OUT, "deck.json"), encoding="utf-8"))
    lines = [
        "# Standard deck — artwork credits",
        "",
        deck["description"],
        "",
        "Every card is cut from a scan of a public-domain print. Titles in [square brackets] are descriptive titles supplied",
        "for untitled vignettes; other titles are the catalogue titles of the source institution.",
        "",
        "| Card | Title | Artist | Year | From | Source | License |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in deck["cards"]:
        title = c["title"].replace("|", r"\|")
        lines.append(f"| {c['id']} | {title} | {c['artist']} | {c['year']} | {c.get('work', '')} | [{c['source']}]({c['sourceURL']}) | {c['license']} |")
    path = os.path.join(ROOT, "docs", "DECK_CREDITS.md")
    open(path, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    print(f"credits → {path}")


if __name__ == "__main__":
    if os.environ.get("DECK_CREDITS_ONLY"):
        write_credits()
    else:
        main()
