"""Deck pipeline, step 1b: fetch public-domain scans from a Wikimedia Commons category.

Usage: python -P scripts/deck/fetch_commons.py "Un_autre_monde_(1844)" [width]
Writes deck-src/commons/<pageid>.jpg and deck-src/commons/meta.json (title, artist, date, license, source URL).
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "OpenCodenames-deck-builder/0.1 (offline game asset pipeline; public-domain artwork)"}
ROOT = os.path.join(os.getcwd(), "deck-src", "commons")


def get_json(params):
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def main():
    category = sys.argv[1] if len(sys.argv) > 1 else "Un_autre_monde_(1844)"
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 900
    os.makedirs(ROOT, exist_ok=True)
    meta_path = os.path.join(ROOT, "meta.json")
    meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
    params = {
        "action": "query",
        "format": "json",
        "generator": "categorymembers",
        "gcmtitle": f"Category:{category}",
        "gcmtype": "file",
        "gcmlimit": "100",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime|size",
        "iiurlwidth": str(width),
    }
    pages = []
    while True:
        d = get_json(params)
        pages += list(d.get("query", {}).get("pages", {}).values())
        if "continue" not in d:
            break
        params.update(d["continue"])
    print(f"{len(pages)} files in {category}")
    for i, p in enumerate(pages):
        key = str(p["pageid"])
        if key in meta:
            continue
        info = (p.get("imageinfo") or [{}])[0]
        if info.get("mime") not in ("image/jpeg", "image/png", "image/tiff"):
            continue
        em = info.get("extmetadata", {})
        lic = strip_html(em.get("LicenseShortName", {}).get("value"))
        entry = {
            "pageid": p["pageid"],
            "file": p["title"],
            "title": strip_html(em.get("ObjectName", {}).get("value")) or p["title"].replace("File:", ""),
            "artist": strip_html(em.get("Artist", {}).get("value")),
            "date": strip_html(em.get("DateTimeOriginal", {}).get("value")),
            "description": strip_html(em.get("ImageDescription", {}).get("value"))[:400],
            "license": lic,
            "sourceURL": info.get("descriptionurl"),
            "thumb": info.get("thumburl"),
            "original": info.get("url"),
        }
        if "public domain" not in lic.lower() and lic.upper() not in ("PD", "CC0") and not lic.upper().startswith("PD"):
            print(f"  skip {p['title']} (license: {lic})")
            meta[key] = {"skip": True, "license": lic}
            continue
        try:
            req = urllib.request.Request(entry["thumb"], headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r, open(os.path.join(ROOT, f"{key}.jpg"), "wb") as f:
                f.write(r.read())
            meta[key] = entry
            print(f"  [{i + 1}/{len(pages)}] {key} {entry['title'][:70]}")
        except Exception as e:  # noqa: BLE001
            print(f"  {key}: {e}")
        time.sleep(0.3)
        if i % 25 == 0:
            json.dump(meta, open(meta_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    json.dump(meta, open(meta_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"done: {sum(1 for m in meta.values() if not m.get('skip'))} images in {ROOT}")


if __name__ == "__main__":
    main()
