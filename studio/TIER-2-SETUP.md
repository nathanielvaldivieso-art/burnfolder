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

## Functions added

| Function | Role |
|----------|------|
| `studio-vault` | Presigned R2 upload / download |
| `studio-distro` | LabelGrid create / validate+distribute / status / prefs |

| Lib | Role |
|-----|------|
| `lib/master-vault.js` | R2 paths + signing |
| `lib/distribution/distribution.interface.js` | Provider factory (`labelgrid` only) |
| `lib/distribution/labelgrid.provider.js` | LabelGrid REST adapter |
