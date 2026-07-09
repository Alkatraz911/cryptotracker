# Orbiter Indexer

Standalone service that mirrors **Orbiter Finance** cross-chain bridge transfers into a
local PostgreSQL table and serves fast queries — including the things Orbiter's public
API can't do: **lookup by wallet address** and **instant access to deep history**.

Runs completely independently of the main CryptoTracker app (it only shares a Postgres
instance, in its own `orbiter_bridges` table). NestJS + TypeORM + PostgreSQL.

## Why

Orbiter's public API has hard limits: no filtering by address, no time-window query, and
deep pagination times out. This service crawls what Orbiter exposes into a DB you own, so:

| | Live Orbiter API | This indexer |
|---|---|---|
| Query by tx hash | ~6 months | everything ingested |
| Query by **wallet address** | impossible | indexed |
| Deep history | tens of seconds | instant (already stored) |
| History beyond Orbiter's cutoff | lost | kept forever once captured |

## Setup

This service owns its database — it does **not** share the main project's DB.

### Option A — Docker (fully isolated: own Postgres container)

```bash
cd orbiter-indexer
docker compose up -d                 # own Postgres (:5455) + indexer (:8090)
docker compose logs -f indexer
```

### Option B — local Node against a dedicated database

```bash
cd orbiter-indexer
npm install
cp .env.example .env                  # DATABASE_URL → a DEDICATED db, not the main one
# create the database once:
#   psql postgres://crypto:crypto@localhost:5454/postgres -c "CREATE DATABASE orbiter_indexer;"
npm run build
npm start                             # API on :8090, background crawler + enricher
```

`DB_SYNC=true` auto-creates the `orbiter_bridges` table on boot. Each row stores the
numeric chain ids **and** human classifiers — `sourceChainName`/`targetChainName`
(e.g. "Arbitrum", "Base") and `sourceNet`/`targetNet` — so responses are readable.

## How it ingests

- **Forward crawler** (every `CRAWL_INTERVAL_MS`): polls the newest feed pages and stores
  new bridges until it catches up. Keeps the DB current going forward.
- **Enricher** (every `ENRICH_INTERVAL_MS`): fills `sender` / `receiver` / `targetAddress`
  via Orbiter's hash-lookup endpoint (covers ~6 months) so address search works.
- **Backfill** (on demand): jumps to a historical page by time and reads the window in
  parallel batches — seeds old history without paging from page 1.

> History floor: Orbiter only serves back to ~mid-2025; the indexer captures everything
> from that floor forward. It can't retrieve data older than Orbiter currently exposes.

## HTTP API

```
GET  /bridges/stats                      # row counts, oldest/newest
GET  /bridges/chains                     # supported chains
GET  /bridges/tx/:hash                   # one bridge by source OR target hash
GET  /bridges/address/:address?limit=    # all bridges where address is sender/receiver/target
GET  /bridges?source=&target=&minUsd=&from=&to=&limit=
POST /admin/crawl                        # run a forward catch-up now
POST /admin/enrich?batch=200             # run one enrichment batch
POST /admin/backfill                     # { source?, target?, from, to } — runs in background
```

`source`/`target` are Orbiter chain ids (e.g. `42161` Arbitrum, `8453` Base). `from`/`to`
are ISO dates. Omit `source` in backfill to seed every chain.

## CLI (no HTTP server)

```bash
npm run build
node dist/cli stats
node dist/cli crawl
node dist/cli enrich --batch 200
node dist/cli reclassify                          # fill chain names/net on old rows
node dist/cli backfill --source 42161 --from 2025-06-01 --to 2025-12-31
node dist/cli backfill --from 2025-06-01          # all source feeds, date → now
node dist/cli backfill --pairs --from 2025-01-01   # MAX history: every chain pair (slow, deepest)
```

`--pairs` crawls every ordered source→target feed. Pair feeds are sparser and reach
further back in time than source-only feeds, so this loads the deepest history Orbiter
exposes (~mid-2025 floor). It's the slow path — run it detached.

## Notes

- Deep backfill of old months is slow (Orbiter's deep pages are slow) but bounded; it
  chunks by 30 days and stops a chain once it passes the reachable floor.
- Addresses are stored lowercased for case-insensitive matching.
- The main app can consume this by calling the HTTP API (no shared code needed).
