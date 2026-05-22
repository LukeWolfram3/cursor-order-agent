# Skill — Order Workflow

The end-to-end procedure for turning any inbound order request into a Shopify draft order plan. Read this in addition to the Order Agent system prompt before processing any order.

"Order" here covers every input shape: a formal PO PDF, a body-only SKU+quantity request, a brochure / patient discharge sheet / supplementary-material request, or any combination. The procedure below adapts — some steps are no-ops for simpler shapes.

## Trigger

This skill applies whenever the Cursor orchestrator has classified an inbound message as `specialist: 'order'` (legacy: `process_order`) or `specialist: 'reprocess_po'` and routed it to the Order Agent. The agent processes one message at a time, identified by `messageId`. The classifier routes any order-shaped intent to the `order` specialist — not just formal POs.

## Roadmap (high-level)

Eight phases. Each names the tool calls (if any) and what the phase produces. Detailed step-by-step instructions — including what to do based on each tool's result — are in the "Procedure" section below.

| # | Phase | Tool calls | Produces |
|---|---|---|---|
| 1 | Read inputs | none | submitter / buyer / ship-to identified from email content; precomputed `attachmentInspections` reviewed |
| 2 | Read the order content | none | readable order content in your context (PDF/image attachment content, or body text) |
| 3 | Extract structured order data | `extract_order_data` | structured order JSON: line items, ship-to, buyer, PO number |
| 4 | Match the location | `shopify_get_location_candidates` → `match_location_with_research` | matched `locationId` + `humanReviewNeeded` flag + reasoning (stop if matchedLocationId is null) |
| 5 | Get location details | `shopify_get_location_details` | the location's parent `companyId`, contacts, basic metafields |
| 6 | Get catalog context | `shopify_get_catalog_context` | catalogs + company `note` + per-SKU variant prices + catalog decision hints — covers tier determination AND price verification in one call |
| 7 | Resolve the customer | `shopify_find_customers_for_po` | a Shopify `customerId` + `companyContactId` for the draft (or stop if unknown) |
| 8 | Plan the draft order | `shopify_plan_draft_order` | the planned draft-order payload + warnings. Apply policy considerations (plastic-surgery / Shane-Fadem, distributor-as-buyer, all-products) in your reply text. |

The duplicate-check tool (`shopify_check_duplicate_po`) is **NOT exposed** in this run set — historical orders we're replaying already exist in Shopify, so every check would false-positive.

## Tools you'll use

You have the order-processing tools available. The procedure below names the canonical one to call at each phase. The Anthropic SDK surfaces each tool's full input schema in your context — match it.

## Procedure

The detailed procedure mirrors the 8 phases. Skip steps only when a specific policy in `order-policies.md` authorizes you to, OR when the input shape doesn't require them.

### Step 1 — Read inputs

**Do:**
- Read the formatted Graph message: `message.id`, `from`, `subject`, `body.contentType`, `body.content`, attachment manifest, and the precomputed `attachmentInspections` block.
- Identify the submitter (the `from` address) — could be a customer, a SYLKE employee, a SYLKE rep, or a purchasing entity at a medical facility. Do NOT assume the sender is `@sylke.com`.
- Locate the buyer / customer in the email content. They may be:
  - The same as the submitter (a customer emailing directly).
  - Different from the submitter (a SYLKE rep forwarding a customer email; the customer is nested in the forward).
  - The submitter on behalf of an organization (a purchasing entity who IS the buyer).
