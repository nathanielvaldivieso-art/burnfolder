# Playback / autoplay investigation (living doc)

**Status:** active problem space — symptoms recur across Studio, public site, and lock-screen / closed-app listening.  
**Last updated:** 2026-09-04  
**Primary engine:** `shared/mux-playback.js`  
**Steel contract:** `.cursor/rules/studio-stream-playback.mdc`  
**Tests:** `npm test` → `test/playback-engine-lockscreen.js` + `test/playback-persist-smoke.js`  
**On-device diagnostics:** `shared/playback-debug.js` → `/studio/debug-playback.html` + `/api/playback-debug-log`

> **When this breaks again:** read this doc first. Do not invent a parallel player, dual-player “bridge,” or page-local advance loop. Fix or simplify the shared engine and the single queue entry path. Prefer deleting caveats over stacking them.

---

## 1. What users actually report

Three symptom families, often mixed in one report:

| Family | Typical wording | What it usually means |
|--------|-----------------|------------------------|
| **Stops / won’t autoplay next** | “SOMETIMES doesn’t go into FIRE ESCAPE”; “photonegative autoplay isn’t working”; “dies at IT DOESNT MATTER” | Queue missing next track, solo `playItem` instead of `playQueue`, advance blocked, or next track skipped so fast it feels like silence |
| **Skips** | Next song never heard; jumps over a track; album “teleports” | Sticky `ended` / inherited playhead after source swap advances twice; wrong start index after video filter / mix remap |
| **Dies when app closed / phone locked** | “Won’t keep going on lock screen”; “only resumes when I open the PWA” | iOS dropped the background media session — almost always because something called `pause()`, reported Media Session paused, or tore down / rebuilt the media element mid-queue |

Canonical album order (photonegative): **sometimes → fire escape → photonegative → it doesnt matter**.

Surfaces that matter:

- Studio **Clips** open collection (photonegative “folder”)
- Studio **Music** / stream album page
- Public **audio / album / song** pages
- Soft-enter from **index photonegative gate** → `audio.html`
- iOS **lock screen** / home-screen PWA / app switcher

Prior chat trails (local Cursor transcripts):

- [Fix photonegative autoplay](a1562676-4560-4724-9d49-b06bccb45acb) — Aug 1 2026
- [Fix locked-phone album autoplay](03944870-de07-49f1-9046-6872f21d419e) — Jul 23 2026
- [Mobile autoplay reliability](a5c63dca-3631-4aa5-a29f-2f01eb8c6d6e) — Aug 2 2026
- [About and contact + playhead leak](690ed009-cc9b-47cf-9523-275f58a1b918) — Jul 20 2026 (“it doesnt matter started at 15 seconds”)
- [Autoplay issue in clips](14b0a8a9-820c-4969-912c-00aa3f15c015) — Sep 4 2026 (SOMETIMES → FIRE ESCAPE in clips)

---

## 2. Architecture (what is allowed)

### One engine

All continuous audio goes through:

```
UI tap → BurnfolderStreamPlayer.playQueue / playItem
       → BurnfolderMuxPlayback (shared/mux-playback.js)
       → media element + Media Session + recall
```

| Piece | Path |
|-------|------|
| Engine | `shared/mux-playback.js` |
| Studio play API | `studio/js/stream-player.js` |
| Shell / bar | `shared/studio-playback-stack.js`, `studio/js/studio-playback-shell.js`, `shared/now-playing-bar.js` |
| Queue builders | Clips `collectionQueueFromOpen` / `playAudioList`; stream `albumQueueFromGroup`; album page `albumQueueFromCurrent` |
| Version collapse | `shared/song-versions.js` |
| Prefetch | `shared/playback-prefetch.js` |
| Recall | `shared/playback-recall.js` |
| Debug | `shared/playback-debug.js` |

**Not continuous:** OS folder video stages, `watch.js` multi-clip shares (manual track switch), entry-editor preview player (separate IDs).

### Steel lock-screen contract (current)

