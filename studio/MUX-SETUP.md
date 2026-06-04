# Mux auto-upload from studio

Studio uploads **audio/video** straight to **Mux**. The entry editor **mux library** dropdown lists every ready file by **filename** (Mux passthrough). Use **more… → delete from mux** to remove a file permanently (stops storage billing for that asset).

Mux API keys never go in the browser. A small **Netlify function** on your machine (or production) talks to Mux for you.

## 1. Mux API keys

1. [dashboard.mux.com](https://dashboard.mux.com) → **Settings** → **API Access**
2. Create a token with permission to create **uploads** and read **assets**
3. Copy **Token ID** and **Secret**

## 2. Netlify environment (local)

In the **repo root** (not `studio/`), create or edit `.env` for Netlify CLI:

```env
MUX_TOKEN_ID=your_token_id
MUX_TOKEN_SECRET=your_token_secret
```

Or run once:

```bash
cd "/path/to/BURNFOLDER.COM (MAIN)"
npx netlify env:set MUX_TOKEN_ID "your_id"
npx netlify env:set MUX_TOKEN_SECRET "your_secret"
```

## 3. Run with functions (required for Mux)

Live Server alone **cannot** call Mux. Start Netlify dev from the **repo root**:

```bash
cd "/path/to/BURNFOLDER.COM (MAIN)"
npx netlify dev
```

Open studio at:

- **http://localhost:8888/studio/index.html** — entries
- **http://localhost:8888/studio/stream.html** — stream (all uploads)

(same port as `netlify dev`, usually 8888)

## 4. Live Server + Mux together (optional)

If you prefer Live Server on port 5500 for HTML:

1. Keep `netlify dev` running on 8888
2. Copy `studio/studio-config.example.js` → `studio/js/studio-config.js`
3. Uncomment `muxApiBase: 'http://localhost:8888/.netlify/functions'`
4. Use Live Server on `studio/index.html` as usual

## 5. In the UI

1. Drop `.mp3`, `.wav`, `.mp4`, etc. on the **right sidebar** (or into the preview)
2. Wait for upload + processing (often 1–3 minutes)
3. Files appear in the **track** dropdown — choose one and click **add**
4. Filenames on Mux match your upload name (duplicates become `name-2.mp3`, etc.)
5. Click **use in entry** on an audio/video block — fills **song title** (filename without extension) and **playback ID** (Mux’s real ID)

After changing Netlify functions, restart `netlify dev` (Control+C, then run again).

Images still use **IMAGES/** paths only (not Mux).

## Production

Add these in the Netlify site dashboard → **Environment variables**, then deploy:

| Variable | Required | Purpose |
|----------|----------|---------|
| `MUX_TOKEN_ID` | Yes | Mux API access |
| `MUX_TOKEN_SECRET` | Yes | Mux API access |
| `STUDIO_API_SECRET` | **Yes** | Locks studio + Mux functions behind a password |

Generate a long random `STUDIO_API_SECRET` (32+ characters). You enter this once in the studio login screen on each device/browser session.

**Without `STUDIO_API_SECRET` on production**, studio and all Mux API endpoints return **503** (locked).

Functions (all require `Authorization: Bearer <STUDIO_API_SECRET>` in production):

- `/.netlify/functions/mux-list-assets`
- `/.netlify/functions/mux-create-upload`
- `/.netlify/functions/mux-upload-status`
- `/.netlify/functions/mux-delete-asset`
- `/.netlify/functions/studio-auth-check` (login verification)

Also available via `/api/*` redirect where configured.

## Security notes

- **Mux keys** never go in the browser — only Netlify functions use them.
- **Studio password** is checked server-side; it is stored in `sessionStorage` for the tab session only (not in source code).
- **Main site** (`burnfolder.com`, `music.html`, etc.) stays public — published playback IDs are already playable on Mux.
- **Studio** (`/studio/*`) is private admin: upload, delete, and browse your full Mux library.
- Local `netlify dev` works without `STUDIO_API_SECRET` for convenience; production does not.