- Locate the ship-to facility (often the same as the buyer's organization, but not always — distributors ship to hospitals).
- Use the precomputed `attachmentInspections` block for attachment metadata.
- If the message is a reply to a prior AI message in the same `conversationId`, look for `ROUTER HINT:` markers and embedded data blobs (PO_DATA, LOCATION_INFO, COMPANY_ID).

**Why:** The submitter, buyer, and ship-to are three potentially-different identities. Identify each from the email content, not from the sender field.

**No tool call** — pure reasoning from the inputs you already have.

### Step 2 — Read the order content

**Do:**
- **Body-only order** (no attachments, body contains SKU+quantity directly): use the body as the order source. Move to step 3.
- **Attachment-backed order**: PDFs and supported images (PNG / JPEG / WebP / GIF) arrive in your context as readable content. Use them as the order source.
- **Unreadable attachment**: if the order's content is only in an attachment format whose bytes aren't in your context (Word doc, RTF, TIFF, HEIC, ZIP, etc.), stop and report that the order content isn't readable in this run.
- **Multiple attachments**: score each (filename hints — `PO-12345.pdf`, `purchase_order.pdf`, `order.xlsx`, `*_PO_*.pdf` — win over packing slips, MSDS, marketing flyers). Pick the most likely order document. If you cannot pick with confidence, stop and surface for human review.

**Why:** PDFs and supported image formats arrive in your context directly; unreadable attachment formats can't be processed in this run, so surface them rather than guess from metadata alone.

### Step 3 — Extract structured order data

**Do:**
- Call `extract_order_data` with:
  - `emailContext` — the customer-facing portion of the email body (not the full forwarded thread).
  - `attachmentIds` — for PDF/image-backed orders, the `id` of the likely order document from the attachment manifest. Use `[]` or omit for body-only orders.
  - `attachmentContext` — optional short text notes from the email/body about the attachment, OR `null` if none. Do not try to transcribe the whole PDF yourself.
- The tool wraps the `po-extractor` sub-agent and returns the canonical structured order: line items, ship-to, buyer, PO number, requested ship date.
- Validate at least one line item with a recognizable SKU. If zero line items: **stop**, report "extraction returned no line items" in your reply.

**Why:** Extraction is high-value, layout-sensitive work delegated to a focused sub-agent. Your parent agent stays clean for orchestration.

### Step 4 — Match the location

**Do:**
- Call `shopify_get_location_candidates` with the extracted ship-to facility name + address. Returns a list of plausible matching CompanyLocations.
- Then call `match_location_with_research` with:
  - `poLocationContext` — the extracted ship-to (facility name, address, buyer domain, bill-to context).
  - `candidates` — the candidate list from the previous call.
- The matcher returns: `reasoning` (prose CoT), `matchedLocationId` (string or null), `matchedLocationName`, `confidence` (0-1), `humanReviewNeeded` (boolean), `humanReviewReason` (prose or null).
- If `matchedLocationId` is null: **stop**. Surface the matcher's `reasoning` in your reply so the human can confirm or correct the parsed address.
- If `matchedLocationId` is set AND `humanReviewNeeded` is false: clean match, proceed to step 5.
- If `matchedLocationId` is set AND `humanReviewNeeded` is true: matched with a concern. You can still proceed to step 5, but include `humanReviewReason` in your final reply so the human knows what to verify. Examples of concerns worth proceeding-and-surfacing: ZIP mismatch (likely mail-processing ZIP), facility name rebrand, bill-to centralized AP. Examples of concerns worth stopping despite a match: entity mismatch (buyer email IDN ≠ matched candidate's IDN), suite mismatch in a medical office building. Use the `reasoning` + `humanReviewReason` to judge.

**Why:** Wrong-location matching is the most expensive error mode. The matcher's "prefer no match over uncertain match" stance is intentional.

### Step 5 — Get location details

**Do:**
- Call `shopify_get_location_details` with the matched `locationId`. Returns the location's parent `companyId`, contacts, basic metafields, and shipping addresses.
- You need the parent `companyId` as an input to step 6's catalog context call.

**Why:** The catalog context tool needs both `locationId` and the parent `companyId`. This call resolves the parent.

### Step 6 — Get catalog context

**Do:**
- Call `shopify_get_catalog_context` with:
  - `locationId` — from step 4.
  - `companyId` — the parent company from step 5.
  - `skus` — the list of SKUs from the extracted order in step 3.
- The tool returns: directly-assigned location catalogs, company-level catalogs (union), the company `note` field, per-SKU variant prices, and `catalogDecisionHints`.
- Determine the tier:
  - If exactly one global-tier catalog is directly assigned (T1–T5, T1F–T4F, Premier T1–T3, OUS D1/D2): use it.
  - If SKU-specific catalogs are assigned (one per SKU): use those for matched SKUs.
  - If no catalogs are directly assigned to the location: read the company `note` for a tier inheritance rule (e.g., "T3F for all new locations. -B").
  - If no usable rule: **stop**. Surface "needs catalog assignment" in your reply.
  - If multiple global tiers (conflict) or a global tier coexists with a SKU-specific catalog (conflict): **stop**, surface the conflict.
- For each line item, compare the order's `unit_price` to the catalog's expected price for that SKU:
  - Delta < 0.5%: match silently.
  - Delta 0.5–5%: proceed using the catalog price, note in your reply ("Used catalog price $X over order price $Y for SKU Z").
  - Delta > 5%: proceed using the catalog price, note prominently, mark your reply as low-confidence on pricing.
- If a SKU is not present in any assigned catalog: **stop**, surface "SKU X not in catalog" for human review. Don't drop unknown SKUs silently.

**Why:** Catalog determination + price reconciliation in one tool call. The `get_catalog_context` output is the canonical source of pricing truth for this order.

### Step 7 — Resolve the customer

**Do:**
- Call `shopify_find_customers_for_po` with the buyer email and the matched location. The tool returns matching customers (already on the location, or known but not yet on this location).
- If a customer is found and already assigned to this location: use them (`customerId` + `companyContactId` for the draft).
- If a customer is found but not assigned to this location: **stop**, surface for human review — adding the customer requires a separate workflow.
- If no customer is found at all: **stop**, surface "no buyer customer found for {email}" — adding a brand-new customer also requires a separate workflow.

**Why:** The Order Agent does NOT auto-add customers. Customer addition is a separate workflow with its own confirmation step.

### Step 8 — Plan the draft order

**Do:**
- Apply policy considerations in your reasoning before the call (see `order-policies.md`):
  - Plastic surgery → ASD-only rep coverage; Shane Fadem exception (mention in your reply, don't write tags — the Shopify Flow handles tagging).
  - Buyer email never `@sylke.com`.
  - Distributor-as-buyer (Cardinal Health, McKesson, etc.) — ship-to is the hospital, contact is the distributor.
  - All-products scope — non-WC SKUs are valid; unknowns are flags, not blockers.
- Call `shopify_plan_draft_order` with:
  - `po` — the extracted order data from step 3.
  - `locationId` — the matched location from step 4.
  - `companyContactId` (optional) — from step 7 if available.
  - `customerId` (optional) — from step 7 if available.
  - `shippingMethod` (optional) — default `FedEx 2Day®`. Override only if the order/email explicitly says otherwise ("overnight", "ground OK").
  - `notes` (optional) — short context for the human reviewer if anything noteworthy applies (e.g., "Distributor order via Cardinal Health"). Do NOT use `notes` to pass tag or metafield data — a separate Shopify Flow handles those post-creation.
- The tool **does not write to Shopify**. It returns `{ mock, wouldCreate, wouldMutateShopify, draftOrderName, plannedInput, warnings }`.
- Read the `warnings` array — surface anything non-trivial in your reply text.

**Why:** This is the canonical final step. The plan captures the order content the system would create. Tags, denormalized metafields, the PO-number metafield, the PO-PDF reference, lot numbers, rep attribution — none of those are your concern. The Shopify Flow attached to draft-order-create populates them after creation.

### Composing the reply

After the plan is complete, write the `text` field. Three short paragraphs, plain language, addressed to whoever submitted the order:

1. **One-line outcome.** Examples: "Draft planned for HonorHealth — Thompson Peak ($3,250, 1 line)." / "Could not proceed — ship-to didn't match any Shopify location."
2. **Flags worth knowing.** Bullet list of anything the reader should see: price mismatches, backorders, distributor patterns, Shane Fadem exception applied. Plain English, not codes.
3. **One-line confidence statement.** "High confidence — all fields cited from the order, prices match catalog T3." / "Medium confidence — used catalog price ($3,250) over order price ($3,500) for SYL-WC-32-050; review delta with customer."

For the `summary` field: one short line, suitable for a log row. Examples above.

No emojis. No closing greetings. The reader sees this in plain text — short and scannable wins.

## Reasoning at each branch

When in doubt about which path to take:

- **High-confidence single match vs. multiple plausible matches** — always surface ambiguity for the location. Wrong location is more expensive than slow.
- **Stale order price vs. catalog price** — always use the catalog price, always surface the delta. The customer pays current price; the human reviewer handles the conversation.
- **Distributor email as buyer** — proceed, attribute to the distributor as contact, ship-to to the hospital. Don't reject; this is a common pattern.
- **Unknown SKU** — stop. An unknown SKU could be a typo (recoverable) or a non-SYLKE product (out of scope). Surface for human.
- **Plastic surgery facility** — apply ASD-only coverage rule UNLESS the submitter is Shane Fadem (`sfadem@sylke.com`). See `order-policies.md`.

## Limits and fallbacks

- **Tool call budget:** The order specialist loop is configured with `maxSteps: 12` per run. Plan to stay under that — a clean order should use 5–7 tool calls (extract / get-candidates / match / get-details / get-catalog-context / find-customers / plan-draft-order). Excessive calls suggest fishing instead of reasoning.
- **Reply length:** ~10 sentences max in `text`. The reader won't see more.
- **Same dead end twice:** if a tool returns the same unhelpful result on a retry (e.g., same location candidates returning the same ambiguous match), do not loop — stop and surface.
- **Tool failures:** if a tool throws or returns an error envelope (network 5xx, Shopify GraphQL errors), retry once. If still failing, stop and surface the tool name + error in your text.
- **No mutations possible in this phase:** the `shopify_plan_*` tools are dry-run only. If you find yourself wanting to "actually create" something, you can't — that's a future phase. Plan it, return the plan in the trace, and tell the reader what the plan was.

## Sources

- `sales-operations-agent/src/workflows/processPO.ts` and `services/processPO/` — the production PO workflow this skill mirrors
- `sales-operations-agent/src/services/shopify/catalogHelpers.ts` — catalog conflict rules
- `sales-operations-agent/src/services/shopify/locationMatch/` — location matching patterns
- `sales-operations-agent/src/services/salesRepAssignment.ts` — rep computation rules
- `.agent-skills/prompt-engineering/SKILL.md` (production) — the prompt rubric this skill is structured against
