#!/usr/bin/env python3
"""Generate music.json (playlist manifest) by scanning the music/ folder.

Reads ID3 tags (artist/album/title) when available. Output: music.json at repo
root, used by the web player.

Run: python .github/gen_music_json.py
"""
import json
import os
import sys

MUSIC_DIR = "music"
OUT = "music.json"

AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac", ".webm"}
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
COVER_NAMES = {"cover", "folder", "album", "albumart", "artwork", "front", "poster"}

# Files without ID3 tags get a manual artist (key = exact filename).
MANUAL_ARTIST = {
    "Augustin Hadelich plays Por Una Cabeza by Carlos Gardel (arr. Hadelich) - Augustin Hadelich.mp3": "Augustin Hadelich",
    "Francis_Shaw_-_Military_March_(SkySound7.com).mp3": "Francis Shaw",
    "Mandela Catalogue_ Amazing Grace (Full Version).mp3": "Mandela Catalogue",
}


def read_id3(path):
    try:
        from mutagen.easyid3 import EasyID3
        t = EasyID3(path)
        artist = (t.get("artist") or [""])[0].strip()
        album = (t.get("album") or [""])[0].strip()
        title = (t.get("title") or [""])[0].strip()
        return artist, album, title
    except Exception:
        return "", "", ""


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
                artist, album, title = read_id3(os.path.join(root, fname))
                if not artist:
                    artist = MANUAL_ARTIST.get(fname, "")
                if not title:
                    title = os.path.splitext(fname)[0]
                    title = title.replace("_", " ").replace("-", " ").strip()
                    title = " ".join(title.split())
                if title.endswith(" spotdown.org"):
                    title = title[: -len(" spotdown.org")]
                tracks.append({
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "url": rel,
                    "dir": d,
                })
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

    tracks.sort(
        key=lambda t: (t["artist"].lower(), t["title"].lower())
    )

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(tracks, fh, ensure_ascii=False, indent=2)

    artists = len({t["artist"] for t in tracks if t["artist"]})
    print("generated %s with %d tracks (%d artists)" % (OUT, len(tracks), artists))


if __name__ == "__main__":
    sys.exit(main())
