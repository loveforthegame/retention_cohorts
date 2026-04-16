# Predis Retention Dashboard

An internal analytics dashboard for analyzing paid user retention at Predis.ai. Upload an Excel export, get pivot tables, charts, cohort survival curves, and AI-generated insights — all computed locally in the browser. No database, no backend, no raw data leaves your machine.

---

## What it does

- Upload a `.xlsx` export of paid users
- All computation happens in-browser (SheetJS + vanilla JS)
- Renders 15+ charts and pivot tables: cohort survival curves, trial depth, feature adoption, churn segmentation, zero post-buy analysis, and more
- AI insights panel powered by Claude — sends only aggregated summaries, never raw row data
- Conversational chat to query the data in plain language
- Definitions drawer explaining every metric, formula, and rationale
- Dark mode by default, light mode toggle

---

## File structure

```
├── index.html          ← Full UI: upload screen, dashboard, sidebar filters, modals
├── styles.css          ← All styles: dark/light tokens, components, date picker, drawer
├── data-processor.js   ← Excel parsing, helper columns, all 17+ pivot functions
├── charts.js           ← Chart.js renders (survival curves, heatmap, bar/line charts)
├── ai.js               ← Claude prompt builder, insights + chat logic
├── app.js              ← Master controller: init, filters, date picker, uploads, state
└── worker/
    ├── index.js        ← Cloudflare Worker: API proxy for /insights and /chat
    └── wrangler.toml   ← Worker config
```

**Script load order matters** — `data-processor.js` → `charts.js` → `ai.js` → `app.js`. All files must be in the same directory as `index.html`.

---

## Deploy

### Frontend (Netlify)

Put all files (`index.html`, `styles.css`, `data-processor.js`, `charts.js`, `ai.js`, `app.js`) in one flat folder and drag it to [netlify.com/drop](https://app.netlify.com/drop). No build step.

### AI Worker (Cloudflare)

```bash
cd worker
npm install -g wrangler
wrangler deploy
wrangler secret put CLAUDE_API_KEY
# paste your Anthropic API key when prompted
```

After deploying, update `WORKER_URL` in `ai.js` with your worker's URL.

The worker runs on Cloudflare's free tier (100,000 requests/day). Claude API is the only cost — at internal usage levels (~20 calls/week), it's negligible.

---

## Excel export format

The dashboard expects a `.xlsx` file with paid users. Key columns it reads:

| Column | Used for |
|---|---|
| `BUY_DATE` | Cohort grouping, date range filter |
| `cancellation_date` | Churn detection |
| `subscription_status` | active / cancelled / non_renewing / paused / in_trial |
| `active subscription month` | Primary source for user tenure (paid months, excluding pauses) |
| `Active subscription Days` | Fallback if monthly column missing |
| `Autoposting Status` | Values: `Active`, `Stopped AP`, `never started` |
| `total_generation_before_BUY` | Trial depth calculation |
| `total_generation_after_BUY` | Zero post-buy detection |
| `Attribution Source` | Churn by channel |
| `user_persona_cleaned` | Churn by persona |
| `payment_platform` | Churn by platform (default filter: Chargebee) |
| `Total Social Channels Connected` | Channels → retention pivot |
| `ecom_flag_used` | Ecom user segmentation |
| `M1–M6 Total Generations` | Generation activity chart |
| `{content_type}_with_ap / _without_ap` | Feature adoption, content type analysis |

Missing columns are handled gracefully — sections that depend on absent data are hidden or show `—`.

---

## How retention is calculated

**Cohort survival curves** — users grouped by buy month. A user is retained at milestone M if `active subscription month >= M`. The `!is_churned` shortcut is not used — active users who haven't yet reached the milestone are excluded from both numerator and denominator. This matches the actual milestone-point-in-time calculation.

**All 3M/6M retention pivots** — same principle. Only users who have definitively passed or failed the milestone (churned, or active with `months_active >= M`) are included. In-flight users (still active but not yet at the milestone) are excluded from both numerator and denominator to avoid deflating rates.

**Autopost** — `Autoposting Status` = `Active` or `Stopped AP` (case-insensitive). `never started` = 0.

**Zero post-buy** — only flagged if `total_generation_after_BUY` column exists AND equals 0. Null/missing = unknown, not zero.

**Channels connected** — users with null/missing channel data are excluded from all buckets to prevent false inflation of the "0 channels" group.

---

## Optional: Plan split upload

To unlock the Plan Analysis section (churn by tier, monthly vs annual retention curve), upload a second `.xlsx` with 3 columns: `email`, `plan_name`, `billing_cycle`. Matched against the main export by email address.

---

## Default filter state

When the dashboard loads, filters are pre-set to:
- **Platform**: Chargebee only (toggle others open to add)
- **All filter groups**: collapsed — expand as needed
- **Date range**: seeded from the actual min/max of your data on upload
- **Status**: Active, Cancelled, Non-Renewing, Paused (In Trial excluded)

---

## Tech stack

| Layer | Technology |
|---|---|
| Excel parsing | SheetJS 0.20.1 (CDN) |
| Charts | Chart.js 4.4 (CDN) |
| Animations | GSAP 3.12.5 (CDN) |
| AI proxy | Cloudflare Worker (free tier) |
| AI model | claude-sonnet-4-20250514 |
| Hosting | Netlify (free tier) |
| Storage | Browser localStorage (last 5 runs cached) |

Zero npm. Zero build step. Zero CI/CD.

---

## Local development

Open `index.html` with a local server — do not open it directly via `file://` as browsers restrict local file loading.

```bash
# Option 1: VS Code Live Server extension
# Option 2:
npx serve .
# then open http://localhost:3000
```

The AI features (Generate Insights, Chat) require the Cloudflare Worker to be deployed and `WORKER_URL` set in `ai.js`. The rest of the dashboard works fully offline.

---

## Owner

Built and maintained by Abhinav (PM, Predis.ai).
