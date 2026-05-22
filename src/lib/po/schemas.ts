import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Order extraction schema
//
// Mirrors the production extraction schema (sales-operations-agent) with the
// requester-override fields dropped — the POC's direct-intake architecture
// doesn't have a forwarder/requester layer.
// ─────────────────────────────────────────────────────────────────────────────

const PO_SKU_VALUES = [
	'SYL-WC-32-010',
	'SYL-WC-32-050',
	'SYL-WC-32',
	'SYL-WC-24-010',
	'SYL-WC-24-050',
	'SYL-WC-24',
	'SYL-WC-16-010',
	'SYL-WC-16-050',
	'SYL-WC-16',
] as const;

const PAYMENT_TERMS_VALUES = [
	'Net 7',
	'Net 15',
	'Net 30',
	'Net 45',
	'Net 60',
	'Net 90',
] as const;

const SHIPPING_METHOD_VALUES = [
	'FedEx 2Day',
	'FedEx Standard Overnight',
	'FedEx Priority Overnight',
	'FedEx Priority Overnight Saturday Delivery',
	'FedEx First Overnight',
	'FedEx First Overnight Saturday Delivery',
] as const;

// ── Pre-Zod normalization config (consumed by normalizeExtractedPO) ─────────

/** Canonical enum values per field path — used by the cleanup layer to validate / sanitize before Zod parse. */
export const PO_EXTRACTION_ENUM_VALUES_BY_PATH = {
	payment_terms: PAYMENT_TERMS_VALUES,
	requested_shipping_method: SHIPPING_METHOD_VALUES,
	'line_items.line_items_array[].SKU': PO_SKU_VALUES,
} as const;

/** Default values for required-string fields that models sometimes omit or return as null. */
export const PO_EXTRACTION_DEFAULT_VALUES_BY_PATH = {
	reason_for_ship_to_address: '',
	shipping_and_delivery_reasoning: '',
	currency: 'USD',
	confidence: 0,
} as const;

/**
 * SKU alias remap. Customers occasionally print short-form SKUs (e.g.
 * "SYL-WC-32-10" instead of "SYL-WC-32-010") and the model transcribes them
 * verbatim per the extraction prompt's "extract as printed" rule. Without
 * this remap they'd be nulled by enum sanitization, leaving the resolver
 * with no SKU.
 */
export const PO_EXTRACTION_ENUM_VALUE_REMAP_BY_PATH = {
	'line_items.line_items_array[].SKU': {
		'SYL-WC-32-10': 'SYL-WC-32-010',
		'SYL-WC-32-50': 'SYL-WC-32-050',
		'SYL-WC-24-10': 'SYL-WC-24-010',
		'SYL-WC-24-50': 'SYL-WC-24-050',
		'SYL-WC-16-10': 'SYL-WC-16-010',
		'SYL-WC-16-50': 'SYL-WC-16-050',
	},
} as const;

/**
 * Field-name "echoes" the model sometimes returns as the value (e.g. returning
 * the literal string "GLN" as the value of GLN_shipping). The cleanup layer
 * detects these and replaces them with null.
 */
export const PO_EXTRACTION_FIELD_NAME_ECHOES: ReadonlyMap<string, readonly string[]> = new Map([
	['GLN_shipping', ['gln', 'gln_shipping', 'gln shipping']],
	['GLN_billing', ['gln', 'gln_billing', 'gln billing']],
	['care_of', ['care_of', 'care of']],
	['accounts_payable_email', ['accounts_payable_email', 'accounts payable email', 'ap email']],
	['invoice_submission_email', ['invoice_submission_email', 'invoice submission email', 'invoice email']],
	['ship_to_facility_name', ['ship_to_facility_name', 'facility name']],
	['reorder_notes', ['reorder_notes', 'reorder notes']],
	['document_flag_reason', ['document_flag_reason', 'document flag reason']],
]);

/** GLN must be exactly 13 digits. Cleanup nulls non-conforming values. */
export const PO_EXTRACTION_GLN_FIELDS = ['GLN_shipping', 'GLN_billing'] as const;
export const PO_EXTRACTION_GLN_PATTERN = /^\d{13}$/;

// ── Line item ───────────────────────────────────────────────────────────────

