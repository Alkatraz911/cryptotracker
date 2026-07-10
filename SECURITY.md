# Security notes

This is an investigation tool intended for local / trusted use. Before exposing
it beyond localhost, rotate the development defaults. Real secrets live only in
`server/.env` (git-ignored); `server/.env.example` is a placeholder template and
must never contain real values.

## Rotate before any non-local deployment

- **JWT_SECRET** — the default `dev-secret-change-me` signs tokens with a public
  value (auth-bypass risk). Set a strong random secret:
  `openssl rand -base64 48`. The server **refuses to start** with the default
  when `NODE_ENV=production`.
- **Database credentials** — `DATABASE_URL` ships with `crypto:crypto`. Change
  the Postgres user/password (and update `DATABASE_URL` + docker-compose). The
  server warns about the default in production.
- **API keys** (`ETHERSCAN_API_KEY`, `SOLSCAN_API_KEY`, `HELIUS_API_KEY`,
  `TRONSCAN_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, …) — issue keys
  scoped to this app; rotate any key that has ever been shared, logged, or
  committed. They are only read from `server/.env`.
- **ADMIN_EMAILS** — grants the admin role (bridge registry + user management).
  Keep it to the intended operators.

## Hygiene

- Keep `server/.env`, `orbiter-indexer/.env`, `debridge-indexer/.env` out of git
  (already git-ignored). If a secret is ever committed, rotate it — removing it
  from history is not enough once pushed.
- Run behind TLS and restrict network exposure of Postgres and the API port.
