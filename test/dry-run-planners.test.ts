import { describe, expect, it } from 'vitest';
import { planCustomerAction } from '../src/inner-tools/dry-run/customer-action-planner.js';
import { planDraftOrder } from '../src/inner-tools/dry-run/draft-order-planner.js';
import { planLocationUpdates } from '../src/inner-tools/dry-run/location-update-planner.js';
import type { ExtractedPOInput } from '../src/lib/po/schemas.js';

function basePO(overrides: Partial<ExtractedPOInput> = {}): ExtractedPOInput {
	return {
		purchase_order_number: 'PO-1001',
		buyer_email: 'buyer@example.com',
		secondary_buyer_email: null,
		buyer_first_name: 'Buyer',
		buyer_last_name: 'Person',
		secondary_buyer_first_name: null,
		secondary_buyer_last_name: null,
		ship_to_address: '100 Main St, Austin, TX 78701',
		ship_to_facility_name: 'Main Hospital',
		ship_to_phone: null,
		reason_for_ship_to_address: '',
		bill_to_address: '100 Main St, Austin, TX 78701',
		bill_to_phone: null,
		payment_terms: 'Net 30',
		shipping_and_delivery_reasoning: '',
		expected_delivery_date: null,
		requested_delivery_time: null,
		requested_shipping_method: 'FedEx 2Day',
		total_price: 20,
		Tax: 0,
		line_items: {
			line_items_array: [
				{ SKU: 'SYL-WC-32-010', quantity: 2, unit_price: 10, line_total: 20 },
			],
		},
		care_of: null,
		accounts_payable_email: null,
		invoice_submission_email: null,
		po_created_date: null,
		GLN_shipping: null,
		GLN_billing: null,
		currency: 'USD',
		acknowledge_link: false,
		is_revised_po: false,
		is_bill_only: false,
		document_flag_reason: null,
		confidence: 0.9,
		document_readable: true,
		reorder_requested: false,
		reorder_notes: null,
		...overrides,
	};
}

describe('dry-run Shopify planners', () => {
	it('builds a draft order plan without mutating Shopify', () => {
		const plan = planDraftOrder({
			po: basePO(),
			locationId: 'gid://shopify/CompanyLocation/1',
		});

		expect(plan).toMatchObject({
			mock: true,
			wouldCreate: true,
			wouldMutateShopify: false,
			draftOrderName: 'DRY-RUN-PO-1001',
			warnings: [],
		});
		expect(plan.shopifyInputShape.lineItems).toEqual([{
			title: 'SYL-WC-32-010',
			quantity: 2,
			originalUnitPriceWithCurrency: {
				amount: '10.00',
				currencyCode: 'USD',
			},
		}]);
	});

	it('returns review warnings instead of writing bad draft lines', () => {
		const plan = planDraftOrder({
			po: basePO({ line_items: { line_items_array: [] } }),
			locationId: 'gid://shopify/CompanyLocation/1',
			lineItems: [{ quantity: 0 }],
		});

		expect(plan.wouldMutateShopify).toBe(false);
		expect(plan.warnings).toEqual([
			'Line 1 has neither variantId nor title.',
			'Line 1 has an invalid quantity.',
		]);
	});

	it('keeps customer and location update actions as local plans', () => {
		expect(planCustomerAction({
			action: 'create_customer',
			customerEmail: 'buyer@example.com',
			reason: 'New buyer on PO',
		})).toMatchObject({
			mock: true,
			wouldMutateShopify: false,
			action: 'create_customer',
		});

		expect(planLocationUpdates({
			locationId: 'gid://shopify/CompanyLocation/1',
			apEmail: 'ap@example.com',
			reason: 'PO lists AP email',
		})).toMatchObject({
			mock: true,
			wouldMutateShopify: false,
			updates: [{ field: 'accounts_payable_email', value: 'ap@example.com' }],
		});
	});
});
