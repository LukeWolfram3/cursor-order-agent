import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyEnv } from '../src/types.js';
import { shopifyAdminUrl, shopifyGraphQL } from '../src/inner-tools/shopify/client.js';

const env = {
	SHOPIFY_STORE_DOMAIN: 'https://example.myshopify.com/admin',
	SHOPIFY_API_VERSION: '2026-01',
	SHOPIFY_ADMIN_ACCESS_TOKEN: 'token-1',
} as ShopifyEnv;

describe('shopifyGraphQL', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('normalizes store domain and sends a token-authenticated POST', async () => {
		const fetchMock = vi.fn(async () => Response.json({ data: { ok: true } }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(shopifyGraphQL({
			env,
			query: 'query Test { shop { name } }',
			variables: { first: 1 },
		})).resolves.toEqual({ ok: true });

		expect(fetchMock).toHaveBeenCalledWith(
			'https://example.myshopify.com/admin/api/2026-01/graphql.json',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-shopify-access-token': 'token-1',
				},
				body: JSON.stringify({
					query: 'query Test { shop { name } }',
					variables: { first: 1 },
				}),
			}),
		);
	});

	it('fails before fetch when no Shopify token is configured', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(shopifyGraphQL({
			env: { ...env, SHOPIFY_ADMIN_ACCESS_TOKEN: undefined, SHOPIFY_KEY: undefined },
			query: 'query Test { shop { name } }',
			variables: {},
		})).rejects.toThrow('SHOPIFY_KEY or SHOPIFY_ADMIN_ACCESS_TOKEN is not configured');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('turns HTTP, GraphQL, and empty-data responses into errors', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));
		await expect(shopifyGraphQL({ env, query: 'query Test { shop { name } }', variables: {} }))
			.rejects.toThrow('Shopify GraphQL HTTP 502: bad gateway');

		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ errors: [{ message: 'denied' }] })));
		await expect(shopifyGraphQL({ env, query: 'query Test { shop { name } }', variables: {} }))
			.rejects.toThrow('Shopify GraphQL error: denied');

		vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
		await expect(shopifyGraphQL({ env, query: 'query Test { shop { name } }', variables: {} }))
			.rejects.toThrow('Shopify GraphQL response did not include data.');
	});
});

describe('shopifyAdminUrl', () => {
	it('builds admin URLs from Shopify GIDs', () => {
		expect(shopifyAdminUrl(env, 'gid://shopify/DraftOrder/12345'))
			.toBe('https://admin.shopify.com/store/example/12345');
	});
});
