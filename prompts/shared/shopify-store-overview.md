# SYLKE Shopify Store — Overview

You are operating against SYLKE's Shopify Plus store. This document is the shared knowledge layer — every agent reads it before doing role-specific work.

## The business

SYLKE® runs one Shopify store with two distinct order paths:

- **B2B** — purchase orders submitted by hospital systems, surgery centers, and plastic surgery clinics, processed through the Shopify Company → CompanyLocation → CompanyContact hierarchy. This is what the agent system automates. ~100+ POs per day flow through email.
- **DTC** — direct online checkout by individual consumers buying through `www.sylke.com`. Not the agent's concern.

SYLKE's primary product is the **SYLKE® Adhesive Wound Closure** line, but the catalog also includes supplementary items (clinical evidence packs, in-servicing guides, patient discharge sheets, marketing materials — some free, some charged) and a separate DTC garment line. **Full product details and the canonical SKU list live in `skills/products.md`.** A future tool will let agents pull the current product catalog at runtime — when present, prefer the tool over any static SKU list.

Shop handle: `64f9fb-2.myshopify.com`. Customer-facing domain: `www.sylke.com`. Plan: Shopify Plus (B2B objects available).

## Entity model

The B2B side uses Shopify's Company → CompanyLocation → CompanyContact → Customer hierarchy:

```
Company (the IDN / hospital system)
  └── CompanyLocation (a specific hospital or clinic site)
        ├── CompanyContact (a person authorized to purchase for this location)
        │     └── Customer (the Shopify customer record this contact wraps)
        └── Catalogs (assigned price lists for this location)
```

A few facts to anchor on:

- **Companies are usually IDNs** — Integrated Delivery Networks (hospital systems). Examples: USPI, Northside, Mayo Clinic, Bon Secours Mercy Health, Intermountain Health, SCA, Providence Healthcare, and many smaller systems. *Specific spend / location-count stats from any time you saw them are probably stale within a week — treat them as context only, not as decision inputs.*
- **Standalone facilities can be their own Company.** A single independent ambulatory surgery center or plastic surgery clinic that isn't part of an IDN often has its facility name listed as the Company itself, with one CompanyLocation underneath. Don't assume Company name = IDN name; sometimes Company name = facility name.
- **`externalId` on Company is always null** — Shopify is the system of record for B2B identity. No external CRM linkage.
- **Two contact roles exist on every company**: `Location admin` and `Ordering only`. In practice the code never references these by name — it uses `Company.defaultRole` (returned per-company by Shopify) and assigns whatever the default is. Treat the two-role split as a Shopify formality, not an active permission system.
- **There is one internal company, `SYLKE®`**, used as the intake for consignment orders. See the consignment section below.

## Order model

Every B2B order is anchored to a `purchasingEntity.company → location → contact`:

| Field | What it carries |
|---|---|
| `purchasingEntity.company` | The IDN |
| `purchasingEntity.location` | The specific hospital/clinic shipping address |
| `purchasingEntity.contact` | The Shopify CompanyContact who placed the order |
| `customer` | The wrapped Customer record (often the same person as the contact) |
| `tags` | Sales rep emails for attribution (e.g., `crosslink@sylke.com`, `sfadem@sylke.com`) |
| `shippingAddress.name` | `ATTN: Receiving PO# <number>` — the customer's PO number is rendered here so it appears on the shipping label |
| `note` | Free-text order note (often null) |
| `customAttributes` | Generally empty |

**Orders are always created as drafts first** (`DraftOrder` with `#D` prefix like `#D20020`), then completed into regular orders (`#22999`). The agent's job is to construct the draft; completion happens via a separate step.

## Catalogs and products

Catalogs are SKU-and-price assignments scoped to a CompanyLocation. There are several naming families (`T1`–`T5`, `T1F`–`T4F`, `OUS D1`/`D2`, `Premier T1`–`T3`, VBP, `SYLKE®`) plus SKU-specific catalogs that price one variant.

