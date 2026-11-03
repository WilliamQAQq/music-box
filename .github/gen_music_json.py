#!/usr/bin/env python3
"""Generate music.json (playlist manifest) by scanning the music/ folder.

Reads audio tags (artist/album/title/genre) when available and assigns curated
style playlist categories. Output: music.json at repo root, used by the web player.

Run: python .github/gen_music_json.py
"""
import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request

MUSIC_DIR = "music"
OUT = "music.json"
LYRICS_OUT = "lyrics.json"

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
    "feodor chaliapin": "古典沙龙 · 剧场礼乐",
    "enrico caruso": "古典沙龙 · 剧场礼乐",
    "enrico caruso, alma gluck": "古典沙龙 · 剧场礼乐",
    "luciano pavarotti": "古典沙龙 · 剧场礼乐",
    "arthur rubinstein": "古典沙龙 · 剧场礼乐",
    "claude debussy": "古典沙龙 · 剧场礼乐",
    "ludwig van beethoven": "古典沙龙 · 剧场礼乐",
    "antonio vivaldi": "古典沙龙 · 剧场礼乐",
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


def read_tags_and_info(path):
    """Read artist/album/title/genre tags, duration, and embedded lyrics."""
    try:
        import mutagen
        raw = mutagen.File(path)
        dur = round(raw.info.length, 1) if raw and getattr(raw, "info", None) else 0
        embedded_lrc = ""
        if raw and getattr(raw, "tags", None):
            for k in raw.tags.keys():
                if k.startswith(("USLT", "©lyr", "LYRICS")):
                    val = raw.tags[k]
                    embedded_lrc = str(getattr(val, "text", val)).strip()
                    if embedded_lrc:
                        break
        t = mutagen.File(path, easy=True)
        if t is None or not t.tags:
            return "", "", "", "", dur, embedded_lrc

        def first(key):
            v = t.tags.get(key) or [""]
            return str(v[0]).strip()

        return first("artist"), first("album"), first("title"), first("genre"), dur, embedded_lrc
    except Exception:
        return "", "", "", "", 0, ""


META_TAG_RE = re.compile(r"^\[(id|ar|ti|al|by|hash|sign|qq|total|re|ve):.*\]$", re.I)
TIME_TAG_RE = re.compile(r"\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]")


def clean_lrc_text(text):
    if not text:
        return ""
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    out = []
    for ln in text.split("\n"):
        s = ln.strip()
        if not s or META_TAG_RE.match(s) or s == "[offset:0]":
            continue
        out.append(s)
    return "\n".join(out)


