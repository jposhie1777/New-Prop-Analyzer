# Pulse NBA

A personal NBA betting analytics web app built on the [BALLDONTLIE](https://www.balldontlie.io) (BDL) NBA API, GOAT tier.

- **Pages:** today's slate, player pages, a "100 in 3 Quarters" cheat sheet, a live hub with halftime prop suggestions, a bet slip with sportsbook deeplinks, a Record page that grades every recommendation, and a cost analyzer.
- **Data:** analytics run entirely in your browser with DuckDB-WASM, over a Parquet baseline plus finished games fetched automatically.
- **Cost:** the only bill is BDL. Nothing outside it costs money (see below).

> Personal, non-commercial project. Informational only, not betting advice.

## The $0 rule

Nothing runs unless the page is open, except the free GitHub Actions live bets tracker (below):

- **No paid background work:** no cron service, database, GCP or paid services. The one background job is a free GitHub Actions run on game nights.
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
3. Add `BDL_TIER` with the value `goat` (or `allstar` / `trial` / `free`).
4. Open or rebuild the Codespace. The dev container (`.devcontainer/devcontainer.json`) also prompts for both secrets and runs `npm install`.
5. Check them with `echo $BDL_TIER` and `test -n "$BDL_API_KEY" && echo key set`.

For a quick local test you can instead put them in `.env.local`, which is git-ignored.

### Vercel

**Project → Settings → Environment Variables:**

| Name | Value | Environments |
| --- | --- | --- |
| `BDL_API_KEY` | your key (mark it **Sensitive**) | Production (and Preview if you use it) |
| `BDL_TIER` | `goat` | same |
| `SITE_PASSWORD` | a password you choose (mark it **Sensitive**) | same |

Redeploy after changing them. Without `SITE_PASSWORD` the site is open to anyone who finds the URL.

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

ALL-STAR (`BDL_TIER=allstar`) runs at 60 req/min with the Trial / Free feature set below.

| | GOAT (`BDL_TIER=goat`) | Trial / Free (`trial` / `free`) |
| --- | --- | --- |
| Rate budget | 600 req/min | 5 req/min |
| Games, stats, per-quarter stats, injuries | ✓ | ✓ (injuries may need a paid tier) |
| Odds, opening odds, player props, deeplinks | ✓ | ✗ (pages show a notice instead) |
| Advanced stats v2, lineups, play-by-play | ✓ | ✗ (pace falls back to box-score possessions; positions fall back to the roster) |
| Full baseline time | about 20-40 min | many hours (about 15 calls per date at 5/min) |

Endpoints your tier can't use come back as an empty list with an explanation, so nothing crashes.

## Deploying to Vercel Hobby

### One-time setup

1. **Create the `production` branch.** It is the live site; `main` keeps getting new work.
   On GitHub: **Code → branch menu (`main`) → type `production` → Create branch production from main**.
2. **Sign in** at [vercel.com](https://vercel.com) with GitHub and choose the free **Hobby** plan.
3. **Add New → Project**, then import `jposhie1777/New-Prop-Analyzer`.
   If it is not listed, use **Adjust GitHub App Permissions** to give Vercel access to the repo.
4. Keep the detected defaults (Framework: Next.js, Build: `npm run build`).
5. Open **Environment Variables** and add these for all environments:
   - `BDL_API_KEY`
   - `BDL_TIER` = `goat`
   - `SITE_PASSWORD`
6. Click **Deploy**. The first build takes 2–3 minutes.
7. **Make `production` the live branch:** **Project → Settings → Environments → Production → Branch Tracking**, change `main` to `production`, then save.
8. **Load the live site:** **Deployments → Create Deployment**, choose `production`, then deploy.
9. **Open the site** at `https://<project>.vercel.app` and sign in with `SITE_PASSWORD`.
   On iPhone: **Share → Add to Home Screen**.

`postinstall` copies the DuckDB-WASM files into `public/duckdb/`, so the browser never loads code from a third-party CDN.

### Releasing new features slowly

- **Everyday work** stays as it is: pull requests into `main`, tried in the Codespace.
- **Previews:** every push to `main` (and every PR) also gets a **Preview** deployment with its own URL. It is in the PR's Vercel comment and in **Deployments**.
  - Previews are behind Vercel's own login, so only you can open them.
  - Use one to test a change on your phone with real data before releasing it.
- **To release:** on GitHub, open **Pull requests → New**, set base `production` and compare `main`, review the list of changes, then **Merge**. The live site updates in about 2 minutes.
- **To undo a release:** **Vercel → Deployments**, open the previous production deployment, then **⋯ → Promote** (instant rollback).

### Keeping the data fresh

- **Daily:** nothing to do. Each new day's finals are fetched through `/api/finals` and cached by the CDN, the first time the site is opened after the games end.
- **Now and then:** run `npm run baseline` (and `npm run baseline:shots` once) in the Codespace, commit `public/data/baseline`, and release it like any other change. A bigger baseline means fewer top-up requests on a fresh device.

Picks, the slip, the record and settings live in each browser's storage. The Codespace URL and the Vercel URL each keep their own.

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

## Live bets tracker (GitHub Actions)

The Live Bets page is filled by `.github/workflows/live-tracker.yml`, which runs on GitHub (free for a public repo) so no page has to stay open.

1. Add the key once: GitHub repo → Settings → Secrets and variables → Actions → New repository secret, name `BDL_API_KEY`.
2. It starts on its own at 12:30, 6:30 and 9:30 PM Eastern (GitHub can start scheduled runs 5-15 min late). It waits for the first tip-off, checks every live game each minute, grades picks at the final, and stops when the night is done. To start it by hand: Actions tab → Live bets tracker → Run workflow.
3. Results go to the `live-data` branch (never merge it; Vercel ignores it via `vercel.json`). The site reads them from raw.githubusercontent.com, which can lag up to about 5 minutes. The branch is public like the rest of the repo.
4. GitHub pauses scheduled workflows after 60 days with no repo activity; re-enable it from the Actions tab.

Local test: `BDL_TIER=mock npm run live:track -- --once --data-dir live-data`, then `LIVE_DATA_DIR=live-data npm run dev`.

## Nightly site data (faster loads)

`.github/workflows/site-data.yml` runs every morning at about 6:23 AM Eastern, after every game is final. It runs `scripts/refreshSiteData.ts`, which does three things:

- rebuilds this season's stats files through last night;
- copies last season's files from `public/data/baseline`;
- writes `snapshot.json`, which holds the team ratings, rest days, injured-scorer averages, 100-in-3 profiles and live quarter profiles worked out ahead of time.

Everything is force-pushed as one commit to the `site-data` branch, so its history never grows. Never merge that branch.

The site reads these files from raw.githubusercontent.com. Slate, Lines, 100 in 3 and Live use the snapshot right away, and the in-browser database keeps loading in the background. If the snapshot is not from today, or the branch is missing, everything falls back to the old path. The workflow uses the same `BDL_API_KEY` secret as the live tracker. To run it now: Actions tab → Nightly site data → Run workflow.

## Sync across devices (slip and sportsbooks)

The slip and these settings follow you between devices: your sportsbooks, default book, state, EV threshold, wager and 100-in-3 settings. Appearance and layout stay per device. The data is stored in a secret GitHub gist that only your server can read.

1. On GitHub, go to Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Under Account permissions, set **Gists** to Read and write. Nothing else is needed.
3. In Vercel, go to Project → Settings → Environment Variables and add `SYNC_GITHUB_TOKEN` with that token, then redeploy.

The first device to sync uploads what it already has. After that, the newest change wins: saves happen about a second after a change, and other devices pull when you switch back to the tab. Sync only runs when `SITE_PASSWORD` is set. Settings → Sync across devices shows the status.

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
  - Every game with score and clock. Live games show their **top 3 value picks** right on the card (labeled **Halftime picks** at halftime), each with a tap-to-add price.
  - **All player props ▾** and **Box score ▾** expand under the game.
  - Projection = current stat + the pregame line for the time left, split by the player's usual quarters, nudged by tonight's pace (more late in games), trimmed for foul trouble and second-half 20+ blowouts. Last-10 averages are used only when no pregame line exists. (This replaces the original halftime formula of 1st-half actual + L10 2nd-half average, which ran too far from the market on real data.)
  - Compared with the de-vigged live line, with EV% shown only when the model is within 20 points of the market. Picks at or above the EV threshold (default 3%, set it in Settings) are highlighted and logged to the Record. *Informational, not guaranteed.*
- **Slip (`/slip`)**
  - One card per pick: player, prop and game, book chips with prices (★ = best), and a **Bet at <book>** button.
  - The button opens BDL's bet-slip link when there is one, else the event page, else the book's NBA page (`src/config/sportsbookLinks.ts`, marked *verify*). Without a bet-slip link the pick is copied so you can paste it into the book's search.
  - **Default sportsbook** (Settings) preselects your book; tap a chip to switch per pick. Parlay odds per book with Copy all legs; stake and quarter-Kelly sizing are under "Stake and sizing". No sportsbook scraping.
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