1. One persistent media element for the visit — never torn down on SPA nav.
2. **Safari / iOS:** native `<audio id="activeLiveAudio">` playing `https://stream.mux.com/{id}.m3u8`. mux-player rebuilds/pauses inner media on `playback-id` change and drops the iOS background session after a few advances.
3. **Elsewhere:** mux-player is fine; same handoff rules.
4. Advance is one move: `ended` → set next source → `play()` same turn — **never `pause()`** on queue handoff.
5. Media Session reports **`wantPlaying`**, not `element.paused` (source swaps fire pause internally).
6. **Finish detection is one function** (`trackHasFinished`). A track cannot finish in its first second. Advance gate stays closed until `currentTime >= 1` so leftover `ended === true` cannot skip the next song.
7. Watchdog only retries `play()` while intent is playing; near-end is a backstop after the gate opens.
8. Media Session: play / pause / next / previous only — **no seek handlers** (breaks iOS next/prev).
9. Full queue must be built **at play start** (including following collections). DOM rebuild is unavailable while locked.

---

## 3. Root causes (catalog)

Treat these as a checklist. Most “new” bugs are one of these returning via a new call site or stale cache.

### A. iOS background session death

- Calling `pause()` during a live queue handoff.
- Reporting Media Session `paused` when the element paused only because the source changed.
- Tearing down / recreating the media element (SPA re-inject of playback scripts, wrong shell mount, hard nav).
- Changing mux-player `playback-id` on the live element while locked (historical — led to dual-player / ping-pong experiments).

### B. Sticky `ended` / inherited playhead (skip or mid-song start)

- After source swap, mux-player can leave `ended === true` and/or keep the previous `currentTime`.
- If the engine clears the advance gate on the first `playing` event at `t≈0`, sticky `ended` immediately advances again → **skips FIRE ESCAPE** (or whatever is next).
- If the next track inherits ~15s playhead → “IT DOESNT MATTER started at 15 seconds.”

### C. Wrong or empty queue

- Tap used `playItem` (single song) instead of `playQueue` (collection/folder list).
- Queue built only for the open group with no following groups (lock-screen cannot extend later).
- Start index from DOM after videos filtered out — must remap via `startPlaybackId`.
- Tile playback id is an **old mix**; queue row resolved to **newest** — start id not found → wrongly falls back to index 0 (or feels like “wrong song”).
- Soft-enter / HTML still loading **stale `?v=`** scripts so fixes never reach the device.

### D. Competing play / seek loops (historical)

- Overlapping `play()` retries, `nudgeMuxPlay` rewriting `playback-id`, dual recall stores.
- `forceStartAtZero` 100ms polling for 1.2s after advance that yanked the playhead back into 0 when buffering on a locked phone → stutter loop on track start (`8068801`).

### E. Platform / product gaps (not engine bugs)

- Video clips in folders: no ended→next by design (inline video stage).
- `watch.js` private shares: manual track switch only.

---

## 4. Evolution of fixes (branches & commits)

Approaches were tried, merged, then often **superseded**. Do not revive discarded designs without reading why they died.

### Timeline (newest first on `main`)

| When | Commit / ship | Idea | Outcome |
|------|---------------|------|---------|
| 2026-09-04 | **Working tree** (not necessarily committed): `trackHasFinished` + advance gate until `t>=1`; clips `playAudioList`; soft-enter stamps `BurnfolderSiteVersion` | Kill sticky-ended skip; one list-play path in clips | Addresses clips SOMETIMES→FIRE ESCAPE; tests extended |
| ~2026-08 | `719974f` | **Native HLS `<audio>`** session on Safari/iOS | Current steel path for lock-screen; photonegative dying mid-album / closed-app called out in message |
| 2026-08-04 | `9fcee03` / stutter PR | Varispeed + lock-screen progress drift | Merged via `cursor/fix-lock-screen-playback-stutter-db41` |
| 2026-08 | `9b36870` | Watchdog hardening (stalls, dropped autoplay, mid-track errors) | Kept |
| 2026-08 | `8068801` | Remove `forceStartAtZero` seek loop; one watchdog; one advancePending | Kept — stutter fix |
| 2026-08-02 | `e493f92` (`lock-screen-simple`) | Kill ping-pong; single continuous session + `wantPlaying` | Superseded dual-player; **on `main` via later merges** |
| 2026-08-02 | `3bf3441` / ping-pong branch | Dual-player ping-pong + iOS standby unlock | **Abandoned** — too fragile; replaced by `e493f92` |
| 2026-08-02 | `1e69dd8` / `d4c8ff2` | Bridge / dual mux-player handoff + keepalive | **Abandoned** — bridge player removed from steel contract |
| 2026-08-02 | `d375312` | Keep queues after close; cross-collection advance | Kept conceptually (`collectionQueueFromOpen` / `albumQueueFromGroup`) |
| 2026-08 | `b53e2fc` lean ship | Autoplay + header + clips boot | Merged |
| 2026-07 | `392ac18` | No `pause()` on handoff; persistent monitor | Kept as invariant |
| 2026-07 | `481df40` / `848ecfa` / `1a45c62` | Cross-group + PHOTO NEGATIVE lock-screen | Kept as queue-shape work |
| 2026-07 | `45f0f16` | Stop chopping song endings (near-end slack too aggressive) | Kept — be careful with END_SLACK |
| 2026-07 | Soft-enter stale `?v=` | Gate loaded July mux-playback while site had newer | Recurring footgun — soft-enter must follow `BurnfolderSiteVersion` |
| 2026-07 | Playhead leak fix | Seek 0 on non-recall starts | Native audio resets on `src`; mux-player still needs one-shot inherited-playhead correction |

