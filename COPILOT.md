# burnfolder.com — Copilot context

## Active release plan

**`PHOTONEGATIVE-RELEASE-PLAN.md`** is the near-term operating plan. Work **The feed** (steps 01–62)
top to bottom. Tell Copilot *"implement feed step N"* to build. Platform features from
`STUDIO-MASTER-PLAN.md` are deferred until step 62.

## What this site is
burnfolder.com is a personal artistic hub and portfolio. It is structured as a series of
dated journal entries. Branching from those entries, all music is collected on the music
page, all video on the video page, and all retail items on the shop page — for quick,
organized access. The site is based on a minimalistic design; any new pages created should
take design and functional cues from existing pages.

The site is not a portfolio in the conventional sense and not a streaming platform. It is
closer to a journal: each entry is dated, self-contained, and released on its own terms.
The site is the work as much as the work itself is.

The audience encounters the work here and only here, on the artist's terms. No algorithm,
no feed, no external platform. The URL is the point of contact.

## Voice and tone
Lowercase throughout. Sparse. No marketing language, no calls to action.
Text on the page should feel like a label on an archive box — just enough to identify,
nothing to persuade. Dates are the primary navigation logic.

## Aesthetic principles
- **Archival coldness.** The site should feel like it has always existed and will continue
  to exist without maintenance. No animations, no hover effects beyond opacity fades.
- **Monospace as identity.** The font is not decorative — it signals that this is a record.
- **Restraint over expression.** If something can be removed without losing meaning, remove it.
  Whitespace is load-bearing. Left margin and opacity do more work than color or scale.
- **Dates as titles.** Pages are named by date (M.DD.YY), not by title. The work speaks;
  the page just marks when it happened.
- **The player is infrastructure.** The bottom bar is functional, not featured. It should
  disappear into the page when not in use.

## What to preserve in every design decision
- White background, black text, monospace. No exceptions.
- Left-aligned layout with consistent 60px margin. Nothing centered.
- Page watermark (bottom-right, 9px, opacity 0.2) on every entry page.
- Navigation links are `page-nav` class — uppercase, faded, no underline.
- Song/entry rows use left-border + bottom-border only. No all-around boxes.
- All buttons are square (no border-radius), outlined (1px solid), monospace font.
- Button hover: invert background and text color, maintain border.

## Design system
White background, black text, monospace font throughout.
No dark mode. No colored links. No borders except left-only on song/entry rows.
Layout is left-aligned: `page-wrap` with 60px left margin, 480px max-width.
All entry pages share one `style.css` — page-specific styles go in a `<style>` block in the HTML file.

## Adding a new journal entry

**Primary path:** compose in `/studio` → **publish live** (writes `entries.js`, a thin
`M.DD.YY.html` shell, and any `IMAGES/` assets via `studio-publish.js`). `songs.js`
(`journalEntries`, tracks, videos) derives from `entries.js` automatically. Manual steps
below remain the fallback if studio is unavailable.

### 1. Create the page
Duplicate `_template.html` → rename to `M.DD.YY.html`
Replace all three `M.DD.YY` placeholders: `<title>`, `.page-id`, `.page-watermark`

### 2. Add the audio track to songs.js (if applicable)
```js
"M.DD.YY": [
  { title: "track name", playbackId: "mux_playback_id_here" }
],
```
The key must exactly match the HTML filename without `.html`.
Multiple tracks on one page: add more objects to the array.

### 3. Add the video to songs.js (if applicable)
```js
window.videosByPage = {
  "M.DD.YY": [
    { title: "video title", playbackId: "mux_video_playback_id_here" }
  ],
  // ...existing entries...
};
```
Add the inline `<mux-player>` element to the entry page HTML as well (see 4.30.26.html).

### 4. Add to the journal entries list (songs.js)
```js
window.journalEntries = ["M.DD.YY", "4.30.26", "2.25.26", ...];
```
Newest first. This is the single source of truth — index.html and spa-router.js both read from it.

### 5. Newsletter email automation (required)
- Every new journal entry must trigger an email notification to all subscribers.
- Notification email must include a direct link to the new entry page:
  `https://burnfolder.com/M.DD.YY.html`
- Keep entry filenames in dated format (`M.DD.YY.html`) so workflow detection works.
- Do not bypass this workflow when publishing new entries.

### 6. Keep welcome email "recent entries" synced (required)
- Source of truth is `window.journalEntries` in `songs.js` (newest first).
- The welcome email must always render the top 3 published entries from that list.
- Never hardcode entry dates in email workflow templates.
- Each recent-entry link must use this exact pattern:
  `https://burnfolder.com/<entry>.html`
