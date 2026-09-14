# PHOTONEGATIVE — Release Plan

**Merged into** [`STUDIO-MASTER-PLAN.md`](STUDIO-MASTER-PLAN.md) **§0**.

Arm (**P#**) · Load (**D#**) · Gate wait (**G#**) · Press (**L#**) · Ride (**R#**) — all live in the master.

Tell Copilot: *"implement platform step P#"* (arm priority: **P7 → P8 → P9 → P11 → P20**).

---

## Legal & Royalties — This Week (LLC Deferred)

Use the full career checklist in [`CAREER-LEGAL-ROADMAP.md`](CAREER-LEGAL-ROADMAP.md) once the release is moving. For now, the immediate priority is everything that has to exist before or alongside the Photonegative drop.

1. **Affiliate as a songwriter with a PRO** (BMI or ASCAP) so the songs can be registered and start earning performance royalties.
2. **Register as a publisher with the same PRO** (or sign up with a publishing administrator like Songtrust / Kobalt) so you collect the full publisher share instead of leaving it on the table.
3. **Register with SoundExchange** as both the featured artist and the sound-recording copyright owner for Photonegative so non-interactive radio/web royalties can flow in.
4. **Create an MLC account** and register the Photonegative compositions to collect U.S. digital mechanical royalties.
5. **Lock down split sheets** for every track with co-writers, producers, or featured artists; get signed copies before release day.
6. **Confirm sample / loop library clearance** for every borrowed sound; keep license receipts/files in one folder.
7. **Register the Photonegative release with the U.S. Copyright Office** — ideally both the sound recording (SR) and the underlying compositions (PA) — to unlock statutory damages and a public record before infringement risk rises.
8. **Assign ISRCs and a UPC/EAN** through your distributor and make sure the metadata is identical at the PRO, SoundExchange, MLC, and distributor.
9. **Set up a simple accounting system** (Wave, QuickBooks Self-Employed, or a spreadsheet) to track Photonegative income/expenses separately from personal funds.
10. **Decide on a release-date buffer** that gives you at least a few days after steps 1–9 are complete before going live, so registrations have time to propagate.

*Note: LLC formation is intentionally deferred for now. Revisit it once revenue becomes consistent or liability exposure increases.*

---

## This Week's Docket

Order matters. Do the legal/rights setup first because it takes days to propagate, then use that momentum to close the open arm blocks.

### Rights & money (start now; LLC deferred)

1. **~~Affiliate as a songwriter with a PRO~~** (BMI or ASCAP) — *done, ASCAP pending verification.*
2. **~~Register as a publisher with the same PRO~~** or sign with a publishing administrator — *done, pending verification.*
3. **~~Register with SoundExchange~~** as featured artist + sound-recording copyright owner — *done, pending verification (registered as solo/individual, SSN).*
4. **~~Create an MLC account~~** and register the Photonegative compositions — *done, pending verification.*
5. **~~Lock down split sheets~~** for every track and get signed copies — *done, sole writer; 100% ownership documented.*
6. **~~Confirm sample / loop library clearance~~** and file receipts in one folder — *done: Splice + Analog Lab licenses paid; own voice/instruments.*
7. **Register the release with the U.S. Copyright Office** (PA + SR where applicable).
8. **Assign ISRCs and a UPC/EAN** through the distributor and mirror the metadata to PRO / SoundExchange / MLC.
9. **Set up simple accounting** for Photonegative income/expenses.

### Laptop / Arm blocks

10. **~~P7~~** — Song page shells for all four tracks — *done; shells created for SOMETIMES, FIRE ESCAPE, PHOTO NEGATIVE, IT DOESNT MATTER.*
11. **~~P8~~** — Album hub tracklist → song page links — *done; tracklist now links each song to its song page.*
12. **P9** — Slots for lyrics, BTS clips, 30s preview, and press photos per song. Lyrics/process notes are per-version; clips live at the song level and can be titled by version.
13. **P11** — Press download paths that survive hi-res swaps.
14. **~~P20~~** — UTM scheme + pitch sheet skeleton + newsletter draft shell. *done; written in the P20 section below.*
15. **Hotline decision** — build the MVP if it stays essential to the artwork; explicitly defer if not.

### Studio / Load decision

16. **Decide the master path** — self-master or hire engineer — and put the final blocks on the calendar so a release date range can be set.

## P20 — Ride prep (paper / notes only)

No new SaaS. These three working documents live here so gate-wait and press-day work is ready before the DSP unlock.

### 1. UTM scheme

Every off-site CTA points to the album hub (`https://burnfolder.com/album.html`) and carries these parameters:

- `utm_source` — the door: `youtube`, `ig`, `email`, `pitch`
- `utm_medium` — the format: `fragment`, `story`, `post`, `dm`, `bio`, `newsletter`
- `utm_campaign=photonegative`
- `utm_content` — the specific fragment, track, or pitch id, e.g. `sometimes-clip-1`, `pitch-sun-010`, `fire-escape-lyrics`
- `utm_term` — optional, for paid/keyword tests only; leave empty unless running ads

Rules:
- Lowercase kebab-case, no spaces.
- Always land on the album hub; song-page links use `song.html?song=<key>` as the base.
- Match the `utm_content` tag exactly to the pitch spreadsheet row so you can trace which fragment/pitch drove a land. The dashboard currently groups by source/medium/campaign; per-content scoring is tabled until traffic makes it worthwhile.

Examples:

| Door | URL |
|------|-----|
| YouTube short — SOMETIMES clip 1 | `https://burnfolder.com/album.html?utm_source=youtube&utm_medium=fragment&utm_campaign=photonegative&utm_content=sometimes-clip-1` |
| Instagram story swipe | `https://burnfolder.com/album.html?utm_source=ig&utm_medium=story&utm_campaign=photonegative&utm_content=hub-story-010` |
| Newsletter blast | `https://burnfolder.com/album.html?utm_source=email&utm_medium=newsletter&utm_campaign=photonegative&utm_content=blast-010` |
| Pitch to blog "Sun" | `https://burnfolder.com/album.html?utm_source=pitch&utm_medium=email&utm_campaign=photonegative&utm_content=pitch-sun-010` |

### 2. Pitch spreadsheet skeleton

Use a CSV or spreadsheet with these columns:

| target | contact | angle | date_sent | reply | outcome | utm_content | notes |
|--------|---------|-------|-----------|-------|---------|-------------|-------|
| Sun blog | editor@sunblog.com | Slow-built single, fits late-night writing column | | | | pitch-sun-010 | Submitted via form |
| Gray playlist | gray@spotify.com | Bedroom production, vocal-forward | | | | pitch-gray-011 | Follow-up after press day |

Outcomes: `playlist`, `blog`, `ignore`, `pending`, `follow-up`.

Starter leads and a how-to-find-more guide live in [`PHOTONEGATIVE-PITCH-LEADS.md`](PHOTONEGATIVE-PITCH-LEADS.md).

### 3. Newsletter draft shell

```
Subject: PHOTONEGATIVE — [gate date or "out now"]
From: nathaniel@burnfolder.com
List: burnfolder newsletter
Hub link: https://burnfolder.com/album.html?utm_source=email&utm_medium=newsletter&utm_campaign=photonegative&utm_content=blast-010

[Body written during gate wait]

- one opening line
- one line on the picture
- album hub link
- press page link
- shop / PWYW link
- sign-off
```

Do not say “OUT NOW” until the gate has actually cleared.

### Do not do this week

- Clothes/merch manufacturing, SaaS builds, ads, speculative sync pitching, generalized posting, or starting multi-tenant / Tier 3+ work.
