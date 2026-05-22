import type { ShopifyEnv } from '../../types.js';
import { shopifyGraphQL } from './client.js';

const DUPLICATE_GLOBAL_QUERY = `
	query AgentPODuplicateGlobalCheck($orderQuery: String!, $draftQuery: String!) {
		searchOrders: orders(first: 10, query: $orderQuery, reverse: true, sortKey: CREATED_AT) {
			edges {
				node {
					id
					name
					poNumber
					note
					createdAt
					displayFinancialStatus
					cancelledAt
					purchasingEntity { ... on PurchasingCompany { location { id name } } }
					shippingAddress { name company address1 city provinceCode zip }
				}
			}
		}
		searchDrafts: draftOrders(first: 50, query: $draftQuery, reverse: true, sortKey: UPDATED_AT) {
			edges {
				node {
					id
					name
					poNumber
					note2
					createdAt
					order { id name createdAt displayFinancialStatus cancelledAt }
					purchasingEntity { ... on PurchasingCompany { location { id name } } }
					shippingAddress { name company address1 city provinceCode zip }
				}
			}
		}
	}
`;

const DUPLICATE_LOCATION_QUERY = `
	query AgentPODuplicateLocationCheck($locationId: ID!, $draftQuery: String!) {
		companyLocation(id: $locationId) {
			id
			name
			orders(first: 50, reverse: true, sortKey: CREATED_AT) {
				edges {
					node {
						id
						name
						poNumber
						createdAt
						lineItems(first: 50) { edges { node { sku quantity } } }
					}
				}
			}
			draftOrders(first: 50, query: $draftQuery, reverse: true, sortKey: UPDATED_AT) {
				edges {
					node {
						id
						name
						poNumber
						createdAt
						lineItems(first: 50) { edges { node { sku quantity } } }
					}
				}
			}
		}
	}
`;

type DuplicateNode = {
	readonly id: string;
	readonly name: string;
	readonly poNumber?: string | null;
	readonly note?: string | null;
	readonly note2?: string | null;
	readonly createdAt?: string | null;
	readonly displayFinancialStatus?: string | null;
	readonly cancelledAt?: string | null;
	readonly order?: { readonly id: string; readonly name: string; readonly createdAt?: string | null } | null;
	readonly purchasingEntity?: { readonly location?: { readonly id: string; readonly name: string } | null } | null;
	readonly lineItems?: {
		readonly edges?: ReadonlyArray<{ readonly node: { readonly sku?: string | null; readonly quantity?: number | null } }>;
	} | null;
};

interface DuplicateGlobalResponse {
	readonly searchOrders: { readonly edges: ReadonlyArray<{ readonly node: DuplicateNode }> };
	readonly searchDrafts: { readonly edges: ReadonlyArray<{ readonly node: DuplicateNode }> };
}

interface DuplicateLocationResponse {
	readonly companyLocation: {
		readonly id: string;
		readonly name: string;
		readonly orders: { readonly edges: ReadonlyArray<{ readonly node: DuplicateNode }> };
		readonly draftOrders: { readonly edges: ReadonlyArray<{ readonly node: DuplicateNode }> };
	} | null;
}

export interface CheckDuplicatePOInput {
	readonly env: ShopifyEnv;
	readonly poNumber: string;
	readonly locationId?: string | null;
	readonly lineItems?: ReadonlyArray<{ readonly sku: string; readonly quantity: number }>;
}

function normalizePO(value?: string | null): string {
	return (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/^#\s*/, '')
		.replace(/^po(?:#|\s)+/i, '')
		.replace(/\s*\(revised po required\)\s*$/i, '');
}

function lineItemSignature(lineItems?: ReadonlyArray<{ readonly sku?: string | null; readonly quantity?: number | null }>): string {
	return (lineItems ?? [])
		.filter((item) => item.sku)
		.map((item) => `${item.sku}:${item.quantity ?? 0}`)
		.sort()
		.join('|');
}

function extractLineItems(node: DuplicateNode) {
	return node.lineItems?.edges?.map((edge) => ({
		sku: edge.node.sku ?? null,
		quantity: edge.node.quantity ?? null,
	})) ?? [];
}

function mapMatch(node: DuplicateNode, type: 'order' | 'draft_order') {
	return {
		type,
		id: node.id,
		name: node.name,
		poNumber: node.poNumber ?? null,
		createdAt: node.createdAt ?? node.order?.createdAt ?? null,
		locationId: node.purchasingEntity?.location?.id ?? null,
		locationName: node.purchasingEntity?.location?.name ?? null,
		cancelledAt: node.cancelledAt ?? null,
		parentOrder: node.order ?? null,
		lineItems: extractLineItems(node),
	};
}

export async function checkDuplicatePO(input: CheckDuplicatePOInput) {
	const searchPO = input.poNumber.replace(/"/g, '\\"');
	const normalized = normalizePO(input.poNumber);
	const globalData: DuplicateGlobalResponse = await shopifyGraphQL({
		env: input.env,
		query: DUPLICATE_GLOBAL_QUERY,
		variables: {
			orderQuery: `po_number:"${searchPO}" OR "${searchPO}"`,
			draftQuery: `"${searchPO}"`,
		},
	});

	const globalMatches = [
		...globalData.searchOrders.edges.map((edge) => mapMatch(edge.node, 'order' as const)),
		...globalData.searchDrafts.edges.map((edge) => mapMatch(edge.node, 'draft_order' as const)),
	];
	const strictGlobal = globalMatches.filter((match) => normalizePO(match.poNumber) === normalized);

	let locationMatches: ReturnType<typeof mapMatch>[] = [];
	if (input.locationId) {
		const locationData: DuplicateLocationResponse = await shopifyGraphQL({
			env: input.env,
			query: DUPLICATE_LOCATION_QUERY,
			variables: { locationId: input.locationId, draftQuery: `"${searchPO}"` },
		});
		locationMatches = [
			...(locationData.companyLocation?.orders.edges.map((edge) => mapMatch(edge.node, 'order' as const)) ?? []),
			...(locationData.companyLocation?.draftOrders.edges.map((edge) => mapMatch(edge.node, 'draft_order' as const)) ?? []),
		];
	}

	const requestedSignature = lineItemSignature(input.lineItems);
	const fuzzy = requestedSignature
		? locationMatches.filter((match) =>
			normalizePO(match.poNumber) !== normalized
			&& lineItemSignature(match.lineItems) === requestedSignature)
		: [];

	return {
		poNumber: input.poNumber,
		normalizedPoNumber: normalized,
		strictDuplicate: strictGlobal[0] ?? null,
		strictMatches: strictGlobal,
		fuzzyMatches: fuzzy,
	};
}
