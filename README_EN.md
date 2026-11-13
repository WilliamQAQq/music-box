<div align="center">

# 🎺 GitHub Music Box · Victorian Phonograph Salon

**A Victorian Vinyl Gramophone Salon Hosted on GitHub Pages**  
*Zero Backend · Framework-Free · Automated ID3 Tag & Synced LRC Lyrics Cloud Record Cabinet*

[**简体中文**](README.md) · **English**

[![Live Salon](https://img.shields.io/badge/%E2%96%B6_Listen_Live-Victorian_Salon-d4a64a?style=for-the-badge&labelColor=24150e)](https://williamqaqq.github.io/music-box/)
[![Tracks](https://img.shields.io/badge/Records-197_Tracks-a8333a?style=for-the-badge&labelColor=24150e)](music.json)
[![Genres](https://img.shields.io/badge/Collections-18_Curated_Genres-4d8a88?style=for-the-badge&labelColor=24150e)](#-curated-record-collections-18-editions)
[![Lyrics](https://img.shields.io/badge/Scrolling_Lyrics-Synced_Bilingual_LRC-88507c?style=for-the-badge&labelColor=24150e)](lyrics.json)

### 👉 [Enter the Live Phonograph Salon: https://williamqaqq.github.io/music-box/](https://williamqaqq.github.io/music-box/)

</div>

---

## ✨ Salon Preview

<p align="center">
  <img src=".github/assets/preview-desktop.webp" alt="GitHub Music Box Desktop Victorian Gramophone & Synced Bilingual Lyrics Preview" width="100%">
</p>

<details>
<summary>📱 Click to expand Mobile "Libretto Scroll" Preview</summary>
<br>
<p align="center">
  <img src=".github/assets/preview-mobile.webp" alt="GitHub Music Box Mobile Scrolling Lyrics Drawer Preview" width="360">
</p>
</details>

---

## 🏛️ Key Highlights

- **Victorian Vinyl Gramophone Aesthetic**: Damask wallpaper motifs, walnut-and-brass cabinet framing, a spinning vinyl platter with an animated dropping tonearm, and a responsive layout that adapts from a two-column desktop salon to a slide-up mobile drawer.
- **18 Curated Record Collections & National Anthem Editions**: **197 tracks across 148 artists**, organized into 11 salon genres and 7 dedicated National Anthem & Military March editions (China, USA, Russia, France, Germany, Japan, United Kingdom). The shelf features an interactive "All / Salon Genres / Anthems & Marches" sub-filter, supports single-click sequential and shuffle playback, and seamlessly switches between **By Genre / By Artist / All Tracks** views.
- **Time-Synced Scrolling Lyrics (Victorian Libretto Folio)**:
  - **155 vocal & analog-broadcast tracks** feature line-by-line `[mm:ss.xx]` `.lrc` synchronized lyrics (**all 109 foreign-language tracks include bilingual Chinese translations**, toggleable via the `译` button), while **42 instrumental tracks** display a dedicated `INSTRUMENTAL` plaque.
  - **Auto-Scroll + Free Manual Browsing**: Lyrics smoothly center on the active line as the music plays. Scrolling manually via mouse wheel, touch, keyboard, or scrollbar automatically pauses auto-follow and surfaces a **"↻ Return to Current Line"** button (or auto-resumes after 5.5 seconds of inactivity).
  - **Click-to-Seek**: Click any timestamped lyric line to jump straight to that moment in the recording.
- **Zero API Limits · Lazy Lyrics · PWA Offline Cache & Smart Preload**: Instant boot from same-origin [`music.json`](music.json) paired with 64-bit FNV-1a library signatures; [`lyrics.json`](lyrics.json) now loads strictly on demand upon track playback (zero cold-boot lyric transfer); [`sw.js`](sw.js) and [`manifest.webmanifest`](manifest.webmanifest) deliver Range-safe offline track caching, while **⚙️ Cabinet Settings** connects any public/private GitHub repo.
- **Personal Collections, Resume Bar & Timestamped Deep Links**:
  - Dedicated **♥ Personal Collections** (`Favorites` + 45-track `Recent History`) synced with heart buttons (`F` shortcut), using Keyed DOM reuse across both the playlist and Queue Drawer for flicker-free updates;
  - Automatic **Resume Playback Bar** on return visits, plus one-click copy of `#track=...&t=...` share deep links opening directly to the current timestamp.
- **Phonograph Studio Popover (`E` shortcut / `调` Console Button)**:
  - **Live Brass Spectrum & 3-Band EQ**: Real-time Canvas spectrum analyzer (automatically pauses frame loops when hidden, scrolled offscreen, or paused), paired with a bypassable 3-band vintage EQ (110Hz / 1.1kHz / 7.5kHz) + 5 presets (`Flat / Warm / Jazz / Rock / Vocal`) and independent Vinyl/Synth mix sliders;
  - **Pitch-Preserving Speed, Crossfade, Sleep Timer & A-B Loop**: `0.75x–1.5x` turntable speed, `0/2/4/6s` track Crossfade, A-B loop practice (`[` / `]` / `\`), and `End of Track / 15 / 30 / 60m` Sleep Timer with 10-second gentle fadeout.
- **In-Panel Lyric Search & `.lrc` Export**: Libretto panel adds live keyword filtering (`搜`) and single-click `.lrc` file export (`导`, optionally including bilingual lines).
- **Interactive Play Queue & Multi-Token Search**: Enqueue any track as **Play Next (`+`)** right from the list or manage the live order (jump, promote to next, remove, reshuffle, clear upcoming) in the slide-over **Queue Drawer (`Q`)**. Toolbar search supports space-separated multi-keyword `AND` filtering with debounced input, one-click clear (`×`), and a quick **Locate Current Track (`定位`)** button.
- **Realistic Vinyl Record Emulation (Web Audio DSP)**: Toggle via shortcut `V` or the **"胶"** button (dynamically fades out and disconnects bypassed DSP branches & surface noise generators when turned off for zero idle CPU overhead):
  - **Vintage Frequency Shaping**: High-pass low-end cleanup, +2.2dB warm low-shelf richness, and a 6.8kHz smooth roll-off eliminating digital sibilance;
  - **Tube / Cartridge Saturation**: Asymmetric even-harmonic warmth blended with soft `tanh` clipping and exact zero-point DC normalization;
  - **Turntable Pitch Drift (Wow & Flutter)**: 33.3 RPM cyclical speed drift (0.555 Hz) and mechanical motor jitter for an unmistakably human, organic vinyl breathing;
  - **Surface Noise & Crackles**: Procedurally synthesized 6-second stereo groove friction rumble with dust crackles and cosine loop-seam crossfading (click-free continuous loop), illuminating the tonearm with a warm golden glow.
- **Analog Poly-Synthesizer Emulation (Web Audio Poly-Synth DSP)**: Toggle via the **"合"** button or shortcut `S` (dynamically stops & disconnects LFOs/branches on bypass; stackable with Vinyl mode):
  - **Dual Asynchronous LFO 6-Stage Allpass PWM Matrix**: Dual odd/even asynchronous LFOs modulate a 6-stage pure linear allpass phase-dispersion cascade mixed 50%/50% with the dry signal for lush, phase-animated PWM shimmer with zero nonlinear intermodulation noise;
  - **Dual Formant Sculpting, Air Shelf & 24dB/oct Cascaded Moog Ladder VCF**: Shapes 500Hz and 1.28kHz electronic formants plus a gentle 7.4kHz air shelf into a dual-cascaded 24dB/oct resonant low-pass filter swept smoothly by a sine LFO;
  - **3-Voice Juno-60 Unison Ensemble Chorus & Velvet Echo**: Pre-filtered at 3.8kHz into left, right, and center pitch-detuned BBD unison voices plus a band-limited (220Hz–1.9kHz) space echo for a wide, noise-free retro synth transformation.
- **Refined Playback & Mobile Engineering**: Native `Media Session API` integration, true Fisher-Yates shuffle history, 3-mode repeat (`Off / All / One`), safe-area notch padding, generous coarse-pointer touch targets, and automatic skip-circuit-breaker on network errors.

---

## 💿 Curated Record Collections (18 Editions)

### 🎷 Salon Genres (11 Collections)

| Collection | Featured Artists | Curatorial Notes | Tracks |
| :--- | :--- | :--- | :---: |
| **古典沙龙 · 剧场礼乐**<br>*(Classical Salon & Tango)* | Erik Satie · Pachelbel's Canon · Chopin / Debussy / Beethoven · Caruso / Pavarotti · Red Army Choir | Chamber cello & piano, vintage Russian and Argentine tangos, and choral marches | **19** |
| **黄金年代 · 爵士名伶**<br>*(Golden Era Vocal Jazz)* | Billie Holiday · Ella Fitzgerald · Chet Baker · Julie London | 1930s–60s smoky jazz divas, crooners, and velvet swing standards | **18** |
| **交响爵士 · 浪漫夜曲**<br>*(Symphonic & Night Jazz)* | Laufey & Iceland Symphony Orchestra · Anthony Lazaro | Contemporary vocal jazz interwoven with lush orchestral arrangements | **16** |
| **先锋浪潮 · 独立摇滚**<br>*(Indie Rock & Post-Rock)* | Omnipotent Youth Society · No Party For Cao Dong · Hedgehog · Wang Wen | Contemporary Chinese indie bands, post-rock instrumentals, and synth-wave | **15** |
| **赤焰岁月 · 华语摇滚**<br>*(Chinese Rock Pioneers)* | Cui Jian · Tang Dynasty · Dou Wei · Black Panther · Second Hand Rose · Lo Ta-yu | Foundational anthems and raw live energy from the golden age of Chinese rock | **13** |
| **世界民谣 · 万国乡音**<br>*(World Folk Heritage)* | Simon & Garfunkel · Milva · Pedro Infante · Youn Sun Nah · Yuko Takahashi | Traditional folk ballads from 12 regions (England, Scotland, Ireland, FR, DE, IT, CU, MX, US, CN, JP, KR) | **12** |
| **暗夜怪谈 · 模拟恐怖**<br>*(Analog Horror & Liminal)* | The Caretaker · Local 58 · Kane Pixels · Mandela Catalogue · IBM 7094 | Liminal Backrooms ambience, 1961 computer vocal synthesis, hauntological 78 RPMs & emergency broadcast tapes | **10** |
| **流金热浪 · 时代新声**<br>*(Modern Viral & Pop Hits)* | Billie Eilish · Lady Gaga & Bruno Mars · ROSÉ · Kendrick Lamar · Wen Yixin | Recent global chart-toppers and contemporary Chinese viral pop hits | **10** |
| **蓝调之音 · 器乐爵士**<br>*(Instrumental Jazz & Cool Bop)* | Miles Davis · John Coltrane · Ryo Fukui · Glenn Miller | Late-night trumpet, saxophone, and piano trio improvisations & big band swing | **9** |
| **灵魂低吟 · 节奏蓝调**<br>*(Classic Soul & R&B)* | Bill Withers · Etta James · Sam Cooke · David Tao | Warm, heartfelt soul classics, blues ballads, and rhythm & blues grooves | **6** |
| **街巷叙事 · 民谣流行**<br>*(Urban Folk & Ballads)* | Vadim Kazachenko · Angang · Chen Doujiang · Ren Haoming | Intimate acoustic storytelling, retro Estrada & folk-pop ballads | **4** |

### 🎺 National Anthems & Military Marches (7 Nations)

| Country Edition | Featured Tracks | Highlights | Tracks |
| :--- | :--- | :--- | :---: |
| 🇨🇳 **国歌军乐 · 中国**<br>*(China Anthems & Marches)* | March of the Volunteers · The East Is Red · March of 8th Route Army · Defend the Yellow River | Historic brass band anthem, 1939 Yan'an battle recordings, Yellow River Cantata & revolutionary marches | **10** |
| 🇺🇸 **国歌军乐 · 美国**<br>*(USA Anthems & Marches)* | The Star-Spangled Banner · Semper Fidelis · The Washington Post · The Liberty Bell · Anchors Aweigh | John Philip Sousa ceremonial brass marches, USNA choir chorales & Armed Forces hymns | **10** |
| 🇷🇺 **国歌军乐 · 俄罗斯**<br>*(Russia & Soviet Marches)* | State Anthem of the USSR · The Sacred War · Farewell of Slavianka · Warszawianka · March of Enthusiasts | Powerful Red Army Choir recordings, industrial youth anthems & heroic military marches | **10** |
| 🇫🇷 **国歌军乐 · 法国**<br>*(France Anthems & Marches)* | La Marseillaise · Le Chant du départ · Le Chant des Partisans · Sambre-et-Meuse | French Revolutionary brass fanfares, First Empire anthem & Garde Républicaine chorus | **10** |
| 🇩🇪 **国歌军乐 · 德国**<br>*(Germany Traditional Marches)* | Das Lied der Deutschen · Erika · Preußens Gloria · Alte Kameraden · Königgrätzer · Wacht am Rhein | Classical European ceremonial brass repertoire, marching soldier songs & Prussian infantry brass | **10** |
| 🇯🇵 **国歌军乐 · 日本**<br>*(Japan Ceremonial Marches)* | Kimigayo · Gunkan Kōshinkyoku · Review March · Yuki no Shingun · Roei no Uta | Vintage Meiji/Taisho/Showa 78 RPM gramophone brass marches, military choirs & imperial anthem | **10** |
| 🇬🇧 **国歌军乐 · 英国**<br>*(UK Anthems & Marches)* | God Save the King · Rule, Britannia! · The British Grenadiers · Colonel Bogey · Land of Hope and Glory | Band of the Grenadier Guards, Edwardian diva Clara Butt 78 RPM & Royal Navy war standards | **5** |

---

## ⌨️ Keyboard Shortcuts

| Key | Action | Key | Action |
| :---: | :--- | :---: | :--- |
| `Space` | Play / Pause | `N` / `P` | Next / Previous track |
| `←` / `→` | Seek backward / forward 5s | `M` | Mute / Unmute |
| `↑` / `↓` | Volume +5% / -5% | `L` | Toggle scrolling lyrics panel |
| `V` | Toggle vinyl record emulation | `S` | Toggle synthesizer resynthesis |
| `E` | Toggle Phonograph Studio popover | `F` | Favorite / Unfavorite track |
| `Q` | Toggle play queue drawer | `[` / `]` / `\` | Set A-B loop A / B / Clear |
| `Esc` | Close active overlay / modal | | |

---

## 📦 Adding Music & Automated Workflow

This project is 100% static with zero build steps. To add new tracks, simply drop audio files (`.mp3`, `.m4a`, `.flac`, `.ogg`, `.wav`, etc., optionally alongside matching `.lrc` files or folder cover images) into [`music/`](music) and push:

```bash
git pull --rebase
git add .
git commit -m "music: add new tracks"
git push
```

Once pushed, the GitHub Actions workflow [`.github/workflows/update-music.yml`](.github/workflows/update-music.yml) automatically runs [`.github/gen_music_json.py`](.github/gen_music_json.py) to:
1. Extract embedded ID3 artist, album, title, genre, and `USLT` lyrics tags via `mutagen` and assign the track to its curated style collection;
2. Search and match time-synced `.lrc` lyrics online for newly added songs;
3. Commit the updated [`music.json`](music.json) and [`lyrics.json`](lyrics.json) back to `main` and trigger a GitHub Pages deployment.

### Connect Your Own Repository or Fork
- **Switch Source on the Fly**: Click **⚙️ Cabinet Settings** in the top-right corner of the player and enter any GitHub `Owner` and `Repo` (plus an optional `ghp_` token stored only in your browser's `localStorage` for private repositories).
- **Deploy Your Own Salon**: Fork this repository → replace tracks in [`music/`](music) and update `DEFAULT_SETTINGS` in [`app.js`](app.js) → enable GitHub Pages (`Deploy from a branch: main / root`) in your repository settings.

---

## 🗂️ Repository Structure

```text
music-box/
├── README.md                       # Chinese repository showcase homepage
├── README_EN.md                    # English repository showcase homepage
├── index.html                      # Player markup (Victorian 2-column salon, Studio popover & Queue drawer)
├── style.css                       # Victorian theme, safe-area padding & coarse-pointer responsiveness
├── manifest.webmanifest            # PWA installable web app manifest
├── sw.js                           # Service Worker (SWR app shell & Range-safe audio caching)
├── app.js                          # Main orchestrator (Keyed DOM list/queue, preloader, Crossfade & hotkeys)
├── js/
│   ├── catalog-data.js             # Genre mappings, FNV-1a signature, deep links, LRC export & search
│   ├── user-state.js               # Personal state controller (Favorites, Recent, Resume, Sleep, A-B Loop)
│   ├── library-loader.js           # Library loader & settings modal (music.json / GitHub API fallback)
│   ├── audio-fx.js                 # Web Audio DSP (Vinyl, Poly-Synth, 3-band EQ, Analyser & Fade bus)
│   ├── lyrics.js                   # Lazy-loaded LRC parser, in-panel search & .lrc export engine
│   └── studio-ui.js                # Studio popover controller (Canvas spectrum, EQ, speed, timer, share)
├── tests/                          # Node unit tests & Playwright headless Chromium E2E test suite
├── music.json                      # Track manifest (title / artist / album / genre / relative path)
├── lyrics.json                     # Synced LRC lyrics catalog (lyrics / translations / instrumental flags)
├── music/                          # Audio files directory (currently 197 tracks)
├── AGENTS.md                       # Technical architecture & maintainer handover notes
└── .github/
    ├── assets/                     # High-DPI WebP preview screenshots for README
    ├── gen_music_json.py           # ID3 tag scanner, genre classifier & online lyrics fetcher
    └── workflows/update-music.yml  # GitHub Actions workflow triggered on music/** pushes
```