### Branch map (remote) — playback-related

These branches are **historical**; `main` is ahead of all of them after native-HLS and later work. Use for archaeology, not as merge sources without diffing against `719974f`+.

| Branch | Tip theme | Relation to `main` |
|--------|-----------|-------------------|
| `lock-screen-simple` | Single continuous session (`e493f92`) | Behind `main` (missing native HLS + later) |
| `origin/cursor/simple-pingpong-playback-dd21` | Ping-pong dual player | Superseded — do not revive |
| `origin/cursor/fix-studio-autoplay-reliability-dd21` | Dual-player handoff (`1e69dd8`) | Superseded |
| `origin/cursor/fix-pn-lockscreen-thru-dd21` | Queue keep + bridge advances (`d375312`) | Ideas landed; implementation superseded |
| `origin/cursor/ship-studio-lean-dd21` | Lean autoplay ship | Merged lineage |
| `origin/cursor/fix-lock-screen-playback-stutter-db41` | Stutter / varispeed | Merged |
| `origin/cursor/playback-debug-logging-db41` | On-device debug log | Merged |
| `origin/cursor/playback-debug-auto-upload-db41` | Auto-upload debug beacons | Merged |
| `origin/cursor/fix-lock-screen-album-advance-757b` | Earlier album advance | Historical |
| `origin/cursor/fix-lock-screen-playback-bb7a` | Earlier lock-screen | Historical |
| `origin/cursor/fix-pn-lock-autoplay-44fd` | PN-specific | Historical |
| `origin/cursor/fix-queue-advance-sync-acfc` | Queue sync | Historical |
| `origin/cursor/fix-studio-background-playback-e04a` | Background playback | Historical |

**Pattern:** PN-specific and dual-player branches proliferated; the durable direction is **one element + wantPlaying + no pause on handoff + native HLS on iOS + full queue up front**.

---

## 5. Current code state (Sep 2026)

### Engine (`shared/mux-playback.js`)

- `wantPlaying`, `advancePending`, `trackStarted`
- `notePlayhead` / `releaseAdvanceGate` — gate opens only when `currentTime >= 1`
- `trackHasFinished` — shared by `ended`, `timeupdate`, watchdog, lifecycle recover
- Native HLS when `audio.canPlayType` accepts MPEG-URL
- `queueHandoff` / `seamlessAdvance` skip `pause()` before source change
- Recall seek forces gate open (resume mid-track)

### Clips (`studio/js/clips-page.js`) — Sep 4 redesign (working tree)

- **`playAudioList(rows, startPlaybackId)`** — single path for any visible audio list
- Collection: `playCollectionFrom` → queue from open group **through later groups**
- Folder: `playFolderFrom` → all audio items in folder sort order (no more solo `playItem` inside an open folder)
- Song rows resolve **newest mix** like the album page; start id remaps by **song key** when tile id is stale
- Lone unfiled audio on the main board still uses `playMuxBlock` → `playItem` (intentional solo)

### Cache / SW

- Touching playback **requires** bumping: HTML `?v=`, `shared/site-version.js`, `sw.js` / `studio/sw.js` cache names together
- Soft-enter (`skins/soft-enter-audio.js`) must stamp `BurnfolderSiteVersion` — hardcoded July versions previously left listeners on dead code

### Tests that must stay green

`test/playback-engine-lockscreen.js`:

