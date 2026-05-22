import type { ShopifyEnv } from '../../types.js';
import { shopifyGraphQL } from './client.js';

const VARIANTS_BY_SKU_QUERY = `
	query AgentPOVariantsBySKU($query: String!) {
		productVariants(first: 50, query: $query) {
			edges {
				node {
					id
					sku
					inventoryQuantity
					price
					product { title }
				}
			}
		}
	}
`;

interface VariantsResponse {
	readonly productVariants: {
		readonly edges: ReadonlyArray<{
			readonly node: {
				readonly id: string;
				readonly sku: string | null;
				readonly inventoryQuantity: number | null;
				readonly price: string | null;
				readonly product?: { readonly title?: string | null } | null;
			};
		}>;
	};
}

export interface VariantLookupInput {
	readonly env: ShopifyEnv;
	readonly items: ReadonlyArray<{ readonly sku: string; readonly quantity?: number | null }>;
}

export async function lookupVariants(input: VariantLookupInput) {
	const skus = Array.from(new Set(input.items.map((item) => item.sku.trim()).filter(Boolean)));
	if (skus.length === 0) return { variants: [], missingSkus: [], outOfStockSkus: [] };
	const requestedQuantityBySku = new Map(
		input.items.map((item) => [item.sku.trim(), item.quantity ?? null]),
	);

	const data: VariantsResponse = await shopifyGraphQL({
		env: input.env,
		query: VARIANTS_BY_SKU_QUERY,
		variables: { query: skus.map((sku) => `sku:${sku}`).join(' OR ') },
	});

	const variants = data.productVariants.edges.flatMap((edge) => {
		const variant = edge.node;
		if (!variant.sku) return [];
		const requested = requestedQuantityBySku.get(variant.sku.trim()) ?? null;
		return [{
			sku: variant.sku,
			variantId: variant.id,
			productTitle: variant.product?.title ?? variant.sku,
			price: variant.price ?? null,
			inventoryQuantity: variant.inventoryQuantity ?? 0,
			quantityRequested: requested,
			outOfStock: (variant.inventoryQuantity ?? 0) <= 0,
		}];
	});

	const foundSkus = new Set(variants.map((variant) => variant.sku));
	return {
		variants,
		missingSkus: skus.filter((sku) => !foundSkus.has(sku)),
		outOfStockSkus: variants.filter((variant) => variant.outOfStock),
	};
}