- Only include entries whose HTML file exists in the repo.
- Publish checklist for every new entry:
  1) Add date to `window.journalEntries` (first item).
  2) Confirm matching file exists: `<entry>.html`.
  3) Confirm link opens on production after deploy.

### 7. Player color palette (single source of truth)
Three colors only for video player and progress UI. Do not introduce blue.

| Token      | Hex       | Use |
|------------|-----------|-----|
| Black      | `#000`    | Text, borders, filled progress bar, icon fill |
| White      | `#fff`    | Backgrounds, icon color on dark surfaces |
| Gray       | `#c8c8c8` | Unfilled progress track, muted UI contrast |

- **No blue in player UI.** Video player surfaces and progress systems should be grayscale only.
- **No purple.** Mux player defaults sometimes introduce purple — always override.
- CSS variables for these tokens are declared in `:root` in `style.css`:
  `--c-black`, `--c-white`, `--c-gray`

### 8. Video player branding protocol (required)
- Palette: black / white / gray only (see Step 7).
- Keep Mux control placement identical to default (play/pause, scrubber, time, fullscreen).
- Always add `playbackrates="1 1.5 2"` attribute to every `<mux-player>` element.
- Hide AirPlay with player CSS (`--airplay-button: none`) and `::part(airplay)`.
- Controls scale 0.7x in normal mode (`--media-button-icon-width: 12px`).
  Controls scale full size in fullscreen (via `:fullscreen` and `:-webkit-full-screen`).
- Video frame 1.3x (468px max-width, 16/9 aspect ratio).
- Poster frame must remain clearly visible — `--controls-backdrop-color: transparent`.
- Control bar: one clean square-cornered rectangle. No rounded corners. No indented volume slider.
- Hide the volume slider itself with `::part(volume)` so the control bar stays visually flat.
- Progress bar: 2px light-gray track with monochrome elapsed fill and a 5px playhead.
  Video should mimic the audio player's geometry and hover timestamp behavior.
- Speed control must remain in the control bar via `::part(playback-rate)`.

### 9. Corner framework (required)
- Corner rule across the site: rectangles stay square. Use `border-radius: 0` for buttons,
  control bars, menus, tooltips, forms, and media chrome.
- Do not add rounded corners to player controls or overlays.
- Progress playheads may remain circular when needed for visibility, but the containing bar
  and all surrounding surfaces remain rectangular.

### 10. Reusable control icon language (required)
- Use the same play/pause icon language as the bottom audio player in `scripts.js`.
- Canonical icons (both in `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">`):
  - Play:  `<polygon points="6,4 20,12 6,20" fill="currentColor"/>`
  - Pause: `<rect x="6" y="5" width="4" height="14" fill="currentColor"/>` +
           `<rect x="14" y="5" width="4" height="14" fill="currentColor"/>`
- Controls must feel like one family across audio and video surfaces.
- Branding priority: reuse familiar controls over inventing page-specific variants.

### 11. Audio bottom bar (required, never modify structure)
- Fixed at `bottom: 0`, full width, `height: 48px`, white background.
- `border-top: 1px solid #000` — this defines the rectangle edge cleanly.
- No box-shadow, no border-bottom, no rounded corners.
- Progress track is `::before` pseudo on `.progress-bar-area`:
  2px height, `#c8c8c8` background. Fill `.progress` is 2px, `#000`.
  Playhead `.progress-playhead` is 5px circle, `#000`, hidden until hover.
- On hover, the progress system must show a timestamp above the bar.
- Volume control is `display: none !important` — do not re-enable.
- **Canonical hidden player (do not vary).** The `#activeMuxPlayer` element MUST carry
  `audio playsinline stream-type="on-demand" preload="metadata"` and be pinned offscreen with
  `position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none`:

```html
<mux-player id="activeMuxPlayer" audio playsinline stream-type="on-demand" preload="metadata"
  style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;"></mux-player>
```

  `audio` + `playsinline` are what stop iOS from fullscreening / scroll-into-view when
  `play()` runs (the cause of the page "jumping" on tap). The fixed 1px pin (never
  `left:-9999px`) keeps the element in-viewport so the browser never scrolls to reach it.
  This markup is emitted by `shared/publish-artifacts.js` and `entry-editor.js`; keep all
  copies identical.

Automation references:
- Subscriber signup endpoint: `/.netlify/functions/subscribe` (writes Netlify Blobs)
- Subscriber export (CI only): `/.netlify/functions/export-subscribers` + bearer `SUBSCRIBERS_EXPORT_SECRET`
- Welcome email trigger: `.github/workflows/welcome-email.yml`
- New entry notification trigger: `.github/workflows/notify-new-entry.yml`

