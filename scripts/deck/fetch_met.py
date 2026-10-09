"""Deck pipeline, step 1: fetch public-domain J. J. Grandville prints from The Met Open Access API (CC0).

Usage: python -I scripts/deck/fetch_met.py [query] [limit]
Writes deck-src/met/<objectID>.jpg (web-size image) and deck-src/met/meta.json.
"""
import json
import os
import sys
import time
import urllib.request

API = "https://collectionapi.metmuseum.org/public/collection"
UA = {"User-Agent": "OpenCodenames-deck-builder/0.1 (game asset pipeline)"}
ROOT = os.path.join(os.getcwd(), "deck-src", "met")


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else "Grandville"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    os.makedirs(ROOT, exist_ok=True)
    ids, offset = [], 0
    while len(ids) < limit:
        page = get_json(f"{API}/v1.1/search?q={urllib.parse.quote(query)}&hasImages=true&limit=100&offset={offset}")
        batch = page.get("objectIDs") or []
        if not batch:
            break
        ids += batch
        offset += len(batch)
        if offset >= page.get("total", 0):
            break
    ids = ids[:limit]
    print(f"{len(ids)} object ids")

    meta_path = os.path.join(ROOT, "meta.json")
    meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
    for i, oid in enumerate(ids):
        key = str(oid)
        if key in meta:
            continue
        try:
            o = get_json(f"{API}/v1/objects/{oid}")
        except Exception as e:  # noqa: BLE001 - keep going on individual failures
            print(f"  {oid}: {e}")
            continue
        artist = o.get("artistDisplayName", "")
        if not o.get("isPublicDomain") or "Grandville" not in artist or not o.get("primaryImageSmall"):
            meta[key] = {"skip": True}
            continue
        entry = {
            "objectID": oid,
            "title": o.get("title"),
            "artist": artist,
            "date": o.get("objectDate"),
            "medium": o.get("medium"),
            "portfolio": o.get("portfolio") or o.get("creditLine"),
            "objectURL": o.get("objectURL"),
            "image": o.get("primaryImage"),
            "imageSmall": o.get("primaryImageSmall"),
            "license": "CC0 1.0 (The Met Open Access, public domain)",
        }
        path = os.path.join(ROOT, f"{oid}.jpg")
        try:
            download(entry["imageSmall"], path)
            meta[key] = entry
            print(f"  [{i + 1}/{len(ids)}] {oid} {entry['medium']} — {entry['title'][:70]}")
        except Exception as e:  # noqa: BLE001
            print(f"  {oid}: download failed {e}")
        time.sleep(0.15)
        if i % 20 == 0:
            json.dump(meta, open(meta_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    json.dump(meta, open(meta_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    kept = [m for m in meta.values() if not m.get("skip")]
    print(f"done: {len(kept)} public-domain Grandville images in {ROOT}")


if __name__ == "__main__":
    import urllib.parse  # noqa: E402

    main()