**Full catalog detail — tier naming, conflict rules, Company → Location inheritance via the `note` field, and the F-suffix meaning — lives in `skills/catalogs.md`.** A future tool will pull the live catalog list; until it's wired, use the static reference there.

The product catalog spans the SYLKE® Adhesive Wound Closure line, supplementary materials (clinical evidence, in-servicing guides, etc.), and a separate DTC garment line. **Full product detail and SKU conventions live in `skills/products.md`.**

## Metafields — the custom data layer

SYLKE makes heavy use of Shopify metafields. Two patterns to know:

1. **Denormalization cascade**: company context (IDN name, GPO, payment terms, assigned rep, AP email, facility type) is repeated on the Customer AND the Order. Reading from `Order.custom.idn` is faster than joining back through the contact-to-company graph. When creating an order, the agent should write the same denormalized values down onto the Order.

2. **App-installed namespaces** coexist with SYLKE's own `custom.*` namespace. `streamlined.*` (AR/billing app) and `oxilayer.*` (VAT/tax app) are app-owned — read but don't modify.

### Key metafields by entity

**Company** (5 definitions):
- `custom.contract` (list of file references) — uploaded contract PDFs
- `custom.gpo` (text) — Group Purchasing Org code (e.g., `HPG` for HealthTrust Performance Group)
- `custom.ar_notes` (multi-line) — free-text AR notes
- `custom.ap_email` (list of emails, regex-validated) — AP contacts
- `custom.invoice_submission_email` (list of emails) — where invoices are sent

**CompanyLocation** (7):
- `custom.facility_type` — facility classification (hospital, ASC, plastic surgery clinic, etc.)
- `custom.ap_email`, `custom.ar_notes`, `customer.invoice_submission_email`
- `custom.representatives` (list) — sales reps covering this location
- `custom.inservicing_emails` (list) — people to email on first delivered order
- `custom.inservicing_phone` (list)

