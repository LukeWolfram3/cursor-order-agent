# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a TypeScript MCP server + HTTP webhook server for AI-powered sales-ops email classification and order processing. See `README.md` for full architecture details.

### Key commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Type-check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Start MCP server (stdio) | `pnpm mcp` |
| Start HTTP webhook server | `pnpm webhook` |

### Running the webhook server

- Start with `pnpm webhook` — listens on port 8787 (override with `PORT` env var).
- Health check: `GET /health` returns `{"ok":true}`.
- All `POST /webhook` and `POST /run` requests require `Authorization: Bearer $WEBHOOK_SECRET`.
- The server requires `ANTHROPIC_API_KEY`, `SHOPIFY_KEY`, and `SHOPIFY_STORE_DOMAIN` to process requests end-to-end.

### Required secrets (environment variables)

- `ANTHROPIC_API_KEY` — powers all sub-agent LLM calls.
- `SHOPIFY_KEY` (or `SHOPIFY_ADMIN_ACCESS_TOKEN`) — Shopify Admin API read access.
- `SHOPIFY_STORE_DOMAIN` — e.g. `store.myshopify.com`.
- `WEBHOOK_SECRET` (or `WEBHOOK_API_KEY`) — Bearer token for webhook auth.

### Gotchas

- **esbuild build scripts**: `pnpm install` may warn about ignored build scripts for esbuild. This is safe to ignore — esbuild ships prebuilt binaries and the scripts are not required for dev tooling (tsx, vitest) to work.
- **No build step needed**: The project uses `tsx` to run TypeScript directly; there is no compile/build step.
- **Shopify writes are dry-run only**: All Shopify mutations are mocked (`wouldMutateShopify: false`). Only reads are real.
- **Tests are fully offline**: All 27 Vitest tests use mocked Shopify/Anthropic calls and do not require real API keys.
