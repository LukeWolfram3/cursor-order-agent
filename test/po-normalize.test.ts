import { describe, expect, it } from 'vitest';
import { normalizeExtractedPO } from '../src/lib/po/normalize.js';

describe('normalizeExtractedPO', () => {
	it('cleans common extractor drift before schema validation', () => {
		const raw = {
			GLN_shipping: 'GLN',
			GLN_billing: 'abc-123',
			payment_terms: 'Due on receipt',
			requested_shipping_method: 'Ground',
			reason_for_ship_to_address: null,
			shipping_and_delivery_reasoning: null,
			currency: null,
			confidence: null,
			line_items: {
				line_items_array: [
					{ SKU: 'SYL-WC-32-10', quantity: 2, unit_price: 10, line_total: 20 },
					{ SKU: 'NOT-A-SKU', quantity: 1, unit_price: 5, line_total: 5 },
				],
			},
		};

		const normalized = normalizeExtractedPO(raw);

		expect(normalized).not.toBe(raw);
		expect(normalized.GLN_shipping).toBeNull();
		expect(normalized.GLN_billing).toBeNull();
		expect(normalized.payment_terms).toBeNull();
		expect(normalized.requested_shipping_method).toBeNull();
		expect(normalized.reason_for_ship_to_address).toBe('');
		expect(normalized.shipping_and_delivery_reasoning).toBe('');
		expect(normalized.currency).toBe('USD');
		expect(normalized.confidence).toBe(0);
		expect(normalized.line_items).toEqual({
			line_items_array: [
				{ SKU: 'SYL-WC-32-010', quantity: 2, unit_price: 10, line_total: 20 },
				{ SKU: null, quantity: 1, unit_price: 5, line_total: 5 },
			],
		});
	});

	it('supplies an empty line item array when extraction omits it', () => {
		const normalized = normalizeExtractedPO({});

		expect(normalized.line_items).toEqual({ line_items_array: [] });
	});
});