export const poLineItemSchema = z.object({
	SKU: z.enum(PO_SKU_VALUES).nullable(),
	quantity: z.number().nullable(),
	unit_price: z.number().nullable(),
	line_total: z.number().nullable(),
});

export type POLineItem = z.infer<typeof poLineItemSchema>;

// ── Main extraction schema ──────────────────────────────────────────────────

export const extractedPOSchema = z.object({
	// Identity
	purchase_order_number: z.string().nullable(),

	// Buyer contact
	buyer_email: z.string().nullable(),
	secondary_buyer_email: z.string().nullable(),
	buyer_first_name: z.string().nullable(),
	buyer_last_name: z.string().nullable(),
	secondary_buyer_first_name: z.string().nullable(),
	secondary_buyer_last_name: z.string().nullable(),

	// Ship-to
	ship_to_address: z.string().nullable(),
	ship_to_facility_name: z.string().nullable(),
	ship_to_phone: z.string().nullable(),
	reason_for_ship_to_address: z.string(),

	// Bill-to
	bill_to_address: z.string().nullable(),
	bill_to_phone: z.string().nullable(),

	// Payment & shipping
	payment_terms: z.enum(PAYMENT_TERMS_VALUES).nullable(),
	shipping_and_delivery_reasoning: z.string(),
	expected_delivery_date: z.string().nullable(),
	requested_delivery_time: z.string().nullable(),
	requested_shipping_method: z.enum(SHIPPING_METHOD_VALUES).nullable(),

	// Totals
	total_price: z.number().nullable(),
	Tax: z.number().default(0),

	// Line items
	line_items: z.object({
		line_items_array: z.array(poLineItemSchema),
	}),

	// Routing / context
	care_of: z.string().nullable(),
	accounts_payable_email: z.string().nullable(),
	invoice_submission_email: z.string().nullable(),
	po_created_date: z.string().nullable(),
	GLN_shipping: z.string().nullable(),
	GLN_billing: z.string().nullable(),
	currency: z.string().default('USD'),

	// Document flags
	acknowledge_link: z.boolean().default(false),
	is_revised_po: z.boolean().default(false),
	is_bill_only: z.boolean().default(false),
	document_flag_reason: z.string().nullable().default(null),

	// Quality
	confidence: z.number(),
	document_readable: z.boolean().default(true),

	// Reorder detection
	reorder_requested: z.boolean().default(false),
	reorder_notes: z.string().nullable().default(null),
});

export type ExtractedPO = z.infer<typeof extractedPOSchema>;
export type ExtractedPOInput = z.input<typeof extractedPOSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Downstream draft-order shapes (unchanged from earlier)
// ─────────────────────────────────────────────────────────────────────────────

export const draftLineDiscountSchema = z.object({
	type: z.enum(['percentage', 'fixed_amount']),
	value: z.number(),
	title: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	reason: z.string().nullable().optional(),
});

export const draftOrderLineItemSchema = z.object({
	sku: z.string().nullable().optional(),
	variantId: z.string().nullable().optional(),
	title: z.string().nullable().optional(),
	quantity: z.number(),
	unitPrice: z.number().nullable().optional(),
	currencyCode: z.string().nullable().optional(),
	discount: draftLineDiscountSchema.nullable().optional(),
	source: z.string().nullable().optional(),
});

export type DraftOrderLineItemInput = z.input<typeof draftOrderLineItemSchema>;

export const locationAddressSchema = z.object({
	address1: z.string().nullable(),
	address2: z.string().nullable().optional(),
	city: z.string().nullable(),
	province: z.string().nullable(),
	zip: z.string().nullable(),
	country: z.string().nullable(),
	countryCode: z.string().nullable().optional(),
	phone: z.string().nullable().optional(),
});

export const shopifyLocationSchema = z.object({
	id: z.string(),
	name: z.string(),
	companyId: z.string(),
	companyName: z.string(),
	shippingAddress: locationAddressSchema.nullable(),
	billingAddress: locationAddressSchema.extend({
		recipient: z.string().nullable().optional(),
		companyName: z.string().nullable().optional(),
	}).nullable(),
	paymentTermsTemplateId: z.string().nullable(),
	buyerEmailDomains: z.array(z.string()),
});

export type ShopifyLocationSummary = z.infer<typeof shopifyLocationSchema>;
