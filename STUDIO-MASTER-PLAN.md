# Burnfolder Studio — Artist OS Master Plan

**Status:** Full vision document synthesizing all planning conversations (July 2026). A follow-up pass will filter this through current resources and realistic scope.

**Last updated:** July 4, 2026

**Sources this plan reflects:**
- `COPILOT.md` artist OS vision and shipped studio architecture
- Pre-push 18-item studio backlog (security, UX, modules)
- ChatGPT distro brainstorm (LabelGrid / white-label / ISRC / provider migration)
- AI integration decisions (provider, modes, voice boundary)
- Social/analytics gap analysis + YouTube/Instagram slate
- Multi-tenant pivot (dogfood the real product, not a single-user fork)
- Dashboard + analytics AI direction (streaming ingest → digest on `/studio/dashboard.html`)

---

## 1. North star

**Burnfolder Studio** is a **multi-tenant artist OS** — a private control plane where artists run their entire practice on the go, then choose what goes public.

| Layer | Role |
|-------|------|
| **Studio (private, per workspace)** | Capture work, manage catalog, distribute, plan releases, collaborate, sell, measure |
| **Public gallery (per workspace)** | The artist's archive/portfolio — sparse, final, on their terms |
| **Distribution (per workspace)** | White-label pipes to DSPs (Spotify, Apple Music, etc.) — **providers are plugins, not the product** |
| **AI (studio-only)** | Digest streaming analytics, ops, planning, checklists, briefs — **never replace the artist's voice** |

### Mental model (from platform planning)

| Layer | What lives there | Who sees it |
|-------|------------------|-------------|
| **Studio** | Drafts, WIP, masters, versions, journal, distro state, analytics | Artist + invited guests |
| **Publish** | Explicit actions: submit to DSPs, publish gallery entry | Artist confirms |
| **Public gallery** | Live entries, music, video, shop | Everyone |

Studio is **source of truth**. The gallery is a **published snapshot** — not two sites in constant sync.

**burnfolder.com today** becomes **workspace #1's gallery output** — the first tenant on the platform, not a separate code path.

### Core loop (scope discipline)

Everything in this plan must serve:

```
capture work → prepare release → distribute → publish gallery → promote → measure → repeat
```

Features outside this loop are Phase 2+ unless they directly reduce friction in the loop.

### Principles (locked in across this chat)

- **Multi-tenant from v1** — not a single-user prototype to rewrite when adding artists
- **Dogfooding** = sign in as a normal user, use your workspace daily — same product others will use
- **ISRC = permanent track identity** — never regenerate on provider migration (DSP history depends on it)
- **AI streamlines everything else; artist owns voice** — no AI entry designer, captions, or copy
- **Distribution is a control plane** — LabelGrid/Too Lost/Revelator/FUGA are swappable pipes
- **Gallery ≠ studio** — archival coldness vs interactive app-like UX
- **Priority:** intuitive → sleek → secure; mobile-first / PWA for daily capture, not for replacing desktop distro workflows
- **Extend this repo** — no Next.js/Postgres rewrite as a prerequisite; add tenant layer incrementally

---

## 2. Gallery philosophy (per workspace)

Each workspace gallery inherits burnfolder's public-site rules. The artist OS publishes **into** this shape — AI briefs reference these constraints, never override them.

| Rule | Detail |
|------|--------|
| Voice | Lowercase, sparse, no marketing language — label on an archive box |
| Navigation | Dates as titles (M.DD.YY), not promotional headlines |
| Aesthetic | Archival coldness — monospace, white/black, left-aligned, no gratuitous animation |
| Audience model | No algorithm, no feed — visitors encounter work on the artist's terms |
| Player | Bottom bar is infrastructure, not hero UI |
| Shop / tips | Commerce exists on gallery; studio surfaces orders/fulfillment |

**Link-in-bio:** gallery home *is* the link-in-bio — no separate Linktree product.

---

## 3. Studio vs gallery vs journal

### Studio vs public gallery

| | **Gallery** (`{slug}.burnfolder.com`) | **Studio** |
|--|----------------------------------------|------------|
| Audience | Visitors | Artist + guests |
| Voice | Archive — sparse, final | Working — can be messy |
| Design | Archival coldness | Interactive, DnD, panels |
| Content | Released entries, music, video, shop | Drafts, WIP, distro, analytics |

### Entry (public) vs journal (private) — must never blur

| | **Entry** | **Journal** |
|--|-----------|-------------|
| Surface | Workspace gallery dated pages | Studio journal tab only |
| Audience | Site visitors | Artist (+ guests if shared) |
| Content | Released work — text, audio, video, playlists | Day notes, plans, reminders |
| Storage | Gallery publish (`entries.js` + HTML per workspace) | `journalDays` (workspace-scoped) |
| Voice | Archive label | Working notes |

Private journal **never surfaces on any gallery**.

### Gallery vs distro publish (separate actions)

| | **Distro (LabelGrid/Too Lost)** | **Gallery publish** |
|--|--------------------------------|---------------------|
| Destination | Spotify, Apple, Amazon, TikTok Music, etc. | `{slug}.burnfolder.com` |
| Identity | ISRC / UPC | Entry date + blocks |
| Reversible | Takedown via provider | Republish (currently 409 — enable with confirm) |
| Timing | DSP review + go-live | Instant on deploy |

Song/album **dedicated pages** — only for releases that warrant them, not every track.

---

## 4. Gallery hosting

- **v1:** `{workspace-slug}.burnfolder.com`
- **v1.1:** Custom domain (CNAME → workspace gallery)
- Per-workspace publish target and deploy — not hardcoded to one git repo long-term
- **Publish Phase A (shipped):** text, Mux audio/video, album/playlist blocks
- **Publish Phase B (planned):** image blocks + `IMAGES/` cover art in live entries

---

## 5. Multi-tenancy & auth

### Model

```
User (account)
  └── Workspace (artist identity)
        ├── Role: owner | collaborator | guest (read-only)
        ├── Cloud state (drafts, catalog, journal, releases…)
        ├── Master file vault
        ├── Mux media (workspace-scoped)
        ├── Distro provider connection (per workspace — Model B)
        ├── Social connections (YouTube, Instagram, …)
        ├── AI preferences + stored plans
        ├── Fan/subscriber data
        ├── Commerce (orders, SKUs)
        └── Gallery publish target
```

### Auth evolution

| Today | Target |
|-------|--------|
| Single `STUDIO_API_SECRET` bearer for all studio APIs | Per-user auth (email/password or magic link) |
| `sessionStorage` studio token | JWT / secure session cookie |
| Lock button clears token | Lock + session expiry + device re-auth |
| Global Netlify Blobs keys | Workspace-scoped keys: `workspace:{id}:drafts`, etc. |

**Production:** real user auth. **`STUDIO_API_SECRET`:** dev/emergency bypass only.

### Security backlog (from pre-push 18-item list — still required)

- [ ] Rate-limit + brute-force protection on auth endpoints
- [ ] Token expiry / auto-relock after inactivity
- [ ] Secret hygiene — `.env` gitignored, keys only in Netlify env
- [ ] 2FA (v1.1)

### Guest & collaborator access (required v1)

Inspired by **untitled.stream**-style sharing, extended to **full album co-creation**:

| Role | Capabilities |
|------|--------------|
| **Owner** | Full workspace: billing, distro connect, gallery publish, guest invites |
| **Collaborator** | Co-create albums, upload masters, edit stack, credits, comment — **cannot** gallery publish, distro submit, or revoke workspace |
| **Guest (read-only)** | Listen, view shareable drafts, comment if enabled |

- Collaborators are **invited accounts** — not anonymous-only
- **Share links** (`listen.html?t=`) remain for **external** mix feedback without accounts
- Owner approves all distro submit and gallery publish steps

### Open question (resource filter pass)

**v1 audience:** (A) you + hand-onboarded artists, or (B) open signup SaaS from launch? Affects billing, abuse controls, and support burden.

---

## 6. Data & cloud architecture

### Storage layers

| Store | Holds |
|-------|--------|
| **Postgres** (or Supabase — `studio/supabase/schema.sql` is a starting reference) | Users, workspaces, memberships, releases, tracks (ISRC), pipeline, distro IDs, DSP metrics, social tokens, fans, orders, splits, import jobs |
| **Object storage — master vault (required v1)** | WAV/FLAC masters, hi-res artwork, press photos, EPK assets. Workspace-scoped. **Masters must live in cloud.** |
| **Object storage — project vault (Tier 2+)** | DAW sessions, stem bundles, reference bounces — linked to songs via `songGroupKey`. Same R2 bucket, separate path prefix. **Not Mux** (download-only). |
| **Mux** | Streaming/transcoding — linked: `ISRC` ↔ vault master ↔ Mux asset ↔ distro track ID ↔ `songGroupKey` |
| **Netlify Blobs** | Large JSON (drafts, journal) keyed by workspace until migrated to Postgres JSONB |

### Master file vault

- Distro submit pulls from vault; Mux transcodes from vault upload
- Artwork at DSP-required specs stored alongside derivatives
- Stems optional v1.1

### Project vault (session files)

**Purpose:** Cloud backup of everything around a song that is **not** for streaming — Logic/Pro Tools/Ableton sessions, stem ZIPs, reference mixes, project notes.

