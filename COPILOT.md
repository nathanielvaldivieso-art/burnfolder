# burnfolder.com — Copilot context

## What this site is
burnfolder.com is a controlled ecosystem for one artist's work — music and visual art.
It is not a portfolio or a streaming platform. It is closer to a journal: each entry is
dated, self-contained, and released on its own terms. The site is the work as much as
the work itself is.

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
