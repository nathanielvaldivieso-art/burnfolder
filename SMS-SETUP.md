# Burnfolder text chain (SMS)

When email is down — or when you want higher engagement — fans get a text when a new journal entry goes live. Same pattern as the email newsletter: Netlify Blobs store the list; GitHub Actions + Twilio send the messages.

## What you get

| Path | Behavior |
|------|----------|
| Home dock | “text for new entries” → phone → `subscribe-sms` |
| Keyword join | Fan texts `JOIN` to your Twilio number |
| Opt-out | Fan texts `STOP` (Twilio + our list both drop them) |
| Welcome | `repository_dispatch` → `welcome-sms.yml` |
| New entry | `notify-new-entry.yml` texts every stored phone |

Storage: Netlify Blobs store `burnfolder-newsletter`, key `subscriber-phones` (E.164, e.g. `+15551234567`). Not in git.

## Setup (one-time)

### 1. Twilio

1. Sign up at [twilio.com](https://www.twilio.com)
2. Buy a US SMS-capable number
3. Console → Account → API keys / Auth token: copy **Account SID** and **Auth Token**
4. Note the **From** number in E.164 (`+1…`)

US A2P 10DLC: for production marketing/notif volume, register a brand + campaign in Twilio Trust Hub so carriers don’t filter you. Trial numbers can only text verified numbers until you upgrade.

### 2. GitHub secrets

Repo → Settings → Secrets and variables → Actions. Add:

| Secret | Value |
|--------|--------|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | Your Twilio number (`+1…`) |

Keep existing `SUBSCRIBERS_EXPORT_SECRET` (same as Netlify) — the notify workflow exports both emails and phones from one endpoint.

Confirm workflow `welcome-sms.yml` is on `main` (this PR adds it). If Actions were never pushed with `workflow` scope, add it via the GitHub UI — see `WORKFLOWS-SETUP.md`.

### 3. Netlify

Site settings → Environment variables (already need these for email):

- `GITHUB_TOKEN` — PAT with `repo` (dispatches welcome SMS)
- `SUBSCRIBERS_EXPORT_SECRET` — matches GitHub

Optional one-time seed:

- `SUBSCRIBER_SEED_PHONES` — comma-separated numbers; loaded on first SMS subscribe if the blob is empty, then remove the env var

### 4. Inbound webhook (JOIN / STOP / HELP)

1. Twilio Console → Phone Numbers → your number → Messaging
2. “A message comes in” → Webhook → HTTP POST
3. URL:

```
https://burnfolder.com/.netlify/functions/sms-inbound
```

Keywords handled by `sms-inbound.js`:

- `JOIN` / `START` / `YES` / `SUBSCRIBE` → add to list
- `STOP` / `CANCEL` / … → remove from list
- `HELP` → short info reply

Twilio still does carrier-level STOP; the webhook keeps our Blob list in sync.

## How it runs

**Web signup**

1. Fan enters phone on burnfolder.com
2. `subscribe-sms` normalizes to E.164, writes Blob
3. Dispatches `send_welcome_sms`
4. `welcome-sms.yml` sends via Twilio REST API

**Keyword signup**

1. Fan texts `JOIN` to the Twilio number
2. `sms-inbound` adds the `From` number and replies

**New entry**

1. Dated HTML / `entries.js` lands on `main`
2. `notify-new-entry.yml` waits for deploy, exports subscribers
3. Emails send if the provider works (`continue-on-error` so a down email provider doesn’t block texts)
4. Every phone gets: `new burnfolder entry: M.DD.YY` + link

## Testing

1. Deploy this branch to Netlify (or merge to `main`)
2. Confirm secrets above
3. On the live site, enter your phone → expect welcome text in ~1 min
4. Or text `JOIN` to the Twilio number
5. Publish a test entry (or re-run the notify workflow) → expect the entry text

Local: `netlify dev` — form still blocks `localhost` unless you hit the function directly.

## Message copy

Sparse, lowercase, archive voice:

- Welcome: `burnfolder — you are on the text list. new entries land here. reply STOP to leave. burnfolder.com`
- New entry: `new burnfolder entry: M.DD.YY` + `https://burnfolder.com/M.DD.YY.html`

Edit bodies in `.github/workflows/welcome-sms.yml` and the SMS step in `notify-new-entry.yml`.

## Email still exists

`subscribe` + Resend/SendGrid workflows remain for when inbox works again. Home dock is text-first; email API is unchanged.