| | **Master vault** | **Project vault** |
|--|------------------|-------------------|
| Contents | Final WAV/FLAC for distro | `.logicx`, `.band`, `.ptx`, `.als`, stem `.zip`, etc. |
| Playback | Mux transcode → stream | Download only (presigned R2 URL) |
| Link key | ISRC + `muxPlaybackId` | **`songGroupKey`** (same as song versions / stacks) |
| R2 path | `ws/{id}/masters/{isrc-or-temp}/` | `ws/{id}/projects/{songGroupKey}/sessions/` · `…/stems/` |

**Today (pre-Tier 2):** `studio/js/asset-cloud.js` detects session file types and stores `songGroupKey` locally in **IndexedDB** — browser-only, not workspace cloud. Tier 2 migrates manifest to Blobs + files to R2.

**Target UX (music → assistant, playback continues via SPA):**

```
Listening to "RBG" on music tab
  → navigate to Dashboard / AI (SPA keeps player alive)
  → "pull up the session files for RBG"
  → AI resolves songGroupKey → lists vault files with download links
  → optional: "upload the latest logic session" from song page while listening
```

**Context passing:** AI requests include optional `context.nowPlaying: { playbackId, title, songGroupKey }` from `BurnfolderMuxPlayback` / playback shell — so "session files for *this* song" works without retyping the title.

**Security:** Workspace JWT on all vault APIs; presigned download URLs (short TTL); AI sees filenames + sizes + dates only — never file bytes.

### Identity & migration (from distro brainstorm)

- **ISRC** = immutable track key within workspace
- **UPC** = release key
- Provider swap (LabelGrid → Revelator/FUGA) preserves ISRC/UPC — DSPs merge history on redelivery

**Migration procedure (when upgrading provider):**
1. Freeze workspace writes
2. Export catalog (ISRC, UPC, titles, credits, artwork refs, provider IDs, DSP links)
3. Normalize to canonical schema
4. Create releases in new provider with **same ISRC/UPC**
5. Re-map provider IDs in Postgres
6. DSP reconciliation (streams/playlists preserved via ISRC)
7. Switch analytics pipeline to new provider

### Sync & portability

- Per-record `updated_at` + merge/conflict UI (replace global last-write-wins)
- Cloud status indicator (`.studio-sync`: syncing / synced / offline)
- Flush on `pagehide` for mobile PWA
- **Full workspace export** (required v1): catalog, drafts, journal, pipeline, metrics, fan metadata, vault manifest, **projectFiles**, **assetMeta, goals, smartStacks** (+ optional binaries)
- **Import/restore** path for trust and exit
- AI export health checks ("3 tracks missing ISRC", "2 masters not in vault")

### Workspace cloud keys (evolve from today's single-user keys)

| Key (scoped) | Holds |
|--------------|-------|
| `drafts` | Entry editor drafts |
| `stack` / `stackMeta` | Music stack + album/project meta |
| `journalDays` | Private journal / plan / checklist |
| `songPages` / `albumPages` | Designer pages pre-push |
| `releaseCatalog` | Distro releases + UPC + provider IDs |
| `trackRegistry` | ISRC registry + vault refs |
| `projectFiles` | Manifest: `{ id, songGroupKey, kind, vaultKey, filename, size, uploadedAt }` — sessions, stems, refs |
| `dspMetrics` | Normalized analytics snapshots |
| `aiPreferences` / `aiPlans` | AI settings + persisted plans |
| `assetMeta` | Per-asset tags, activity label, notes (`playbackId` → metadata) |
| `goals` | Practice / improvement goals + schedules + linked stacks |
| `smartStacks` | Saved search filters that auto-refresh when new uploads match |
| `distroPreferences` | Provider connection + last sync |

**Convention:** all authored state syncs through cloud layer — no localStorage-only authored data.

---

## 7. Song lifecycle

Pipeline drives dashboard, calendar, AI nudges, and checklists.

### Track stages

```
idea → demo → recording → mix → master → metadata_ready → distro_draft → distro_submitted → dsp_live → gallery_published → promoted → archived
```

### Release stages

```
draft → assets_complete → checklist_passed → distro_submitted → dsp_live → gallery_draft → gallery_live → campaign_active → complete
```

### Cross-cutting flags

`has_master_in_vault` · `isrc_assigned` · `artwork_approved` · `splits_documented` · `collaborator_signoff` · `pre_release_checklist_passed`

### UI

- Pipeline kanban + list views
- **Unified release calendar:** distro go-live, gallery publish, YT/IG posts, shows, marketing tasks
- **Dashboard** (`/studio/dashboard.html`): analytics home — streaming metrics feed + AI that digests and analyzes them; pipeline/calendar surfaces land here over time
- Stage transitions: manual or AI-suggested — **never auto-publish**

---

## 8. What exists today (port, don't rebuild)

### Shipped in `/studio` (single-tenant — migrate to workspace model)

| Module | Detail |
|--------|--------|
| **Entries** | Draft hub + block editor; publish live → `entries.js` + `M.DD.YY.html` via GitHub |
| **Music** | Mux library, upload, play, drag-to-stack albums, version management |
| **Video** | Same stack, video-filtered |
| **Journal** | Private day log, plan, checklist — separate from public entries |
| **Dashboard** | Analytics home — streaming metrics placeholder, on-demand AI (digest/analyze when data exists), workspace export |
| **Share links** | Private `listen.html?t=` for mix feedback; play count analytics (first metrics feed for dashboard) |
| **Song/album designers** | Push dedicated pages when a release warrants it |
| **SPA shell** | `studio-spa-router.js` — playback bar survives tab nav |
| **Mobile** | `BurnfolderTouchTap`, 44px targets, safe-area, PWA |
| **Cloud sync** | Netlify Blobs via `studio-state.js` + `cloud-state.js` |
| **Auth gate** | `STUDIO_API_SECRET` bearer — replace with multi-user |
| **Commerce (gallery)** | Stripe checkout + Shippo webhook on public shop — not yet in studio UI |

### Existing Netlify functions (extend, don't duplicate)

| Function | Role |
|----------|------|
| `studio-state.js` | Personal cloud KV → workspace-scoped |
| `studio-publish.js` | Gallery publish → entries + HTML + IMAGES |
| `studio-publish-song-pages.js` / `studio-publish-album-pages.js` | Push designer pages |
| `studio-share-links.js` / `share-listen.js` | Private listen tokens + play tracking |
| `studio-auth-check.js` | Password gate → real auth |
| `mux-*` | Upload, list, delete assets |
| `subscribe.js` / `export-subscribers` | Newsletter (workspace-scoped) |
| `stripe-webhook.js` | Orders + Shippo labels |

### Studio UX backlog (from 18-item list)

