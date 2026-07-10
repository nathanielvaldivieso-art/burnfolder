# Tier 1 setup — Burnfolder Studio

One-time operator checklist after Copilot deploys Tier 1 code. Full plan: `STUDIO-MASTER-PLAN.md` (§0 near-term, §17 Tier 1).

## 1. Run Supabase migrations (required)

If you skip this, sign-in works but collaboration APIs fail.

1. Open [Supabase](https://supabase.com/dashboard) → project **burnfolder-studio**
2. **SQL Editor → New query**
3. Paste and run `supabase/migrations/001_tier1.sql`
4. Paste and run `supabase/migrations/002_music_project_collab.sql`

## 2. Confirm environment variables

**Netlify** (Site configuration → Environment variables) and local **`.env`** (gitignored) should include:

| Variable | Notes |
|----------|-------|
| `SUPABASE_URL` | `https://laknobdkbbfujnmsqzak.supabase.co` |
| `SUPABASE_ANON_KEY` | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only — never in browser/git |
| `ANTHROPIC_API_KEY` | Anthropic console |
| `AI_PROVIDER` | `anthropic` |
| `AI_MODEL` | `claude-haiku-4-5` |
| `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` | existing |
| `GITHUB_TOKEN` | existing — publish live |
| `STUDIO_API_SECRET` | keep until Supabase auth verified, then remove from production |

**Supabase → Authentication → URL configuration**

- Site URL: `https://burnfolder.com`
- Redirect URLs: `https://burnfolder.com/**`, `http://localhost:8888/**`

**Supabase → Authentication → Providers → Email**

- Email enabled; confirm email **off** for Tier 1 (faster invites)

Your owner account must exist under **Authentication → Users**.

## 3. Deploy

Push to Netlify (or trigger deploy). Local test:

```bash
netlify dev
```

Open `http://localhost:8888/studio/today.html`

## 4. Verify (45–60 min)

- [ ] Sign in at `/studio/` with Supabase email (not old studio password)
- [ ] **today** tab shows workspace name + `owner`
- [ ] Open **music** → expand a project → **collaborators** → invite by email; copy invite URL
- [ ] Collaborator opens invite URL, signs in, lands on **music** with **only that project**
- [ ] Guest on project: read-only (no upload); collaborator: can edit that project only
- [ ] Collaborator cannot open entry/journal/video/today (music only)
- [ ] Owner: create entry draft → **publish live** → burnfolder.com updates
- [ ] **Ask AI** one on-demand question on **today**
- [ ] **Export** on today downloads workspace JSON backup
- [ ] Lock button signs out; sign back in

## 5. Security hygiene

If API keys were pasted in chat or screenshots, rotate in Supabase and Anthropic consoles, then update Netlify + local `.env`.

## Tier 1 scope reminder

**In:** Supabase login, owner workspace, per-project music invites, workspace-scoped blobs/Mux, on-demand AI, JSON export, owner-only publish live.

**Out (Tier 2+):** Whole-workspace collaborators, LabelGrid, R2 vault, social posting, analytics dashboard, subdomains, proactive AI.
