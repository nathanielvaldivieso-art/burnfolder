# Burnfolder Studio — Dashboard Marketing Plan

**Status:** Living product plan (started July 13, 2026)  
**North star:** Turn Studio dashboard into a **state-of-the-art marketing consultant** for a solo artist / indie brand — data in, strategy out based on goal, ship into owned tools, measure whether it worked.  
**Relates to:** `STUDIO-MASTER-PLAN.md` §9.5 (listening / growth data), PHOTONEGATIVE day-0 analytics (P16–P19)  
**Owner surface:** `/studio/dashboard.html`

---

## 0. Thesis

Burnfolder’s desk should behave like a **boutique marketing firm on retainer**:

1. **Read** the board (pulse)  
2. **Diagnose** the funnel / site under load  
3. **Bet** on one move  
4. **Ship** into a real world or studio tool
5. **Score** the bet next period  

AI never replaces taste. It never pens fan-facing copy. It translates numbers into **where to go and what to change**.

**Core differentiator:** site traffic should **reshape site architecture** — pathways are the floor plan under load; entry / music / shop / press are the levers.

```
people walk the site
     ↓
pathways show the real floor plan
     ↓
desk picks one weight change (or email / fix)
     ↓
you ship in entry · music · shop · press · pen
     ↓
publish / send
     ↓
pathways + pulse prove it worked (or didn’t)
```

---

## 1. Design principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **One screen, three jobs** | Pulse · Work · Look closer — never five equal tabs |
| 2 | **One bet at a time** | Max one primary `nextMove` / queued action |
| 3 | **Silence > filler** | Empty or “not enough signal” beats fake ambition |
| 4 | **Anti-generation** | Artist pens every outbound word; AI only briefs |
| 5 | **Ship or it isn’t a move** | Every action names a Studio surface + done condition |
| 7 | **Architecture over reach** | Prefer feature / path / spotlight / offer / fix over “post more” |
| 9 | **Close the loop** | Sticky bets + scoreback; advice that evaporates is worthless |
| 10 | **No cards / no dashboard chrome clutter** | Keep Burnfolder spareness; power in hierarchy, not widgets |

---

## 2. Marketer operating loop (framework)

Real marketers don’t stare at metrics — they run cadence:

| Cadence | Job | Dashboard job |
|---------|-----|----------------|
| **Mon read** | What moved? | Pulse +/− vs prior period |
| **Diagnose** | Where’s the leak / win? | Funnel label in `why` + pathway map |
| **Bet** | One priority | `nextMove` + sticky bet card |
| **Ship** | Production | Deep-link into tool (`ship.href`) |
| **Wed follow-up** | Still open? | Queue until done / send / skip |
| **Fri score** | Did Monday’s bet pay? | Next digest opens with scoreback |

**Funnel lens (always):**  
`discover → listen → land → subscribe / tip / buy / shop`

**Diagnosis categories (AI must pick one in `why`):**

- **Attention** — listens up, lands flat  
- **Conversion** — lands up, earned flat  
- **Offer** — money only on one rail (e.g. tips, shop quiet)  
- **Retention** — repeats / list quiet  
- **Distribution** — outbound DSP high, return lands low  
- **Architecture** — converting path buried; dead path featured  

---

## 3. UI target — three surfaces

### 3.1 Pulse (always on)

| Signal | Job |
|--------|-----|
| **listen** | Are people staying with the music? |
| **lands** | Are people finding the site? |
| **earned** | Did support land? |

**Next:** period deltas (`+12 lands`, `−$0 tips`). Optional fourth pulse chip only if outbound DSP interest dominates.

### 3.2 Work / market desk (always on)

- One punchy imperative line (`nextMove`)  
- **do this** → commits the bet (does not auto-queue from AI alone)  
- **again** → re-read  
- Queue:  
  - **Emailable** → empty pen + send / skip  
  - **Studio task** → primary CTA opens tool + done / skip  
- Sticky until done/sent/skipped (survive refresh)

### 3.3 Look closer (collapsed by default)

| Block | Contents |
|-------|----------|
| **listen** | Site song board + heat; site/DSP toggle when DSP exists |
| **map** *(new)* | Pathway graph — rooms + edge weights + money exits circled |
| **pathways** | Leaderboard + landings / sources / outbound (disclosure) |
| **email** | Subscribers, click rate, campaigns |
| **money** | Tips / digital / shop + recent |
| **shares** *(new)* | Share-link plays already in analytics snapshot |

**Removed from home forever:** peer analytics tabs, attention vanity strip, press/shop/export chrome as dashboard clutter.

---

## 4. AI — boutique marketing consultant

### 4.1 Role

Sharp advisor for a solo brand. Reads `metricsSnapshot` + audiences. Outputs **one** highest-leverage move a non-marketer can execute today.

### 4.2 Output contract

