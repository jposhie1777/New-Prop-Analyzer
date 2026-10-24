# Pulse NBA

A personal NBA betting analytics web app built on the [BALLDONTLIE](https://www.balldontlie.io) (BDL) NBA API, GOAT tier.

- **Pages:** today's slate, player pages, a "100 in 3 Quarters" cheat sheet, a live hub with halftime prop suggestions, a bet slip with sportsbook deeplinks, a Record page that grades every recommendation, and a cost analyzer.
- **Data:** analytics run entirely in your browser with DuckDB-WASM, over a Parquet baseline plus finished games fetched automatically.
- **Cost:** the only bill is BDL. Nothing outside it costs money (see below).

> Personal, non-commercial project. Informational only, not betting advice.

## The $0 rule

Nothing runs unless the page is open:

- **No background work:** no cron, GitHub Actions, database, GCP or paid services.
- **Server:** thin API routes on Vercel Hobby that proxy BDL, hiding your key, with aggressive CDN caching.
- **Polling:**
  - Live box scores refresh every 30 s, only while a game is in progress **and** the tab is visible.
  - The slate and opening lines refresh every 10 min while visible.
  - Hidden tab: all polling stops. Nothing live: the page sleeps until the next tip-off.
- **Finished dates are immutable:** `/api/finals?date=` is cached on the CDN for 30 days, so BDL is hit about once per date, ever. Today's date is never treated as final.
- **Over the Hobby limits:** Vercel pauses the project instead of billing you.

## Quick start (mock mode, no key needed)

```bash
npm install
cp .env.example .env.local      # BDL_TIER=mock
npm run baseline                # optional: builds a mock baseline in public/data/mock-baseline
npm run dev                     # http://localhost:3000
```

Mock mode serves realistic fixtures shaped like the official OpenAPI spec. They include a game in the 3rd quarter, a game **at halftime** (so halftime mode shows suggestions), injuries, opening and live odds, and props with deeplinks.

## Setting the secret

The key is read only from server-side environment variables. It is never logged, never sent to the browser, and never prefixed with `NEXT_PUBLIC_`.

### GitHub Codespaces

1. Open GitHub → **Settings → Codespaces → Secrets → New secret**.
2. Add `BDL_API_KEY` with your key and give it access to this repository.
3. Add `BDL_TIER` with the value `goat` (or `trial` / `free`).
4. Open or rebuild the Codespace. The dev container (`.devcontainer/devcontainer.json`) also prompts for both secrets and runs `npm install`.
5. Check them with `echo $BDL_TIER` and `test -n "$BDL_API_KEY" && echo key set`.

For a quick local test you can instead put them in `.env.local`, which is git-ignored.

### Vercel

**Project → Settings → Environment Variables:**

| Name | Value | Environments |
| --- | --- | --- |
| `BDL_API_KEY` | your key (mark it **Sensitive**) | Production (and Preview if you use it) |
| `BDL_TIER` | `goat` | same |

Redeploy after changing them.

## Running the baseline (optional, recommended)

The baseline backfills seasons **2025** (2025-26) and **2026** (2026-27 to date) into zstd Parquet files under `public/data/baseline/{season}/`:

| File | Contents |
| --- | --- |
| `games.parquet` | finished games |
| `teams.parquet` | the 30 teams |
| `players.parquet` | players seen in box scores |
| `player_game_stats.parquet` | full-game player stats (all fields) |
| `player_period_stats.parquet` | player stats per quarter (`period` 1-4) |
| `advanced_stats.parquet` | advanced stats v2, full game (`period` 0) and per quarter where BDL has it |
| `lineups.parquet` | lineup positions (BDL lineups start with the 2025 season) |
| `team_period_summaries.parquet` | per game, per quarter: points, possessions and pace, derived from play-by-play (raw plays are not stored) |

Run it in the Codespace:

```bash
npm run baseline                         # seasons 2025,2026 through yesterday (ET)
npm run baseline -- --seasons 2026       # only this season
npm run baseline -- --through 2026-12-31 # stop at a date
npm run baseline -- --rebuild-only       # rewrite Parquet from the checkpoint, no BDL calls
npm run baseline -- --skip-images        # skip the headshot mapping step
```

- **Resumable:** every finished date is saved to `.baseline-work/<tier>/dates/` and recorded in `checkpoint.json`. If it stops, run it again and it continues.
- **Idempotent:** dates already saved are skipped. Rerun anytime to roll the baseline forward.
- **Progress:** prints progress, calls per date, the peak calls per minute and an ETA.
- **Rate budget:** uses one sliding-window rate budget, so it never exceeds your tier's limit, and retries 429/5xx with backoff.
- **Manifest:** writes `public/data/baseline/manifest.json`, including the last date covered.
- **Headshots:** finishes by building `public/data/nba-person-ids.json` (see Images).

Then commit and push the files so Vercel serves them:

```bash
git add public/data/baseline public/data/nba-person-ids.json
git commit -m "Update baseline"
git push
```

**Without a baseline** the app still works. On first load the browser fetches finished dates one by one from `/api/finals`. Those responses are CDN-cached for 30 days, so it is slow only once. The baseline just makes first loads fast and keeps BDL calls low.

### Top-up (automatic)

On page load the browser:

1. Reads `manifest.json`.
2. Asks `/api/season-dates` which dates after the manifest's last date have finished games.
3. Fetches each missing date from `/api/finals?date=YYYY-MM-DD`.
4. Stores the results in IndexedDB.

Dates the baseline later covers are pruned automatically. If IndexedDB is unavailable or corrupt, the app rebuilds it (Settings → *Rebuild local game data* forces this). A small pill in the header shows *syncing* / *up to date*.

## Trial vs. GOAT

| | GOAT (`BDL_TIER=goat`) | Trial / Free (`trial` / `free`) |
| --- | --- | --- |
| Rate budget | 600 req/min | 5 req/min |
| Games, stats, per-quarter stats, injuries | ✓ | ✓ (injuries may need a paid tier) |
| Odds, opening odds, player props, deeplinks | ✓ | ✗ (pages show a notice instead) |
| Advanced stats v2, lineups, play-by-play | ✓ | ✗ (pace falls back to box-score possessions; positions fall back to the roster) |
| Full baseline time | about 20-40 min | many hours (about 15 calls per date at 5/min) |

Endpoints your tier can't use come back as an empty list with an explanation, so nothing crashes.

## Deploying to Vercel Hobby

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo, and keep the defaults (Next.js, `npm run build`).
3. Add `BDL_API_KEY` and `BDL_TIER` (see above), then deploy.
4. `postinstall` copies the DuckDB-WASM files into `public/duckdb/`, so the browser never loads code from a third-party CDN.

To roll the baseline forward later, run `npm run baseline` in the Codespace, commit and push. Vercel redeploys.

### Caching

All TTLs live in `src/config/cacheTtls.ts`:

| Data | CDN cache |
| --- | --- |
| Schedule | 5 min |
| Injuries | 10 min |
| Opening odds / props | 10 min |
| Live box scores | 30 s |
| Live odds / props | 60 s |
| Finished dates | 30 days, immutable |
| Player search | 1 day |

Every route sends `s-maxage` + `stale-while-revalidate`, so Vercel's CDN answers repeats without running a function.

## Pages

- **Slate (`/`)**
  - Today's games with opening vs. current consensus spread and total.
  - Moneylines, rest days and back-to-back flags, injuries.
  - Lines by book with deeplinks. Add any side to the slip.
- **Players (`/players`, `/player/[id]`)**
  - Per-game and per-quarter logs (season tabs).
  - Averages ± SD for L5/L10/L20/season, by full game, Q1-Q4, 1st half, 2nd half and through three quarters.
  - Hit-rate chips vs. tonight's lines.
  - The opponent's defense vs. the player's position (G/F/C, 1-30 ranks).
  - Usage shift when a listed teammate is out.
- **100 in 3 (`/three-quarters`)**
  - Projection = implied team total (from spread + total) × the team's share of points scored in Q1-Q3.
  - Probability from a normal approximation, ranked, with all inputs shown.
- **Live (`/live`)**
  - Scores, clock and cumulative box scores.
  - **Halftime mode:** projection = 1st-half actual + the player's L10 2nd-half average, minutes trimmed for foul trouble and 20+ point margins.
  - Compared with the de-vigged live line, with EV% shown. Picks at or above the EV threshold (default 3%, set it in Settings) are flagged. *Informational, not guaranteed.*
- **Slip (`/slip`)**
  - Per-book odds, best price, parlay odds per book and best-price-per-leg.
  - Quarter-Kelly sizing for modeled picks.
  - Deeplinks fill `{state}` from Settings (default `nj`).
  - FanDuel/DraftKings props link to the event page with a **Copy pick** button. No sportsbook scraping.
- **Record (`/record`)**
  - Logs every flagged halftime pick, every pregame 100-in-3 projection and every slip pick at the first price seen.
  - Grades them from final stats once the game syncs: W-L, units, ROI, Brier score, calibration, and breakdowns by source, market and EV.
  - Device-only, with JSON export/import.
- **Costs (`/costs`)**
  - BDL calls by endpoint, peak per-minute rate vs. the tier limit.
  - CDN hit rate and stale serves (from `x-vercel-cache`), function invocations and duration.
  - Baseline and IndexedDB sizes, BDL cost per day.
  - A what-if calculator (viewers × hours × poll interval) vs. Hobby allowances. The limits are in `src/config/vercelLimits.ts`, marked *verify*.
- **Settings (`/settings`):** sportsbook state, EV threshold, coupon wager amount, local data reset.

## Images

- **Team logos** come from NBA's logo CDN, using a fixed BDL-team → NBA-team id map.
- **Headshots** use a BDL-player → NBA-person mapping built by `npm run images:map`, which also runs at the end of the baseline. It matches by name + team, then by unique name. Put fixes in `src/config/nbaPersonOverrides.json` as `{ "<bdlPlayerId>": <nbaPersonId> }`.
- **Fallbacks:** anything unmatched shows initials (players) or the abbreviation (teams).

## Development

```bash
npm test          # Vitest: odds math, rate budget, client, finals builder, aggregates (real DuckDB SQL), grader, cost model
npm run lint      # TypeScript type-check
npm run build
```

- **API source:** endpoint paths, params and response shapes follow the official spec (`docs/bdl-nba-openapi.yml`, copied from BDL's `balldontlie-api/mcp` repo). The `deeplinks` object (`event` + `selections`, each `url` or `url_template` with `{state}`, `{pickType}`, `{wagerAmount}`) comes from the docs page, and the code treats it as optional.
- **Period stats:** the stats `period` filter (1-4) only works for completed games. Live box scores are cumulative.
- **Browser console:** run your own SQL with `await pulseQuery("SELECT * FROM team_scope_lines LIMIT 5")`.

### Layout

```
src/config/            cache TTLs, tiers, Vercel limits, app settings, headshot overrides
src/lib/bdl/           BDL client, rate budget, types, mock fixtures
src/lib/server/        finals builder, route helpers, usage counters
src/lib/data/          row schemas, flattening, play-by-play team summaries, manifest
src/lib/analytics/     DuckDB views, loaders, aggregates, halftime and 100-in-3 models
src/lib/math/          odds and probability math
src/lib/tracking/      pick record and grader
src/lib/client/        browser data sync, IndexedDB, hooks, slip, settings
src/app/               pages and API routes
scripts/               baseline, headshot mapping, DuckDB asset copy
```
