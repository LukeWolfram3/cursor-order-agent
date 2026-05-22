import type { ShopifyEnv } from '../../types.js';
import { log } from '../../lib/log.js';

export interface ShopifyGraphQLInput<TVariables extends Record<string, unknown>> {
	readonly env: ShopifyEnv;
	readonly query: string;
	readonly variables: TVariables;
}

interface ShopifyGraphQLWireResponse<TData> {
	readonly data?: TData;
	readonly errors?: ReadonlyArray<{ readonly message: string }>;
}

function normalizeStoreDomain(domain: string): string {
	return domain
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.trim();
}

export async function shopifyGraphQL<TData, TVariables extends Record<string, unknown>>(
	input: ShopifyGraphQLInput<TVariables>,
): Promise<TData> {
	const storeDomain = normalizeStoreDomain(input.env.SHOPIFY_STORE_DOMAIN);
	const accessToken = input.env.SHOPIFY_KEY ?? input.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
	if (!accessToken) {
		throw new Error('SHOPIFY_KEY or SHOPIFY_ADMIN_ACCESS_TOKEN is not configured');
	}

	const startedAt = Date.now();
	const response = await fetch(
		`https://${storeDomain}/admin/api/${input.env.SHOPIFY_API_VERSION}/graphql.json`,
		{
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-shopify-access-token': accessToken,
			},
			body: JSON.stringify({
				query: input.query,
				variables: input.variables,
			}),
		},
	);

	if (!response.ok) {
		const body = await response.text();
		log('error', 'fetch.failed', {
			target: 'shopify.graphql',
			status: response.status,
			latencyMs: Date.now() - startedAt,
			bodyExcerpt: body.slice(0, 500),
		});
		throw new Error(`Shopify GraphQL HTTP ${response.status}: ${body}`);
	}

	const payload = await response.json() as ShopifyGraphQLWireResponse<TData>;
	if (payload.errors?.length) {
		throw new Error(`Shopify GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
	}
	if (!payload.data) {
		throw new Error('Shopify GraphQL response did not include data.');
	}

	return payload.data;
}

export function shopifyAdminUrl(env: ShopifyEnv, gid: string): string {
	const storeSlug = normalizeStoreDomain(env.SHOPIFY_STORE_DOMAIN)
		.replace('.myshopify.com', '')
		.split('.')[0];
	const id = gid.split('/').pop() ?? gid;
	return `https://admin.shopify.com/store/${storeSlug}/${id}`;
}
