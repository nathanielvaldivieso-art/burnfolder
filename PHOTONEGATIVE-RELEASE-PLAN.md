# PHOTONEGATIVE — Release Plan

**Status:** Active north-star plan (July 2026)  
**How to use:** work **The feed** top to bottom. Stop at gates. Check off as you go. Tell Copilot *"implement feed step N"* when you're ready to build. Steps 63–68 require step 62 Tier 3 decision.  
**Supersedes for near-term:** `STUDIO-MASTER-PLAN.md` until step 62 completes.

---

## North star

Prove that **art made with integrity can reach people commercially** — that audiences care about work that cares about them.

PHOTONEGATIVE is the proof object. burnfolder is the proof system.

**Off-site thesis** (repeat calmly on social — never on journal entries):

> music made slowly, released on purpose — on a site that doesn't treat you like inventory.

---

## Core concept: the print and the darkroom

| Surface | What it is | Where |
|---------|------------|-------|
| **Release cut** | Frozen masters — the picture you took | DSP, `music.html`, top of album hub |
| **The darkroom** | Versions, process, outtakes | Bottom of album hub, journal arc |

After freeze: `useLatestVersions: false` on `musicFeaturedRelease`. Living versions live in the darkroom only.

**Canonical link for everything off-site:** `burnfolder.com/album.html?album=photonegative`

---

## The feed

Work in order. Each step is one advance. Build steps reference existing infra unless noted.

### Freeze — take the picture

- [ ] **01** `[music]` Listen-through **SOMETIMES** — full pass, no fix list. Passes freeze criteria.
- [ ] **02** `[music]` Listen-through **FIRE ESCAPE** — same.
- [ ] **03** `[music]` Listen-through **PHOTO NEGATIVE** — same.
- [ ] **04** `[music]` Listen-through **IT DOESNT MATTER** — same.
- [ ] **05** `[music]` Export masters: `PHOTONEGATIVE_{TRACK}_MASTER.wav` (all 4).
- [ ] **06** `[music]` Document credits and splits for every track.
- [ ] **07** `[music]` Fill release cut table (below) with final playbackIds or file refs.
- [ ] **08** `[music]` Choose **lead single** for playlist pitching (FIRE ESCAPE or SOMETIMES).
- [ ] **09** `[copy]` Write album hub copy: subtitle, thoughts pull (3–5 sentences from 5.17.26), credits, darkroom intro line.
- [ ] **10** `[copy]` Write press page copy: bio, story hook, pull quote, contact email.
- [ ] **11** `[copy]` Write homepage intro block copy (see step 33).
- [ ] **12** `[freeze]` Declare freeze complete. The picture is taken. No more release-cut edits.

### Assets — prepare before build

- [ ] **13** `[assets]` Export hi-res cover (3000×3000 min) for press + DSP.
- [ ] **14** `[assets]` Select or shoot 1–2 press photos.
- [ ] **15** `[assets]` Create one visual per track (4) for album hub visuals panel.
- [ ] **16** `[content]` Film launch fragment: lead single hook (15–30s).
- [ ] **17** `[content]` Film launch fragment: title track atmospheric moment (15–30s).
- [ ] **18** `[content]` Film launch fragment: cover + concept line (static or short video).
- [ ] **19** `[content]` Film launch fragment: camera/design piece tied to a track.
- [ ] **20** `[content]` Edit all launch fragments. Ready to post. All link to album hub.

### Build — site surfaces

