# Skill — Order Policies and Edge Cases

The policy layer. Hard rules and non-obvious edge cases that govern order processing — regardless of input shape (formal PO, body-only order, brochure/sample request) or who submitted it (customer, employee, rep, or purchasing entity). Read this before any irreversible decision: escalation, draft creation, reply.

## Trigger

Apply these rules whenever you reach a decision point that any of them touches. The rules are listed in approximate "how often they fire" order — common patterns first.

## Hard rules (always apply)

### 1. Buyer email is never `@sylke.com`

SYLKE is the vendor, not the customer. If the only buyer-email candidate you can extract is a `@sylke.com` or `.sylke.com` address, that's a parsing error. Re-read the email body and any attached order document to find the *customer's* email — usually in a bill-to / contact / submitted-by block, or named near the ship-to in body-only orders.

If you still cannot find a non-@sylke.com buyer email after a careful re-read, stop and surface "no customer buyer email found" in your reply.

### 2. Plastic surgery → SYLKE ASD only (with Shane Fadem exception)

Plastic surgery clinics and a handful of carve-out territories are **SYLKE ASD only** — no Crosslink rep coverage.

How to apply:
- Read the matched CompanyLocation's `custom.facility_type` metafield (from `shopify_get_location_details`). If it equals "plastic surgery" / "plastic surgery clinic" / "cosmetic surgery", the rule applies.
- The matched location's assigned reps (`custom.representatives` list) should already reflect this.

**The Shane Fadem exception:**

If the submitter is `sfadem@sylke.com`, the plastic-surgery-ASD-only rule does NOT apply to his accounts. Shane's accounts get Crosslink + SYLKE coverage even when they're plastic surgery clinics.

**Your role here is observational, not active.** You do NOT write rep tags on the draft order — a Shopify Flow runs after draft-order creation and handles tagging based on the location's metafields. Your job is to MENTION the rule in your reply when it's noteworthy so the human reviewer can verify the Flow's tagging matches expectations:

- Shane Fadem + plastic surgery → note: "Plastic surgery clinic under Shane Fadem — Crosslink + SYLKE coverage applies (overrides the ASD-only default)."
- Any other submitter + plastic surgery → note: "Plastic surgery facility — SYLKE ASD coverage only."
- Anything not plastic surgery → no need to mention rep coverage.

### 3. All SYLKE products are in scope

The bulk of B2B orders are for the six canonical wound closure SKUs (`SYL-WC-{16,24,32}-{010,050}`), but orders regularly include non-WC items: patient discharge sheets, marketing flyers, brochures, educational materials, in-servicing guides, clinical evidence packs. The agent must accept ANY SKU SYLKE offers in its live Shopify catalog.

- Look every SKU on an order up in Shopify's products. If it exists, process it.
- An unknown SKU is a flag — stop on that line, surface for human review. Do not reject the entire order, but don't drop unknown SKUs silently either.
- DTC garment SKUs (`SMD-*`) shouldn't appear on B2B orders. If you see one, surface as "unexpected DTC SKU" in your reply but proceed.

### 4. Distributor-as-buyer pattern

Large medical distributors (Cardinal Health, McKesson, Owens & Minor, etc.) often place orders on behalf of hospitals. The buyer email will be the distributor's domain (`@cardinalhealth.com`, `@mckesson.com`); the ship-to is the hospital's address.

How to handle:
- Treat the distributor's email as the contact email on the order.
- Resolve the *ship-to location* to the hospital's CompanyLocation, NOT to the distributor.
- Note in your reply: "Order via [distributor] on behalf of [hospital]."
- Use the hospital's assigned catalog / tier for pricing — distributors don't have their own catalogs for SYLKE products.

This is a normal pattern; do not treat it as anomalous. Common distributor domains: `cardinalhealth.com`, `mckesson.com`, `owens-minor.com`, `medline.com`, `henryschein.com`, `concordance-healthcare.com`.

### 5. Never auto-create new B2B entities

You may NEVER create a new Company, CompanyLocation, CompanyContact, or Customer via this workflow. Creation is a separate workflow that requires explicit human confirmation in a reply thread.

If `match_location_with_research` returns `matchedLocationId: null` (no confident match, or multiple ambiguous candidates):
- Stop. Do not call `shopify_plan_draft_order`.
- In your reply, include the parsed ship-to address and the matcher's `reasoning` so the human reviewer can confirm or correct it.

If `match_location_with_research` returns a match WITH `humanReviewNeeded: true` (matched but with concerns — ZIP mismatch, suite mismatch in a medical office building, entity mismatch, etc.):
- Read the matcher's `humanReviewReason`. Judge whether the concern is proceed-and-surface (ZIP mismatch, facility rebrand, centralized AP) or stop-and-escalate (entity mismatch, suite mismatch in MOB).
- For proceed-and-surface: call `shopify_plan_draft_order` normally, and include `humanReviewReason` verbatim in your reply text.
- For stop-and-escalate: do not call `shopify_plan_draft_order`. Surface the reasoning + concern in your reply.

