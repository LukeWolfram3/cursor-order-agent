import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyEnv } from '../src/types.js';

vi.mock('../src/inner-tools/shopify/client.js', () => ({
	shopifyGraphQL: vi.fn(),
}));

import { shopifyGraphQL } from '../src/inner-tools/shopify/client.js';
import { getCatalogContext } from '../src/inner-tools/shopify/catalogs.js';

const shopifyGraphQLMock = vi.mocked(shopifyGraphQL);
const env = {} as ShopifyEnv;

describe('getCatalogContext', () => {
	beforeEach(() => {
		shopifyGraphQLMock.mockReset();
	});

	it('dedupes company catalogs and flags conflicting direct assignments', async () => {
		shopifyGraphQLMock
			.mockResolvedValueOnce({
				companyLocation: {
					id: 'loc-1',
					name: 'North Hospital',
					catalogs: {
						nodes: [
							{ id: 'catalog-tier', title: 'T1' },
							{ id: 'catalog-sku', title: 'SYL-WC-32-010 $10/BX' },
						],
					},
					company: { id: 'company-1', name: 'North Company', note: 'location note' },
				},
				company: {
					id: 'company-1',
					name: 'North Company',
					note: null,
					locations: {
						edges: [
							{ node: { id: 'loc-1', name: 'North Hospital', catalogs: { nodes: [{ id: 'catalog-tier', title: 'T1' }] } } },
							{ node: { id: 'loc-2', name: 'South Hospital', catalogs: { nodes: [{ id: 'catalog-tier', title: 'T1' }] } } },
						],
					},
				},
			})
			.mockResolvedValueOnce({
				productVariants: {
					edges: [{
						node: {
							id: 'variant-1',
							sku: 'SYL-WC-32-010',
							price: '12.00',
							contextualPricing: { price: { amount: '10.00', currencyCode: 'USD' } },
							product: { title: 'SYLKE 32' },
						},
					}],
				},
			})
			.mockResolvedValueOnce({
				catalogs: { nodes: [{ id: 'catalog-global', title: 'Global Catalog' }] },
			});

		const result = await getCatalogContext({
			env,
			locationId: 'loc-1',
			companyId: 'company-1',
			skus: ['SYL-WC-32-010', 'SYL-WC-32-010', ' '],
			includeAllCatalogs: true,
		});

		expect(result.company).toEqual({
			id: 'company-1',
			name: 'North Company',
			note: 'location note',
		});
		expect(result.companyCatalogs).toEqual([{ id: 'catalog-tier', title: 'T1' }]);
		expect(result.catalogDecisionHints.directCatalogIssues).toEqual([
			'Global tier and SKU-specific catalogs are both assigned.',
		]);
		expect(result.variantPrices).toEqual([{
			sku: 'SYL-WC-32-010',
			variantId: 'variant-1',
			productTitle: 'SYLKE 32',
			basePrice: '12.00',
			contextualPrice: '10.00',
			currencyCode: 'USD',
		}]);
		expect(result.allCatalogs).toEqual([{ id: 'catalog-global', title: 'Global Catalog' }]);
		expect(shopifyGraphQLMock.mock.calls[1]?.[0].variables).toEqual({
			query: 'sku:SYL-WC-32-010',
			context: { companyLocationId: 'loc-1' },
		});
	});
});
