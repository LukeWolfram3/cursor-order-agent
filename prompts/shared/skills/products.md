# Skill — Products

SYLKE's product catalog spans more than just the SYLKE® Adhesive Wound Closure line. This skill describes the product universe at a high level and tells you to use the live product-listing tool to get the authoritative current set.

## The current source of truth

The live Shopify product catalog is the authority. A future tool will let you pull the up-to-date list of products and their variants at runtime — when that tool is wired, **call it on every PO that has line items**, not just when you encounter an unfamiliar SKU.

Cache the result for the duration of one PO. Don't re-fetch on every line item.

Until the tool is wired, you have the static guide below. Treat it as orientation, not as a closed allowlist of valid SKUs.

## Product categories

### B2B medical — the primary line

**SYLKE® Adhesive Wound Closure** is the core product. Six canonical SKUs make up the bulk of B2B PO volume:

| SKU | Description |
|---|---|
| `SYL-WC-16-010` | 16cm × 2.5cm Wound Closure, Box of 10 |
| `SYL-WC-16-050` | 16cm × 2.5cm Wound Closure, Box of 50 |
| `SYL-WC-24-010` | 24cm × 3.4cm Wound Closure, Box of 10 |
| `SYL-WC-24-050` | 24cm × 3.4cm Wound Closure, Box of 50 |
| `SYL-WC-32-010` | 32cm × 2.5cm Wound Closure, Box of 10 |
| `SYL-WC-32-050` | 32cm × 2.5cm Wound Closure, Box of 50 |

Less-common SYL-WC-32 variants exist for the 32cm size: `SYL-WC-32` (single eaches, $120), `SYL-WC-32-002` (box of 2), `SYL-WC-32-005` (box of 5).

### Supplementary B2B materials — included with orders

In addition to the priced wound closure SKUs, SYLKE provides supplementary items that often appear on POs:

- **Clinical evidence packs** (typically free)
- **In-servicing guides** (typically free)
- **Patient discharge sheets**
- **Marketing brochures, flyers, educational materials**

Some of these are free; some carry a small charge. They have their own SKUs in the Shopify catalog. They are NOT the wound closure product; they're sales/education materials that ship alongside or independently.

### DTC consumer line — out of scope for B2B PO automation

**SYLKE MD® Antimicrobial Longline Bra** and **Boyshort** (silk garments with antimicrobial properties). SKUs use the `SMD-*` prefix (e.g., `SMD-LB-SM`, `SMD-BS-LXL`). These are sold through direct online checkout on `www.sylke.com`, not through B2B POs. If an `SMD-*` SKU appears on a B2B PO, treat it as anomalous and surface — but do not reject the PO outright.

## Scope rule for the POAgent

The POAgent must accept **any SKU that exists in the live Shopify product catalog**, not only the six canonical wound closure SKUs above. POs regularly include supplementary items.

- A SKU you can find in the live catalog → process it.
- A SKU you cannot find → flag `unknown_sku` and surface for human review. Don't drop unknown lines silently; the rep needs to see them.
- An obviously-DTC SKU (`SMD-*`) on a B2B PO → process it but flag as anomalous; let the rep decide.

## When the product-listing tool is wired

When the tool exists, the workflow becomes:

1. Receive the PO with extracted line items.
2. Call the product-listing tool once for this PO.
3. For each line item, look up the SKU in the returned list.
   - Found, B2B product → proceed with pricing per `catalogs.md`.
   - Found, supplementary material → proceed; note in your reasoning whether the line carries a price or is bundled-free.
   - Found, DTC `SMD-*` → flag anomalous, proceed.
   - Not found → flag `unknown_sku`, do not invent.
4. Continue with location matching and draft order planning.

Until the tool is wired, you can call `shopify_lookup_variants` for individual SKU lookups, which fetches one variant at a time from the live store. The dedicated listing tool will be more efficient when it lands.

## Unit-of-measure conventions

For the wound closure line, each variant title encodes its UOM:

- `Box of 10`, `Box of 50` — typical B2B packaging
- `Box of 2`, `Box of 5` — small-batch trial packaging
- `Eaches` — single-unit pricing

The PO's quantity field refers to *number of that variant*, not number of individual units. A PO line "1 BX of SYL-WC-32-050" means one box (which contains 50 eaches). Don't translate between boxes and eaches; pass the quantity through to the line item as written on the PO.