If `shopify_find_customers_for_po` returns no matching customer at the matched location:
- Stop. Do not call `shopify_plan_draft_order`.
- In your reply, name the email you couldn't find and the location.

Note: the `shopify_plan_customer_action` and `shopify_plan_location_updates` tools exist but are **dry-run only** for now. Even if you call them, they produce plans that don't actually create anything. So calling them mid-order-flow doesn't help — they're for future creation workflows. Stay out of them in the order flow.

This is a guardrail against bad merges. A new "Memorial Hospital" auto-created when one already exists under a slightly different name creates duplicates that are painful to clean up.

## Soft rules (apply when relevant)

### 6. Shipping method defaults and overrides

- Default: `FedEx 2Day®`. Hospitals don't want overnight unless they ask.
- Order requests overnight ("rush", "ASAP", "ship today/tomorrow", "we need this Friday and it's Wednesday"): use `FedEx Standard Overnight®`.
- Order requests ground ("ground is fine", "no rush", "save on shipping"): use `FedEx Ground®`.
- Customer has a 3rd-party shipping account on file (`Customer.custom.3rd_party_shipping_account_`): use their account number, ship method per their preference.

### 7. Catalog price wins over order price (with disclosure)

If an order encodes a different unit price than the assigned catalog for the same SKU, the plan should use the catalog price. In your reply, explicitly say: "Used catalog price $X.XX over order price $Y.YY for SKU Z (catalog tier T3, $X delta)."

This protects SYLKE from honoring stale or wrong prices and lets the human reviewer have an informed conversation with the customer if needed.

### 8. Pricing tolerance

- Delta < 0.5%: match silently.
- Delta 0.5–5%: proceed with catalog price, note in reply.
- Delta > 5%: proceed with catalog price, note prominently, mark your reply as low-confidence on pricing.
- Catalog price unavailable (SKU not in the catalog assigned to this location): stop. Surface "SKU not in catalog" in your reply.

## What you do NOT do (Shopify Flow handles it)

A Shopify Flow runs after the draft order is created and takes care of all post-creation enrichment. The agent does NOT:

- Write order tags (rep emails, consignment, channel, etc.) — Flow attaches these.
- Populate denormalized metafields on the order (`idn`, `gpo`, `facility_type`, `payment_terms`, `sylke_representative_email`, etc.) — Flow copies these from the customer / location.
- Set the PO number metafield (`Order.custom.po_`) — Flow extracts from the draft and writes it.
- Attach the PO PDF as a file_reference metafield (`Order.custom.purchase_order`) — Flow handles file attachment.
- Write lot numbers (`Order.custom.lot`) — Flow handles lot tracking.
- Render `ATTN: Receiving PO# <number>` in the shipping address — Flow handles label formatting.

Your job ends when `shopify_plan_draft_order` returns a clean plan. Don't try to populate Flow-handled data via the `notes` field or any other channel. Keep your reply focused on what the human reviewer needs to know.

## Combinatorics worth knowing

### Plastic surgery + Shane Fadem

- `sfadem@sylke.com` submits an order for a plastic surgery clinic.
- In your reply, note: "Plastic surgery clinic under Shane Fadem — Crosslink + SYLKE coverage applies (overrides the ASD-only default for plastic surgery)."
- The Shopify Flow handles actual rep tagging based on the location's metafields. Your role is just to surface the exception.

### Distributor as buyer + plastic surgery

- Cardinal Health submits an order for a plastic surgery clinic.
- Resolve ship-to to the clinic, contact = Cardinal Health email.
- In your reply, note: "Order via Cardinal Health on behalf of [clinic]. Plastic surgery facility — SYLKE ASD coverage only."

### Clean order from a known account (the happiest path)

- A clean order from Bon Secours Mercy Health: attached PDF, all line items extractable, location matched cleanly, T3 catalog assigned, prices match exactly.
- Plan the draft. Brief reply, high confidence, no flags worth surfacing.

## Sources

- `sales-operations-agent/src/router/routerPrompt.ts` — production routing rules
- `sales-operations-agent/src/services/shopify/customer2/orchestrations/` — customer/contact assignment rules
- `sales-operations-agent/src/services/salesRepAssignment.ts` — rep computation (Crosslink/ASD logic)
- `sales-operations-agent/src/workflows/processPO.ts` — production PO workflow
- Memory: `reference-sales-rep-routing`, `reference-product-scope`, `reference-catalog-tier-naming`
