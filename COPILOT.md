# burnfolder.com — Copilot context

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

## Adding a new journal entry — 4 steps

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

Automation references:
- Subscriber signup endpoint: `/.netlify/functions/subscribe`
- Welcome email trigger: `.github/workflows/welcome-email.yml`
- New entry notification trigger: `.github/workflows/notify-new-entry.yml`

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
| archive | archive.html | songsByPage["archive"] |

Each track/video on a collection page shows a subtle date link (→ entry page).

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
| `songs.js` | Audio catalog, video catalog, and journal entries list — edit here |
| `scripts.js` | Audio engine — rarely needs editing |
| `spa-router.js` | Page routing — do not edit unless adding new page types |
| `_template.html` | Starter for new entry pages |
| `index.html` | Home — entries auto-populated from window.journalEntries |
| `music.html` | All audio — auto-populated from songs.js |
| `content.html` | All video — auto-populated from songs.js (window.allVideos) |
| `archive.html` | Audio archive — manual section management |


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

## Design system
White background, black text, monospace font throughout.
No dark mode. No colored links. No borders except left-only on song/entry rows.
Layout is left-aligned: `page-wrap` with 60px left margin, 480px max-width.
All entry pages share one `style.css` — page-specific styles go in a `<style>` block in the HTML file.

## Adding a new entry — 3 steps

### 1. Create the page
Duplicate `_template.html` → rename to `M.DD.YY.html`
Replace all three `M.DD.YY` placeholders: `<title>`, `.page-id`, `.page-watermark`

### 2. Add the song to songs.js
```js
"M.DD.YY": [
  { title: "track name", playbackId: "mux_playback_id_here" }
],
```
The key must exactly match the HTML filename without `.html`.
Multiple tracks on one page: add more objects to the array.

### 3. Add to the index entries list (index.html)
```js
const entries = ["M.DD.YY", "2.25.26", "11.29.25", "11.28.25"];
```
Newest first.

## Page anatomy (_template.html)
```
① <title> and .page-id      — date stamp e.g. 2.25.26
② .page-img                 — optional photo (remove block if unused)
③ .page-annotation          — optional caption/text (remove block if unused)
④ #audioList                — rendered automatically by scripts.js
⑤ .page-watermark           — fixed bottom-right stamp, matches date
⑥ bottom player block       — never modify, identical on every page
```

## songs.js structure
```js
window.songsByPage = {
  "2.25.26":  [{ title: "...", playbackId: "..." }],
  "11.29.25": [{ title: "...", playbackId: "..." }],
  "11.28.25": [{ title: "...", playbackId: "..." }]
};
// allSongs (for music page) is derived automatically — do not edit manually
```

## Known bugs to avoid
- Never call `activeMuxPlayer.load()` after setting `playback-id` — mux-player
  handles attribute changes automatically; calling .load() reverts to the previous track.
- Never use `allSongs.filter(song => song.page === fileName)` to match tracks to pages
  — use `window.songsByPage[fileName]` directly (immune to typos).

## File map
| File | Purpose |
|------|---------|
| `style.css` | Global styles — all pages |
| `songs.js` | Song catalog — edit here to add tracks |
| `scripts.js` | Audio engine — rarely needs editing |
| `spa-router.js` | Page routing — do not edit |
| `_template.html` | Starter for new entry pages |
| `index.html` | Home — update entries array when adding pages |
| `music.html` | All songs — auto-populated from songs.js |