```json
{
  "digest": {
    "headline": "",
    "period": "week",
    "periodLabel": "this week",
    "sections": [],
    "nextMove": "Pin tip pathway — lead entry with the finishing cut"
  },
  "actions": [
    {
      "move": "feature",
      "title": "Pin tip pathway — lead entry with the finishing cut",
      "why": "conversion · top pathway ends near tip · song X peaks late",
      "cohortLabel": "",
      "audience": { "mode": "none", "actionKey": "", "emails": [] },
      "aiHint": "Block order: audio first; tip/shop link above fold",
      "shareHint": "",
      "ship": {
        "surface": "entry",
        "href": "/studio/index.html?bet=feature&target=tip",
        "cta": "open entry",
        "doneWhen": "publish"
      }
    }
  ]
}
```

### 4.3 Move vocabulary

| Move | Typical ship surface | When |
|------|----------------------|------|
| `feature` / `path` | entry | Amplify converting pathway |
| `spotlight` | entry / music | Heat concentrated on one cut |
| `offer` | shop | Product/price/weight wrong |
| `fix` | tip / shop / press page | Friction on money path |
| `email` | queue pen | Addressable cohort + purpose |
| `thank` | queue pen | Rare, high-value only |
| `bridge` | entry / press | Outbound interest, weak return |
| `drop` | journal / entry | Owned content moment |

### 4.4 Hard rules

- Data truth: `metricsSnapshot` only — never invent emails or numbers  
- Anonymous plays → architecture moves, **never** email  
- Max 1 action; thank is never the default  
- No customer-facing copy generation  
- Prefer quieter no-move when signal is too thin  

### 4.5 Files

- `netlify/functions/studio-ai.js` — system prompt + extract  
- `studio/js/studio-ai-panel.js` — desk UI, cache, queue  
- `netlify/functions/lib/market-desk-store.js` — queue, scrutiny, audiences  
- `netlify/functions/studio-market-desk.js` — queue CRUD + send  

---

## 5. Ship contract — translation into action

**Problem:** Insight without a tool path is a sticky note.  
**Fix:** Every action carries `ship` — surface, href, CTA, done condition.

| Lever in data | Ship into | Done means |
|---------------|-----------|------------|
| Pathway / tip / shop converts | Entry (block order, CTAs) | Published |
| Song heat concentrated | Entry / music feature | Live featured |
| Offer mix wrong | Shop designer | Product order / active published |
| Addressable cohort + purpose | Email pen | Artist wrote + sent |
| Rare high-value support | Email (selective) | Sent |
| Friction on money path | Tip / shop / press | Friction removed + published |
| Outbound high, return low | Entry / press bridge | Live return path |

**UI rule:** Primary button is `open entry` / `pen email` / `open shop` — not generic “done” until the artist has entered the tool (email excepted: pen is the tool).

**Surfaces already in Studio (wire as ship targets):**

| Surface | Path | Architecture lever |
|---------|------|--------------------|
| Entry composer | `/studio/index.html` | Block order, what home traffic meets |
| Music | `/studio/stream.html` + `musicFeaturedRelease` | What owns `music.html` |
| Press | `/studio/press-designer.html` | Proof / return / links |
| Shop | `/studio/shop-designer.html` | Offer weight |
| Journal | `/studio/journal.html` | Owned drop cadence |
| Email queue | desk itself | Cohorts only |

Target surfaces should accept `?bet=&target=` (or equivalent) and show a **one-line desk brief** at top while shipping.

---

## 6. Site data → site architecture (flagship loop)

### 6.1 Insight

Analytics pathway labels (`home`, `music`, `shop`, `press`, `journal:…`, `album:…`, `song:…`, `out:spotify`, …) are not vanity — they are **rooms**. The desk’s job is to **reweight the building**.

### 6.2 Architecture levers (priority)

1. **Entry block composition** — strongest editable architecture today  
2. **`musicFeaturedRelease`** — expose in Studio; desk can propose feature  
3. **Homepage `entryOrder`** — pin converting dates, don’t only prepend newest  
4. **Shop product order / `active`** — pin earners, demote dead SKUs  
5. **Tip in the pathway graph** — record tip UI open as a hop so money rooms are visible  
6. **Press link / bridge CTAs** — return paths from distribution  

### 6.3 Pathway map (Look closer)

Directed graph of pathway nodes + edge session counts. Circle money exits (shop / tip-adjacent / success). Desk cites a node/edge when diagnosing **architecture** or **conversion**.

### 6.4 What we are not building

No full drag-and-drop site builder / Webflow clone. Composition stays Burnfolder: **blocks, features, orders, publish**.

---

## 7. Sticky bets + scoreback

| Need | Behavior |
|------|----------|
| **Sticky** | Accepted bet persists (blob / local) until sent / done / skipped |
| **Brief** | Travels with deep-link into designer |
| **Scoreback** | Next digest: “Last bet: … → lands +N · earned +$X” (or “too early”) |
| **Quota** | Honor `maxWeeklyActs` server-side later (today client context only) |

Without scoreback, the product is motivational poster, not a consultant.

---

## 8. Data map (inputs the consultant may use)

