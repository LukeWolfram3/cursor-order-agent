import type { ShopifyEnv } from '../../types.js';
import { shopifyGraphQL } from './client.js';

const CATALOG_CONTEXT_QUERY = `
	query AgentPOCatalogContext($locationId: ID!, $companyId: ID!) {
		companyLocation(id: $locationId) {
			id
			name
			catalogs(first: 250) {
				nodes { id title }
			}
			company { id name note }
		}
		company(id: $companyId) {
			id
			name
			note
			locations(first: 250) {
				edges {
					node {
						id
						name
						catalogs(first: 250) { nodes { id title } }
					}
				}
			}
		}
	}
`;

const CONTEXTUAL_VARIANT_PRICES_QUERY = `
	query AgentPOContextualVariantPrices($query: String!, $context: ContextualPricingContext!) {
		productVariants(first: 50, query: $query) {
			edges {
				node {
					id
					sku
					price
					contextualPricing(context: $context) {
						price { amount currencyCode }
					}
					product { title }
				}
			}
		}
	}
`;

const LIST_CATALOGS_QUERY = `
	query AgentPOListCatalogs($first: Int!) {
		catalogs(first: $first) {
			nodes { id title }
		}
	}
`;

interface CatalogItem {
	readonly id: string;
	readonly title: string;
}

interface CatalogContextResponse {
	readonly companyLocation: {
		readonly id: string;
		readonly name: string;
		readonly catalogs: { readonly nodes: readonly CatalogItem[] };
		readonly company: { readonly id: string; readonly name: string; readonly note?: string | null } | null;
	} | null;
	readonly company: {
		readonly id: string;
		readonly name: string;
		readonly note?: string | null;
		readonly locations: {
			readonly edges: ReadonlyArray<{
				readonly node: {
					readonly id: string;
					readonly name: string;
					readonly catalogs: { readonly nodes: readonly CatalogItem[] };
				};
			}>;
		};
	} | null;
}

interface VariantPricesResponse {
	readonly productVariants: {
		readonly edges: ReadonlyArray<{
			readonly node: {
				readonly id: string;
				readonly sku: string | null;
				readonly price: string | null;
				readonly contextualPricing?: {
					readonly price?: { readonly amount?: string | null; readonly currencyCode?: string | null } | null;
				} | null;
				readonly product?: { readonly title?: string | null } | null;
			};
		}>;
	};
}

interface ListCatalogsResponse {
	readonly catalogs: { readonly nodes: readonly CatalogItem[] };
}

export interface CatalogContextInput {
	readonly env: ShopifyEnv;
	readonly locationId: string;
	readonly companyId: string;
	readonly skus?: readonly string[];
	readonly includeAllCatalogs?: boolean;
}

function uniqueCatalogs(catalogs: readonly CatalogItem[]): CatalogItem[] {
	const byId = new Map<string, CatalogItem>();
	for (const catalog of catalogs) byId.set(catalog.id, catalog);
	return Array.from(byId.values());
}

function buildSkuQuery(skus: readonly string[]): string {
	return skus.map((sku) => `sku:${sku}`).join(' OR ');
}

function classifyCatalog(title: string): 'global_tier' | 'sku_specific' | 'other' {
	const normalized = title.trim();
	if (/^(T[1-5]|T[1-4]F|Premier T[1-3]|OUS D[12]|SYLKE®?|Volume-Based Pricing T[1-5])$/i.test(normalized)) {
		return 'global_tier';
	}
	if (/SYL-WC-\d{2}-\d{3}|SYL-WC-\d{2}/i.test(normalized) || /\$\d+.*\/(BX|unit)/i.test(normalized)) {
		return 'sku_specific';
	}
	return 'other';
}

function detectCatalogIssues(catalogs: readonly CatalogItem[]) {
	const classified = catalogs.map((catalog) => ({
		...catalog,
		kind: classifyCatalog(catalog.title),
	}));
	const globalTierCatalogs = classified.filter((catalog) => catalog.kind === 'global_tier');
	const skuSpecificCatalogs = classified.filter((catalog) => catalog.kind === 'sku_specific');
	const issues: string[] = [];

	if (globalTierCatalogs.length > 1) {
		issues.push(`Multiple global tier catalogs assigned: ${globalTierCatalogs.map((catalog) => catalog.title).join(', ')}`);
	}
	if (globalTierCatalogs.length > 0 && skuSpecificCatalogs.length > 0) {
		issues.push('Global tier and SKU-specific catalogs are both assigned.');
	}

	return { classified, issues };
}

async function fetchContextualVariantPrices(input: {
	readonly env: ShopifyEnv;
	readonly locationId: string;
	readonly skus: readonly string[];
}) {
	const skus = Array.from(new Set(input.skus.map((sku) => sku.trim()).filter(Boolean)));
	if (skus.length === 0) return [];

	const data: VariantPricesResponse = await shopifyGraphQL({
		env: input.env,
		query: CONTEXTUAL_VARIANT_PRICES_QUERY,
		variables: {
			query: buildSkuQuery(skus),
			context: { companyLocationId: input.locationId },
		},
	});

	return data.productVariants.edges.flatMap((edge) => {
		const variant = edge.node;
		if (!variant.sku) return [];
		return [{
			sku: variant.sku,
			variantId: variant.id,
			productTitle: variant.product?.title ?? variant.sku,
			basePrice: variant.price ?? null,
			contextualPrice: variant.contextualPricing?.price?.amount ?? variant.price ?? null,
			currencyCode: variant.contextualPricing?.price?.currencyCode ?? null,
		}];
	});
}

async function listAllCatalogs(env: ShopifyEnv): Promise<CatalogItem[]> {
	const data: ListCatalogsResponse = await shopifyGraphQL({
		env,
		query: LIST_CATALOGS_QUERY,
		variables: { first: 250 },
	});
	return [...data.catalogs.nodes];
}

export async function getCatalogContext(input: CatalogContextInput) {
	const context: CatalogContextResponse = await shopifyGraphQL({
		env: input.env,
		query: CATALOG_CONTEXT_QUERY,
		variables: {
			locationId: input.locationId,
			companyId: input.companyId,
		},
	});

	const directLocationCatalogs = [...(context.companyLocation?.catalogs.nodes ?? [])];
	const companyCatalogs = uniqueCatalogs(
		context.company?.locations.edges.flatMap((edge) => edge.node.catalogs.nodes) ?? [],
	);
	const directIssues = detectCatalogIssues(directLocationCatalogs);
	const companyIssues = detectCatalogIssues(companyCatalogs);

	const [variantPrices, allCatalogs] = await Promise.all([
		fetchContextualVariantPrices({
			env: input.env,
			locationId: input.locationId,
			skus: input.skus ?? [],
		}),
		input.includeAllCatalogs ? listAllCatalogs(input.env) : Promise.resolve([]),
	]);

	return {
		location: context.companyLocation
			? {
				id: context.companyLocation.id,
				name: context.companyLocation.name,
			}
			: null,
		company: context.company
			? {
				id: context.company.id,
				name: context.company.name,
				note: context.company.note ?? context.companyLocation?.company?.note ?? null,
			}
			: context.companyLocation?.company ?? null,
		directLocationCatalogs,
		companyCatalogs,
		allCatalogs,
		variantPrices,
		catalogDecisionHints: {
			directAssignmentCount: directLocationCatalogs.length,
			companyCatalogUnionCount: companyCatalogs.length,
			directCatalogIssues: directIssues.issues,
			companyCatalogIssues: companyIssues.issues,
			directCatalogClassifications: directIssues.classified,
			companyCatalogClassifications: companyIssues.classified,
		},
	};
}