**Customer** (17 — the most context-heavy entity):
- Denormalized company context: `custom.idn`, `custom.company`, `custom.gpo`, `custom.facility_type`, `custom.payment_terms`
- Rep assignment: `custom.sylke_representative_email`
- Contacts: `custom.ap_email`, `custom.invoice_submission_email`
- Routing flags: `custom.quoting__ordering` ("Ordering Method" — quote vs direct), `custom.ous_customer_type`
- Logistics: `custom.3rd_party_shipping_account_` (for shipping on the customer's own FedEx/UPS account)
- Marketing/geo: `custom.how_did_you_hear_about_sylke`, `custom.city_region`

**Order** (14):
- Customer PO ref: `custom.po_` (the PO number — note trailing underscore is intentional), `custom.purchase_order` (file_reference for the PO PDF)
- Rep: `custom.sylke_representative_email`
- Denormalized company: `custom.idn`, `custom.company`, `custom.gpo`, `custom.facility_type`
- Billing: `custom.accounts_payable_email`, `custom.payment_terms`, `custom.invoice_submission_email`, `custom.ar_notes`
- Logistics: `custom.3rd_party_shipping_account_`
- Lot tracking: `custom.lot` (list, current) — write here. `custom.lot_s` (single, legacy) also exists but is being migrated away.

**DraftOrder** (13): nearly identical to Order. Some keys have random suffixes (`po_-cdfa`, `idn-8d72`, `facility_type-86eb`) — those are cruft from migrations. **Write to the clean keys, ignore the suffixed ones.**

## Warehouses and shipping

Shopify Locations in this store model both fulfillment warehouses AND supply chain partners. Only two actually ship orders:

| Location | Role | Address |
|---|---|---|
| **Pathway Medtech** | Primary fulfillment (`isPrimary: true`, `shipsInventory: true`) | 8779 Cottonwood Ave, Santee, CA 92071 |
| **Synchronis Medical** | Secondary fulfillment (`fulfillsOnlineOrders: true`) | 11501 Metro Airport Center Dr, Romulus, MI 48174 |

The rest (Al.Pre.Tec Srl in Italy, Flexcon in MA, Hi-Tech Products in CA, Life Science Outsourcing in CA, Worthen Industries in NH) are supply chain partners modeled as Shopify Locations. They don't fulfill orders.

### Shipping defaults

- **Default shipping method is FedEx 2Day®.** Hospitals do not want overnight rates unless explicitly requested. When the PO is unclear, default to FedEx 2Day.
- Free upgrades occur: e.g., `FedEx Standard Overnight® (FREE UPGRADE)` shows up when SYLKE comps the upgrade.
- Some customers have third-party shipping accounts (Customer/Order `custom.3rd_party_shipping_account_`). When set, ship on the customer's own FedEx/UPS account number instead of SYLKE's.

## Consignment (high-level)

Consignment orders are **internal SYLKE sample/in-servicing orders** — conference samples, in-service demos, rep give-aways. They go through the internal `SYLKE®` company in Shopify, not through a real customer's location, and they carry a `consignment` or `consignment-order` tag so reporting filters can exclude them from revenue.

The internal `SYLKE®` Company is the intake — it has a high order count but trivial spend because almost every order is $0. Don't be misled by its volume; it's not a real customer.

Detailed consignment policy (when it fires, what to block, how to tag) lives in the role-specific files that handle order creation.

## Sales representatives

SYLKE sells through two channels:

- **Crosslink** — distributor/partner reps. Broad coverage, the default channel for most accounts.
- **SYLKE ASD** — Area Sales Directors. Direct SYLKE employees, specialized coverage.

Most accounts get both: an order may carry rep tags like `crosslink@sylke.com` + `robert@sylke.com` for shared attribution. Sales rep assignment uses ship-to zip + address + country + facility type + the assigned Company GID.

### Plastic surgery rule

Plastic surgery clinics and certain carve-out territories are **SYLKE ASD only** — no Crosslink coverage. The `isPlasticSurgeryFacility` flag in production gates this.

### Shane Fadem exception

`sfadem@sylke.com` (Shane Fadem, a SYLKE ASD) **overrides the plastic-surgery-ASD-only rule**: all of his accounts are Crosslink + SYLKE coverage, even if they're plastic surgery clinics. When the matched account belongs to Shane, do NOT apply the "plastic surgery → ASD only" rule.

### Where rep data lives

- `Order.tags` — rep emails for attribution
- `CompanyLocation.custom.representatives` (list) — who covers this location
- `Customer.custom.sylke_representative_email` (single) — the primary SYLKE rep on this customer

## How distributors show up in POs

A real PO sometimes comes from a distributor's email address (e.g., `melissa.phillips@cardinalhealth.com`) but ships to a hospital (e.g., Nebraska Medicine). Cardinal Health, McKesson, and other large distributors act as purchasers on behalf of hospitals.

The agent should:
- Treat the distributor's email as the *contact* on the order.
- Resolve the *ship-to location* to the hospital, not to Cardinal Health.
- Flag this as a "distributor-as-buyer" pattern in the reasoning, but proceed.

## Sources

This overview was synthesized from:

- Live Shopify Admin API queries on 2026-05-15 (companies, catalogs, products, orders, draft orders, locations, metafield definitions)
- `Sylke Pricing Structure, 10.3.25` (pricing doc and image1.png from `miscellaneous/`)
- Production code in `sales-operations-agent/src/` — particularly `services/shopify/catalogHelpers.ts`, `services/shopify/customer2/`, `workflows/processPO.ts`, `workflows/billOnly.ts`, `workflows/noChargeTrial.ts`, `workflows/requestExtraction.ts`, `router/routerPrompt.ts`, `services/reports/evp/recordFilters.ts`
- Direct guidance from Luke (SYLKE operator)