## Shared build framework (single sources of truth)

The site is rebuilt from a small set of shared modules. **Reuse these — do not fork a
second implementation on a new page.** When a behavior exists here, wire to it.

| Concern | Single source | Notes |
|---------|---------------|-------|
| Audio engine | `shared/mux-playback.js` (`BurnfolderMuxPlayback`) | Queue, seamless advance, recall, media session, prefetch |
| Now-playing bar | `shared/now-playing-bar.js` (`BurnfolderNowPlayingBar`) | THE bottom bar everywhere: SVG play button, title menu/version picker, progress + drag/touch seek, hover timestamp, spinner. Public (`scripts.js`), studio (shell), and `listen.js` all mount it — never reimplement |
| Bottom-bar version menu | `shared/version-picker.js` + `shared/playback-context.js` | Bottom-bar "now playing" menu |
| Touch / tap | `shared/studio-tap.js` (`BurnfolderTouchTap`, alias `BurnfolderStudioTap`) | All audio-starting taps (see below) |
| Recall / restore | `shared/playback-recall.js` | Single key `burnfolderPlaybackRecall` |
| Prefetch / durations | `shared/playback-prefetch.js` | Pool, `attachRow`, `requestDuration`, `setActivePlayer` |
| Media Session | `shared/media-session.js` | Lock screen / Control Center (via engine only) |
| Cache-bust version | `shared/site-version.js` (`BurnfolderSiteVersion`) | One constant for every `?v=` |
| Service worker | `shared/sw-core.js` (`createBurnfolderServiceWorker`) | `sw.js` / `studio/sw.js` are config only |
| Page generation | `shared/publish-artifacts.js` (`buildEntryHtml`) | Canonical page shell + script block |
| Hub renderers | `shared/song-page-render.js`, `shared/album-page-render.js` | Layout; play via callbacks |

#### Song page content model (song-page-render.js + song-page-store.js)
- **Two note scopes.** `page.notes` = **song notes** (shown on every version). `page.versions[playbackId].notes` = **version notes** (follow the selected/playing version). `page.versions[playbackId].lyrics` likewise follow the version. Lyrics + version notes are authored per-version in the song designer; song notes are the global field.
- **One version selector.** The "Versions" list is the only picker. Lyrics and version notes reflect whatever version is selected/played there (`playSongHubQueue` → `renderApi.selectVersion`). Do NOT re-add a per-panel version-picker chip row.
- **No empty boxes on the public site.** Every panel (lyrics, version notes, song notes, clips, cover, video) is hidden unless it has content (`panelVisible`/`panelHidden`). The studio editor preview (`showVersionPicker: true`) is the only place that shows a placeholder for an empty slot.
- The bottom-bar buffering spinner was removed (it shifted the play/close buttons on each track start) — do not reintroduce a layout-affecting spinner.

