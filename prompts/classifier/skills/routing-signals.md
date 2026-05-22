# Skill — Routing Signals

The catalogue of email content patterns that indicate each `specialist` classification. Use this as the lookup table when applying decision priority rule 5 (content signals) in the classifier system prompt.

The header for each section gives the canonical `specialist` enum value plus the legacy router action name in parens.

## How to use

For each candidate workflow, check the signals listed below against the email. Strong signals are usually sufficient on their own; medium signals need at least one corroborating field; weak signals only count when paired with other weak signals from the same action.

When multiple actions share signals (e.g., a forwarded PO that also mentions "quote"), apply the decision-priority rules in the system prompt and let the explicit-instruction / reply-context rules break the tie.

Classifier scope: this skill focuses on **what the email says** — subject line, body content, and attachment metadata (filename, MIME type, size). The classifier does NOT reason about who sent the email; sender authority and identity matter in downstream specialist workflows (PO, no-charge-trial, bill-only), not here. Treat every email as classifiable from its content alone.

What the classifier sees about attachments: a manifest with each attachment's name, MIME type, size, inline flag, and whether content bytes are present. **Content bytes are NOT decoded for the classifier** — no PDFs, images, or Office docs are passed as content. Filename and MIME type are the only attachment signals available.

## Signals by action

### `order` (`process_order`)

`order` is the broad "any order request" specialist — NOT limited to formal POs. Use it for any email that asks SYLKE to ship something to a customer, regardless of whether a formal purchase order document is attached.

| Signal strength | Pattern |
|---|---|
| Strong | PDF / Word / Excel / TIFF / image attachment named like `PO-12345.pdf`, `purchase_order_*.pdf`, `*_PO_*.pdf`, `Order #*.pdf`, or any filename that looks like an order document |
| Strong | Body or subject contains a PO number pattern: `PO-12345`, `PO #4521`, `PO# 30-3785262`, `Purchase Order: NNNNN`, or `P.O.: NNNNN` |
| Strong | Body contains explicit SKU + quantity, with or without a PO number: "1 bx/50 of SYL-WC-32-050", "Please send 2 boxes of 16-010", "Order: 3x SYL-WC-24-050" |
| Strong | Body requests supplementary materials with quantities: "Please send 10 patient discharge sheets and 5 brochures to [facility]", "Could we get 20 clinical evidence packs?", "Need in-servicing guides for an upcoming training" |
| Strong | Body requests consignment / sample / in-service inventory from a SYLKE rep: "Consignment for AAOS next week", "Samples for our in-servicing at Memorial", "Demo inventory for the conference" |
| Medium | Subject contains "order", "po", "purchase order" without other strong workflow markers |
| Medium | Body says "please ship to", "ATTN: Receiving", "deliver to [hospital]" |
| Weak | Generic "here is the attached order" / "the PO is attached" + an attachment |

**Disambiguation:**
- If the email body is asking for example POs (NOT submitting one), route to `po_examples` instead.
- If the email is a quote request with a forwarded sample PO, the latest reply intent wins — usually `quote_or_location_request`.
- A request for brochures or clinical evidence with no quantity, framed as marketing-collateral pickup or sales-prep, is still `order` if a ship-to is named. If it's just "send me a brochure to review" with no facility / no shipping intent, it's `no_action`.

### `reprocess_po` (`reprocess_po`)

| Signal strength | Pattern |
|---|---|
| Required | Previous AI email in the thread contains `ROUTER HINT: expected_action=reprocess_po` AND embedded `PO_DATA` HTML-comment blob |
| Strong | User reply text is short and confirmatory: "Yes", "Yes please", "Yes override", "Process it", "Process anyway", "Confirmed", "Proceed" |
| Medium | User reply explicitly references the duplicate flag: "Yes, it's not a duplicate", "Override the duplicate check" |

Never route to `reprocess_po` without the prior `ROUTER HINT` — there's no context to act on otherwise.

### `no_charge_trial` (`no_charge_trial`)

| Signal strength | Pattern |
|---|---|
| Strong | Subject or body contains "no charge trial" / "no-charge trial" / "NCT" |
| Strong | Body says "free sample", "trial sample", "complimentary sample", "no cost", "no charge", "comp the order" |
| Strong | Body says "for evaluation", "to evaluate", "we'd like to try" + no PO number |
| Medium | New customer asks for a small quantity ("a couple of boxes", "one box of each") without mentioning purchase or invoicing |
| Medium | Reply to a previous AI email that flagged ineligibility, with `proceed_anyway`-like confirmation: "Yes, proceed", "Override", "Send it anyway" |

