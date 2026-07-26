# Tier 2 setup — Release machine (LabelGrid + R2)

One-time operator checklist after Copilot deploys Tier 2 code. Full plan: `STUDIO-MASTER-PLAN.md` (§17 Tier 2).

**In:** Cloudflare R2 master vault, LabelGrid distro adapter (when API key present), ISRC/`trackRegistry`, releases UI + checklist.

**Solo plan (current):** No API. Studio stays in **manual mode** — vault + checklist + “mark ready / mark submitted”; create/distribute in the [LabelGrid dashboard](https://app.labelgrid.com/). Adding `LABELGRID_API_KEY` later flips the page back to API create/submit.

**Out (Tier 3+):** LabelGrid analytics ingest, catalog import, YouTube OAuth, gallery Phase B image publish (separate if needed).

## 1. Cloudflare R2 vault

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. Create bucket: `burnfolder-masters`
3. **Manage R2 API Tokens** → Object Read & Write on that bucket
4. Add to Netlify (+ local `.env`):

| Variable | Source |
|----------|--------|
| `R2_ACCOUNT_ID` | Cloudflare account id (URL / R2 overview) |
| `R2_ACCESS_KEY_ID` | Token creation screen |
| `R2_SECRET_ACCESS_KEY` | Token creation screen (shown once) |
| `R2_BUCKET_NAME` | `burnfolder-masters` |

**CORS (optional for browser direct PUT):** Studio uploads go through the Netlify `studio-vault` proxy by default, so bucket CORS is not required for Clips/picture uploads. Direct presigned PUT (releases masters, or `directPut: true`) still needs CORS — Safari shows **"Load failed"** without it.

Auto-apply runs on `upload-url` / `status` when the R2 token has Admin permission. Manual (Cloudflare → R2 → bucket → Settings → CORS):

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 2. LabelGrid

1. Sign up at [labelgrid.com](https://www.labelgrid.com) on an **API-capable** plan (confirm cost fits budget — pause if > ~$40/mo on top of Mux)
2. Complete artist profile (legal name, PRO, etc.)
3. Create a **label** + **artist** (+ **writer** for credits) in their dashboard
4. **Settings → API tokens** → create key → save as `LABELGRID_API_KEY`
5. Netlify env:

| Variable | Value |
|----------|--------|
| `LABELGRID_API_KEY` | API bearer token |
| `DISTRO_PROVIDER` | `labelgrid` |
| `LABELGRID_SANDBOX` | `true` while testing against sandbox (optional) |

Optional env shortcuts (or set the same ids in studio **releases → LabelGrid connection**):

| Variable | Notes |
|----------|--------|
| `LABELGRID_LABEL_ID` | numeric label id |
| `LABELGRID_ARTIST_ID` | numeric artist id |
| `LABELGRID_WRITER_ID` | numeric writer id (credits) |
| `LABELGRID_PRIMARY_GENRE_ID` | from `/genres` |

Docs: [api.labelgrid.com/docs/api](https://api.labelgrid.com/docs/api)

## 3. Deploy

```bash
npm install   # pulls @aws-sdk/client-s3 + s3-request-presigner for R2
netlify dev   # or push to trigger Netlify
```

Open `http://localhost:8888/studio/releases.html`

## 4. Wire prefs in studio

1. Sign in as **owner**
2. **releases** tab → **ping API** (confirms `LABELGRID_API_KEY`)
3. **load labels / artists / genres** → copy ids into prefs → **save prefs**
4. Set **© / ℗ name**

## 5. Verify first release path

Prepare: WAV/FLAC master(s), **3000×3000** cover, credits.

- [ ] Upload master on **releases** → vault key appears
- [ ] Upload cover + check “3000×3000”
- [ ] Checklist all green
- [ ] **create on LabelGrid** → catalog shows `distro_draft` + provider id
- [ ] **submit to DSPs** (owner only) → status `distro_submitted`
- [ ] Collaborator can upload/prepare but **cannot** submit
- [ ] ISRC blank until LabelGrid returns one; then field locks

DSP store review: **3–14 days** (passive wait).

## 6. Security hygiene

Never put `LABELGRID_API_KEY` or R2 secrets in client JS or git. Rotate if pasted in chat.

## 7. Sessions + pictures cloud vault

Same R2 bucket; separate path prefixes + Blob manifests.

| Kind | R2 path | Blob manifest |
|------|---------|---------------|
| `session` / `stem` / `ref` | `ws/{id}/projects/{songGroupKey}/{kind}s/{file}` | `projectFiles` |
| `image` | `ws/{id}/images/{folderKey}/{file}` | `imageLibrary` |
| `press` | `ws/{id}/press/{folderKey}/{file}` | `imageLibrary` |
| `epk` | `ws/{id}/epk/{folderKey}/{file}` | `imageLibrary` |

**API** (`studio-vault`):

| Action | Method | Notes |
|--------|--------|-------|
| `status` | GET | vault configured? |
| `upload-url` | POST | presigned PUT; pass `kind`, `songGroupKey` or `folderKey` (optional; proxy preferred) |
| `put` | POST (binary body) | `?action=put&kind=&fileName=` — server PutObject, no R2 CORS |
| `multipart-init` / `multipart-part` / `multipart-complete` | POST | chunked proxy for files > 5MB |
| `register` | POST | after PUT — writes manifest row (idempotent on `vaultKey`) |
| `list` | GET | merge manifest + R2; prefer registered rows |
| `download` | GET | short-lived presigned GET |
| `delete` | POST | owner only; deletes object + manifest row |

**Client helpers**

- `studio/js/vault-upload.js` — low-level; auto-registers project/image kinds after upload
- `studio/js/cloud-files.js` — `uploadSession`, `uploadImage`, `listSessions`, `listImages`, `download`, `remove`

### Verify (on deployed Studio after R2 env is set)

- [ ] `GET /api/studio-vault?action=status` → `{ configured: true }`
- [ ] Upload a session via `BurnfolderCloudFiles.uploadSession(file, { songGroupKey })`
- [ ] `list` / `listSessions` returns the file with `verified: true`
- [ ] `download` returns a working URL
- [ ] Owner `remove` deletes object + clears manifest row
- [ ] Upload a press photo via `uploadImage(file, { kind: 'press', folderKey: 'photonegative' })`

UI wiring (song/stream/press pages) is separate — helpers only until those surfaces land.

## Functions added

| Function | Role |
|----------|------|
| `studio-vault` | Presigned R2 upload / download / list / register |
| `studio-distro` | LabelGrid create / validate+distribute / status / prefs |

| Lib | Role |
|-----|------|
| `lib/master-vault.js` | R2 paths + signing + list |
| `lib/vault-manifest.js` | `projectFiles` + `imageLibrary` Blob rows |
| `lib/distribution/distribution.interface.js` | Provider factory (`labelgrid` only) |
| `lib/distribution/labelgrid.provider.js` | LabelGrid REST adapter |