#### Cache-bust version: bump ALL knobs together (or the PWA serves stale JS)
When you change any shared/studio script, the deployed PWA only picks it up if its `?v=`
URL changes — the service worker caches each asset by exact URL. Symptom of drift: "works in
`npm dev` (no SW) but broken on the live PWA" (e.g. stale `studio-tap.js` → taps do nothing).
Bump these together to one new `YYYYMMDD<letter>` value:
1. `shared/site-version.js` `SITE_SCRIPT_VERSION` (public `?v=` + register-sw SW-script bust).
2. `studio/js/studio-version.js` `BurnfolderStudioVersion` (SPA router's dynamic script loads).
3. Every `.js?v=` in `*.html` and `studio/*.html` (one-liner:
   `perl -i -pe 's{(\.js)\?v=[\w.]+}{$1?v=NEW}g' studio/*.html *.html`).
4. SW cache names in `sw.js` / `studio/sw.js` (forces old caches to purge on activate).
5. `shared/publish-artifacts.js` `SCRIPT_VERSION` (generated pages).
Do not leave a script's `?v=` pinned to an old value after editing the file.

### Interaction standard (prevents the mobile-tap class of bug)
**Any control that STARTS AUDIO must fire through `BurnfolderTouchTap.bind(el, handler[, {shouldSkip}])`**
— never a bare `click` listener. iOS/PWA standalone requires `play()` to run inside the
touch gesture, and the module uses a 10px movement slop so elastic scroll/bounce does not
cancel the tap. `on(container, selector, handler)` is the delegated variant.
- Every tracklist row builder routes through it: `scripts.js` `buildTracklistItem`,
  `listen.js`, `shared/album-page-render.js`, `shared/song-versions.js` `fillVersionTracklist`,
  studio `stream-page.js` `bindTouchPlay`.
- Pass `shouldSkip` when a sub-control inside the row owns its own tap (e.g. the version-cycle
  title in `buildTracklistItem`, or post-drag suppression in studio).
- Plain discrete buttons that don't start audio (lyrics tabs, hub play buttons, delete) may
  use `click` — the slop/gesture handling only matters for audio rows.
- **Rule:** if you add a new play surface, bind via `BurnfolderTouchTap`. Do not write a new
  touch handler.

**No-jump rule (why the page must not scroll when you tap a song).** Three things move the
viewport on mobile; all three are forbidden in the play path:
1. **Never `.focus()` the fixed bottom bar on touch.** `preventScroll: true` is not honored on
   iOS Safari, so focusing a fixed element scrolls the page. `scripts.js` `focusPlayControl()`
   bails out when `matchMedia('(pointer: coarse)')` matches — focus is desktop-only. Space-to-
   toggle still works because the handler is bound to `document`, not the button.
2. **The player must be `audio playsinline`** (see §11) so `play()` never triggers fullscreen
   or scroll-into-view.
3. **Keep the hidden player pinned in-viewport** (`position:fixed;top:0`), never offscreen at
   `left:-9999px`, so the browser has no reason to scroll toward it.
If a tap ever scrolls the page again, check these three before anything else.

### Page framing standard (prevents the right-edge clip / weird mobile framing)
Every page — public and studio — is framed by one set of rules in `style.css` (loaded by all
pages, including `../style.css` in studio). Do not re-solve framing per page.
1. **Global `box-sizing: border-box`** on `*, *::before, *::after`. Padding/border never widen a
   box, so flex rows (e.g. the studio album header: cover · title · play · hub · toggle) keep
   their controls inside the card instead of pushing them off the right edge.
2. **`html, body { max-width: 100%; overflow-x: clip; }`.** No horizontal scroll, ever. `clip`
   (not `hidden`) is used so we don't create a scroll container that would break
   `position: sticky` (studio editor sidebar). A single stray-wide child can no longer drag the
   whole layout sideways.
3. **Fixed bars span `left: 0; right: 0; width: auto` — never `width: 100vw`.** `100vw` ignores
   the scrollbar and, with `viewport-fit=cover` on notched iPhones, exceeds the visual viewport
   and clips the right side. Applies to `.bottom-progress-bar` and the index newsletter popup.
4. **Gutters come from `--page-gutter` and respect the notch:** fixed bars pad with
   `max(var(--page-gutter), env(safe-area-inset-left/right))`. Use the token for any new
   full-bleed/fixed element instead of hard-coding a side padding.

#### Mobile sizing (`@media (max-width: 600px)` in `style.css` only)
Public and studio must look identical on phone — same left gutter, same content width, same
bottom bar height. Tokens: `--page-gutter-mobile: 24px` (also assigned to `--page-gutter` inside
the breakpoint).
- **`.page-wrap`** (including `.studio-page .page-wrap`, `.studio-stream-layout`, `.studio-home`):
  `margin-left: var(--page-gutter-mobile)`, `max-width: calc(100vw - 32px)`, `padding: 24px 0 120px 0`.
- **Tracklists:** `max-width: calc(100vw - 40px)` (same class names on public + studio).
- **`.site-header`:** `padding-left/right: var(--page-gutter-mobile)`.
- **`.bottom-progress-bar`:** `height: 48px`, safe-area padding via `--page-gutter-mobile`.
- **Studio desktop width caps** (`520px` / `640px`) live in `studio.css` inside
  `@media (min-width: 601px)` only — never on mobile. Do not add competing `margin`, `max-width`,
  or bottom-bar rules to `studio.css` `@600px`; touch-target tweaks only.

If studio feels “zoomed in” or clipped on mobile while the main site looks fine, studio is almost
certainly overriding the shared mobile block — delete the override and fix it in `style.css`.

If content is clipped on the right or the page scrolls sideways on mobile, check these rules —
do not patch a single page; fix it in the `style.css` framing block so every page inherits it.

### Versioning & cache (single source)
- `shared/site-version.js` defines `BurnfolderSiteVersion` (also `require()`-able in Node by
  `publish-artifacts.js`). **Bump it on any playback/tap/shared-JS change.**
- Public pages load `site-version.js` immediately before `register-sw.js`.
- `register-sw.js` registers the SW as `/sw.js?v=<version>` (studio: `/studio/sw.js?v=…`) so
  installed PWAs always pick up new code instead of serving stale JS.
- Keep `?v=` on shared scripts in HTML aligned to the current version (the generator stamps
  one `${version}` everywhere; hand-edited pages should match).

### Service worker (one strategy, two configs)
`shared/sw-core.js` owns the strategy: HTML/navigations/live data = network-first with cache
fallback; versioned static assets = stale-while-revalidate. `sw.js` and `studio/sw.js` only
`importScripts('/shared/sw-core.js')` and pass `{ cacheName, includeRoot, freshSuffixes,
staticPrefixes }`. **Bump the `cacheName`** when changing cached behavior. `site-version.js`
is in `freshSuffixes` so the version constant itself is always network-fresh.

### Bottom bar: one implementation (done)
`scripts.js` (public), `studio-playback-shell.js` (studio), and `listen.js` all mount
`BurnfolderNowPlayingBar`. The module owns ALL bar presentation; the page scripts only own
engine glue. The contract when wiring a new surface:
```js
window.BurnfolderNowPlayingBar.mount({
  barEl, titleEl, playBtnEl, closeBtnEl, muxPlayerEl: activeMuxPlayer,
  bodyActiveClass: '',            // '' if the page manages body classes itself
  getActiveSong, onTogglePlay, onPlayVersion, onClose
});
```
- Load order: `playback-context.js` + `version-picker.js` + `now-playing-bar.js` BEFORE the
  page script. Omit `version-picker.js`/`playback-context.js` to get a bar with no title menu
  (e.g. `listen.js`, a private share with no catalog).
- Do NOT re-add a play button `innerHTML`, a `progressBarArea` seek/drag listener, a hover
  timestamp, or a bespoke version menu to any page script. If the bar needs a new behavior,
  add it once in `shared/now-playing-bar.js`.

### Deferred consolidation roadmap (do deliberately, not blind)
These remain partly duplicated because merging them touches live playback and must be done
atomically. Sequence when picked up:
1. **Engine unify:** make `scripts.js` fully delegate to `BurnfolderMuxPlayback`
   (`bindEnded: true`, `togglePlayPause` → engine, drop its own `ended`/`error` queue-advance)
   — must remove the parallel path in one change to avoid double-advance.
2. **Recall unify:** delete the legacy `sessionStorage.playbackState` path in `scripts.js`;
   use only `BurnfolderPlaybackRecall`.
3. **Events:** standardize all surfaces on one playback event (`burnfolder-playback-changed`).
4. **Tracklist factory:** one parameterized row builder (flags: duration, version-cycle,
   studio chrome) feeding public/hub/studio/listen.
5. **Bottom-bar markup:** the generator already centralizes it; migrate static pages to the
   generated shell rather than maintaining ~17 verbatim copies.

## Page anatomy (_template.html)
```
① <title> and .page-id      — date stamp e.g. 4.30.26
② .page-img                 — optional photo (remove block if unused)
③ .page-annotation          — optional caption/text (remove block if unused)
④ (inline mux-player)       — optional video player embedded in page (remove if unused)
⑤ #audioList                — rendered automatically by scripts.js
⑥ .page-watermark           — fixed bottom-right stamp, matches date
⑦ bottom player block       — never modify, identical on every page
```

## songs.js structure
```js
// Audio catalog
window.songsByPage = {
  "4.30.26":  [{ title: "...", playbackId: "..." }],
  "2.25.26":  [{ title: "...", playbackId: "..." }],
};
// allSongs (for music page) is derived automatically — do not edit manually

// Journal entries — single source of truth
window.journalEntries = ["4.30.26", "2.25.26", "11.29.25", "11.28.25"];

// Video catalog
window.videosByPage = {
  "4.30.26": [{ title: "...", playbackId: "..." }],
};
// allVideos (for video page) is derived automatically — do not edit manually
```

## Collection pages
| Page | File | Populates from |
|------|------|----------------|
| music | music.html | window.allSongs (from songsByPage) |
| video | content.html | window.allVideos (from videosByPage) |
| shop | shop.html | manual HTML |

Each track on the music page no longer shows the entry date inline; use the **now playing** bar — click the track title for **go to song**, **go to entry** (when the recording is tied to a dated page), and **versions** (alternate takes).

## Known bugs to avoid
- Never call `activeMuxPlayer.load()` after setting `playback-id` — mux-player
  handles attribute changes automatically; calling .load() reverts to the previous track.
- Never use `allSongs.filter(song => song.page === fileName)` to match tracks to pages
  — use `window.songsByPage[fileName]` directly (immune to typos).
- Never hardcode the journal entries list anywhere except `window.journalEntries` in
  songs.js. Both index.html and spa-router.js read from that variable.

## File map
| File | Purpose |
|------|---------|
| `style.css` | Global styles — all pages |
| `entries.js` | Block-based entry data (`window.entryDataByDate`) — primary source for dated pages; studio **publish live** writes here |
| `entry-renderer.js` | Renders entry blocks on dated pages from `entries.js` |
| `songs.js` | Audio/video catalogs derived from `entries.js` + legacy keys; `window.journalEntries` list |
| `scripts.js` | Audio engine — rarely needs editing |
| `spa-router.js` | Page routing — do not edit unless adding new page types |
| `_template.html` | Starter for new entry pages (manual workflow fallback) |
| `index.html` | Home — entries auto-populated from window.journalEntries |
| `music.html` | All audio — auto-populated from songs.js |
| `content.html` | All video — auto-populated from songs.js (window.allVideos) |
| `listen.html` | Private share-link listen page (`?t=` token) — noindex |
| `stripe-publishable.js` | Stripe publishable key (load before `scripts.js` / `checkout.js`) |

## Subscribers and deploy (Netlify + GitHub)

- **Production host:** `burnfolder.com` → Netlify (`burnfolder.netlify.app`). **Not** GitHub Pages. The repo’s Pages workflow (`pages-build-deployment`) can succeed while production stays stale if Netlify autodeploy is disconnected.
- **Backup deploy:** `.github/workflows/netlify-deploy.yml` POSTs a Netlify Build Hook on every `main` push. One-time: Netlify → Build hooks → add hook for `main` → copy URL → GitHub secret `NETLIFY_BUILD_HOOK`. Also reconnect the Netlify site to this GitHub repo so git pushes trigger builds without the hook.
- **Canonical list:** `/.netlify/functions/subscribe` stores emails in **Netlify Blobs** (store name `burnfolder-newsletter`, key `subscriber-emails`). They are **not** committed to git.
- **`subscribers.json` in the repo** is an empty placeholder only (`{"subscribers":[]}`). Do not put real addresses there.
- **One-time seed (optional):** set Netlify env `SUBSCRIBER_SEED_EMAILS` to a comma-separated list; on first subscribe after deploy, the function seeds the blob if it was empty, then you can remove the env var.
- **New-entry emails (GitHub Actions):** add repository secret `SUBSCRIBERS_EXPORT_SECRET` with the same value as Netlify env `SUBSCRIBERS_EXPORT_SECRET`. The workflow `notify-new-entry.yml` calls `GET https://burnfolder.com/.netlify/functions/export-subscribers` with `Authorization: Bearer <secret>` to read the list.
- **Welcome emails:** unchanged — still triggered by `repository_dispatch` from subscribe; no subscriber list file on disk required.

## Local preview

- Newsletter subscribe shows a short message on `localhost` / `127.0.0.1` instead of calling Netlify. Use `netlify dev` to test the function locally.

## Admin / add-song

- `admin.html` was removed. `netlify/functions/add-song.js` returns 403 — add catalog entries by editing `songs.js` in git.

---

# burnfolder/studio — the artist OS

`/studio` is a **private, single-user mobile-first artist OS** — post from your phone,
plan your days, preview and share work before it goes live. It is **not** part of the
public archive and does **not** follow the public site's "archival coldness."
burnfolder.com is the gallery; `/studio` is where the practice runs day to day.

## Purpose
One app to run the whole practice on the go:

**Shipped today**
- **Entries** (`index.html`) — compose dated journal pages and **publish live** to
  burnfolder.com (`entries.js` + `M.DD.YY.html` via GitHub). Hub lists drafts; editor
  opens in-place without losing playback.
- **Music** (`stream.html`) — Mux audio library, upload, inline play, drag-to-stack
  projects/albums, version management.
- **Video** (`video.html`) — same stack as music, filtered to video assets.
- **Journal** (`journal.html`) — **private** day log, day plan, and checklist. Fully
  separate from public entries — practice notes, not archive material.
- **Share links** — private `listen.html?t=` URLs for collaboration (mix feedback, etc.).
  Created from the music library via `share-links.js`.
- **Song / album pages** (`song-designer.html`, `album-designer.html`) — dedicated public
  pages for releases that warrant them; **push to site** when ready (not every track).
- **SPA shell** — `studio-spa-router.js` keeps the global playback bar alive across entry /
  music / video / journal nav. Entry hub ↔ editor transitions without full reload.
- **Mobile UX** — `shared/studio-tap.js` (`BurnfolderTouchTap`) for all playback taps and
  mobile-critical controls; 44px targets, safe-area padding on studio chrome.
  padding, active states on coarse pointers (`studio.css` mobile block).

**Next**
- **Publish Phase B** — image blocks and `IMAGES/` cover art in live entries.
- **Analytics** — plays, top tracks, traffic.
- **Orders / merch / shipping** — Stripe + Shippo surface.
- **Content / marketing plans** — scheduling pipeline for posts/campaigns.
- **Polish** — mobile UX, SPA reliability, share-link workflow.

**Not current focus**
- File drop-sharing (`files.html` redirects to music).
- Republish / edit existing live entry dates (blocked today; add when needed).

## Public entries vs private journal
| | **Entry** (public) | **Journal** (private) |
|---|---------------------|----------------------|
| Surface | burnfolder.com dated pages | `/studio/journal.html` only |
| Audience | Site visitors | Artist only |
| Content | Released work — text, audio, video, playlists | Day notes, plans, reminders |
| Storage | `entries.js` + HTML (git, after publish) | `journalDays` cloud key |
| Voice | Archive label — sparse, final | Working notes — can be messy |

## Studio design language
Distinct from the public site, but same **identity tokens**: monospace, square corners
(`border-radius: 0`), grayscale (black/white/`#c8c8c8`), lowercase labels. The difference:
studio is **interactive and app-like** — it may use hover states, drag-and-drop, tabs,
panels, inline editing, and richer affordances that the public archive forbids. Priority
order for studio: **intuitive → sleek → secure**, all while staying **mobile-first / PWA**.

## Studio architecture (current)

### Navigation (four main tabs)
| Tab | File | Role |
|-----|------|------|
| entry | `index.html` | Draft hub + block editor |
| music | `stream.html` | Audio Mux library + stack |
| video | `video.html` | Video Mux library |
| journal | `journal.html` | Private day planner |

Sub-pages (full navigation, not SPA): `song-designer.html`, `album-designer.html`,
`stream-song.html`. Redirects: `editor.html` → `index.html`; `files.html`,
`stream-stack.html` → `stream.html`.

### SPA router (`studio/js/studio-spa-router.js`)
Intercepts nav among the four main tabs. Swaps `#studio-spa-content` without tearing down
`#studioGlobalPlayback`. Entry is special: hub and editor shell live on `index.html`;
opening a draft (`?id=`) toggles via `editor-gate.js` without fetching a new page.
`studioSpaNavigate(url)` is the programmatic entry point.

### Touch & mobile playback (`shared/studio-tap.js`)
**Single standard for every tap that starts audio or critical mobile actions** — public
site and studio. Load this script before `mux-playback.js` / `scripts.js` on any page with
playback. API: `BurnfolderTouchTap` (alias `BurnfolderStudioTap`).

| Method | Use |
|--------|-----|
| `bind(el, handler, options?)` | One element (track row, play button) |
| `on(container, selector, handler, options?)` | Delegated taps (draft list, preview bubbles) |

**Rules (do not duplicate elsewhere):**
- Fires `touchend` inside the user-gesture window so iOS/PWA can call `play()`.
- Uses **10px movement slop** — tiny scroll/elastic bounce must not cancel taps (PWA
  standalone is stricter than mobile Safari tabs).
- Suppresses duplicate synthetic `click` after a handled touch.
- Optional `options.shouldSkip(event)` — studio DnD uses this to ignore post-drag taps.

**Playback rows:** always wire through `bind()` — never `click` alone on `.music-track-row`.
Studio music (`stream-page.js`) delegates to this module; do not add a second touch layer.

**PWA cache:** bump `shared/site-version.js` + `?v=` on script tags; bump `sw.js` /
`studio/sw.js` cache name when playback or tap logic changes. Installed PWAs keep stale JS
until the cache name changes.

### Auth (Tier 1 — Supabase workspaces)

When `SUPABASE_URL` + `SUPABASE_ANON_KEY` are set in Netlify, studio uses **Supabase email login** instead of the legacy single password.

- **Client (`studio/js/studio-auth.js`):** fetches `/studio-public-config` → Supabase sign-in form. **Sign-in is required on every full page load** (persisted JWT/password in localStorage is cleared; tab `sessionStorage` is only used after unlock for that visit). `window.fetch` attaches `Authorization: Bearer <jwt>` and `X-Workspace-Id` to studio APIs (`/mux-`, `/studio-state`, `/studio-publish`, `/studio-share-links`, `/studio-workspace`, `/studio-ai`, `/studio-export`).
- **Server (`netlify/functions/lib/workspace-auth.js`):** verifies JWT via Supabase; resolves workspace membership; scopes Netlify Blob keys as `ws_{workspaceIdNoHyphens}_{logicalKey}`. Roles: **owner** (publish, invites, export), **collaborator** (write), **guest** (read-only — POST blocked).
- **Legacy fallback:** if Supabase env vars are missing, `STUDIO_API_SECRET` password gate still works (`netlify/functions/lib/studio-auth.js`).
- **First login:** `ensureDefaultWorkspace()` creates slug `burnfolder` + owner membership.
- **Invites:** owner creates invite on `/studio/today.html`; collaborator opens `/studio/invite.html?t=…` (no email in Tier 1).
- **DB:** run `supabase/migrations/001_tier1.sql` in Supabase SQL Editor before first use.

### Mux
`mux-create-upload`, `mux-upload-status`, `mux-list-assets`, `mux-delete-asset` — all
bearer-gated. Mux library is cloud source of truth for songs/videos.

### Workspace cloud (`netlify/functions/studio-state.js` + `studio/js/cloud-state.js`)
Key/value on **Netlify Blobs** (store `studio-state`), bearer-gated. Keys are **workspace-scoped** when Supabase auth is active (`ws_{id}_drafts`, etc.). On first read, legacy unscoped keys are copied into the workspace key. Classic CJS → call `connectLambda(event)` before `getStore()`. **Last-write-wins**: pull on load, debounced push on change, flush on `pagehide`. Cloud keys:

| Key | Module | Holds |
|-----|--------|-------|
| `drafts` | `drafts.js` | Entry editor drafts |
| `stack` / `stackMeta` | `stream-shared.js` | Music stack + album/project meta |
| `journalDays` | `journal-day-store.js` | Private journal / plan / checklist per day |
| `songPages` | `song-page-store.js` | Song designer pages (pre-push) |
| `albumPages` | `album-page-store.js` | Album designer pages (pre-push) |
| `notes` | `journal-store.js` | Legacy notes store (superseded by `journalDays`) |
| `releaseDates` | `today-page.js` | Release calendar on **today** |
| `trackPipeline` | `track-pipeline.js` | Per-track status: demo / mix / master / ready |

### Tier 1 pages & APIs

| Surface | Path / function |
|---------|-----------------|
| Today dashboard | `/studio/today.html` — calendar, workspace invites, export, AI |
| Accept invite | `/studio/invite.html?t=…` |
| Workspace API | `studio-workspace.js` |
| On-demand AI | `studio-ai.js` (Haiku; no entry copy generation) |
| Export | `studio-export.js` (owner only) |
| Public auth config | `studio-public-config.js` |

Header **cloud indicator** (`.studio-sync`) and **lock button** (`.studio-lock-btn`) in
`.studio-nav-tools`. `burnfolder-cloud-state` event: `syncing` / `synced` / `offline`.

### Publish & share (server)
| Function | Role |
|----------|------|
| `studio-publish.js` | Publish live entry → `entries.js` + HTML shell + `IMAGES/` uploads |
| `studio-publish-song-pages.js` | Push song page to site |
| `studio-publish-album-pages.js` | Push album page to site |
| `studio-share-links.js` | Create/revoke private listen tokens |
| `share-listen.js` | Resolve token for `listen.html` |

Live publish: text, Mux audio/video, album/playlist blocks, and image/cover uploads from
studio asset cloud (`IMAGES/` committed to GitHub). Existing date blocked (409) unless
republish confirmed. Requires `GITHUB_TOKEN` with repo write.

### PWA
`studio/manifest.webmanifest` + `studio/sw.js` (HTML network-first; `/studio/js/` cached
stale-while-revalidate). **Bump `shared/site-version.js` and SW cache name** on every
playback/tap change — not just studio CSS. Load `shared/studio-tap.js` on stream pages.

## Studio conventions
- **Tier 1 multi-user.** Supabase Auth + workspace tables (`supabase/migrations/001_tier1.sql`). Legacy `studio/supabase/schema.sql` is unused.
- **Everything authored syncs through `cloud-state.js`** — don't add localStorage-only
  authored state; wire new data to a `studio-state` key.
- **Never commit secrets.** Supabase service role, `STUDIO_API_SECRET`, Mux tokens, Stripe keys, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY` in
  Netlify env (and local `.env`, gitignored) only.
- **Bump cache versions** on every studio change or the PWA serves stale code.
- **Entry editor DOM lifecycle** — `entry-editor.js` exposes `studioInitEntryEditorDom()` and
  `studioReloadEntryDraft()` for SPA re-init after navigation; don't cache DOM refs at load time.
- **Private journal stays private** — never surface `journalDays` on the public site.