- [ ] **21** `[build]` Album hub in Studio: release cut tracklist (frozen playbackIds only), cover, play-all.
- [ ] **22** `[build]` Album hub: thoughts, credits, lyrics (or links to song pages), links row (streaming placeholders ok).
- [ ] **23** `[build]` Album hub: **the darkroom** section — version picker per song, journal date links (2.25.26 → 7.1.26 arc).
- [ ] **24** `[build]` Album hub: visuals panel (step 15 assets). Push to `album-pages.js`.
- [ ] **25** `[build]` Song page: **photonegative** (title track) — lyrics, notes, one visual. Push via Studio.
- [ ] **26** `[build]` Song page: **lead single** — same. Push via Studio.
- [ ] **27** `[build]` Link both song pages from album hub tracklist.
- [ ] **28** `[build]` Create `press.html` — EPK sections + downloadable assets (cover, photos, optional 30s preview).
- [ ] **29** `[build]` Shop: digital album purchase / pay-what-you-want via Stripe (extend existing tip checkout pattern).
- [ ] **30** `[build]` Album hub: sparse *support / download* link → shop.
- [ ] **31** `[build]` Set `musicFeaturedRelease.useLatestVersions: false` in `entries.js`.
- [ ] **32** `[build]` `music.html` hero links to album hub.
- [ ] **33** `[build]` Homepage: intro block above entry list —
  ```
  burnfolder — journal and archive.
  current release: photonegative → [album hub]
  ```
  Optional line: *music made slowly, released on purpose.*
- [ ] **34** `[build]` Add Cloudflare Web Analytics.

### Distro — manual LabelGrid (no API wait)

- [ ] **35** `[distro]` LabelGrid: create release, upload all 4 masters.
- [ ] **36** `[distro]` LabelGrid: metadata, credits, genre, artwork. Record ISRC + UPC in table below.
- [ ] **37** `[distro]` LabelGrid: submit for DSP distribution.

**⛔ GATE 38** — Wait for DSP live (Spotify + Apple minimum). Usually 3–14 days. Site build (21–34) can happen during the wait. Do not launch publicly until gate clears.

### Launch — flip everything at once

- [ ] **39** `[launch]` Add Spotify + Apple URLs to album hub links row and `press.html`.
- [ ] **40** `[launch]` Verify production: album hub, press, shop, homepage, `music.html` — all correct.
- [ ] **41** `[launch]` Publish release journal entry (document the picture — not hype). Newsletter sends automatically.
- [ ] **42** `[launch]` Post off-site fragment 1: lead single clip → album hub.
- [ ] **43** `[launch]` Post off-site fragment 2: title track clip → album hub.
- [ ] **44** `[launch]` Post off-site fragment 3: cover + concept → album hub.
- [ ] **45** `[launch]` Post off-site fragment 4: camera/design piece → album hub visuals.
- [ ] **46** `[launch]` Post off-site fragment 5: *when do i take the picture?* — text only, link to 5.17.26 or album hub.

### Push — keep moving down the feed

- [ ] **47** `[push]` Start playlist pitch spreadsheet (playlist, contact, date, status).
- [ ] **48** `[push]` Pitch lead single — first batch (5–10 curators). Manual only. EPK link included.
- [ ] **49** `[push]` Press outreach — first batch (5–10). Lead with concept + artist-built archive story. EPK link.
- [ ] **50** `[push]` Post: SOMETIMES visual or performance clip → album hub.
- [ ] **51** `[push]` Post: FIRE ESCAPE visual or lyric fragment → album hub.
- [ ] **52** `[push]` Post: PHOTO NEGATIVE concept piece (negative/developing visual) → album hub.
- [ ] **53** `[push]` Post: IT DOESNT MATTER emotional closer clip → album hub.
- [ ] **54** `[push]` Pitch lead single — second batch.
- [ ] **55** `[push]` Journal entry #1 (finished-adjacent: performance, visual, or what a song is *for*).
- [ ] **56** `[push]` Post any remaining track visuals not yet used.
- [ ] **57** `[push]` Post process B-roll (studio, drums, camera) — darkroom tease → journal.
- [ ] **58** `[push]` Journal entry #2 (finished-adjacent).
- [ ] **59** `[push]` Pitch batch 3 + press batch 2.
- [ ] **60** `[push]` Journal entry #3 (finished-adjacent).
- [ ] **61** `[measure]` Record metrics snapshot: Spotify saves, monthly listeners, newsletter subs/opens, direct sales, site traffic, share-link plays.
- [ ] **62** `[review]` Decide: extend push OR resume `STUDIO-MASTER-PLAN.md` (Tier 3 analytics first). Threshold: one playlist/press win OR meaningful saves/sales signal.

### Post-feed — autonomous marketing pipeline (after step 62)

Spec: **`PHOTONEGATIVE-MARKETING-PIPELINE.md`**. Only start when step 62 chooses Tier 3 resume. Tasks only — never journal or caption copy.

