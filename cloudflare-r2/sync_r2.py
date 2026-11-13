#!/usr/bin/env python3
"""Incrementally sync a local music folder to Cloudflare R2 and publish manifest.json / lyrics.json.

Reuses ID3 parsing, genre mapping, and online LRC lookup from .github/gen_music_json.py.
Uploaded objects are written to the configured R2 bucket using Wrangler CLI (--remote).

Examples:
  python cloudflare-r2/sync_r2.py --dry-run
  python cloudflare-r2/sync_r2.py --dir r2_music
  python cloudflare-r2/sync_r2.py --dir r2_music --prune --no-online
"""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
GEN_SCRIPT_PATH = os.path.join(REPO_ROOT, ".github", "gen_music_json.py")

spec = importlib.util.spec_from_file_location("gen_music_json", GEN_SCRIPT_PATH)
gen_music = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen_music)

MEDIA_MIME = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

KNOWN_CURATED_GENRES = set(gen_music.ARTIST_GENRE.values()) | set(gen_music.MANUAL_GENRE.values())
STATE_FILENAME = ".r2-sync-state.json"
LYRICS_CACHE_FILENAME = ".r2-lyrics-cache.json"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def resolve_wrangler_cmd():
    wrangler_bin = shutil.which("wrangler.cmd") or shutil.which("wrangler")
    if wrangler_bin:
        return [wrangler_bin]
    npx_bin = shutil.which("npx.cmd") or shutil.which("npx")
    if npx_bin:
        return [npx_bin, "wrangler"]
    raise RuntimeError("Neither wrangler nor npx was found on PATH. Install Node.js / Wrangler first.")


