import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyEnv } from '../src/types.js';

vi.mock('../src/inner-tools/shopify/client.js', () => ({
	shopifyGraphQL: vi.fn(),
}));

import { shopifyGraphQL } from '../src/inner-tools/shopify/client.js';
import { lookupVariants } from '../src/inner-tools/shopify/variants.js';

const shopifyGraphQLMock = vi.mocked(shopifyGraphQL);
const env = {
	SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
	SHOPIFY_API_VERSION: '2026-01',
} as ShopifyEnv;

describe('lookupVariants', () => {
	beforeEach(() => {
		shopifyGraphQLMock.mockReset();
	});

	it('dedupes trimmed SKUs and preserves requested quantities', async () => {
		shopifyGraphQLMock.mockResolvedValueOnce({
			productVariants: {
				edges: [
					{
						node: {
							id: 'variant-1',
							sku: 'SYL-WC-32-010',
							inventoryQuantity: 5,
							price: '10.00',
							product: { title: 'SYLKE 32' },
						},
					},
					{
						node: {
							id: 'variant-2',
							sku: 'SYL-WC-24-010',
							inventoryQuantity: 0,
							price: '8.00',
							product: null,
						},
					},
				],
			},
		});

		const result = await lookupVariants({
			env,
			items: [
				{ sku: ' SYL-WC-32-010 ', quantity: 2 },
				{ sku: 'SYL-WC-32-010', quantity: 2 },
				{ sku: 'SYL-WC-24-010', quantity: 1 },
				{ sku: 'SYL-WC-16-010', quantity: 3 },
			],
		});

		expect(shopifyGraphQLMock).toHaveBeenCalledWith(expect.objectContaining({
			variables: { query: 'sku:SYL-WC-32-010 OR sku:SYL-WC-24-010 OR sku:SYL-WC-16-010' },
		}));
		expect(result.variants).toEqual([
			expect.objectContaining({
				sku: 'SYL-WC-32-010',
				quantityRequested: 2,
				outOfStock: false,
			}),
			expect.objectContaining({
				sku: 'SYL-WC-24-010',
				productTitle: 'SYL-WC-24-010',
				quantityRequested: 1,
				outOfStock: true,
			}),
		]);
		expect(result.missingSkus).toEqual(['SYL-WC-16-010']);
		expect(result.outOfStockSkus).toEqual([expect.objectContaining({ sku: 'SYL-WC-24-010' })]);
	});

	it('short-circuits empty SKU input without calling Shopify', async () => {
		await expect(lookupVariants({
			env,
			items: [{ sku: '   ', quantity: 1 }],
		})).resolves.toEqual({ variants: [], missingSkus: [], outOfStockSkus: [] });

		expect(shopifyGraphQLMock).not.toHaveBeenCalled();
	});
});
