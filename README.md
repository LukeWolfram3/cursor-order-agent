# Cursor Sales-Ops Order Agent (POC)

Architecture for processing SYLKE sales-ops order emails via a **Cursor cloud automation**:

1. **Cursor runner** — saves the webhook payload to a temp file and runs `pnpm process-email <payload.json>`.
2. **CLI pipeline** — `src/cli/process-email.ts` calls the same classify/order code as the HTTP webhook.
3. **Sub-agents** — each makes its own `@anthropic-ai/sdk` call inside the Node process:
   - Classifier (`classify_email`)
   - Order specialist (`run_order_specialist`) with inner tools (extract, location match, Shopify reads, dry-run planners)

Shopify **reads are real**. All **writes are dry-run only** (`wouldMutateShopify: false`).

## Prerequisites

- Node.js 22+
- pnpm
- Secrets: `ANTHROPIC_API_KEY`, `SHOPIFY_KEY` (or `SHOPIFY_ADMIN_ACCESS_TOKEN`), `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION`

## Setup (local)

```bash
cd cursor-order-agent
pnpm install
cp .env.example .env   # fill in values
pnpm typecheck
pnpm test
```

Run the CLI pipeline against a saved payload:

```bash
pnpm process-email test-data/emails/example.json
```

The stdio MCP server (`pnpm mcp`) still exists for local experiments, but the Cursor automation path does not depend on MCP.

Run the HTTP webhook server (for external callers / Power Automate):

```bash
pnpm webhook
```

Listens on `PORT` (default **8787**). Endpoints:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/webhook` or `/run` | `Authorization: Bearer $WEBHOOK_SECRET` | Classify email + run order specialist when applicable |
| `GET` | `/health` | none | Liveness check |

Request body (Graph-shaped JSON):

```json
{
  "graph": {
    "message": { "id": "...", "subject": "...", "body": { "contentType": "text", "content": "..." } },
    "attachments": { "value": [] }
  },
  "prompt": "optional free-text note for logging/metadata"
}
```

Response: `{ classification, orderSpecialist?, message?, prompt? }`. The pipeline mirrors the Cursor orchestrator: classify first; if `specialist === "order"` and `confidence >= 0.5`, run the order specialist; otherwise return classification only.

Example:

```bash
curl -sS -X POST "http://localhost:8787/webhook" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d @test-data/emails/sample.json
```

After deploy, point external callers at `https://<your-host>/webhook` (or `/run`) with the same Bearer token. Set `WEBHOOK_SECRET` (or `WEBHOOK_API_KEY`) plus the Shopify/Anthropic env vars on the host.

## Cursor automation setup

1. Repo: [LukeWolfram3/cursor-order-agent](https://github.com/LukeWolfram3/cursor-order-agent).
2. At [cursor.com/automations](https://cursor.com/automations), create **Sales-Ops Order Agent (POC)**.
3. Connect the repo. Model: **Claude Sonnet 4.6**.
4. Paste `prompts/orchestrator/system.md` into **Agent Instructions**.
5. Configure secrets: `SHOPIFY_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION`, `ANTHROPIC_API_KEY`.
6. Use a webhook trigger for test runs.

## Using the POC

Post a Microsoft Graph-shaped JSON payload to the Cursor automation webhook (see `test-data/emails/` — you provide fixtures). The runner will:

1. Save the payload to `/tmp/order-agent-input.json`
2. Run `pnpm process-email /tmp/order-agent-input.json`
3. Return the CLI's JSON result

The `trace` array lists tool phases (`tool.start` / `tool.completed`) for iteration.

### Attachment byte handling

The MCP server stages Graph attachment `contentBytes` in process memory by `message.id` + `attachment.id` before invoking classifier/order agents. Agent prompts and the order-specialist tool loop receive only attachment metadata and byte-availability flags; the extractor resolves staged bytes internally when `extract_order_data` is called with `attachmentIds`.

For Cursor chat/automation routing, pass full attachment bytes to `classify_email` once, then omit `contentBytes` from the `run_order_specialist` graph for the same message. For webhook/server-side runs, the HTTP pipeline stages bytes before classification and reuses the sanitized graph for the order specialist automatically.

## Troubleshooting

- `401 authentication_error: invalid x-api-key` from `classify_email` means the MCP server reached Anthropic, but the configured `ANTHROPIC_API_KEY` was rejected. Verify or rotate the Anthropic key in the MCP server/automation secrets, then rerun the automation.

## Test data

Do **not** commit production emails. Drop fixtures into:

- `test-data/emails/*.json`
- `test-data/attachments/*` (PDFs referenced by `contentBytes` in Graph JSON)

## Iterating prompts

1. Edit markdown under `prompts/` (loaded at runtime by the CLI/HTTP/MCP pipeline).
2. `git commit && git push`
3. Re-run the automation — no MCP rebuild required beyond repo sync.

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
2. Wire the specialist in the CLI/HTTP pipeline.
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
| `pnpm mcp` | Start stdio MCP server |
| `pnpm process-email <payload.json>` | Run the full sales-ops pipeline from a JSON payload |
| `pnpm webhook` | Start HTTP webhook server (`POST /webhook`, `POST /run`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
