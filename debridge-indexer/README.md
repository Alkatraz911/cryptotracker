# deBridge Indexer

Standalone service that mirrors **deBridge (DLN)** cross-chain orders into a local
PostgreSQL table and serves fast queries — including lookup by **wallet address**
and instant access to deep history (deBridge keeps the full order history).

Independent of the main CryptoTracker app (shares only a Postgres instance, in its
own `debridge_orders` table). NestJS + TypeORM + PostgreSQL. Mirrors the design of
`orbiter-indexer`.

## Source

The public DLN stats API behind `app.debridge.com/orders`:
- list:   `POST stats-api.dln.trade/api/Orders/filteredList` (newest-first, skip/take, totalCount)
- detail: `GET  stats-api.dln.trade/api/Orders/{orderId}` (sender/receiver + src/dst tx)
- byHash: `GET  stats-api.dln.trade/api/Transaction/{hash}/orderIds`

The list endpoint lacks addresses/dest-tx, so the indexer stores a base record on
crawl and an **enrichment** pass fills `sender`/`receiver`/`dst_tx` via order detail.

## Setup

### Docker (isolated Postgres)
```bash
cd debridge-indexer
docker compose up -d          # own Postgres (:5456) + indexer (:8091)
```

### Local Node (dedicated DB)
```bash
cd debridge-indexer
npm install
cp .env.example .env
#   psql postgres://crypto:crypto@localhost:5454/postgres -c "CREATE DATABASE debridge_indexer;"
npm run build
npm start                     # API on :8091 + background crawler + enricher
```

## HTTP API
```
GET  /orders/stats
GET  /orders/chains
GET  /orders/tx/:hash                      # order by src/dst tx hash or orderId
GET  /orders/address/:address?limit=       # orders where address is sender/receiver
GET  /orders?give=&take=&from=&to=&limit=  # chain ids + ISO dates
POST /admin/crawl
POST /admin/enrich?batch=200
POST /admin/reclassify
POST /admin/backfill                       # { give?, take?, max? } — runs in background
```

## CLI (no HTTP)
```bash
npm run build
node dist/cli stats
node dist/cli crawl
node dist/cli enrich --batch 200
node dist/cli reclassify
node dist/cli backfill --give BSC --take BASE --max 20000
node dist/cli backfill --max 100000        # all chains, deep history
```

`give`/`take` accept network codes (ETH, BSC, POLYGON, ARBITRUM, BASE, SOLANA).
deBridge keeps the full history, so backfill depth is bounded only by how far you
page (skip). Addresses come from the enrichment pass.
