# Deployment (Vercel)

## Scope

Two separate Vercel Projects from this one repo:

- **Project A** — Root Directory `frontend/`, Framework "Vite" (or rely on
  `frontend/vercel.json`).
- **Project B** — Root Directory `server/`, Framework "Other" (Node.js
  Functions via `server/api/index.ts` + `server/vercel.json`).

`orbiter-indexer/` and `debridge-indexer/` are **out of scope** — both run a
continuous background crawler/enricher (`setInterval`, started from
`onModuleInit`) plus their own dedicated Postgres instance, and are meant to
run as a long-lived, always-on process (`docker-compose`, `restart:
unless-stopped`). That doesn't fit Vercel's stateless, time-boxed function
model. They keep running on their current separate hosting regardless of this
deployment; `ORBITER_INDEXER_URL` (below) just needs to point at wherever
that ends up.

## Project A — `frontend/`

- Build Command: `npm run build` (`tsc && vite build`).
- Env vars:
  - `VITE_API_URL` — the deployed backend's absolute origin, **no** `/api`
    prefix (e.g. `https://cryptotracker-api.vercel.app`). Unset falls back to
    a same-origin `/api` path, which only works in local dev (proxied by
    `vite.config.ts`).

## Project B — `server/`

- Build Command: `npm run build && npm run migration:run`. Migrations run
  once per deploy in the build container this way — **not** per invocation
  (`app.module.ts` sets `migrationsRun: !process.env.VERCEL`, since running
  migrations on every serverless cold start is a race risk under concurrency).
- Function: `api/index.ts`, `maxDuration` set in `server/vercel.json`.
  - **Vercel Hobby caps `maxDuration` at 10s regardless of config.** This
    app's `/explorer/trace` endpoint has its own internal budget
    (`TRACE_TIME_BUDGET_MS`, default 20s) precisely because it can otherwise
    run long — Pro (60s) is the realistic minimum plan for this backend;
    consider Fluid Compute if still not enough.
- Env vars:
  - `DATABASE_URL` — a managed Postgres reachable from Vercel (Neon, Supabase,
    etc.), **prefer the provider's pooled/pgbouncer connection string** —
    each concurrent invocation opens its own small pool
    (`extra.max: 5`, see `app.module.ts`). Must be set for the **Build**
    environment too, not just Runtime — `migration:run` needs it at build
    time.
  - Use separate `DATABASE_URL` values per Vercel environment (Production vs.
    Preview) if PR preview deployments shouldn't run migrations against, or
    write to, the production database.
  - `JWT_SECRET` — a strong random value (`openssl rand -base64 48`). The
    server refuses to boot in production with the default.
  - `AI_PROVIDER` — set to `claude`, `openrouter`, or `openai`. The default
    (`ollama`, `http://localhost:11434`) is unreachable from Vercel.
  - `AI_MODEL`, and whichever of `ANTHROPIC_API_KEY` /
    `OPENROUTER_API_KEY`+`OPENROUTER_URL` / `OPENAI_API_KEY`+`OPENAI_BASE_URL`
    matches the chosen `AI_PROVIDER` (see `server/.env.example`).
  - `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`, `SOLSCAN_API_KEY`,
    `HELIUS_API_KEY` — as already used locally.
  - `ADMIN_EMAILS`.
  - `ORBITER_INDEXER_URL` — point at wherever `orbiter-indexer` ends up
    hosted, or leave empty to query the Orbiter API directly.

## Known limitations

- Concurrent Vercel builds (e.g. two rapid pushes) could race running
  migrations against the same database — TypeORM's migration runner has no
  built-in advisory lock. Avoid overlapping deploys if this matters.
- `/explorer/trace` can return a partial result (`stats.timedOut: 1`) once its
  internal time budget is spent, rather than the full trace — this is by
  design (see `explorer.service.ts`'s `traceFlow()`), not a bug.
