# [burnfolder.com](http://burnfolder.com)

Personal artistic hub and archive for **burnfolder** (nathaniel a valdivieso).  
Live site: [burnfolder.com](https://burnfolder.com) · Contact: [nathaniel@burnfolder.com](mailto:nathaniel@burnfolder.com)

This README describes **what the site is**, **how it speaks**, and **how it is structured** — public gallery and private studio. For implementation detail, publishing workflows, and platform plans, see the docs listed at the end.

---

## Purpose

burnfolder.com is not a conventional portfolio and not a streaming platform. It is closer to a **journal and archive**: dated, self-contained releases of work, encountered only here, on the artist’s terms.

- **No algorithm, no feed, no rented “link in bio.”** The URL is the point of contact.
- **The site is part of the work.** Layout, pacing, and restraint are intentional — not scaffolding around the music.
- **Studio is the practice; the gallery is the published snapshot.** Drafts, mixes, plans, and analytics stay private until something is explicitly published.

Off-site thesis (social / YouTube only — never on journal entries):

> music made slowly, released on purpose — on a site that doesn't treat you like inventory.

Handle everywhere: **@burnfolder** (see `socials/README.md`).

---



## Voice


| Rule             | Detail                                                              |
| ---------------- | ------------------------------------------------------------------- |
| Case             | Lowercase throughout                                                |
| Density          | Sparse — just enough to identify, nothing to persuade               |
| Metaphor         | Text should feel like a **label on an archive box**                 |
| Navigation logic | **Dates** are primary titles (`M.DD.YY`), not promotional headlines |
| Forbidden        | Marketing language, hard CTAs, hype, emoji clutter                  |


Public copy stays final and quiet. Working notes, messy drafts, and day plans belong only in **studio journal** — never on the public archive.

---



## Aesthetic (public gallery)

**Archival coldness** — the site should feel like it has always existed and will continue without maintenance.


| Token     | Practice                                                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| Color     | White background, black text, gray `#c8c8c8` for muted UI — no color accents, no dark mode |
| Type      | Monospace as identity (a record, not decoration)                                           |
| Layout    | Left-aligned; consistent gutters; whitespace is load-bearing                               |
| Corners   | Square everywhere (`border-radius: 0`) — buttons, bars, forms, media chrome                |
| Motion    | Restraint; opacity fades only — no gratuitous animation                                    |
| Player    | Fixed bottom bar is **infrastructure**, not a hero feature                                 |
| Watermark | Small date/page stamp, bottom-right, low opacity                                           |


Studio shares identity tokens (monospace, square corners, grayscale) but is allowed to be **interactive and app-like** — tabs, drag-and-drop, panels, richer affordances.

---



## Mental model

```
capture → prepare → distribute → publish gallery → promote → measure → repeat
```


| Layer                  | Role                                                      | Who sees it                      |
| ---------------------- | --------------------------------------------------------- | -------------------------------- |
| **Studio** (`/studio`) | Artist OS — drafts, catalog, journal, releases, analytics | Artist (+ invited collaborators) |
| **Publish**            | Explicit action (entry, song/album page, shop, press)     | Artist confirms                  |
| **Public gallery**     | Live archive — entries, audio, visual, shop, hubs         | Everyone                         |


Studio is source of truth. The gallery is a published snapshot, not a second site in constant sync.

---



## Site structure (public)



### Navigation

Constellation menu (`shared/site-menu.js`) on every public page:


| Item        | Page           | Role                                               |
| ----------- | -------------- | -------------------------------------------------- |
| **audio**   | `audio.html`   | Featured listening surface (release constellation) |
| **video**   | `content.html` | All videos from the catalog                        |
| **archive** | `archive.html` | Chronological index of dated journal entries       |
| **shop**    | `shop.html`    | Digital / retail catalog                           |
| **about**   | `about.html`   | One-line identity                                  |
| **contact** | `contact.html` | Email only                                         |


Brand mark in the menu returns to **home** (`index.html`).

---



### Home — `index.html`

Landing **gate**: full-viewport Photonegative image (`IMAGES/TORNADO.jpeg`) with pixel-sampled hotspots that link into the site (album, audio, video, archive, shop, and reserved spots). Scroll / soft-enter leaves the gate into listening without treating home as a dashboard.

Home is the link-in-bio. No Linktree.

---



### Audio — `audio.html`

Primary music stage for the current release era. Four named constellation buttons (e.g. sometimes, fire escape, photonegative, it doesnt matter) start playback; optional outbound “listen on” links when DSPs are live. Playback continues via the shared bottom bar across SPA navigation.

Related catalog surface: `music.html` — portfolio-style list of all songs / featured release material (auto-built from catalog data). Same listening function, denser inventory view.

---



### Video — `content.html`

Collection of all videos tied to journal entries / catalog (`videosByPage` → `allVideos`). Inline Mux players; grayscale control branding. Same bottom audio bar for continuity when navigating away.

---



### Archive — `archive.html`

List of published journal entry dates (newest first), from `window.journalEntries`. Entry into the dated pages that form the chronological spine of the site.

---



### Dated journal entries — `M.DD.YY.html`

**One pattern, many instances.** Each page is a dated release of work:

- Date stamp as title and watermark  
- Optional image, annotation text, inline video  
- Optional tracklist (Mux audio) rendered into `#audioList`  
- Content increasingly authored as blocks in `entries.js` and rendered by `entry-renderer.js`

Entries are self-contained. They are not blog posts with categories — they are dated artifacts. New entries are composed in studio and **published live** (writes `entries.js` + thin HTML shell); newsletter workflows notify subscribers with a direct link.

Template for manual fallback: `_template.html`.

---



### Song pages — `song.html?song=…`

**One hub pattern per song** (slug/key such as `sometimes`, `fire escape`). Not every track gets one — only releases that warrant dig depth.

Typical panels (shown only when content exists):

- Cover / hero video  
- **Versions** list (alternate takes; single version selector)  
- Lyrics and version notes (follow the selected version)  
- Song-level notes  
- Clips / BTS media

Authored in studio **song designer**, pushed to `song-pages.js`. Empty panels stay hidden on the public site.

---



### Album pages — `album.html?album=…`

**One hub pattern per album** (e.g. `photonegative`). Canonical drop-in for a release:

- Title, cover, play-all, tracklist  
- Outbound DSP links (spotify / apple / tidal — may be pending until gate)  
- Thoughts, compiled notes, visuals

Authored in studio **album designer**, pushed to `album-pages.js`. Canonical Photonegative link: `burnfolder.com/album.html?album=photonegative`.

---



### Press — `press.html`

Electronic press kit: bio, contact, social/DSP links, downloadable assets. Public social links live here (not on journal entries). Authored via studio **press designer** → `press-page.js`.

---



### Shop — `shop.html`

Product catalog from `shop-products.js` (studio **shop designer**). Day-0 commerce is **pay-what-you-want digital** (e.g. PHOTO NEGATIVE album). Physical merch is deferred until after release demand warrants it.

#### Commerce flow (shared)


| Page            | Function                                                        |
| --------------- | --------------------------------------------------------------- |
| `cart.html`     | Cart contents, checkout kickoff                                 |
| `checkout.html` | Shipping form + Stripe (physical path)                          |
| `success.html`  | Post-payment confirmation (digital download / tip / order copy) |
| `cancel.html`   | Checkout abandoned / cancelled                                  |


Digital PWYW can open Stripe checkout directly from shop. Tips use dedicated Stripe session helpers. Floating cart control appears when the cart is non-empty.

---



### About / contact

- **about** — single identity line: creative project attribution  
- **contact** — `nathaniel@burnfolder.com` only

No bios-as-marketing, no multi-paragraph pitch.

---



### Private share surfaces (noindex)


| Page              | Function                                                  |
| ----------------- | --------------------------------------------------------- |
| `listen.html?t=…` | Tokenized private audio share (mix feedback, pre-release) |
| `watch.html?t=…`  | Tokenized private video share + optional download         |


Created from studio share-link tools. Not in the public constellation menu.

---



### Word pull — `wordpull.html`

Public-facing word-pull exercise (shared bank with studio). Creative/utility surface, not a primary archive page.

---



### Print — `print/`

Print-ready business card assets and HTML for physical cards (QR → site). Not part of the live visitor nav.

---



## Shared public functions

These are **site-wide behaviors**, not separate pages:


| Function                   | What it does                                                                     |
| -------------------------- | -------------------------------------------------------------------------------- |
| **Bottom now-playing bar** | Play/pause, title, progress/seek, version menu — persists across soft navigation |
| **Mux audio/video**        | Streaming via Mux; catalogs keyed by playback IDs                                |
| **SPA router**             | Soft-nav between main surfaces without killing playback                          |
| **Site menu**              | Constellation nav + brand home                                                   |
| **Newsletter**             | Subscribe (Netlify Blobs); welcome + new-entry email via GitHub Actions          |
| **Analytics beacons**      | First-party listening / landing signals for the studio dashboard                 |
| **Service worker / PWA**   | Caching for reliable return visits; versioned script busting                     |
| **Skins / hotspots**       | Home gate interaction layer (Photonegative map)                                  |


---



## Studio (`/studio`) — private artist OS

Not part of the public archive. Mobile-first PWA for running the practice: compose, organize media, plan days, design hubs, publish, measure.

### Studio navigation


| Tab           | Path                    | Role                                                                  |
| ------------- | ----------------------- | --------------------------------------------------------------------- |
| **dashboard** | `studio/dashboard.html` | Listening intelligence, email engagement, marketing desk digest       |
| **entry**     | `studio/index.html`     | Draft hub + block editor; **publish live** to the gallery             |
| **clips**     | `studio/clips.html`     | Unified media library (audio, video, files, stacks) — Mux upload/play |
| **journal**   | `studio/journal.html`   | Private day log, plan, checklist (never public)                       |
| **releases**  | `studio/releases.html`  | Masters vault, checklist, LabelGrid handoff for DSP distribution      |


Auth: Supabase workspace login (owner / collaborator / guest) when configured; legacy password fallback otherwise. Cloud state syncs via Netlify Blobs (last-write-wins). Header shows sync status and lock.

### Designers & publish targets (under clips conceptually)


| Surface        | Publishes to                                      |
| -------------- | ------------------------------------------------- |
| Song designer  | `song-pages.js` + public song hubs                |
| Album designer | `album-pages.js` + public album hubs              |
| Press designer | `press-page.js` + `press.html`                    |
| Shop designer  | `shop-products.js` + `shop.html`                  |
| Entry editor   | `entries.js` + `M.DD.YY.html` (+ optional images) |




### Clips drill-ins


| Page                 | Role                                                  |
| -------------------- | ----------------------------------------------------- |
| `song-designer.html` | Per-song studio view / editor / preview / share       |
| `stream-song.html`   | Archived (see `archive/studio/`)                      |
| `stream-album.html`  | Per-album/project studio view                         |
| Share links UI      | Mint `listen` / `watch` tokens for collaborators      |




### Redirects / legacy URLs

Older paths (`stream.html`, `video.html`, `files.html`, `ideas.html`, `editor.html`, `today.html`, etc.) redirect into the current tabs (usually **clips** or **entry**). Treat the five nav tabs above as the real map.

### Studio-only tools


| Surface                   | Role                         |
| ------------------------- | ---------------------------- |
| `word-pull.html` (studio) | Author/manage word-pull bank |
| `invite.html`             | Accept workspace invite      |
| `debug-playback.html`     | Playback diagnostics         |


---



## Data & catalogs (conceptual)


| Artifact                             | Meaning                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `entries.js`                         | Block-based dated entry content — primary publish target |
| `songs.js`                           | Derived audio/video catalogs + `journalEntries` order    |
| `song-pages.js` / `album-pages.js`   | Dedicated hub content                                    |
| `shop-products.js` / `press-page.js` | Shop + press kits                                        |
| Mux assets                           | Cloud source of truth for media binaries                 |
| Studio cloud keys                    | Drafts, stacks, journal days, designer state (private)   |


---



## Hosting & deploy (short)

- **Production:** Netlify → `burnfolder.com` (not GitHub Pages)  
- **Media:** Mux  
- **Payments:** Stripe  
- **Studio auth / workspaces:** Supabase (when enabled)  
- **Subscribers:** Netlify Blobs (not committed to git)

---



## Related docs


| Doc                                                                                              | Use when                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `[COPILOT.md](COPILOT.md)`                                                                       | Voice/design rules, shared modules, entry publish checklist, player protocol   |
| `[STUDIO-MASTER-PLAN.md](STUDIO-MASTER-PLAN.md)`                                                 | Operating plan (PHOTONEGATIVE release, platform vision, analytics desk, tiers) |
| `[studio/README.md](studio/README.md)`                                                           | Local studio setup, Mux, cloud sync, publish live                              |
| `[studio/MUX-SETUP.md](studio/MUX-SETUP.md)`                                                     | Mux credentials                                                                |
| `[studio/TIER-1-SETUP.md](studio/TIER-1-SETUP.md)` / `[TIER-2-SETUP.md](studio/TIER-2-SETUP.md)` | Auth workspaces / LabelGrid release path                                       |
| `[socials/README.md](socials/README.md)`                                                         | Handles, active vs parked platforms                                            |
| `[NEWSLETTER-SETUP.md](NEWSLETTER-SETUP.md)` / `[WORKFLOWS-SETUP.md](WORKFLOWS-SETUP.md)`        | Subscriber + GitHub Action wiring                                              |


`PHOTONEGATIVE-RELEASE-PLAN.md`, `DASHBOARD-MARKETING-PLAN.md`, and `MUSIC-GROWTH-*.md` are stubs that redirect to the master plan.

---



## What not to confuse


| This                     | Is not                                                     |
| ------------------------ | ---------------------------------------------------------- |
| Public journal **entry** | Private studio **journal** (day planner)                   |
| Gallery publish          | DSP / LabelGrid distribution (separate action)             |
| Song/album **hub**       | Every track in the library (hubs are selective dig layers) |
| Home gate image          | A marketing landing page with stats and CTAs               |
| Bottom player            | Featured UI — it should disappear into the page when idle  |