**Disambiguation:**
- A no-charge trial with a PO number is still `no_charge_trial` (the customer attached a PO out of habit; the workflow honors the "no cost" semantics).
- A Shopify contact-form submission with message type "Quote" is `quote_or_location_request` even if the customer used casual words like "trial" — the form classification wins.

### `bill_only` (`bill_only`)

| Signal strength | Pattern |
|---|---|
| Required | Email is a Shopify form notification with the Bill Only form schema in the body |
| Strong | Subject contains "Bill Only" or "Bill Only form" |
| Strong | Body contains "Bill Only form has a new submission" |
| Strong | Body contains the structured field table with rows: First name, Last name, Email, Facility name, plus SKU quantities (`qty_32_010`, `qty_32_050`, `qty_24_010`, `qty_24_050`, `qty_16_010`, `qty_16_050`) |
| Medium | Subject or body explicitly says "Bill Only" outside of the form context (rare; usually still routes to `bill_only`) |

Bill Only is the most structured workflow — if the form schema is recognized, route immediately. If the email body explicitly says "bill only please" at the top as a workflow override on a forwarded email, that's the override rule firing, not a content signal.

### `add_customer` (`add_customer`)

| Signal strength | Pattern |
|---|---|
| Required | Previous AI email in the thread contains `ROUTER HINT: expected_action=add_customer` OR `CUSTOMER_INFO` data blob OR explicitly asks "Should I add [X] to [Location]?" |
| Strong | Reply text is a confirmation: "Yes", "Yes please", "Add them", "Confirmed", "Yes, use [email]" |
| Strong | Body says "Add jane@hospital.org to Memorial Hospital" (or similar add-customer-to-location wording) with no prior AI thread |
| Medium | Reply mentions a different email than the prior AI suggested: "Yes but use mike@hospital.org" → extract that email |

Buyer selection on bare confirmation: use the PRIMARY buyer email from the prior AI email's Customer Info blob unless the reply explicitly names another email or says "use secondary".

### `add_company_location` (`add_company_location`)

| Signal strength | Pattern |
|---|---|
| Required | Previous AI email contains `ROUTER HINT: expected_action=add_company_location` OR `LOCATION_INFO` data blob with parent IDN suggestion |
| Strong | Reply text: "Yes", "Yes create it", "Confirmed", "Yes but under [different IDN]" |
| Strong | Reply names a catalog tier: "Yes, use T3F", "Tier 5 please", "Premier T1" |
| Medium | Reply provides additional details like suite number: "Yes, Suite 200" or street override |

If the reply names a parent IDN that differs from the AI's suggestion ("Create under Bon Secours instead"), extract that as `override_idn`. The downstream workflow will try to attach the new location under the named parent.

### `quote_or_location_request` (`request_extraction`)

| Signal strength | Pattern |
|---|---|
| Strong | Subject contains "pricing", "pricing letter", "quote", "proposal", "RFP" |
| Strong | No prior AI thread, body asks for pricing or to "set up an account" |
| Strong | Body contains "could you send pricing", "what does X cost", "looking for quote on", "we'd like to know pricing for" |
| Strong | Shopify contact-form submission where the form's message type is "Quote" or "Pricing inquiry" — always `quote_or_location_request` even if message text uses casual "trial" or "sample" language |
| Medium | Body says "add this location" / "set up this account" with raw address details and no quote ask → still `quote_or_location_request` (downstream picks `standalone`) |

`request_type` is required:
- `quote` — next step is pricing / generate a quote draft
- `standalone` — next step is location/company setup only, no quote yet

**Disambiguation:**
- Don't try to disambiguate based on whether the customer is "existing" or "new" — the classifier can't reliably know that from content alone. Route on what the email says, not on who it's from. The downstream workflow figures out customer status.
- An "add this location" request that includes pricing context ("they want T2") is borderline — route as `quote_or_location_request` to capture both intents.

### `corporate_account` (`corporate_account`)

