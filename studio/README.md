# Burnfolder Studio (local)

Single-page entry editor. Open **`studio/index.html`** with **`netlify dev`** from the repo root for Mux upload and playback.

## What you get

- **Preview** — build the entry like the live site (now playing bar, tracklists, inline video).
- **Entry** (`index.html`) — draft list + journal page editor; open an entry to compose.
- **Stream** (`stream.html`) — tap **▶** to play; **drag songs onto the stack** at the bottom (reorder by dragging chips). Song page has extra options. PWA-friendly.
- **Header** — switch entries or start a new dated draft.
- **export & publish** — copy/download package and publish checklist (collapsed at the bottom).

## Mux

See [MUX-SETUP.md](./MUX-SETUP.md). Requires `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` in repo root `.env`.

## Data & personal cloud

Your studio is single-user. Authored data syncs to your **personal cloud** (Netlify
Blobs) so the same drafts and projects show up in every browser / on your phone:

- **Projects / albums** (the stream stack + name + cover) — synced.
- **Drafts / entries** (the editor) — synced.
- **Journal notes** — synced (IndexedDB mirrors cloud key `notes`).
- **Mux library** (songs/videos) — already cloud (fetched from Mux).

The studio header shows a **cloud** status (saving… / synced / offline) and a **lock**
button to end your session.

How it works:

- `netlify/functions/studio-state.js` stores one JSON document per key in Netlify
  Blobs, gated by the same `STUDIO_API_SECRET` bearer the Mux functions use.
- `studio/js/cloud-state.js` reads/writes those keys (debounced).
- Model is **last-write-wins**: on page load the studio pulls the latest copy from
  the cloud; every change is pushed up. Edit on one device at a time.
- Requires a Netlify deploy (or `netlify dev` locally). Netlify Blobs is automatic —
  no extra service or account. If the cloud is unreachable, the studio falls back to
  this browser's local copy.

> The old `supabase/schema.sql` is unused — the personal cloud uses Netlify Blobs.

## Publish live (Phase A)

From the entry editor, **export & publish → publish live** commits a new dated entry
to GitHub (`entries.js` + `M.DD.YY.html`), triggers Netlify deploy, and the usual
new-entry subscriber email.

Requirements on Netlify:

- `STUDIO_API_SECRET` — same studio password (already set).
- `GITHUB_TOKEN` — personal access token or fine-grained token with **Contents: Read
  and write** on the `burnfolder` repo. (The newsletter subscribe function may
  already use this token; publish needs write access to `entries.js` and entry HTML.)

Phase A supports **text, Mux audio/video, album/playlist blocks** (playback ids only).
Image blocks and `IMAGES/` cover art are rejected until Phase B.

Publishing an existing date is blocked (409). Republish support can be added later.

## Legacy URL

`studio/editor.html` redirects to `index.html` (same `?id=` draft links still work).