def run_wrangler(base_cmd, wrangler_args, dry_run=False):
    cmd = base_cmd + wrangler_args
    if dry_run:
        print("[dry-run]", " ".join(cmd))
        return
    proc = subprocess.run(cmd, cwd=REPO_ROOT, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Wrangler command failed with exit code {proc.returncode}: {' '.join(cmd)}")


def load_json_safe(path, default):
    if not os.path.isfile(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, type(default)) else default
    except Exception:
        return default


def scan_library(root_dir, no_online=False):
    existing_lyrics = load_json_safe(os.path.join(root_dir, LYRICS_CACHE_FILENAME), {})
    tracks = []
    covers = {}
    new_lyrics = {}
    media_files = {}  # key -> (abs_path, ext, sha256)

    if not os.path.isdir(root_dir):
        return tracks, new_lyrics, media_files

    for current_root, dirs, files in os.walk(root_dir):
        # Skip hidden folders (.git, .wrangler, etc.)
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for fname in sorted(files):
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            full_path = os.path.join(current_root, fname)
            rel_key = os.path.relpath(full_path, root_dir).replace("\\", "/")
            rel_dir = os.path.dirname(rel_key)

            if ext in gen_music.AUDIO_EXTS:
                artist, album, title, raw_genre, dur, embedded_lrc = gen_music.read_tags_and_info(full_path)
                if not artist:
                    artist = gen_music.MANUAL_ARTIST.get(fname, "")
                if not title:
                    title = os.path.splitext(fname)[0].replace("_", " ").replace("-", " ").strip()
                    title = " ".join(title.split())
                for suffix in (" spotdown.org", " (SPOTISAVER)"):
                    if title.endswith(suffix):
                        title = title[: -len(suffix)].strip()

                genre = gen_music.resolve_genre(fname, artist, raw_genre)
                if genre == "其他典藏" and rel_dir:
                    top_folder = rel_dir.split("/")[0]
                    if top_folder in KNOWN_CURATED_GENRES:
                        genre = top_folder

                tracks.append({
                    "name": fname,
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "genre": genre,
                    "path": rel_key,
                    "url": rel_key,
                    "dir": rel_dir,
                })
                media_files[rel_key] = (full_path, ext, sha256_file(full_path))

                sidecar = os.path.splitext(full_path)[0] + ".lrc"
                if os.path.isfile(sidecar):
                    with open(sidecar, "r", encoding="utf-8", errors="replace") as sf:
                        new_lyrics[rel_key] = {"type": "synced", "lrc": gen_music.clean_lrc_text(sf.read())}
                elif rel_key in existing_lyrics:
                    new_lyrics[rel_key] = existing_lyrics[rel_key]
                elif embedded_lrc:
                    new_lyrics[rel_key] = {"type": "synced", "lrc": gen_music.clean_lrc_text(embedded_lrc)}
                elif not no_online:
                    fetched = gen_music.fetch_online_lyrics(artist, title, album, dur)
                    if fetched:
                        new_lyrics[rel_key] = fetched
            elif ext in gen_music.IMG_EXTS:
                base = os.path.splitext(fname)[0].lower()
                if base in gen_music.COVER_NAMES or rel_dir not in covers:
                    covers[rel_dir] = rel_key
                media_files[rel_key] = (full_path, ext, sha256_file(full_path))

    referenced_covers = set()
    for t in tracks:
        d = t["dir"]
        while True:
            if d in covers:
                t["cover"] = covers[d]
                referenced_covers.add(covers[d])
                break
            if not d:
                break
            d = os.path.dirname(d)

    # Only keep cover images that are actually referenced by at least one track (or all images? Keeping referenced avoids stray junk)
    media_files = {
        k: v
        for k, v in media_files.items()
        if os.path.splitext(k)[1].lower() in gen_music.AUDIO_EXTS or k in referenced_covers
    }

    tracks.sort(key=lambda t: (t["artist"].lower(), t["artist"], t["title"].lower()))
    ordered_lyrics = {t["path"]: new_lyrics[t["path"]] for t in tracks if t["path"] in new_lyrics}
    return tracks, ordered_lyrics, media_files


def main(argv=None):
    parser = argparse.ArgumentParser(description="Sync local audio directory to Cloudflare R2 bucket.")
    parser.add_argument("--dir", default=os.path.join(REPO_ROOT, "r2_music"), help="Local R2 staging folder (default: r2_music/)")
    parser.add_argument("--bucket", default="music-box-audio", help="Target Cloudflare R2 bucket name")
    parser.add_argument("--config", default=os.path.join(SCRIPT_DIR, "wrangler.toml"), help="Path to wrangler.toml")
    parser.add_argument("--dry-run", action="store_true", help="Print planned uploads without calling R2")
    parser.add_argument("--force", action="store_true", help="Upload all media even if unchanged in .r2-sync-state.json")
    parser.add_argument("--prune", action="store_true", help="Delete remote objects removed from local --dir")
    parser.add_argument("--no-online", action="store_true", help="Skip online LRC API lookups")
    parser.add_argument("--publish-empty", action="store_true", help="Upload empty manifest.json / lyrics.json when dir is empty or absent")
    parser.add_argument("--max-storage-gb", type=float, default=8.0, help="Hard 80%% free-tier storage cap in GiB (default: 8.0 GiB of 10 GiB)")
    parser.add_argument("--skip-kv", action="store_true", help="Skip pushing storage byte count to Workers KV quota:storage:v1")
    args = parser.parse_args(argv)

    root_dir = os.path.abspath(args.dir)
    if not os.path.isdir(root_dir) and not args.dry_run and not args.publish_empty:
        print(f"Staging folder not found: {root_dir}")
        print("Create it and place audio files inside, or pass --publish-empty to initialize empty R2 manifests.")
        return 1

    tracks, ordered_lyrics, media_files = scan_library(root_dir, no_online=args.no_online)
    state_path = os.path.join(root_dir, STATE_FILENAME)
    prev_state = load_json_safe(state_path, {"files": {}})
    prev_files = prev_state.get("files") if isinstance(prev_state.get("files"), dict) else {}

    to_upload = []
    total_media_bytes = 0
    for rel_key, (abs_path, ext, digest) in sorted(media_files.items()):
        total_media_bytes += os.path.getsize(abs_path)
        if args.force or prev_files.get(rel_key) != digest:
            to_upload.append((rel_key, abs_path, MEDIA_MIME.get(ext, "application/octet-stream"), digest))

    to_prune = sorted(set(prev_files.keys()) - set(media_files.keys())) if args.prune else []

    manifest_bytes = json.dumps(tracks, ensure_ascii=False, indent=2).encode("utf-8")
    lyrics_bytes = json.dumps(ordered_lyrics, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    total_bytes = total_media_bytes + len(manifest_bytes) + len(lyrics_bytes)
    max_storage_bytes = int(max(0.1, args.max_storage_gb) * (1024 ** 3))
    used_mib = total_bytes / (1024 ** 2)
    cap_gib = max_storage_bytes / (1024 ** 3)
    pct_of_cap = (total_bytes / max_storage_bytes) * 100.0 if max_storage_bytes else 100.0

    print(
        f"Scanned {len(tracks)} track(s), {len(ordered_lyrics)} lyric entry/entries, "
        f"{len(to_upload)} media file(s) to upload, {len(to_prune)} to prune."
    )
    print(f"Storage budget: {used_mib:.2f} MiB / {cap_gib:.2f} GiB safety cap ({pct_of_cap:.1f}% of 80% free-tier limit)")

    if total_bytes >= max_storage_bytes:
        print(
            f"ABORTED: Planned bucket footprint ({used_mib:.2f} MiB) reaches/exceeds "
            f"{cap_gib:.2f} GiB (80% of 10 GiB R2 Free Tier). No files were uploaded."
        )
        return 2

    if args.dry_run:
        for rel_key, _, mime, _ in to_upload:
            print(f"[dry-run] PUT {args.bucket}/{rel_key} ({mime})")
        for rel_key in to_prune:
            print(f"[dry-run] DELETE {args.bucket}/{rel_key}")
        print(f"[dry-run] PUT {args.bucket}/manifest.json ({len(tracks)} tracks)")
        print(f"[dry-run] PUT {args.bucket}/lyrics.json ({len(ordered_lyrics)} entries)")
        if not args.skip_kv:
            print(f"[dry-run] KV PUT MUSIC_QUOTA_KV/quota:storage:v1 ({total_bytes} bytes)")
        return 0

    wrangler_cmd = resolve_wrangler_cmd()
    config_flags = ["--config", args.config] if os.path.isfile(args.config) else []

    next_files = dict(prev_files)
    try:
        for idx, (rel_key, abs_path, mime, digest) in enumerate(to_upload, start=1):
            print(f"[{idx}/{len(to_upload)}] Uploading {rel_key} ({mime})...")
            run_wrangler(
                wrangler_cmd,
                config_flags
                + [
                    "r2",
                    "object",
                    "put",
                    f"{args.bucket}/{rel_key}",
                    "--file",
                    abs_path,
                    "--ct",
                    mime,
                    "--cc",
                    "public, max-age=86400",
                    "--remote",
                ],
            )
            next_files[rel_key] = digest

        for rel_key in to_prune:
            print(f"Pruning remote object {rel_key}...")
            run_wrangler(
                wrangler_cmd,
                config_flags + ["r2", "object", "delete", f"{args.bucket}/{rel_key}", "--remote"],
            )
            next_files.pop(rel_key, None)
    finally:
        if os.path.isdir(root_dir) and next_files != prev_files:
            with open(state_path, "w", encoding="utf-8", newline="\n") as sf:
                json.dump({"files": next_files}, sf, ensure_ascii=False, indent=2)

    with tempfile.TemporaryDirectory() as tmpdir:
        manifest_tmp = os.path.join(tmpdir, "manifest.json")
        lyrics_tmp = os.path.join(tmpdir, "lyrics.json")
        storage_kv_tmp = os.path.join(tmpdir, "quota-storage.json")
        with open(manifest_tmp, "wb") as mf:
            mf.write(manifest_bytes)
        with open(lyrics_tmp, "wb") as lf:
            lf.write(lyrics_bytes)
        with open(storage_kv_tmp, "w", encoding="utf-8", newline="\n") as kf:
            json.dump(
                {
                    "bytes": total_bytes,
                    "objects": len(media_files) + 2,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
                kf,
            )

        print("Uploading manifest.json...")
        run_wrangler(
            wrangler_cmd,
            config_flags
            + [
                "r2",
                "object",
                "put",
                f"{args.bucket}/manifest.json",
                "--file",
                manifest_tmp,
                "--ct",
                "application/json; charset=utf-8",
                "--cc",
                "public, max-age=60",
                "--remote",
            ],
        )
        print("Uploading lyrics.json...")
        run_wrangler(
            wrangler_cmd,
            config_flags
            + [
                "r2",
                "object",
                "put",
                f"{args.bucket}/lyrics.json",
                "--file",
                lyrics_tmp,
                "--ct",
                "application/json; charset=utf-8",
                "--cc",
                "public, max-age=120",
                "--remote",
            ],
        )

        if not args.skip_kv:
            print("Updating MUSIC_QUOTA_KV storage footprint...")
            run_wrangler(
                wrangler_cmd,
                config_flags
                + [
                    "kv",
                    "key",
                    "put",
                    "quota:storage:v1",
                    "--path",
                    storage_kv_tmp,
                    "--binding",
                    "MUSIC_QUOTA_KV",
                    "--remote",
                ],
            )

    if os.path.isdir(root_dir):
        with open(state_path, "w", encoding="utf-8", newline="\n") as sf:
            json.dump({"files": next_files}, sf, ensure_ascii=False, indent=2)
        with open(os.path.join(root_dir, LYRICS_CACHE_FILENAME), "w", encoding="utf-8", newline="\n") as lcf:
            json.dump(ordered_lyrics, lcf, ensure_ascii=False, separators=(",", ":"))

    print("Cloudflare R2 sync completed cleanly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