| Signal strength | Pattern |
|---|---|
| Required | Subject contains "Corporate Account Application" |
| Strong | Body contains the Corporate Account Application form schema fields |
| Strong | Body matches Shopify form notification format (e.g., "[Site] has received a new submission") with a form-type marker identifying it as the corporate account form |

This is a tight form-driven action — if the schema is present, route. If the email body explicitly says "corporate account application for X" at the top as an override on a different email, the override rule fires.

### `po_examples` (`po_examples`)

| Signal strength | Pattern |
|---|---|
| Strong | Body or subject contains "example PO", "sample PO", "example purchase order", "send PO from" |
| Strong | Body asks "could you provide POs from [location/company]" |
| Strong | Reply to a sales-prep email asking for evidence: "Send me a couple of POs from Northside" |
| Medium | "Show me POs" / "POs from" without other specific workflow markers |

**Disambiguation:**
- A new customer asking for sample POs is `po_examples`, NOT `quote_or_location_request`. Sample POs is a sales-enablement artifact, not a pricing inquiry.

### `engineering_issue` (`create_github_issue`)

| Signal strength | Pattern |
|---|---|
| Strong | Subject contains "github issue", "bug report", "feature request" |
| Strong | Body says "create a github issue", "file a bug for", "log this error" |
| Strong | Forwarded error notification (sentry / cloudflare error email / agent error reply) with framing language at the top |
| Medium | Body says "this didn't work right, can you fix" / "improvement idea: ..." in the context of the AI worker |

Internal tool maintenance request, not a customer-facing workflow.

### `no_action` (`no_action`)

| Signal strength | Pattern |
|---|---|
| Strong | "Remittance Advice", "Payment Notification", "ACH transfer", "wire transfer confirmation" |
| Strong | AR statement acknowledgments, "Invoice received", aging report responses |
| Strong | Auto-reply patterns: "Out of Office", "I am away from my desk", "automatic reply" |
| Strong | Marketing / newsletter / vendor outreach unrelated to any SYLKE workflow |
| Default | Anything that doesn't match another action |

`no_action` is the safe catch-all. Use it whenever the email doesn't clearly belong to a workflow — better to surface for human review than misroute.

## Multi-signal scenarios

**A PO email also mentions "for a trial":**
- Rule: explicit instruction at the top of the email and reply intent dominate over content signals.
- If the body says "process as no charge trial" at the top, above the forwarded thread → `no_charge_trial`.
- If there's no explicit instruction at the top but the customer's portion says "we'd like a no-charge trial of these SKUs" with a PO attached → `no_charge_trial` (the "no charge" intent dominates).
- If neither, default to the strongest signal — usually `order` if PO indicators are present.

**A reply that mentions multiple things:**
- The latest reply is the primary source of intent.
- "Yes, but also can you send POs from Mayo?" — the "Yes" confirms the prior workflow; the "POs from Mayo" is a separate request. Route to the confirmation workflow; surface the secondary ask as a follow-up via `no_action` if needed.

**Email with multiple PO attachments:**
- Still `order`. The Order Agent handles multi-attachment orders (one of the attachments will be selected as the canonical order, others tagged as supporting docs).

**Forwarded email from a customer that itself contains a quote:**
- Inspect the text at the top of the email, above the forwarded thread. If it says "please process this PO" → `order`. If it says "looks like they want a quote" → `quote_or_location_request`. If there's no instruction at the top → default to the most-specific content signal in the body.

## Signals that look strong but aren't

- **"Order" in a subject line alone** — many subject lines have "order" without it being a PO. Look for corroborating signals (PO number, SKU mention, attachment).
- **A PDF attachment alone** — could be a flyer, a contract, a remittance. Filename and body context matter.
- **"Quote" in a subject line alone** — could be an AR-related "quote me an estimate of when my invoice will be paid" (which is `no_action`). Check the body.
- **A reply that just says "Yes"** — only meaningful with a prior AI email + ROUTER HINT in the same thread. Without that context, "Yes" is `no_action` (someone is confirming something the system has no record of).

## Sources

- `sales-operations-agent/src/router/routerPrompt.ts` — production router prompt, source of the rule structure
- `sales-operations-agent/src/router/routerTools.ts` — production action / tool schemas
- `sales-operations-agent/src/workflows/*.ts` — per-workflow signal patterns (extracted from the production extraction prompts)
- Production CLAUDE.md routing table — for the canonical list of router actions