def fetch_online_lyrics(artist, title, album, target_dur):
    """Best-effort online LRC lookup for newly uploaded tracks."""
    # 1. NetEase Cloud Music
    try:
        q = ("%s %s" % (artist, title)).strip()
        data = urllib.parse.urlencode({"s": q, "type": 1, "offset": 0, "limit": 5}).encode("utf-8")
        req = urllib.request.Request(
            "https://music.163.com/api/search/get",
            data=data,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com", "Cookie": "NMTID=1; os=pc"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            songs = (json.loads(r.read().decode("utf-8")).get("result") or {}).get("songs") or []
        for s in songs[:3]:
            sdur = (s.get("duration") or 0) / 1000.0
            if target_dur > 0 and abs(sdur - target_dur) > 12:
                continue
            sid = s["id"]
            lurl = "https://music.163.com/api/song/lyric?os=pc&id=%s&lv=-1&kv=-1&tv=-1" % sid
            lreq = urllib.request.Request(lurl, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com"})
            with urllib.request.urlopen(lreq, timeout=8) as lr:
                lres = json.loads(lr.read().decode("utf-8"))
            if lres.get("nolyric"):
                return {"type": "instrumental"}
            lrc = clean_lrc_text((lres.get("lrc") or {}).get("lyric") or "")
            tlrc = clean_lrc_text((lres.get("tlyric") or {}).get("lyric") or "")
            if "纯音乐，请欣赏" in lrc or "此歌曲为没有填词的纯音乐" in lrc:
                return {"type": "instrumental"}
            if len(TIME_TAG_RE.findall(lrc)) >= 3:
                entry = {"type": "synced", "lrc": lrc}
                if len(TIME_TAG_RE.findall(tlrc)) >= 3:
                    entry["tlyric"] = tlrc
                return entry
    except Exception:
        pass

    # 2. Kugou LRC
    try:
        kw = ("%s %s" % (artist, title)).strip()
        u = "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=" + urllib.parse.quote(kw) + "&page=1&pagesize=4"
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as r:
            info = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("info") or []
        for item in info[:2]:
            sdur = item.get("duration") or 0
            if target_dur > 0 and abs(sdur - target_dur) > 15:
                continue
            ku2 = "http://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=%s&duration=%d&hash=%s&album_audio_id=" % (
                urllib.parse.quote(item.get("filename", "")),
                int(sdur * 1000),
                item.get("hash", ""),
            )
            with urllib.request.urlopen(urllib.request.Request(ku2, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as r2:
                cands = json.loads(r2.read().decode("utf-8")).get("candidates") or []
            if cands:
                ku3 = "http://lyrics.kugou.com/download?ver=1&client=pc&id=%s&accesskey=%s&fmt=lrc&charset=utf8" % (
                    cands[0]["id"],
                    cands[0]["accesskey"],
                )
                with urllib.request.urlopen(urllib.request.Request(ku3, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as r3:
                    dl = json.loads(r3.read().decode("utf-8"))
                lrc = clean_lrc_text(base64.b64decode(dl.get("content", "")).decode("utf-8", errors="replace"))
                if "纯音乐，请欣赏" in lrc:
                    return {"type": "instrumental"}
                if len(TIME_TAG_RE.findall(lrc)) >= 3:
                    return {"type": "synced", "lrc": lrc}
    except Exception:
        pass

    # 3. api.lrc.cx fallback
    try:
        params = {"title": title, "artist": artist}
        if album and album != "Unknown Album":
            params["album"] = album
        u = "https://api.lrc.cx/lyrics?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "MusicBox/1.0"}), timeout=8) as r:
            lrc = clean_lrc_text(r.read().decode("utf-8", errors="replace"))
        if len(TIME_TAG_RE.findall(lrc)) >= 3:
            return {"type": "synced", "lrc": lrc}
    except Exception:
        pass
    return None


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

    existing_lyrics = {}
    if os.path.isfile(LYRICS_OUT):
        try:
            with open(LYRICS_OUT, "r", encoding="utf-8") as lf:
                existing_lyrics = json.load(lf) or {}
        except Exception:
            existing_lyrics = {}

    tracks = []
    covers = {}
    new_lyrics = {}

    for root, dirs, files in os.walk(MUSIC_DIR):
        dirs.sort()
        for fname in sorted(files):
            ext = os.path.splitext(fname)[1].lower()
            rel = os.path.join(root, fname).replace("\\", "/")
            d = os.path.dirname(rel)
            if ext in AUDIO_EXTS:
                full_path = os.path.join(root, fname)
                artist, album, title, raw_genre, dur, embedded_lrc = read_tags_and_info(full_path)
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

                # Sidecar .lrc next to audio overrides or populates lyrics
                sidecar = os.path.splitext(full_path)[0] + ".lrc"
                if os.path.isfile(sidecar):
                    with open(sidecar, "r", encoding="utf-8", errors="replace") as sf:
                        new_lyrics[rel] = {"type": "synced", "lrc": clean_lrc_text(sf.read())}
                elif rel in existing_lyrics:
                    new_lyrics[rel] = existing_lyrics[rel]
                elif embedded_lrc:
                    new_lyrics[rel] = {"type": "synced", "lrc": clean_lrc_text(embedded_lrc)}
                else:
                    fetched = fetch_online_lyrics(artist, title, album, dur)
                    if fetched:
                        new_lyrics[rel] = fetched
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

    ordered_lyrics = {t["url"]: new_lyrics[t["url"]] for t in tracks if t["url"] in new_lyrics}
    with open(LYRICS_OUT, "w", encoding="utf-8", newline="\n") as lf:
        json.dump(ordered_lyrics, lf, ensure_ascii=False, separators=(",", ":"))

    artists = len({t["artist"] for t in tracks if t["artist"]})
    genres = len({t["genre"] for t in tracks if t["genre"]})
    print(
        "generated %s (%d tracks, %d artists, %d genres) and %s (%d entries)"
        % (OUT, len(tracks), artists, genres, LYRICS_OUT, len(ordered_lyrics))
    )


if __name__ == "__main__":
    sys.exit(main())
