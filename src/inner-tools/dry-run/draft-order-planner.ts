import type { DraftOrderLineItemInput, ExtractedPOInput } from '../../lib/po/schemas.js';

export interface PlanDraftOrderInput {
	readonly po: ExtractedPOInput;
	readonly locationId: string;
	readonly companyContactId?: string | null;
	readonly customerId?: string | null;
	readonly shippingMethod?: string | null;
	readonly lineItems?: ReadonlyArray<DraftOrderLineItemInput>;
	readonly currencyCode?: string | null;
	readonly notes?: string | null;
}

interface PlannedDraftLineItem {
	readonly sku: string | null;
	readonly variantId: string | null;
	readonly title: string | null;
	readonly quantity: number;
	readonly originalUnitPriceWithCurrency: {
		readonly amount: string;
		readonly currencyCode: string;
	} | null;
	readonly appliedDiscount: {
		readonly value: number;
		readonly valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';
		readonly title: string;
		readonly description: string;
	} | null;
	readonly source: string | null;
}

function moneyAmount(value: number | null | undefined): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return value.toFixed(2);
}

function normalizeCurrency(input: PlanDraftOrderInput): string {
	return (input.currencyCode ?? input.po.currency ?? 'USD').toUpperCase();
}

function toDiscount(discount: DraftOrderLineItemInput['discount']): PlannedDraftLineItem['appliedDiscount'] {
	if (!discount) return null;
	const label = discount.title ?? discount.reason ?? 'Line item discount';
	return {
		value: discount.value,
		valueType: discount.type === 'percentage' ? 'PERCENTAGE' : 'FIXED_AMOUNT',
		title: label,
		description: discount.description ?? discount.reason ?? label,
	};
}

function fallbackLinesFromPO(input: PlanDraftOrderInput): DraftOrderLineItemInput[] {
	return input.po.line_items.line_items_array
		.filter((item) => item.SKU && item.quantity)
		.map((item) => ({
			sku: item.SKU,
			title: item.SKU,
			quantity: item.quantity ?? 0,
			unitPrice: item.unit_price,
			source: 'extracted_po',
		}));
}

function toPlannedLineItems(input: PlanDraftOrderInput): PlannedDraftLineItem[] {
	const currencyCode = normalizeCurrency(input);
	const lines = input.lineItems?.length ? input.lineItems : fallbackLinesFromPO(input);

	return lines.map((item) => {
		const amount = moneyAmount(item.unitPrice);
		return {
			sku: item.sku ?? null,
			variantId: item.variantId ?? null,
			title: item.title ?? item.sku ?? null,
			quantity: item.quantity,
			originalUnitPriceWithCurrency: amount
				? { amount, currencyCode: item.currencyCode?.toUpperCase() ?? currencyCode }
				: null,
			appliedDiscount: toDiscount(item.discount),
			source: item.source ?? null,
		};
	});
}

function buildWarnings(lineItems: ReadonlyArray<PlannedDraftLineItem>): string[] {
	const warnings: string[] = [];
	if (lineItems.length === 0) warnings.push('No valid line items were provided.');
	lineItems.forEach((item, index) => {
		if (!item.variantId && !item.title) {
			warnings.push(`Line ${index + 1} has neither variantId nor title.`);
		}
		if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
			warnings.push(`Line ${index + 1} has an invalid quantity.`);
		}
		if (item.appliedDiscount && item.appliedDiscount.value < 0) {
			warnings.push(`Line ${index + 1} has a negative discount value.`);
		}
	});
	return warnings;
}

export function planDraftOrder(input: PlanDraftOrderInput) {
	const lineItems = toPlannedLineItems(input);

	return {
		mock: true,
		wouldCreate: true,
		wouldMutateShopify: false,
		draftOrderName: `DRY-RUN-${input.po.purchase_order_number ?? crypto.randomUUID().slice(0, 8)}`,
		plannedInput: {
			poNumber: input.po.purchase_order_number,
			locationId: input.locationId,
			companyContactId: input.companyContactId ?? null,
			customerId: input.customerId ?? null,
			email: input.po.buyer_email,
			shippingAddress: input.po.ship_to_address,
			billingAddress: input.po.bill_to_address,
			paymentTerms: input.po.payment_terms,
			shippingMethod: input.shippingMethod ?? input.po.requested_shipping_method,
			lineItems,
			notes: input.notes ?? null,
		},
		shopifyInputShape: {
			lineItems: lineItems.map((item) => ({
				...(item.variantId ? { variantId: item.variantId } : {}),
				...(!item.variantId && item.title ? { title: item.title } : {}),
				quantity: item.quantity,
				...(item.originalUnitPriceWithCurrency
					? { originalUnitPriceWithCurrency: item.originalUnitPriceWithCurrency }
					: {}),
				...(item.appliedDiscount ? { appliedDiscount: item.appliedDiscount } : {}),
			})),
		},
		warnings: buildWarnings(lineItems),
	};
}
