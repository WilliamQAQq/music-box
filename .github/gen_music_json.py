#!/usr/bin/env python3
"""Generate music.json (playlist manifest) by scanning the music/ folder.

Reads audio tags (artist/album/title/genre) when available and assigns curated
style playlist categories. Output: music.json at repo root, used by the web player.

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
    "Francis_Shaw_-_Military_March_(SkySound7.com).mp3": "Francis Shaw",
    "Mandela Catalogue_ Amazing Grace (Full Version).mp3": "Mandela Catalogue",
    "National Anthem- United States - Star Spangled Banner.mp3": "美国国歌",
    "United States of America National Anthem (Instrumental).mp3": "美国国歌",
}

# Curated style playlists mapped by artist name (exact match, case-insensitive).
ARTIST_GENRE = {
    # 1. 黄金年代 · 爵士名伶 (Golden Era Vocal Jazz & Crooners)
    "billie holiday": "黄金年代 · 爵士名伶",
    "chet baker": "黄金年代 · 爵士名伶",
    "dean martin": "黄金年代 · 爵士名伶",
    "dinah washington": "黄金年代 · 爵士名伶",
    "ella fitzgerald": "黄金年代 · 爵士名伶",
    "ella fitzgerald, paul weston and his orchestra": "黄金年代 · 爵士名伶",
    "etta jones": "黄金年代 · 爵士名伶",
    "john coltrane, johnny hartman": "黄金年代 · 爵士名伶",
    "julie london": "黄金年代 · 爵士名伶",
    "louis armstrong": "黄金年代 · 爵士名伶",
    "peggy lee": "黄金年代 · 爵士名伶",

    # 2. 交响爵士 · 浪漫夜曲 (Symphonic & Contemporary Vocal Jazz)
    "laufey, iceland symphony orchestra": "交响爵士 · 浪漫夜曲",
    "laufey": "交响爵士 · 浪漫夜曲",
    "anthony lazaro": "交响爵士 · 浪漫夜曲",

    # 3. 蓝调之音 · 器乐爵士 (Instrumental Jazz, Cool/Hard Bop & Swing)
    "duke ellington, john coltrane": "蓝调之音 · 器乐爵士",
    "glenn miller": "蓝调之音 · 器乐爵士",
    "lester young": "蓝调之音 · 器乐爵士",
    "lester young, oscar peterson trio": "蓝调之音 · 器乐爵士",
    "miles davis, john coltrane, bill evans": "蓝调之音 · 器乐爵士",
    "oliver nelson": "蓝调之音 · 器乐爵士",
    "ryo fukui": "蓝调之音 · 器乐爵士",
    "sidney bechet, muggsy spanier": "蓝调之音 · 器乐爵士",
    "berlioz, ted jasper": "蓝调之音 · 器乐爵士",

    # 4. 灵魂低吟 · 节奏蓝调 (Classic Soul, Blues & R&B)
    "bill withers": "灵魂低吟 · 节奏蓝调",
    "etta james": "灵魂低吟 · 节奏蓝调",
    "james brown": "灵魂低吟 · 节奏蓝调",
    "sam cooke": "灵魂低吟 · 节奏蓝调",
    "william bell": "灵魂低吟 · 节奏蓝调",
    "david tao": "灵魂低吟 · 节奏蓝调",

    # 5. 先锋浪潮 · 独立摇滚 (Chinese Indie Rock, Post-Rock & Synth-Punk)
    "万能青年旅店": "先锋浪潮 · 独立摇滚",
    "no party for cao dong": "先锋浪潮 · 独立摇滚",
    "刺猬hedgehog": "先锋浪潮 · 独立摇滚",
    "回春丹": "先锋浪潮 · 独立摇滚",
    "海龟先生": "先锋浪潮 · 独立摇滚",
    "蛙池": "先锋浪潮 · 独立摇滚",
    "當代電影大師": "先锋浪潮 · 独立摇滚",
    "wang wen": "先锋浪潮 · 独立摇滚",
    "发光曲线": "先锋浪潮 · 独立摇滚",
    "白紙扇（hardcore raver in tears）": "先锋浪潮 · 独立摇滚",
    "快乐老家": "先锋浪潮 · 独立摇滚",
    "vh (vast & hazy)": "先锋浪潮 · 独立摇滚",

    # 6. 赤焰岁月 · 华语摇滚 (Classic Chinese Rock Pioneers)
    "ado": "赤焰岁月 · 华语摇滚",
    "black panther": "赤焰岁月 · 华语摇滚",
    "dou wei": "赤焰岁月 · 华语摇滚",
    "second hand rose": "赤焰岁月 · 华语摇滚",
    "tang dynasty": "赤焰岁月 · 华语摇滚",
    "wang feng": "赤焰岁月 · 华语摇滚",
    "xtx (xie tianxiao)": "赤焰岁月 · 华语摇滚",
    "xu wei": "赤焰岁月 · 华语摇滚",
    "反光镜乐队": "赤焰岁月 · 华语摇滚",
    "崔健": "赤焰岁月 · 华语摇滚",
    "羅大佑": "赤焰岁月 · 华语摇滚",
    "陳明章, 王明輝": "赤焰岁月 · 华语摇滚",

    # 7. 街巷叙事 · 民谣流行 (Mandarin Folk & Pop)
    "暗杠": "街巷叙事 · 民谣流行",
    "一杯陈豆浆": "街巷叙事 · 民谣流行",
    "任浩铭, 黄勇": "街巷叙事 · 民谣流行",

    # 8. 古典沙龙 · 剧场礼乐 (Classical, Tango & Ceremonial)
    "benny martin/the wong janice": "古典沙龙 · 剧场礼乐",
    "carlos gardel": "古典沙龙 · 剧场礼乐",
    "erik satie/philippe entremont": "古典沙龙 · 剧场礼乐",
    "francis shaw": "古典沙龙 · 剧场礼乐",
    "mandela catalogue": "古典沙龙 · 剧场礼乐",
    "pyotr leshchenko": "古典沙龙 · 剧场礼乐",
    "the red army choir": "古典沙龙 · 剧场礼乐",
    "юрий щербаков": "古典沙龙 · 剧场礼乐",
    "美国国歌": "古典沙龙 · 剧场礼乐",
}

MANUAL_GENRE = {}


def infer_genre_from_tag(raw_genre):
    if not raw_genre:
        return ""
    g = raw_genre.lower()
    if any(k in g for k in ("vocal jazz", "crooner", "torch")):
        return "黄金年代 · 爵士名伶"
    if any(k in g for k in ("jazz", "swing", "bop", "ragtime", "bossa")):
        return "蓝调之音 · 器乐爵士"
    if any(k in g for k in ("soul", "r&b", "rnb", "blues", "funk", "motown")):
        return "灵魂低吟 · 节奏蓝调"
    if any(k in g for k in ("indie", "post-rock", "shoegaze", "alternative", "synth")):
        return "先锋浪潮 · 独立摇滚"
    if any(k in g for k in ("rock", "metal", "punk", "grunge")):
        return "赤焰岁月 · 华语摇滚"
    if any(k in g for k in ("classical", "tango", "orchestra", "piano", "march", "hymn", "anthem")):
        return "古典沙龙 · 剧场礼乐"
    if any(k in g for k in ("folk", "pop", "ballad", "acoustic", "singer")):
        return "街巷叙事 · 民谣流行"
    return raw_genre


def read_tags(path):
    """Read artist/album/title/genre tags across mp3/m4a/flac/ogg/opus."""
    try:
        import mutagen
        t = mutagen.File(path, easy=True)
        if t is None or not t.tags:
            return "", "", "", ""

        def first(key):
            v = t.tags.get(key) or [""]
            return str(v[0]).strip()

        return first("artist"), first("album"), first("title"), first("genre")
    except Exception:
        return "", "", "", ""


def resolve_genre(fname, artist, raw_genre):
    if fname in MANUAL_GENRE:
        return MANUAL_GENRE[fname]
    if artist:
        mapped = ARTIST_GENRE.get(artist.strip().lower())
        if mapped:
            return mapped
    inferred = infer_genre_from_tag(raw_genre)
    return inferred or "其他典藏"


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
                artist, album, title, raw_genre = read_tags(os.path.join(root, fname))
                if not artist:
                    artist = MANUAL_ARTIST.get(fname, "")
                if not title:
                    title = os.path.splitext(fname)[0]
                    title = title.replace("_", " ").replace("-", " ").strip()
                    title = " ".join(title.split())
                for suffix in (" spotdown.org", " (SPOTISAVER)"):
                    if title.endswith(suffix):
                        title = title[: -len(suffix)].strip()
                genre = resolve_genre(fname, artist, raw_genre)
                tracks.append({
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "genre": genre,
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
        key=lambda t: (t["artist"].lower(), t["artist"], t["title"].lower())
    )

    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(tracks, fh, ensure_ascii=False, indent=2)

    artists = len({t["artist"] for t in tracks if t["artist"]})
    genres = len({t["genre"] for t in tracks if t["genre"]})
    print("generated %s with %d tracks (%d artists, %d genres)" % (OUT, len(tracks), artists, genres))


if __name__ == "__main__":
    sys.exit(main())