- [ ] Unified mobile tab bar across all studio areas (backlog #10)
- [ ] Command palette / quick-add ⌘K (backlog #11)
- [ ] Offline-first PWA polish — cache shell + last cloud snapshot (backlog #12)
- [ ] SPA reliability + entry editor DOM lifecycle (`studioInitEntryEditorDom`, `studioReloadEntryDraft`)
- [ ] Share-link workflow polish

### Not current focus

- File drop-sharing (`files.html` → redirects to music)
- Republish existing live entry dates (blocked 409 today — enable later)

---

## 9. Module catalog (full vision)

### 9.1 Foundation (build first)

- [ ] Multi-user auth + sessions
- [ ] Workspaces + roles (owner / collaborator / guest)
- [ ] Workspace-scoped API (`requireWorkspaceAccess`)
- [ ] Master file vault
- [ ] Migrate burnfolder.com data → workspace #1
- [ ] Gallery subdomain routing
- [ ] Data export/import
- [ ] Conflict-safe sync
- [ ] Security: rate-limit, auto-relock, secret hygiene

### 9.2 Catalog & creative

- [ ] ISRC registry (assign, import, **never regenerate**)
- [ ] UPC registry
- [ ] Song lifecycle + pipeline board
- [ ] Unified release calendar
- [ ] Credits registry
- [ ] Split sheets linked to tracks/releases
- [ ] Version management (extend existing)
- [ ] Stems + session files in project vault (Tier 2 — see §6 project vault)
- [ ] Practice librarian — asset tags, smart search, goals (Phase 2+ — see §9.7.1)

### 9.3 Distribution (white-label)

**Insight:** Studio is a **music identity + analytics + distribution routing control plane** — not a distributor.

| Phase | Provider |
|-------|----------|
| v1 | **LabelGrid** (preferred, dev-friendly API) or **Too Lost** (easier UX) |
| v2+ | **Revelator / FUGA** via ISRC-preserving migration engine |

- **Per-workspace** distro account connect (API key / OAuth) — not one shared master account
- Pluggable adapter: `createRelease`, `updateRelease`, `submitRelease`, `takedownRelease`, `getAnalytics`, `importCatalog`
- Analytics via provider poll and/or webhooks → normalized `dspMetrics`

**Flow:**

```
Vault master + metadata → release draft → pre-release checklist → provider submit → DSPs
                                                                        ↓ (separate, artist confirms)
                                                            gallery publish for workspace
```

**Catalog import / backfill (day-1 requirement):**

- Pull existing discography from **connected LabelGrid/Too Lost account**
- Import ISRCs, UPCs, release status, DSP links
- Backfill pipeline state; prompt vault upload for missing masters
- AI assists ambiguous mapping — **artist confirms**

### 9.4 Pre-release checklist (AI-assisted)

Gates before distro submit or gallery publish:

- Master in vault (format, duration, sample rate)
- Artwork specs (3000×3000, explicit flag)
- ISRC / UPC present
- Credits + splits complete
- Title/version consistency (workspace ↔ distro ↔ gallery draft)

**AI:** run checklist, report gaps — **never rewrite titles, lyrics, or entry copy.**

### 9.5 Analytics

**Dashboard is the analytics surface** — one page (`/studio/dashboard.html`), not a separate analytics tab. Two sections:

| Section | Role |
|---------|------|
| **Streaming** | Ingested metrics from DSPs, Mux, share links, YouTube/Instagram — per-track/per-release views |
| **AI** | Digest and analyze that data — trends, period comparisons, focus suggestions; **never invent numbers** |

**Tier 1 (shipped shell):** dashboard page with streaming placeholder + on-demand AI panel. Share-link `playCount` + `lastPlayedAt` are the only live metrics until Tier 3 ingest.

**Target unified feed (Tier 3+):**

| Source | Metrics |
|--------|---------|
| Distro provider | Spotify, Apple, Amazon, TikTok Music — streams, listeners, revenue |
| Mux | On-site / embed plays |
| Share links | Private listen plays (existing — first feed) |
| YouTube | Views, watch time |
| Instagram | Reach, saves, reel plays |
| Bandcamp / SoundCloud | v2 — same pull pattern |
| Site traffic | Cloudflare Web Analytics |
| Commerce | Tips, orders, conversion |

Normalized store: workspace Blob `dspMetrics` or Supabase table — `{ platform, isrc, streams, listeners, revenue, date }`.

**AI + analytics flow (Tier 3):**

```
sync-analytics.js → normalized dspMetrics + share-link aggregates
  → dashboard #dashboardAnalyticsFeed renders tables/charts
  → studio-ai.js receives optional metrics snapshot in POST body
  → AI summarizes patterns, compares periods, suggests focus — grounded in provided data only
```

**Current state:** share-link counts only in backend; dashboard UI shows placeholder until Tier 3 ingest ships. No site traffic, Mux dashboard, or DSP stats in studio yet.

### 9.6 Social integrations

**v1:** YouTube + Instagram only. No TikTok, X, or "all platforms" day one.

| Platform | Scope | Notes |
|----------|-------|-------|
| **YouTube** | OAuth, analytics pull, link to releases, optional vault upload | Build before Instagram |
| **Instagram** | OAuth (Business/Creator + Meta app), insights pull, link posts to calendar | v1 may be read analytics + manual post + studio tracking; API publish where allowed |
| **Bandcamp / SoundCloud** | v2 analytics pull + catalog link | |

- No auto-crosspost without artist confirm
- No AI-generated captions or post copy
- Social supports **promote** step in core loop — not a replacement for gallery

### 9.7 AI layer

**Provider:** cheapest viable — **OpenAI GPT-4o mini** or **Anthropic Haiku** (user preference: Anthropic or OpenAI). Swappable via `AI_PROVIDER` env. Netlify function, workspace-gated.

**Modes (user preference — both required):**

| Mode | Behavior |
|------|----------|
| **On-demand** | Open AI panel, ask anything |
| **Proactive** | Nudges: stale drafts, checklist failures, release gaps, missing masters, unreleased tracks |

**Preference knobs:** frequency (off / daily / when idle), which modules trigger nudges, quiet hours.

**AI does:**

- **Digest streaming analytics** — summarize DSP/share-link/Mux/social metrics when a snapshot is provided; compare periods; spot trends (**never invent numbers**)
- Release planning + sequencing
- Design **briefs** (direction, constraints — not finished copy)
- Pre-release checklist + gap reports
- **Capability navigator** ("can I publish cover art yet?" / Phase B status)
- Catalog import mapping assistance
- Export health reports
- Marketing/scheduling scaffolding (you fill in content)
- Fan/release correlation insights

**AI does not:**

- Write entry copy, captions, lyrics
- Design entry layouts or auto-fill blocks
- Auto-publish gallery or auto-submit distro

**Storage rule:** ephemeral chat for quick questions; **persist** when it's a release plan, design brief, or campaign timeline worth revisiting. Keys: `aiPreferences`, `aiPlans`.

### 9.7.1 Practice librarian (organizational AI)

**Purpose:** Sort and surface practice clips (drums, demos, voice memos) — **organize, never critique.** Complements release pipeline; does not replace journal or music stacks.

**Example flow:**

```
Upload drum practice clips → tag as "drums" / "practice"
  → "pull up all drumming from the last 2 months" → compiled playlist
  → "create a goal called drum improvement — remind me every saturday"
  → goal surfaces on Dashboard + journal reminder on scheduled days
```

**What it does**

| Capability | Detail |
|------------|--------|
| **Asset tags** | Workspace `assetMeta`: `{ playbackId → tags[], activity, notes }` — from filename, manual chips, or AI-suggested tags (**artist confirms**) |
| **Filter + search** | Tag + date range + filename on music/journal; save filter as stack |
| **AI compile** | Natural language → structured query server-side → playable result list on Dashboard |
| **Goals** | `goals` store: title, linked tags/stacks, schedule (e.g. every Saturday) |
| **Recurring reminders** | Schedule seeds journal `reminders` on matching days; Dashboard shows active goals |
| **Smart stacks** | `smartStacks`: saved searches that refresh when new tagged uploads match |

**AI does (practice librarian only):**

- Parse intent → `search_assets`, `create_stack`, `create_goal` actions
- Suggest tags from filenames (confirm before apply)
- Compile playlists from tags + `createdAt` + journal contributions

**AI does not:**

- Critique performance, technique, or mix quality
- Write entry copy, captions, or journal prose
- Auto-tag or auto-create goals without confirm

**Security:** Same as on-demand AI — workspace JWT, server-side Mux list, **metadata only** to Anthropic (titles, tags, dates, durations). No raw audio bytes sent to the model.

**Build sub-phases (Phase 2 onward — see §13):**

| Sub-phase | Scope | Depends on |
|-----------|--------|------------|
| **2a — Tags + filter** | `assetMeta`, tag chips on upload, date/tag filter bar, "save as stack" | Tier 1 complete |
| **2b — AI search + compile** | Action parsing in `studio-ai.js`, result playlist on Dashboard, link to stacks | 2a |
| **2c — Goals + recurring reminders** | `goals` store, Dashboard goal cards, Saturday → journal reminder seeding | 2a, unified calendar (Phase 2) |
| **3+ — Smart stacks + transcripts** | Auto-refresh saved searches; optional transcript index for voice memos | 2b, optional STT provider |

**UI surfaces:** Dashboard (search + goals + analytics), music page (tags/filter), journal (contributions already date-link clips).

### 9.7.2 Session-file assistant (vault + context-aware AI)

**Purpose:** While listening in studio, ask the assistant to **surface project files** for the current or named song — organize and retrieve, not critique.

**Example flow:**

```
Music tab: now playing "RBG"
  → SPA nav to Dashboard / AI (playback continues)
  → "pull up the session files for RBG"
  → file list: RBG.logicx, RBG_stems.zip, RBG_ref_mix.wav — each with download
```

**Depends on:** R2 project vault (§6), `projectFiles` manifest, `songGroupKey` linking (existing in `asset-cloud.js` / versions API).

**AI actions:**

| Action | Behavior |
|--------|----------|
| `get_session_files` | `{ songGroupKey \| title }` → query `projectFiles` + R2 manifest → return list |
| `get_session_files_for_now_playing` | Uses `context.nowPlaying.songGroupKey` when user says "this song" / "session files for RBG" |
| `upload_session_file` | (UI) Song page or music row → attach `.logicx` / stem zip → R2 + manifest row |

**AI does not:** Open or edit DAW projects; critique mixes; auto-upload without confirm.

**Build sub-phases:**

| Sub-phase | Scope | When |
|-----------|--------|------|
| **2d — Project vault upload** | R2 project paths, `projectFiles` manifest, upload UI on song/music row | Tier 2 (with master vault) |
| **2e — Context-aware AI retrieval** | Pass `nowPlaying` to `studio-ai.js`; `get_session_files` action; download links on Dashboard | Tier 2, after 2d |
| **3+ — Migrate local asset-cloud** | Move IndexedDB session refs → workspace `projectFiles`; dedupe by hash | Tier 3 |

**SPA requirement:** AI panel reachable from music/video without tearing down playback (`studio-spa-router.js` + global playback shell — already the pattern).

### 9.8 Commerce & merch

Extend existing **Stripe + Shippo** (gallery shop today) into studio:

- Orders dashboard, SKUs, inventory
- Tie merch drops to release pipeline
- Fulfillment status, tracking, label URLs
- Tips summary in money view

### 9.9 Fan relationship

- Subscriber list in studio (from newsletter — workspace-scoped)
- Segment by release interest / purchase history
- Release notification workflow
- Share-link analytics tied to fan context where identifiable

### 9.10 Financial view

Not full accounting — export to external tools for tax prep:

- DSP revenue (distro analytics)
- Collaborator splits + owed amounts (documented; auto-pay v2+)
- Payout reconciliation notes
- Tips + merch (Stripe)
- Sync/license fee log
- Tax-year CSV export

### 9.11 Marketing, PR & sync

- Content / marketing planner — idea → drafting → scheduled → posted
- Playlist pitching log (manual tracking — no automated spam)
- EPK / press kit from vault assets
- Sync licensing pipeline stages
- Gallery home as link-in-bio

### 9.12 Live performance

- Show calendar events
- Setlist builder (ISRC/track pick)
- Ticket links
- Post-show journal notes → optional entry link

### 9.13 Rights & PRO (track, don't become)

- PRO registration status + links (ASCAP/BMI) — not filing
- Copyright registration status — tracked only
- Sample clearance flag per track

### 9.14 Collaboration (detailed)

- Invite: email → role → workspace access
- Co-create albums: stack, vault uploads, credits — owner gates publish/submit
- Comment threads on tracks/releases
- Activity log
- External feedback via share links (no account)

### 9.15 Gallery publish

- Per-workspace block-based entries (existing editor model)
- Phase B images + IMAGES/
- Republish with confirmation (fix 409)
- Voice enforced by editor + AI brief — not AI generation

---

## 10. Studio design language

Same **identity tokens** as gallery: monospace, square corners, grayscale, lowercase labels.

**Difference:** studio is **interactive** — hover, DnD, tabs, panels, inline edit. Gallery forbids these.

Priority: intuitive → sleek → secure → mobile-first PWA.

### Mobile standards (preserve from shipped studio)

- `BurnfolderTouchTap` for all playback taps — 10px slop, touchend gesture window, no duplicate click layer
- 44px touch targets, safe-area padding
- Bump `site-version.js` + SW cache name on playback/tap changes

### Desktop reality

Distro metadata, master uploads, analytics review, and split documentation are **desktop-weighted**. Mobile excels at: journal, quick listen, share links, AI nudges, pipeline glance.

---

## 11. Studio navigation (target)

| Area | Role |
|------|------|
| **dashboard** | Analytics home — streaming metrics, AI digest/analysis, pipeline/calendar (phased), now playing, quick actions |
| **catalog** | Music/video, stack/albums, vault, versions, lifecycle board |
| **entries** | Draft hub + editor + gallery publish |
| **releases** | Distro drafts, submit, import/backfill, checklist |
| **journal** | Private day plan, notes, checklist |
| **social** | YouTube + Instagram |
| **commerce** | Orders, merch, tips |
| **fans** | Subscribers, segments, notifications |
| **money** | Revenue, splits, exports |
| **marketing** | Campaign planner, EPK, pitches, sync |
| **live** | Shows, setlists |
| **settings** | Workspace, guests, distro, domain, AI prefs, export |

SPA shell keeps global playback alive across nav. Entry hub ↔ editor via `editor-gate.js` without full reload.

---

## 12. Technical conventions

- Extend **this repo** (static site + Netlify Functions) — rejected: full Next.js rewrite as v1 requirement
- Postgres/Supabase for relational tenant data; Blobs/R2 for vault + large JSON during transition
- All studio functions gain workspace scoping
- Never commit secrets — Netlify env + gitignored `.env`
- Private journal never on gallery
- Guests cannot publish or submit distro without owner role
- Entry editor: don't cache DOM refs at load — use SPA re-init hooks

---

## 13. Build phases (full vision — not resource-filtered)

| Phase | Focus |
|-------|-------|
| **0 — Tenant foundation** | Auth, workspaces, roles, scoped API, master vault, migrate workspace #1, subdomain gallery, export, security hardening |
| **1 — Port studio** | Entries, Mux, journal, share links, designers, SPA, mobile, collaborators — all workspace-scoped |
| **2 — Lifecycle & calendar** | Pipeline state machine, unified calendar, credits/splits, pre-release checklist; **practice librarian 2a–2c**; **project vault 2d–2e** (session files + context-aware AI retrieval) |
| **3 — Distribution v1** | LabelGrid/Too Lost adapter, ISRC/UPC, submit, **catalog import**, DSP analytics ingest; **smart stacks** (saved practice searches) |
| **4 — Analytics & money** | Dashboard streaming feed (ingest + charts), AI metrics digest, financial view, fan panel, commerce in studio |
| **5 — AI layer** | On-demand + proactive copilot, briefs, checklist, capability navigator, import assist; **practice librarian AI search + compile actions** (2b) |
| **6 — Social** | YouTube then Instagram — connect, insights, calendar linking |
| **7 — Marketing, PR, live** | Campaign planner, EPK, playlist log, sync, shows/setlists |
| **8 — Gallery hardening** | Custom domains, Phase B images, republish, per-workspace deploy automation |
| **9 — Distribution v2** | Provider migration tooling (→ Revelator/FUGA), Bandcamp/SoundCloud analytics |

---

## 14. Explicitly out of scope

- Full accounting / QuickBooks replacement
- In-app DAW or stem editor
- Social DM inbox
- Hosted fan community (Discord, etc.)
- Automated playlist spam
- Sample clearance legal workflow (flag only)
- AI entry designer or auto-generated copy
- Every social platform day one (YT + IG only for v1)
- Open signup at scale without billing/abuse controls (pending resource pass)

---

## 15. Decisions locked in (full chat reference)

| Topic | Decision |
|-------|----------|
| Tenancy | Multi-user from v1; dogfood as normal workspace user |
| First tenant | burnfolder.com = workspace #1 gallery |
| Gallery URL | `{slug}.burnfolder.com` + custom domain option |
| Masters | Cloud vault — required, not Mux-only |
| Distro | **LabelGrid** (Tier 2+); **Revelator** only if Tier 5 |
| ISRC | Immutable; LabelGrid assigns on submit |
| Import | **LabelGrid API** at Tier 3 |
| AI | **Anthropic Claude Haiku** only |
| AI modes | On-demand Tier 1; proactive optional Tier 2 |
| AI boundary | Ops only — no copy, captions, entry design; practice librarian organizes only — no performance critique |
| Practice librarian | Tags + AI compile + goals — Phase 2+ (§9.7.1); metadata-only to AI |
| Social | **YouTube** Tier 3; **Instagram** Tier 4 |
| Site traffic | **Cloudflare Web Analytics** |
| Vault | **Cloudflare R2** — masters + **project/session files** |
| Project vault | R2 `projects/{songGroupKey}/` — session files linked to songs; AI retrieval Tier 2 (§9.7.2) |
| Auth | **Supabase** |
| Tier 4 price | **$15/mo** Stripe subscription, one tier |
| Collaboration | Guest accounts + co-album creation; share links for externals |
| Export | Full workspace export required |
| Money | Splits, payout notes, sync fees, tax export — in plan |
| Fans | Subscriber panel + segments — in plan |
| Merch | Studio commerce surface — in plan |
| Checklist | AI-assisted — in plan |
| Link-in-bio | Gallery home — no Linktree |
| Distro ≠ gallery | Separate explicit publish actions |

---

## 16. Risks & guardrails (from gap review)

| Risk | Guardrail |
|------|-----------|
| Scope creep | Core loop test for every feature |
| Voice erosion | No AI copy; briefs give constraints only; practice librarian organizes — never critiques performance |
| Mobile/distortion | Distro/checklist on desktop; mobile for capture + glance |
| SaaS vs dogfood | v1 audience decision gates billing/abuse/onboarding depth |
| Provider lock-in | ISRC-centric schema + adapter interface from day one |
| Trust | Export + import from day one |

---

## 17. Frugal tier plan (resource-filtered)

**Operator profile:** sole operator, ~$100/mo budget, no code experience, musician-first. Platform serves **your catalog** first; collaborators are immediate circle; other users = invite-only until Tier 4.

**v1 audience:** Hand-onboarded only — you + invited collaborators. No public signup until Tier 4.

---

### The path (follow in order)

```
Tier 1  Supabase login + collaborators + your existing studio on burnfolder.com
Tier 2  Cloudflare R2 masters + LabelGrid → Spotify/Apple + cover art on site
Tier 3  Dashboard streaming ingest (LabelGrid + share links + Mux) + AI digest + YouTube + catalog import
Tier 4  Other artists pay $15/mo → theirname.burnfolder.com + Instagram
Tier 5  Ignore until LabelGrid can't scale (Revelator) — years away
```

---

### Locked stack (no alternatives unless noted)

These choices are final for this project. Copilot implements against this table only.

| Job | Company | When | ~Cost/mo |
|-----|---------|------|----------|
| Site + functions | **Netlify** | Now | $0–19 |
| Streaming playback | **Mux** | Now | $10–40 |
| Login + workspace DB | **Supabase** | Tier 1 | $0 |
| Studio drafts/sync | **Netlify Blobs** (workspace-prefixed keys) | Tier 1 | $0 |
| Master WAV/FLAC storage | **Cloudflare R2** | Tier 2 | ~$1–5 |
| DSP distribution | **LabelGrid** | Tier 2 | *LabelGrid plan — budget separately* |
| AI assistant | **Anthropic Claude Haiku** | Tier 1 | $5–10 cap |
| Gallery (you) | **burnfolder.com** | Tier 1 | — |
| Gallery (others) | **`{slug}.burnfolder.com`** on Netlify | Tier 4 | — |
| Site traffic stats | **Cloudflare Web Analytics** | Tier 3 | $0 |
| Social analytics | **YouTube** (Tier 3), **Instagram** (Tier 4) | Tier 3+ | $0 |
| Shop + subscriptions | **Stripe** (+ **Shippo** for physical merch) | Now / Tier 4 | % of sales |
| Code editor | **Cursor + Copilot** | Now | existing |

**Do not use:** Too Lost, OpenAI (unless Anthropic fails), Plausible, Clerk, Auth0, DistroKid, Revelator (until Tier 5), separate Linktree.

**One exception only:** If LabelGrid rejects your application or has no API on your plan, stop and ask Copilot to evaluate **TuneCore API** or manual LabelGrid dashboard workflow before switching distro — do not preemptively sign up elsewhere.

### How to use this section

1. Complete the **For you** checklist for your current tier only
2. Tell Copilot: *"Implement Tier N per STUDIO-MASTER-PLAN.md section 17."*
3. Run the tier **Verify** checklist
4. Use it on a real release before advancing

Copilot reads `COPILOT.md` + this file before writing code.

---

### Your time (operator hours)

Estimates are **your** active time — not Copilot build time. Assumes no code experience, using Cursor for implementation. Add buffer if something breaks (OAuth screens often take 2×).

| Tier | When | One-time setup | Copilot sessions | Verify & test | Per release / ongoing |
|------|------|----------------|------------------|---------------|------------------------|
| **1** | Now | **2–3 h** | **2–4 h** (1–2 sessions) | **1 h** | **1–2 h/week** using studio |
| **2** | Release in 60 days | **2–3 h** | **2–3 h** | **1–2 h** | **3–5 h/release** (masters, metadata, submit) |
| **3** | After DSP live | **2–4 h** | **1–2 h** | **45 min** | **~30 min/month** checking stats |
| **4** | Others want in | **4–6 h** | **3–5 h** | **1–2 h** | **1–2 h/month** if users sign up |
| **5** | Years away | **10+ h** + hire dev | — | — | — |

**Calendar totals (spread over weeks, not one sitting):**
- **Tier 1 live:** ~**6–10 hours** over 1–2 weeks
- **Through first DSP release (Tier 2):** +**8–13 hours** on top of Tier 1
- **Through analytics (Tier 3):** +**4–7 hours**
- **Through paid product (Tier 4):** +**9–13 hours** — only if triggered

**Passive waiting (not counted):** Netlify deploy ~5 min · DNS/SSL up to 24 h · LabelGrid DSP review **3–14 days** · collaborator accepting invite whenever they open email

**Weekly cap (musician-first):** **≤2 hours/week** on platform ops unless a release deadline requires Tier 2 work that week.

---

| Block | Who | Purpose |
|-------|-----|---------|
| **For you** | Nathaniel (operator) | Accounts to create, keys to copy, Netlify env vars, how to verify, budget checks — no code required |
| **For Copilot** | Cursor / AI agent | What to build, which files to touch, acceptance criteria, what **not** to build in this tier |

**Workflow per tier:**
1. Read tier goal + trigger — don't start a tier early.
2. Complete **For you** checklists before asking Copilot to build.
3. Give Copilot: *"Implement Tier N per STUDIO-MASTER-PLAN.md section 17"* + paste the **For Copilot** block.
4. Run **Verify** steps when Copilot finishes.
5. Use the platform on a **real project** before starting the next tier.

**Reference docs Copilot must read before any tier work:**
- `STUDIO-MASTER-PLAN.md` (this file)
- `COPILOT.md` (gallery voice, studio conventions, shared modules)
- `studio/README.md`, `studio/MUX-SETUP.md` (local dev + Mux)

### What NOT to cut (expensive to reverse — bake in early, build thin)

| Decision | Tier 1 implementation |
|----------|------------------------|
| Workspace-scoped data | Prefix Blobs keys / add `workspace_id` everywhere — don't ship new global keys |
| Invite-only multi-user | Supabase Auth free tier + owner/collaborator/guest roles — minimal UI |
| ISRC field on tracks | Text field + registry in Blobs/Postgres lite — even before distro |
| Distro adapter interface | Don't build LabelGrid yet — but don't hardcode one-off distro logic when you do |
| Gallery voice rules | Already in editor + COPILOT — free |
| Private journal ≠ entry | Already built — keep |

### What to cut or defer (save time + money)

| Module | Verdict | When |
|--------|---------|------|
| `{slug}.burnfolder.com` multi-gallery | **Defer** | Tier 4 — Tier 1: burnfolder.com only |
| Custom domains | **Defer** | Tier 4 |
| LabelGrid distro | **Defer** | Tier 2 |
| Master file vault (R2) | **Defer** | Tier 2 — Tier 1: Mux + local master discipline |
| Catalog import from provider | **Defer** | Tier 2–3 — with distro |
| Unified analytics ingest + charts | **Defer** | Tier 3 — Tier 1: dashboard shell + share-link counts only; AI panel ready for metrics snapshot |
| YouTube | **Defer** | Tier 3 |
| Instagram | **Defer** | Tier 4 (second social) |
| AI proactive nudges | **Defer** | Tier 2 — Tier 1: on-demand only |
| Marketing planner, EPK, playlist log, sync | **Defer** | Tier 4 |
| Live shows / setlists | **Defer** | Tier 4 |
| PRO / copyright tracking | **Defer** | Tier 4 |
| Financial panel (splits, tax export) | **Defer** | Tier 3–4 |
| Fan CRM / segments | **Defer** | Tier 3 — newsletter on gallery still works |
| Commerce in studio | **Defer** | Tier 3 — Stripe shop on gallery stays as-is |
| Command palette ⌘K | **Defer** | Tier 3 |
| Full Postgres catalog schema | **Defer** | Tier 2 — Supabase auth + Blobs suffices at small scale |
| Revelator migration | **Defer** | Tier 5+ |
| Bandcamp / SoundCloud | **Defer** | Tier 5 |
| Open signup + billing | **Defer** | Tier 4 — only if others will pay |
| Offline-first PWA hardening | **Defer** | Tier 2 — basic PWA already exists |
| Phase B gallery images | **Defer** | Tier 2 — when a release needs cover art on site |
| Republish existing dates (409 fix) | **Defer** | Tier 2 — workaround: new date or manual git |
| Practice asset tags + filter (2a) | **Defer** | Tier 2 — parallel to release machine; does not block distro |
| AI practice search + compile (2b) | **Defer** | Tier 2 — after 2a; extends `studio-ai.js` with actions |
| Practice goals + recurring reminders (2c) | **Defer** | Tier 2 — after 2a + calendar |
| Smart stacks + transcript search (3+) | **Defer** | Tier 3 — optional STT for voice memos |
| Project vault — session/stem upload (2d) | **Defer** | Tier 2 — R2 alongside master vault |
| AI session-file retrieval (2e) | **Defer** | Tier 2 — context from now playing |
| Migrate local asset-cloud → R2 (3+) | **Defer** | Tier 3 — IndexedDB → workspace manifest |

---

### Tier 1 — **Catalog OS** (now → next few months)

**Your time:** ~**6–10 h** one-time · then **1–2 h/week** ongoing

**Goal:** Perfect release workflow for *your* projects + immediate collaborators. Zero distraction from active music.

**You get:** invite-only accounts, workspace-scoped studio, **dashboard** (analytics home shell + on-demand AI), light track status, simple calendar, share links, publish to burnfolder.com, JSON export.

**You skip:** distro, vault, social, **streaming analytics ingest** (DSP/Mux/social feeds — Tier 3), subdomains, marketing, money/fans/commerce in studio.

**Build order:** (1) Supabase Auth + workspaces + invites → (2) scope Blobs/Mux/publish → (3) track status + calendar → (4) dashboard AI panel → (5) migrate your data.

**Dashboard (shipped):** `/studio/dashboard.html` — streaming placeholder + AI panel. Share-link play counts are the first metrics feed when ingest lands in Tier 3.

**~$100/mo budget:** Netlify $0–19 · Mux $10–40 · Supabase $0 · AI $5–15 · **Total ~$20–75**

---

#### For you — Tier 1 operator checklist (~5–8 h active + 2–4 h with Copilot)

| Step | Your time | What you're doing |
|------|-----------|-------------------|
| Pre-flight (logins) | **15 min** | Confirm Netlify, Mux, GitHub access |
| Step 1 — Supabase | **45–60 min** | Create project, copy keys, add URLs, create your user |
| Step 2 — Anthropic | **15–20 min** | Account, API key, billing alert |
| Step 3 — Netlify env vars | **30–45 min** | Paste ~10 variables; easy to miss one — go slow |
| Copilot build | **2–4 h** | 1–2 Cursor sessions: paste prompt, answer questions, redeploy if needed |
| Step 4 — Verify | **45–60 min** | Sign in, invite collaborator, test upload/publish/AI/export |
| **Tier 1 total** | **~6–10 h** | Spread over 1–2 weeks at ≤2 h/week |

**Before any Copilot build session**

- [ ] Confirm you can log into [Netlify](https://app.netlify.com) (site: burnfolder.com)
- [ ] Confirm you can log into [Mux dashboard](https://dashboard.mux.com) (already used for studio)
- [ ] Confirm GitHub repo access (publish live uses `GITHUB_TOKEN`)

**Step 1 — Supabase (auth + workspace DB)**

1. Go to [supabase.com](https://supabase.com) → **Start your project** (free tier)
2. Create project: name e.g. `burnfolder-studio`, strong DB password → **save password in password manager**
3. Wait for project to finish provisioning (~2 min)
4. **Project Settings → API** — copy and save:
   - `Project URL` → you'll set as `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**never put in browser code or git**)
5. **Authentication → Providers → Email** — enable Email; disable "Confirm email" for now if you want faster invites for collaborators (re-enable later)
6. **Authentication → URL configuration** — add site URLs:
   - `https://burnfolder.com`
   - `http://localhost:8888` (local `netlify dev`)
7. Create your account: **Authentication → Users → Add user** (your email + password) — this is workspace owner #1

**Step 2 — Anthropic (AI)**

1. Go to [console.anthropic.com](https://console.anthropic.com) → create account
2. **API Keys → Create Key** → save as `ANTHROPIC_API_KEY`
3. Set billing alert at **$10/mo**

**Step 3 — Netlify environment variables**

Netlify dashboard → your site → **Site configuration → Environment variables**. Add (or update):

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → service_role key (**functions only**) |
| `MUX_TOKEN_ID` | existing |
| `MUX_TOKEN_SECRET` | existing |
| `GITHUB_TOKEN` | existing — repo write for publish live |
| `ANTHROPIC_API_KEY` | from Anthropic console |
| `AI_PROVIDER` | `anthropic` |
| `AI_MODEL` | `claude-3-5-haiku-latest` |
| `STUDIO_API_SECRET` | keep until Tier 1 deploy; remove from production after Supabase auth works |

For **local** dev, mirror the same keys in repo root `.env` (file is gitignored — never commit).

**Step 4 — After Copilot deploys Tier 1**

- [ ] Open `https://burnfolder.com/studio/` — sign in with Supabase email (not old studio password)
- [ ] Invite one collaborator email from studio settings
- [ ] Collaborator accepts invite, signs in, opens same workspace
- [ ] Upload a test track to Mux, confirm it appears only in your workspace
- [ ] Create entry draft, publish live, confirm burnfolder.com updates
- [ ] Ask AI one on-demand question (e.g. "what can studio publish today?")
- [ ] Run workspace export, download JSON backup

**Tier 1 discipline**

- Keep WAV masters on your drive in a folder per project until Tier 2 vault — name files with ISRC when assigned
- Platform work: **≤2 h/week** — see table above
- Don't create LabelGrid, YouTube dev apps, or R2 yet

**Tier 1 ongoing (after setup):** **~1–2 h/week** — journal, drafts, collaborator album work, one AI question. This *is* the tool serving your catalog; it shouldn't feel like infra work.

---

#### For Copilot — Tier 1 implementation guide

**Read first:** `COPILOT.md`, `studio/js/cloud-state.js`, `netlify/functions/studio-state.js`, `netlify/functions/lib/studio-auth.js`, `studio/js/studio-auth.js`

**Goal:** Invite-only multi-user workspace model. Scope all existing studio features to workspace #1 (`burnfolder`). Do **not** start Tier 2+ features.

**Build tasks (in order)**

1. **Supabase schema** — create `supabase/migrations/001_tier1.sql` (or use Supabase SQL editor doc in repo):
   - `workspaces` (id, slug, name, owner_user_id, created_at)
   - `workspace_members` (workspace_id, user_id, role: owner|collaborator|guest)
   - `workspace_invites` (email, workspace_id, role, token, expires_at)
   - Seed workspace slug `burnfolder` for owner
2. **Auth middleware** — new `netlify/functions/lib/workspace-auth.js`:
   - Verify Supabase JWT from `Authorization: Bearer`
   - Resolve `workspace_id` from header `X-Workspace-Id` or default membership
   - Enforce role caps (guest read-only, collaborator no publish/distro)
3. **Replace studio login** — update `studio/js/studio-auth.js`:
   - Supabase client sign-in (email/password)
   - Attach JWT to all studio API calls
   - Keep lock/logout button; remove sole reliance on `STUDIO_API_SECRET` in production when `SUPABASE_URL` is set
4. **Scope Netlify Blobs** — update `studio-state.js` + `cloud-state.js`:
   - Keys become `ws:{workspaceId}:{key}` (drafts, stack, stackMeta, journalDays, songPages, albumPages)
   - Migration script/function: copy current unscoped keys → `ws:{burnfolder-id}:…`
5. **Workspace UI** — minimal `studio/js/workspace-settings.js`:
   - Show workspace name, invite by email + role, list members, revoke
   - No billing, no public signup page
6. **Light pipeline** — extend `stream-shared.js` or new `studio/js/track-pipeline.js`:
   - Status enum on stack items: `demo|mix|master|ready` (stored in stackMeta)
   - Simple filter/sort in stream UI — no full kanban
7. **Release calendar** — new cloud key `releaseDates` (workspace-scoped):
   - Manual date + label + optional track/album link
   - Minimal list/calendar view on `studio/dashboard.html` (calendar section — phased after analytics shell)
8. **On-demand AI** — `netlify/functions/studio-ai.js` + dashboard AI section:
   - Anthropic Haiku only (`AI_MODEL=claude-haiku-4-5` or current Haiku slug)
   - Workspace-gated; read-only context snapshot (draft count, pipeline, COPILOT excerpt)
   - **Analytics role (Tier 1 shell):** prompt + UI ready to digest metrics when Tier 3 passes a snapshot — never invent numbers
   - **Hard rule:** reject prompts asking to write entry copy, captions, lyrics
   - UI: `#studioAiForm` on dashboard — no proactive nudges in Tier 1
9. **Workspace export** — `netlify/functions/studio-export.js`:
   - GET returns JSON bundle of all workspace Blob keys + pipeline + member list metadata
10. **Update COPILOT.md** — document Tier 1 auth, workspace scoping, retired patterns

**Do NOT build in Tier 1**

- LabelGrid, R2 vault, `{slug}.burnfolder.com`, YouTube/Instagram OAuth
- Proactive AI, **streaming analytics ingest** (§9.5 — dashboard shell is Tier 1), fan CRM, commerce studio UI
- Postgres catalog tables beyond workspaces/members/invites
- Open signup, Stripe billing for workspaces
- Phase B images, republish 409 fix (unless trivial — otherwise Tier 2)

**Acceptance criteria**

- [ ] Owner + collaborator + guest roles behave per section 5
- [ ] Two users in same workspace see same drafts/stack; different workspace cannot cross-read
- [ ] Mux upload/list still works workspace-gated
- [ ] Publish live still writes to burnfolder.com repo for workspace `burnfolder` only
- [ ] AI answers capability questions without generating copy
- [ ] Dashboard loads with streaming placeholder + AI panel; `/studio/today.html` redirects to dashboard
- [ ] Export produces valid JSON backup
- [ ] No secrets in git; all new env vars documented in `studio/TIER-1-SETUP.md`

**Deliverable doc:** create `studio/TIER-1-SETUP.md` with operator env var table mirroring **For you** above.

---

### Tier 2 — **Release machine**

**Your time:** ~**8–13 h** for first release · then **3–5 h/release** after that

**Trigger:** You have a release date on Spotify/Apple within the next 60 days.

**Add:** Cloudflare R2 vault + **LabelGrid** submit + ISRC + checklist + gallery cover art (Phase B) + republish fix. **Optional parallel:** practice librarian 2a–2c (tags, AI compile, goals) — see §9.7.1; does not block first DSP release.

---

#### For you — Tier 2 operator checklist (~8–13 h first release)

| Step | Your time | What you're doing |
|------|-----------|-------------------|
| Step 1 — Cloudflare R2 | **30–45 min** | Account, bucket, API token, Netlify env |
| Step 2 — LabelGrid | **1–2 h** | Signup, artist profile (legal name, PRO), API key, confirm pricing |
| Copilot build | **2–3 h** | One Cursor session for vault + distro UI |
| Step 3 — Prepare release | **2–4 h** | Masters, 3000×3000 art, credits doc — *music work*, not admin |
| Step 4 — Verify + submit | **1–2 h** | Upload masters, checklist, submit, publish gallery entry |
| **DSP review wait** | **0 h active** | LabelGrid → stores: **3–14 days** — go make music |
| **Tier 2 first release** | **~8–13 h** | Can split across 2–3 weeks |
| **Each later release** | **~3–5 h** | Mostly Step 3–4; accounts already exist |

**Step 1 — Cloudflare (R2 vault + free analytics later)**

1. [dash.cloudflare.com](https://dash.cloudflare.com) → sign up with same email you use for the domain if possible
2. **R2 Object Storage** → Create bucket: `burnfolder-masters`
3. **Manage R2 API Tokens** → Create token → Object Read & Write on `burnfolder-masters`
4. Save to password manager and Netlify env:

| Variable | Where to find it |
|----------|------------------|
| `R2_ACCOUNT_ID` | Cloudflare dashboard URL or R2 overview |
| `R2_ACCESS_KEY_ID` | Token creation screen |
| `R2_SECRET_ACCESS_KEY` | Token creation screen (shown once) |
| `R2_BUCKET_NAME` | `burnfolder-masters` |

**Step 2 — LabelGrid (distribution — only distro we use)**

1. Go to [labelgrid.com](https://www.labelgrid.com) → sign up for artist + API-capable plan
2. Complete artist profile in their dashboard (legal name, PRO, etc.)
3. **Settings → API** (or Developer) → create API key → save as `LABELGRID_API_KEY`
4. Add to Netlify: `DISTRO_PROVIDER=labelgrid`
5. **Before paying:** confirm monthly cost fits your release budget — pause Tier 2 if the plan exceeds ~$40/mo on top of Mux

**Step 3 — Prepare one real release**

- [ ] WAV or FLAC master per track (24-bit/44.1kHz minimum)
- [ ] Cover art exactly **3000×3000** JPG or PNG
- [ ] Credits written out (writers, producers, featured artists, year)
- [ ] LabelGrid assigns ISRC on submit — leave ISRC blank in studio until first submit returns one

**Step 4 — Verify Tier 2**

- [ ] Upload master → appears in studio vault (R2)
- [ ] Build release from album stack → checklist all green
- [ ] Submit to LabelGrid → status shows submitted/live in studio
- [ ] Publish burnfolder.com entry with cover image (Phase B)
- [ ] Collaborator still cannot submit distro or gallery publish

**Do not start Tier 2 until Tier 1 verify checklist is complete.**

---

#### For Copilot — Tier 2 implementation guide

**Read first:** Tier 1 code, `netlify/functions/studio-publish.js` (Phase B gaps), `shared/publish-artifacts.js`

**Build tasks**

1. **R2 vault** — `netlify/functions/lib/master-vault.js` + `studio/js/vault-upload.js`:
   - Presigned or proxied upload; workspace-scoped paths:
     - Masters: `ws/{id}/masters/{isrc-or-temp}/{filename}`
     - **Projects:** `ws/{id}/projects/{songGroupKey}/sessions/` and `…/stems/`
   - Link master objects to track in `trackRegistry` Blob key
   - **Project manifest** in workspace Blob `projectFiles`: `{ id, songGroupKey, kind: session|stem|ref, vaultKey, filename, size, uploadedAt }`
   - Download via presigned URL; session files **never** go to Mux
2. **Distro adapter** — `netlify/functions/lib/distribution/`:
   - `distribution.interface.js` + `labelgrid.provider.js` only
   - Methods: createRelease, submitRelease, getReleaseStatus, getAnalytics (stub OK)
   - `DISTRO_PROVIDER` env must be `labelgrid` — no other provider in Tier 2
3. **ISRC registry** — workspace Blob `trackRegistry`: `{ isrc, title, vaultKey, muxPlaybackId, providerTrackId, status }`
   - UI: ISRC field on stream track / song page; validate uniqueness; **immutable after assign**
4. **Releases UI** — `studio/releases.html` + `studio/js/releases-page.js`:
   - Build release from stack/album → attach masters + artwork from vault → submit
   - Owner-only submit; collaborators can prepare
5. **Pre-release checklist** — `studio/js/release-checklist.js`:
   - Rule engine per section 9.4; integrate AI assist via existing `studio-ai.js` (read-only audit)
6. **Phase B publish** — extend `studio-publish.js` + entry editor for image blocks + `IMAGES/` commit
7. **Republish** — allow `republish: true` on existing dates with confirmation modal
8. **Proactive AI (optional)** — only if flag `AI_PROACTIVE=true`; nudges for checklist failures only
9. **Update docs** — `studio/TIER-2-SETUP.md`

**Practice librarian (parallel — Phase 2 sub-phases; build after Tier 1 verify, does not block distro submit):**

10. **Asset tags (2a)** — workspace Blob `assetMeta` + `studio/js/asset-meta.js`:
    - Tag chips on music/journal upload; infer hints from filename (`drums`, `practice`, etc.)
    - Filter bar: tag + date range on `stream.html`; "save filter as stack" → existing `groups`
11. **AI search + compile (2b)** — extend `netlify/functions/studio-ai.js`:
    - Parse NL → `{ action: 'search_assets', filters: { tags, since, until } }` or `create_stack` / `create_goal`
    - Dashboard: render result playlist (reuse stream row UI + playback shell); confirm before mutating state
    - **Metadata only** to Anthropic — no audio bytes
12. **Goals + recurring reminders (2c)** — workspace Blob `goals` + Dashboard goal cards:
    - `{ title, tags, linkedStackId, schedule: { weekday, time }, reminderText }`
    - On schedule match: seed `journalDays[dateKey].reminders`; surface on Dashboard
    - In-app only in Tier 2 — PWA push notifications defer to Tier 3+
13. **Acceptance (practice librarian)** — upload 3 drum clips tagged `drums`; AI query "drumming last 2 months" returns playable list; create Saturday goal; reminder appears on matching journal day

14. **Session-file assistant (2d–2e)** — extend vault + `studio-ai.js`:
    - Upload `.logicx` / stem zip from song page linked to `songGroupKey`
    - AI panel accepts `context.nowPlaying` from playback shell
    - Query "pull up session files for RBG" → downloadable file list; playback continues if user navigated from music via SPA
15. **Acceptance (session files)** — upload Logic session for a stack song; while playing that song, ask AI for session files; list matches; download works with workspace auth

**Do NOT build in Tier 2:** multi-gallery, social OAuth, catalog import, **streaming analytics ingest** (§9.5 — Tier 3), billing, performance critique AI, auto-tag without confirm, in-browser DAW

**Acceptance criteria**

- [ ] Master uploads to R2; distro submit uses vault file
- [ ] ISRC cannot be changed after lock
- [ ] LabelGrid submit succeeds for test release
- [ ] Gallery entry publishes with cover image
- [ ] Collaborator can build album but cannot submit distro or gallery publish

---

### Tier 3 — **Measure & promote**

**Your time:** ~**4–7 h** one-time · then **~30 min/month**

**Trigger:** At least one release is live on DSPs and you want stream counts in one place.

**Add:** LabelGrid analytics + Mux + share links in studio dashboard, **YouTube** connect, **LabelGrid catalog import**, fan list + orders (read-only).

---

#### For you — Tier 3 operator checklist (~4–7 h)

| Step | Your time | What you're doing |
|------|-----------|-------------------|
| Step 1 — Cloudflare Web Analytics | **15–20 min** | Add site, copy beacon snippet for Copilot |
| Step 2 — YouTube OAuth | **1–2 h** | Google Cloud project — **budget 2 h** if first time; most common snag |
| Step 3 — Catalog prep | **30–60 min** | List LabelGrid releases + missing vault masters |
| Copilot build | **1–2 h** | One Cursor session |
| Step 4 — Verify | **30–45 min** | Connect YouTube, run import, check dashboard streaming section + ask AI about trends |
| **Tier 3 total** | **~4–7 h** | Mostly one afternoon |
| **Ongoing** | **~30 min/month** | Glance analytics before planning next release |

**Step 1 — Cloudflare Web Analytics (free site traffic)**

1. Cloudflare dashboard → **Web Analytics** → Add site `burnfolder.com`
2. Copy the JS beacon snippet Copilot will place in gallery pages (or give Copilot the snippet from dashboard)
3. No env var required — snippet-only is fine

**Step 2 — YouTube (only social platform in Tier 3)**

1. [Google Cloud Console](https://console.cloud.google.com) → **New project** → name: `burnfolder-studio`
2. **APIs & Services → Library** → enable **YouTube Data API v3**
3. **OAuth consent screen** → External → add your Google account as test user
4. **Credentials → Create OAuth client ID** → Web application
5. Authorized redirect URI: `https://burnfolder.com/.netlify/functions/social-youtube-callback`
6. Add to Netlify:

| Variable | Value |
|----------|-------|
| `YOUTUBE_CLIENT_ID` | OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | OAuth client secret |

**Step 3 — LabelGrid catalog import prep**

1. Log into LabelGrid → note every live release: title, UPC, track ISRCs
2. List tracks missing WAV in R2 vault — upload masters before import completes

**Step 4 — Verify Tier 3**

- [ ] Dashboard **streaming** section shows LabelGrid streams for at least one track
- [ ] AI digest: ask dashboard AI "which track gained streams this week?" — answer grounded in ingested metrics, not invented
- [ ] YouTube connect works → video view count visible on dashboard
- [ ] **Import catalog** pulls LabelGrid discography into studio
- [ ] Subscriber emails visible in **fans** tab
- [ ] Stripe orders visible read-only in **commerce** tab

*Instagram waits until Tier 4.*

---

#### For Copilot — Tier 3 implementation guide

**Practice librarian (Phase 3 continuation — if 2a–2c not done in Tier 2):**

1. **Smart stacks** — workspace Blob `smartStacks`:
   - Saved `{ name, filters }` that re-query Mux + `assetMeta` on library refresh
   - UI: pin smart stack on Dashboard or music page; badge when new matches land
2. **Transcript index (optional)** — server-side STT on upload or on-demand for voice memos:
   - Store transcript in `assetMeta`; search includes transcript text
   - Workspace-gated; STT provider env (`STT_PROVIDER`) — never send raw audio to Anthropic
3. **Goal nudges** — extend proactive AI (if enabled) to surface stale practice goals only — not performance feedback

**Build tasks**

1. **Analytics ingest** — cron or on-demand `netlify/functions/sync-analytics.js`:
   - Pull from distro adapter `getAnalytics`, Mux Data API (if available), aggregate share-link counts from Blobs
   - Store normalized rows in workspace Blob `dspMetrics` or Supabase table
2. **Dashboard streaming UI** — extend `studio/dashboard.html` + `studio/js/dashboard-page.js`:
   - Populate `#dashboardAnalyticsFeed` with per-track/per-release tables — minimal, monospace, mobile-readable
   - Hide `#dashboardAnalyticsEmpty` when data exists
3. **AI metrics digest** — extend `studio-ai.js` POST body:
   - Optional `metricsSnapshot` from latest `dspMetrics` + share-link aggregates (server-side fetch, workspace-scoped)
   - System prompt: summarize patterns, compare periods — **never invent numbers** (see §9.5)
4. **YouTube only** — `social-youtube-auth.js`, `social-youtube-callback.js`:
   - No Instagram code in Tier 3
5. **Catalog import** — `labelgrid.provider.js` `importCatalog()` only:
   - Map to `trackRegistry` + pipeline stages; flag missing vault masters
   - AI assist mapping in `studio-ai.js` — confirm before write
6. **Fans panel** — `studio/fans.html`: read `subscribe` Blobs scoped to workspace newsletter key
7. **Commerce read-only** — list recent Stripe payment intents / orders via existing webhook data or Stripe API
8. **Docs** — `studio/TIER-3-SETUP.md`

**Do NOT build in Tier 3:** Instagram, marketing planner, billing, multi-gallery

---

### Tier 4 — **Solvent tool**

**Your time:** ~**9–13 h** setup · then **1–2 h/month** if users sign up

**Trigger:** Someone outside your circle asks to use Burnfolder Studio, or monthly costs exceed $100 and you need revenue.

**Add:** `{slug}.burnfolder.com` galleries, **$15/mo Stripe subscription**, **Instagram** analytics, marketing planner, custom domains.

**Price:** One tier only — **$15/month per workspace** (change in Stripe once if costs demand it).

---

#### For you — Tier 4 operator checklist (~9–13 h)

| Step | Your time | What you're doing |
|------|-----------|-------------------|
| Step 1 — Stripe subscription | **30–45 min** | Product, price ID, webhook |
| Step 2 — Wildcard DNS | **30–45 min** active | **+ up to 24 h wait** for SSL |
| Step 3 — Instagram Meta app | **1–2 h** | Business app + link IG to Facebook Page |
| Step 4 — Legal pages | **1–2 h** | Read Copilot draft of terms/privacy; edit in your words |
| Copilot build | **3–5 h** | 2 sessions — billing + multi-gallery is largest build |
| Step 5 — Verify | **1–2 h** | Test paid signup end-to-end with test card |
| **Tier 4 total** | **~9–13 h** | Spread over 2–3 weeks |
| **Ongoing** | **1–2 h/month** | Support invites, failed payments, one user question |

**Step 1 — Stripe subscription product**

1. [dashboard.stripe.com](https://dashboard.stripe.com) → **Product catalog → Add product**
2. Name: `Burnfolder Studio`
3. Price: **$15.00 USD / month** recurring
4. Copy **Price ID** → Netlify env: `STRIPE_STUDIO_PRICE_ID`
5. **Developers → Webhooks** → Add endpoint: `https://burnfolder.com/.netlify/functions/stripe-billing-webhook`
6. Events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`
7. Save signing secret → `STRIPE_BILLING_WEBHOOK_SECRET`

**Step 2 — Wildcard subdomain on Netlify**

1. Netlify → **Domain management** → **Add domain** → `burnfolder.com` (if not already)
2. DNS: add `*` CNAME → your Netlify site URL (wildcard for `{slug}.burnfolder.com`)
3. Wait for SSL provisioning (can take up to 24h)

**Step 3 — Instagram (second social — Tier 4 only)**

1. [developers.facebook.com](https://developers.facebook.com) → **Create app** → type: Business
2. Add product: **Instagram Graph API**
3. Link your Instagram Business/Creator account to a Facebook Page
4. Add to Netlify: `META_APP_ID`, `META_APP_SECRET`
5. Expect: **insights read + manual post linking** — not full auto-posting

**Step 4 — Legal (minimum before charging)**

- [ ] Publish `/terms.html` and `/privacy.html` on burnfolder.com (Copilot can draft from template — you review)
- [ ] Refund policy: recommend **7-day cancel, no refund mid-month** — write one sentence in terms

**Step 5 — Verify Tier 4**

- [ ] Test signup at `burnfolder.com/studio/join` (or path Copilot creates) → Stripe checkout → new workspace
- [ ] New workspace loads at `testslug.burnfolder.com`
- [ ] Your `burnfolder` workspace still on `burnfolder.com` with all data intact
- [ ] Instagram insights appear in social tab

---

#### For Copilot — Tier 4 implementation guide

**Build tasks**

1. **Gallery routing** — map `Host` header → workspace; deploy or generate per-workspace gallery config
2. **Public signup** — gated: email verify + Stripe subscription before workspace create
3. **Workspace provisioning** — create Blobs namespace, default Mux passthrough tag, gallery repo path or branch strategy (document choice)
4. **Marketing module** — `studio/marketing.html`: kanban + link to releases (no AI copy gen)
5. **EPK** — static page generator from vault press photos + bio field
6. **Instagram** — Meta OAuth (same pattern as YouTube); insights read-only
7. **Custom domain** — admin UI: artist enters domain → Netlify DNS instructions shown
8. **Docs** — `studio/TIER-4-SETUP.md`

**Acceptance criteria**

- [ ] New paying user gets isolated workspace + subdomain gallery
- [ ] burnfolder workspace data never leaks to other tenants
- [ ] Billing webhook suspends workspace on failed payment (grace period configurable)

---

### Tier 5 — **Scale** (ignore for now)

**Your time:** **10+ hours** research + sales calls; **hire a developer** for implementation.

**Trigger:** LabelGrid cannot handle your volume, or 50+ paying workspaces.

**Upgrade path:** Migrate to **Revelator** only (ISRC-preserving migration per section 6). Budget $500+/mo. Hire a developer — this is not a Copilot-only tier.

**For you when triggered:** Export full catalog from LabelGrid → contact Revelator sales → do not start until Tier 4 revenue covers it.

**For Copilot when triggered:** `revelator.provider.js` + migration engine only — Bandcamp/SoundCloud, full payout automation, ⌘K palette, live module come after Revelator works.

---

### Time budget rule (musician-first)

| Activity | Cap |
|----------|-----|
| Platform setup (any tier) | ≤**2 h/week** until tier verify is done |
| Copilot sessions | **1 session ≤2 h**; stop when verify checklist is unblocked |
| Tier 1 daily use | **1–2 h/week** — this is catalog work, not infra |
| Tier 2 release crunch | **OK to spend 3–5 h in release week** — then back to cap |
| Tier 3+ maintenance | **~30 min–2 h/month** unless supporting paying users (Tier 4) |

If a tier doesn't unlock a **specific upcoming release**, defer it. Passive waits (DNS, DSP review) are not your problem — don't sit on them.

### North star unchanged

Multi-tenant architecture **thin in Tier 1**, full vision **documented** in sections 1–16 above. You're not abandoning the master plan — you're **sequencing** it so the catalog stays the job.

---

## 18. Copilot global instructions (all tiers)

When working on Burnfolder Studio at any tier, Copilot must:

1. **Read** `STUDIO-MASTER-PLAN.md` (current tier section) and `COPILOT.md` before editing
2. **Never commit** secrets, `.env`, or API keys
3. **Never push** to git unless operator explicitly asks
4. **Scope every change** to the active tier — reject scope creep in commit messages and diffs
5. **Preserve** gallery voice rules — studio may be richer UI, gallery stays archival
6. **Preserve** `BurnfolderTouchTap` for playback; bump cache version on tap/playback changes
7. **Wire authored state** through workspace-scoped cloud keys — no localStorage-only drafts
8. **Enforce AI boundary** — ops/checklists/briefs only; never generate entry copy
9. **Create/update** tier setup doc (`studio/TIER-N-SETUP.md`) when adding env vars or operator steps
10. **Minimize diff** — extend existing modules (`cloud-state.js`, `studio-state.js`, `stream-shared.js`) before new parallel systems

When operator says *"implement Tier N"*, Copilot runs the **For Copilot** block for that tier only.

---

## 19. Next step (~2–3 h to start)

| Step | Your time |
|------|-----------|
| Supabase setup | 45–60 min |
| Anthropic API key | 15–20 min |
| Netlify env vars | 30–45 min |
| Tell Copilot to implement Tier 1 | 2–4 h across 1–2 sessions |

Do not create LabelGrid, R2, or YouTube accounts until their tier.
