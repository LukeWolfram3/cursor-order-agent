# Cursor Sales-Ops Order Agent (POC)

Architecture for processing SYLKE sales-ops order emails via a **Cursor cloud automation**:

1. **Cursor main agent** — saves the webhook payload to a temp file and delegates to repo-defined Cursor subagents.
2. **Cursor subagent roster** — `.cursor/agents/*` contains classifier, order-specialist, PO extractor, and location matcher agents.
3. **Deterministic shell tools** — `pnpm order-tool <tool> <input.json>` exposes Shopify reads and dry-run planners.

Shopify **reads are real**. All **writes are dry-run only** (`wouldMutateShopify: false`).

## Prerequisites

- Node.js 22+
- pnpm
- Secrets: `SHOPIFY_KEY` (or `SHOPIFY_ADMIN_ACCESS_TOKEN`), `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION`

## Setup (local)

```bash
cd cursor-order-agent
pnpm install
cp .env.example .env   # fill in values
pnpm typecheck
pnpm test
```

Run a deterministic helper tool against a saved input:

```bash
pnpm order-tool shopify_get_location_candidates /tmp/location-input.json
```

This branch intentionally tests Cursor-native subagent delegation only.

## Cursor automation setup

1. Repo: [LukeWolfram3/cursor-order-agent](https://github.com/LukeWolfram3/cursor-order-agent).
2. At [cursor.com/automations](https://cursor.com/automations), create **Sales-Ops Order Agent (POC)**.
3. Connect the repo. Model: **Claude Sonnet 4.6**.
4. Paste `prompts/orchestrator/system.md` into **Agent Instructions**.
5. Configure secrets: `SHOPIFY_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION`.
6. Use a webhook trigger for test runs.

## Using the POC

Post a Microsoft Graph-shaped JSON payload to the Cursor automation webhook (see `test-data/emails/` — you provide fixtures). The main agent will:

1. Save the payload to `/tmp/order-agent-input.json`
2. Delegate classification to `email-classifier`
3. If it is an order, delegate processing to `order-specialist`
4. Use `pnpm order-tool` commands for deterministic Shopify reads and dry-run planning
5. Return the structured result

The `trace` array lists tool phases (`tool.start` / `tool.completed`) for iteration.

### Attachment handling

For test fixtures, use `localPath` in the webhook payload, for example:

```json
{
  "id": "attachment-po-2208145-final-document",
  "name": "Company 1 PurchaseOrder 2208145 Email Final Document.pdf",
  "contentType": "application/pdf",
  "localPath": "test-run-data/Company 1 PurchaseOrder 2208145 Email Final Document.pdf"
}
```

Cursor subagents read the repo-local file directly. Do not send large `contentBytes` through the Cursor automation webhook for this experiment.

## Test data

Do **not** commit production emails. Drop fixtures into:

- `test-data/emails/*.json`
- `test-data/attachments/*` (PDFs referenced by `contentBytes` in Graph JSON)

## Iterating prompts

1. Edit markdown under `prompts/` or `.cursor/agents/`.
2. `git commit && git push`
3. Re-run the automation after the repo syncs.

Key files:

| Area | Path |
|------|------|
| Orchestrator router | `prompts/orchestrator/system.md` |
| Classifier | `prompts/classifier/` |
| Order specialist | `prompts/order-agent/` |
| Extractor sub-agent | `prompts/order-agent/sub-agents/po-extractor.md` |
| Location matcher | `prompts/order-agent/sub-agents/location-research-matcher.md` |

## Adding a new specialist

1. Implement `src/sub-agents/<name>.ts` + prompts.
2. Add or update the corresponding `.cursor/agents/<specialist>.md`.
3. Extend `prompts/orchestrator/system.md` dispatch instructions if needed.
4. Wire `CLASSIFIER_OPTIONS` in `src/lib/classifier-options.ts`.

## Architecture notes

- **PDF**: native Anthropic `document` blocks in the extractor (no `pdf-parse`).
- **Web search**: `web_search_20250305` in the location matcher (0.85 confidence threshold enforced in code).
- **Duplicate PO check**: disabled for this POC.
- **Out of scope**: production triggers, real Shopify mutations, trace DB, document processor.

## Known failure modes (from agents-test)

- Extraction returns empty line items → specialist should stop with a clear blocked message.
- Location match below 0.85 confidence → `matchedLocationId: null`, human review.
- Unreadable attachments (Word/Excel) → rely on email body; do not invent SKUs.
- Large location lists → domain enrichment paginates role assignments per location (sequential Shopify calls).

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm order-tool <tool> <input.json>` | Deterministic Shopify read / dry-run helper for Cursor subagents |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