- [ ] **63** `[data]` Stand up relational store (SQLite local or Postgres/Supabase) — three layers: catalog/performance, fan traffic, creative asset inventory.
- [ ] **64** `[data]` Wire Layer A ingest — LabelGrid API or simulated DDEX endpoints (ISRC, UPC, daily streams/saves by DSP, geo, UGC counts).
- [ ] **65** `[data]` Wire Layer B ingest — Cloudflare Web Analytics + album hub / smart-link click logs (visits, CTR to DSPs, time on page).
- [ ] **66** `[data]` Seed Layer C — creative asset inventory JSON/DB from steps 15–20 assets (Asset_ID, track, type, status, description).
- [ ] **67** `[agent]` Python task agent — daily snapshot → LLM with system prompt from spec §4 → exactly 3 micro-tasks.
- [ ] **68** `[alert]` Daily alert channel — webhook, Slack, Telegram, or logfile; operator reads tasks, executes manually.

---

## Release cut table

Fill at step 07. ISRC/UPC at step 36.

| # | Song | Release cut (playbackId / file) | ISRC |
|---|------|----------------------------------|------|
| 1 | SOMETIMES | | |
| 2 | FIRE ESCAPE | | |
| 3 | PHOTO NEGATIVE | | |
| 4 | IT DOESNT MATTER | | |

**Lead single (step 08):** _______________  
**UPC (step 36):** _______________

---

## Reference — album hub sections (for steps 21–24)

Top to bottom on `album.html?album=photonegative`:

1. Header — PHOTO NEGATIVE / *four songs about when to stop editing yourself*
2. Cover — `IMAGES/PHOTO-NEGATIVE-COVER.png`
3. Release cut — play-all, frozen tracklist
4. Links — spotify · apple · support/download · `5.17.26.html`
5. Thoughts — short pull from essay
6. Credits
7. Lyrics — compiled or song-page links
8. **The darkroom** — versions + journal arc
9. Visuals — one per track

---

## Reference — press page sections (for step 28)

`press.html` — utility, archive-box voice. No hype.

- Artist bio (3–5 lines, lowercase)
- Release line + concept
- Pull quote: *when do i take the picture?*
- Story hook (photonegative → burnfolder — for press only)
- Streaming links (after gate 38)
- Album hub link
- Downloadable assets: cover, press photos, optional preview audio
- Credits
- Contact email

---

## Reference — what not to do

- Marketing language on journal entries
- `useLatestVersions: true` on music page after freeze
- "OUT NOW" energy off-site or on-site
- WIP / retake journal posts after launch (finished-adjacent only)
- AI-generated captions
- Promo links to unstable/latest versions
- Automated playlist spam
- Waiting for LabelGrid API, R2 vault, or Tier 4 before shipping

---

## Deferred until step 62

Tier 4 SaaS · **autonomous marketing pipeline** (`PHOTONEGATIVE-MARKETING-PIPELINE.md`, feed steps 63–68) · marketing planner UI · LabelGrid API · multi-tenant galleries · IG analytics integration · song pages for all 4 tracks · physical merch unless ready · living album on `music.html`

---

## Key URLs

| Purpose | URL |
|---------|-----|
| Album (link-in-bio) | `burnfolder.com/album.html?album=photonegative` |
| Music | `burnfolder.com/music.html` |
| Press / EPK | `burnfolder.com/press.html` |
| Journal origin | `burnfolder.com/5.17.26.html` |
| Shop | `burnfolder.com/shop.html` |
| Home | `burnfolder.com` |

---

## Related files

| File | Role |
|------|------|
| `entries.js` | Journal + `musicFeaturedRelease` |
| `album-pages.js` | Album hub content |
| `album.html` | Album hub shell |
| `studio/album-designer.html` | Compose + push album hub |
| `STUDIO-MASTER-PLAN.md` | Platform vision (paused until step 62) |
| `PHOTONEGATIVE-MARKETING-PIPELINE.md` | Autonomous marketing data pipeline + daily task agent spec (post step 62) |
| `COPILOT.md` | Gallery voice + build priorities |

---

*Check off steps in order. Update the release cut table as decisions land.*
