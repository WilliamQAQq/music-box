#!/usr/bin/env python3
"""Generate music.json (playlist manifest) by scanning the music/ folder.

Run: python .github/gen_music_json.py
Output: music.json at repo root, used by the web player.
"""
import json
import os
import sys

MUSIC_DIR = "music"
OUT = "music.json"

AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac", ".webm"}
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
COVER_NAMES = {"cover", "folder", "album", "albumart", "artwork", "front", "poster"}


def main():
    if not os.path.isdir(MUSIC_DIR):
        print("music/ dir not found, nothing to do")
        return

    tracks = []
    covers = {}

    for root, dirs, files in os.walk(MUSIC_DIR):
        dirs.sort()
        for fname in sorted(files):
            ext = os.path.splitext(fname)[1].lower()
            rel = os.path.join(root, fname).replace("\\", "/")
            d = os.path.dirname(rel)
            if ext in AUDIO_EXTS:
                title = os.path.splitext(fname)[0]
                title = title.replace("_", " ").replace("-", " ").strip()
                title = " ".join(title.split())
                tracks.append({"title": title, "url": rel, "dir": d})
            elif ext in IMG_EXTS:
                base = os.path.splitext(fname)[0].lower()
                if base in COVER_NAMES or d not in covers:
                    covers[d] = rel

    for t in tracks:
        d = t["dir"]
        while d:
            if d in covers:
                t["cover"] = covers[d]
                break
            d = os.path.dirname(d)

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(tracks, fh, ensure_ascii=False, indent=2)

    print("generated %s with %d tracks" % (OUT, len(tracks)))


if __name__ == "__main__":
    sys.exit(main())
