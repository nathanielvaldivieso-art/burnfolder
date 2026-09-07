# stream-song archive

The `stream-song.html` page (and its `js/stream-song-page.js` controller) are archived here as a safety net.

## Past purpose

`stream-song.html` was the original per-song studio hub. It showed:

- Song title and version count
- Cover art and optional hero video
- Sortable versions list with inline playback controls
- Lyrics, version notes, song notes, and clips
- Share-link creation panel
- Tools: open in designer, public site link, copy playback id, and delete the Mux asset

As of the song-designer simplification, all of that functionality was absorbed by `studio/song-designer.html`:

- Title, cover, and version strip
- Blocks editor (text / photo / audio / video)
- Share links
- Public preview pane
- Copy playback id and delete version
- Deep-link via `?p=<playbackId>`

The studio links that used to point to `stream-song.html` now point to `song-designer.html` with the same `?song=` or `?p=` parameters.

## Files

- `stream-song.html` — original HTML shell
- `js/stream-song-page.js` — original page controller