- Native HLS advance does **not** call `pause()` on handoff
- Queue crosses sometimes → fire escape → photo negative → it doesnt matter
- Media Session stays “playing” across handoffs
- Sticky `ended` at `t≈0` after swap must **not** skip the handed-off track
- Sticky `ended` with inherited end clock must not skip either

---

## 6. How to debug next time

1. **Where?** Clips collection / Music album / public audio / soft-enter / lock screen / closed PWA.
2. **How started?** Collection ▶, track row, unfiled tile, folder item — only list paths should build a multi-track queue.
3. **Queue contents?** In console / debug log: `BurnfolderStreamPlayer.engine().getActiveQueue()` and index. Confirm FIRE ESCAPE (or expected next) is present **after** the current id.
4. **Element?** `#activeLiveAudio` (Safari/iOS) vs `#activeMuxPlayer`. If iOS is on mux-player, native HLS detection failed or an old build is cached.
5. **Debug log:** reproduce once, open `/studio/debug-playback.html` or pull `/api/playback-debug-log`. Look for `advance`, `play:rejected`, `watchdog:paused-retry`, `event:ended-ignored` / finish rejects, lifecycle recover.
6. **Cache:** hard refresh; confirm Network panel shows current `mux-playback.js?v=…` and SW cache name bumped.
7. **Do not** add a second player, a page-local `ended` listener, or a timed `currentTime = 0` loop.

### Regression checklist

- [ ] Clips → open photonegative → play SOMETIMES → hears FIRE ESCAPE without unlocking
- [ ] Same with phone locked / PWA backgrounded (iOS)
- [ ] Music page album ▶ through end of photonegative into next collection (if any)
- [ ] Soft-enter from index gate still uses current site version scripts
- [ ] SPA: dashboard → music → journal — audio continues, no restart
- [ ] `npm test` green
- [ ] No `pause()` between queue tracks in debug log during handoff

---

## 7. Design principles (non-negotiable)

1. **Simplify, don’t caveat.** If a guard only exists to paper over a race, fix the race (one finish function, one gate).
2. **One play intent:** `wantPlaying`. UI and Media Session follow it.
3. **One media element** per visit on the live path (native audio on iOS, mux-player elsewhere).
4. **Queues are data, not DOM** — build the full listen path before backgrounding.
5. **Identity over index** — start and highlight by `playbackId` / song key after filters and mix resolution.
6. **Cache is part of the bug.** Stale `?v=` equals “fix never shipped.”
7. **Discarded designs stay discarded:** dual mux-player bridge, ping-pong standby, ScriptProcessor keepalive, `forceStartAtZero` polling — unless new evidence overturns `719974f` / `e493f92` / `8068801`.

---

## 8. Open risks / likely next failures

- **Chrome / desktop mux-player** still relies on sticky-ended discipline; native audio path doesn’t. Regressions often show on one browser only.
- **Very short clips (&lt;1s)** cannot finish under the `currentTime >= 1` rule (not used for photonegative songs).
- **Multiple queue builders** (clips / stream / album / editor) can drift — long-term, one shared `buildQueueFromGroup(startId)` in `stream-shared` would reduce forks.
- **Service worker** serving old `mux-playback.js` after a “fix” that only bumped HTML.
- **Uncommitted Sep 4 clips/engine changes** — confirm they are committed and deployed before treating the SOMETIMES→FIRE ESCAPE fix as live in production.

---

## 9. File index

| File | Role |
|------|------|
| `shared/mux-playback.js` | Engine |
| `shared/media-session.js` | Lock-screen metadata / actions |
| `shared/playback-debug.js` | Timeline log + upload |
| `shared/playback-recall.js` | Resume |
| `shared/playback-prefetch.js` | Warm next |
| `shared/song-versions.js` | Group keys, newest mix |
| `shared/site-version.js` | Public cache-bust SSOT |
| `shared/studio-playback-stack.js` | Script list + shell markup |
| `studio/js/stream-player.js` | `playQueue` / video strip / start remap |
| `studio/js/clips-page.js` | Clips collection/folder queues |
| `studio/js/stream-page.js` | Music list queues |
| `studio/js/stream-album-page.js` | Album hub queues |
| `skins/soft-enter-audio.js` | Index gate → audio script chain |
| `test/playback-engine-lockscreen.js` | Contract tests |
| `.cursor/rules/studio-stream-playback.mdc` | Agent steel standard |

---

*End of living doc. Append new incidents under §1 and new commits under §4; do not fork a second investigation file.*
