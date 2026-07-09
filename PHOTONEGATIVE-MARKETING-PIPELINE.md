# Autonomous Music Marketing Data Pipeline & Task Agent

**Status:** Spec — build after feed step 62 (Tier 3 analytics resume)  
**Scope:** PHOTONEGATIVE solo-operator marketing automation  
**Parent plan:** `PHOTONEGATIVE-RELEASE-PLAN.md` · `STUDIO-MASTER-PLAN.md` §9.5, §9.11

---

## 1. Project Overview & Objective

We are building a lightweight, automated backend system that acts as an **Agile Marketing Task Manager** for a solo independent music artist. The system ingests music distribution data, web analytics, and a creative asset inventory, filters it through an LLM, and outputs a concise, daily **To-Do List** of micro-actions via an alert channel (Webhook / Slack / Telegram / Logfile).

The goal is absolute minimization of analysis paralysis for a sole operator. The AI must never output long essays or open-ended strategic advice; it must output direct, data-justified tasks.

---

## 2. System Architecture & Data Flow

```
[LabelGrid API / Webhooks] ──┐
[Web Traffic / Link Logs] ──┼─> [ SQLite / PostgreSQL Database ] ──> [ Python AI Engine ] ──> [ Actionable Daily Alert ]
[Creative Asset Library]  ──┘
```

---

## 3. Data Schema & Ingestion Requirements

The system must store and relate three distinct data layers in a relational database:

### A. Catalog & Performance Ingest (Lagging Indicators)

**Source:** Simulating endpoints from LabelGrid API / DDEX metadata.

**Fields:**

- ISRC, UPC, Track Title, Project Type (Single / EP / Album)
- Daily Streams by DSP (Spotify, Apple Music, YouTube)
- Daily Saves / Adds
- Geographic Tier (Country / City)
- UGC Video Uses (YouTube Content ID, TikTok audio count)

### B. High-Intent Fan Traffic (Leading Indicators)

**Source:** Local website / landing page analytics or smart-link click logs.

**Fields:**

- Date, Target URL, Total Visits
- Click-Through Rate (CTR) to DSPs
- Average Time on Page

### C. Creative Asset Inventory (The Execution Capital)

**Source:** A localized JSON or database log of pre-made creative assets ready to deploy.

**Fields:**

- Asset_ID, Track_ID association
- Asset_Type (Short-form Video, Official Video, Live Clip, Canvas Loop, Social Image)
- Status (Ready / In-Progress)
- Description / Context

---

## 4. The AI Processing Logic (System Prompt Blueprint)

When the Python script triggers the LLM (OpenAI API / Anthropic API), it must pass the current data snapshot along with the following strict System Prompt constraints:

```text
ROLE: You are an elite, agile digital music marketer and task manager handling an independent artist's release.
INPUT: You will be given a snapshot of:
1. Daily stream/save velocity changes.
2. Web/Link traffic conversion rates.
3. An inventory of available creative assets.

CONSTRAINTS:
- Never write essays, introductions, or pleasantries.
- Never give general music industry advice.
- You must parse the data for anomalies: sharp stream spikes, algorithmic triggers (high save rates), or high web traffic with low conversion (link friction).
- You must match performance anomalies directly to available assets in the inventory.

OUTPUT FORMAT:
Output exactly 3 high-priority, data-justified, actionable micro-tasks for today.
Format each task strictly as:
- [ ] **TASK TITLE**: Clear actionable execution step.
  * *Data Justification*: Brief 1-sentence note explaining why this is prioritized.
  * *Asset to Use*: Specify the Asset_ID or asset file name from the inventory.
```

---

## 5. PHOTONEGATIVE context

| Surface | Maps to |
|---------|---------|
| Album hub + smart links | Layer B — traffic / CTR |
| LabelGrid distro (step 35–37) | Layer A — ISRC, UPC, streams |
| Launch fragments + track visuals (steps 15–20) | Layer C — asset inventory |
| Step 61 metrics snapshot | Seed data for first pipeline run |
| Studio dashboard (`/studio/dashboard.html`) | Future UI home for ingest + alerts |

**Voice rule (unchanged):** This agent produces **operator tasks only** — never journal copy, captions, or off-site marketing language. Public gallery voice stays in `COPILOT.md`.

---

## 6. Alert channels (v1)

Pick one primary channel; others are optional:

| Channel | Use |
|---------|-----|
| Webhook | Netlify function or cron POST to custom endpoint |
| Slack | Incoming webhook |
| Telegram | Bot API |
| Logfile | Local / server append — lowest friction for solo dev |

---

## Related files

| File | Role |
|------|------|
| `PHOTONEGATIVE-RELEASE-PLAN.md` | Release feed — steps 61–62 gate this work |
| `STUDIO-MASTER-PLAN.md` | Tier 3 analytics ingest, dashboard, marketing module |
| `studio/dashboard.html` | Analytics home shell |
| `netlify/functions/studio-ai.js` | Existing AI gateway — extend with metrics snapshot |
