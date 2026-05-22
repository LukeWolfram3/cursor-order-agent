# Skill — Catalogs and Pricing

SYLKE's pricing lives in Shopify catalogs, scoped per-CompanyLocation. This skill is the canonical reference for catalog naming, tier inheritance, conflict rules, and how to read the customer's assigned catalog when verifying line item prices.

## The current source of truth

The live store is the authority on which catalogs exist and what they contain. A future tool will let you pull the up-to-date catalog list at runtime — when that tool is wired, **prefer it over the static names below**. The tables in this file are accurate as of the last review but catalog titles, price lists, and assignments change.

When the tool is available, call it before reasoning about pricing for any customer. Cache the result for the duration of one PO; don't re-fetch on every line item.

## Catalog naming families

### Global-tier catalogs (apply pricing to all SKUs)

| Catalog | What it is |
|---|---|
| `T1`–`T5` | Volume-tiered US pricing. T1 is highest price; T5 is lowest. The 50-pack variants are cheaper per-EA than the 10-pack variants on T1–T4 (volume discount built in). |
| `T1F`–`T4F` | "Flat" per-EA variants. Same per-EA price across box sizes. Used for accounts that want predictable unit cost for budgeting. No T5F exists. |
| `OUS D1`, `OUS D2` | Outside-US distributor tiers. The pricing doc calls these `D6/D7` and `D6F/D7F`; the live store titles them `OUS D1/OUS D2`. Treat as ambiguous until verified — confirm against the live catalog list. |
| `Premier T1`, `Premier T2`, `Premier T3` | Separate negotiated Premier program. T4/T5 don't exist for Premier. |
| `Volume-Based Pricing T1`–`T5` (VBP) | Legacy pricing with quantity-step discounts within a single tier. "1-off when Scott approves." Not the default path. |
| `SYLKE®` | Internal employee catalog. Used for the SYLKE® consignment company. |

### SKU-specific catalogs (target one SKU)

- `SYL-WC-XX-YYY $XXX/BX (TZ)` format — one catalog per (SKU, tier) pair, prices encoded in the title. Roughly 40 of these exist (6 core SKUs × ~5–7 prices).
- `$XX/unit` and `$XX-XX/unit` — one-off per-unit pricing, applies only to SYL-WC-32-010 and SYL-WC-32-050.

These exist for accounts that have a custom contract on a specific SKU while taking standard pricing on the rest.

## Tier inheritance — Company → Location

Catalogs are assigned per-CompanyLocation, but **an entire IDN is often standardized on a single tier**. When resolving which tier applies to a given location, apply this order:

1. **Direct assignment first.** If the CompanyLocation has any catalog(s) directly assigned, those are the answer.
2. **Parent Company's `note` field next.** The `Company.note` is a free-text field the SYLKE ops team uses to encode tier rules. Read it before deciding the location has "no tier" — the rule may be there.

   Real examples from production:
   > Intermountain Health: `"1/12/26: T3F for all new locations. -B / Rec'd call from Robert (Sylke rep) asked that we update the catalog to $75/$70. Update made. (KS)"`
   > SCA: `"9/8/25: T3F for all new SCA locations, per Scott. -B"`

   Format: free text. Initials (`-B`, `(KS)`) identify the author who added the rule. Always read the full note before deciding — multiple rules can stack chronologically and the most recent one usually wins.

3. **No usable rule found?** Surface `needs_catalog_assignment` and stop. Do NOT guess a tier from the customer's order history or other signals.

## Conflict rules

A single CompanyLocation should have one of: (a) one global-tier catalog, or (b) one SKU-specific catalog per SKU. Conflicts:

1. **Two global-tier catalogs on one location** = conflict. T1 and T2 cannot both apply.
2. **A global-tier catalog plus any SKU-specific catalog** = conflict. The global tier already prices every SKU; the SKU-specific catalog would override one and create ambiguity.
3. **Two SKU-specific catalogs on the SAME SKU** = conflict.
4. **SKU-specific catalogs on DIFFERENT SKUs** = OK. Different SKUs can have different custom prices.

When a conflict is detected, do not silently pick one — surface the conflict and stop. The ops team needs to resolve the catalog assignment, not the agent.

## Reading a customer's tier when verifying prices

For each line item on a PO:

1. Look up the assigned catalog(s) on the CompanyLocation.
2. If a SKU-specific catalog covers this exact SKU, use its price.
3. Otherwise, use the global tier (T1–T5, T1F–T4F, Premier T*, OUS D*).
4. Compare the PO's unit price to the catalog price:
   - Match (within 0.5%) → silent.
   - 0.5–5% delta → note in your reply, use the catalog price.
   - >5% delta → note prominently, use the catalog price, lower your confidence.
   - SKU not present in any assigned catalog → stop. Surface "SKU X not in this location's catalog".

## The F suffix in detail

F = Flat per-EA. The non-F tiers (T1–T4) charge less per-EA on 50-packs than 10-packs (volume discount built in). The F variants flatten this — same per-EA price regardless of box size. Worked example for T3 vs T3F on SYL-WC-32:

| Catalog | 32-010 (box of 10) | 32-050 (box of 50) | Per-EA on 10s | Per-EA on 50s |
|---|---|---|---|---|
| T3 | $700/BX | $3,250/BX | $70 | **$65** (volume discount) |
| T3F | $700/BX | $3,500/BX | $70 | **$70** (flat) |

So an account on T3F pays $250/BX more for the 50-pack than an account on T3, in exchange for predictable per-EA budgeting.

## When the catalog-listing tool is wired

When the tool exists, call it once per PO to get the current authoritative list. Use that list to:

- Confirm the catalog name on the matched location matches a known catalog title.
- Read the price list contents for each line item's SKU.
- Detect catalogs that have been added or renamed since this skill was last edited.

Until the tool is wired, you have only the static names above. If you encounter a catalog title not in the table, surface it as `unknown_catalog` rather than guessing how to price it.