| Source | Status | Use |
|--------|--------|-----|
| Site lands / listens / heat | Live | Attention + architecture |
| Pathways / UTM / referrers / outbound | Live | Map + diagnosis |
| Commerce tips / digital / shop | Live | Offer + conversion |
| Newsletter subs + blasts + UTM click rate | Live | Email moves |
| Fan actions (tip/digital/shop/subscribe emails) | Live | Addressable cohorts |
| Share-link plays | In snapshot, **not in UI yet** | Look closer + AI |
| Time series | In snapshot, **unused** | Deltas / slopes for AI |
| Cloudflare visits | Optional API, **not in UI** | Secondary pulse |
| DSP (Spotify/Apple) | Stub pending | Later; until then outbound = distribution signal |

**Integrity fixes (platform):**

- Fan actions vs queue workspace scoping (`legacy` vs workspace)  
- First-party analytics workspace scoping when multi-tenant matters  
- Newsletter UTMs required for honest click rate  

---

## 9. Phased roadmap

### Phase A — Consultant core *(foundation; partly shipped)*

- [x] Pulse · work · look closer remodel  
- [x] Marketing-advisor prompt (not thank-you-only)  
- [x] Opt-in **do this** (no auto-queue)  
- [x] Email vs studio-task queue cards  
- [x] Cut demo/fake metrics fixture  
- [ ] Persist sticky bet across refresh  
- [ ] Ship object on actions (`surface`, `href`, `cta`, `doneWhen`)  
- [ ] Queue primary CTA = open tool / pen  
- [ ] Period deltas on pulse  
- [ ] Feed series deltas into AI context  

### Phase B — Architecture loop *(flagship)*

- [ ] Pathway **map** in look closer  
- [ ] Tip hop in pathway labeling  
- [ ] Desk deep-link → entry with sticky brief (`?bet=&target=`)  
- [ ] Deep-link → shop / press  
- [ ] Studio control for `musicFeaturedRelease`  
- [ ] Homepage pin / `entryOrder` control (not only publish-prepend)  
- [ ] AI bias: architecture moves preferred for anonymous signal  

### Phase C — Score & cadence

- [ ] Scoreback on next digest from last bet fingerprint  
- [ ] Weekly cadence copy (Mon bet / Fri score)  
- [ ] Server-side weekly act quota  
- [ ] Surface share links + outbound chip when dominant  

### Phase D — Distribution & fidelity

- [ ] DSP ingest (Tier 3 per master plan) when ready  
- [ ] Cloudflare chip only if it changes a decision  
- [ ] Light A/B: tag two pathways, desk asks which won after 7 days  
- [ ] Multi-tenant cohort / analytics scoping correctness  

---

## 10. Explicit non-goals

- More home-surface metric tabs  
- AI-written emails, captions, lyrics, posts  
- Auto-thank every tipper / every buyer  
- Full social scheduler inside dashboard  
- Auto-publishing site changes without the artist  
- Vanity follower graphs as primary pulse  
- Replacing press/shop designers with a mega page builder  

---

## 11. Success criteria

The desk is “state of the art” when a non-marketer can:

1. Open dashboard and know **health in three numbers**  
2. Accept **one** clear bet with a reason  
3. Land **inside the right Studio tool** with a brief  
4. Publish or send without guessing  
5. Return later and see whether the bet **moved pulse / pathways**  

Secondary: converting pathways rise after architecture ships; email sends carry purpose + UTMs; thank-yous stay rare and human.

---

## 12. File map (implementation)

| Path | Role |
|------|------|
| `studio/dashboard.html` | Shell: pulse, desk, closer |
| `studio/js/dashboard-page.js` | Analytics render, closer, map (future) |
| `studio/js/studio-ai-panel.js` | Digest, queue, ship CTAs |
| `studio/css/studio.css` | Dashboard spareness |
| `netlify/functions/studio-analytics.js` | Period snapshot |
| `netlify/functions/studio-ai.js` | Consultant model |
| `netlify/functions/studio-market-desk.js` | Queue + send |
| `netlify/functions/lib/market-desk-store.js` | Store, scrutiny, audiences |
| `shared/site-analytics.js` | Collection + pathway labels |
| `studio/index.html` + entry editor | Primary architecture ship target |
| `studio/shop-designer.html` / `press-designer.html` | Offer / bridge targets |
| `entries.js` → `entryOrder`, `musicFeaturedRelease` | Architecture data |

---

## 13. Working notes / decisions log

| Date | Decision |
|------|----------|
| 2026-07-13 | Remodel to pulse · work · look closer; kill tab parity |
| 2026-07-13 | Retire thank-you-only desk; marketing advisor + rare thanks |
| 2026-07-13 | Opt-in queue; remove demo metrics fixture |
| 2026-07-13 | North star: ship contract + site data → site architecture |
| 2026-07-13 | This plan created as ongoing effort doc |

Update this section when shipping phase milestones or reversing a principle.

---

**Copilot cue:** *"implement dashboard marketing plan Phase A/B/C item … per DASHBOARD-MARKETING-PLAN.md"*
