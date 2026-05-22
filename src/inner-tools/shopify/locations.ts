import type { ShopifyEnv } from '../../types.js';
import type { ShopifyLocationSummary } from '../../lib/po/schemas.js';
import { log } from '../../lib/log.js';
import { shopifyGraphQL } from './client.js';

const COMPANY_LOCATIONS_QUERY = `
	query AgentPOCompanyLocations($cursor: String) {
		companyLocations(first: 250, after: $cursor) {
			edges {
				node {
					id
					name
					company { id name }
					shippingAddress { address1 address2 city province zip country countryCode phone }
					billingAddress { recipient companyName address1 address2 city province zip country countryCode phone }
					buyerExperienceConfiguration { paymentTermsTemplate { id } }
					roleAssignments(first: 10) {
						nodes {
							companyContact {
								customer {
									defaultEmailAddress { emailAddress }
								}
							}
						}
					}
				}
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

const LOCATION_DETAILS_QUERY = `
	query AgentPOLocationDetails($locationId: ID!, $cursor: String) {
		companyLocation(id: $locationId) {
			id
			name
			company { id name }
			shippingAddress { address1 address2 city province zip country countryCode phone }
			billingAddress { recipient companyName address1 address2 city province zip country countryCode phone }
			buyerExperienceConfiguration { paymentTermsTemplate { id } }
			roleAssignments(first: 250, after: $cursor) {
				edges {
					node {
						id
						companyContact {
							id
							customer { id firstName lastName defaultEmailAddress { emailAddress } }
						}
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
`;

type ShopifyAddressNode = {
	readonly recipient?: string | null;
	readonly companyName?: string | null;
	readonly address1?: string | null;
	readonly address2?: string | null;
	readonly city?: string | null;
	readonly province?: string | null;
	readonly zip?: string | null;
	readonly country?: string | null;
	readonly countryCode?: string | null;
	readonly phone?: string | null;
};

type CompanyLocationNode = {
	readonly id: string;
	readonly name: string;
	readonly company?: { readonly id: string; readonly name: string } | null;
	readonly shippingAddress?: ShopifyAddressNode | null;
	readonly billingAddress?: ShopifyAddressNode | null;
	readonly buyerExperienceConfiguration?: {
		readonly paymentTermsTemplate?: { readonly id?: string | null } | null;
	} | null;
	readonly roleAssignments?: {
		readonly nodes?: ReadonlyArray<{
			readonly companyContact?: {
				readonly customer?: {
					readonly defaultEmailAddress?: { readonly emailAddress?: string | null } | null;
				} | null;
			} | null;
		}>;
		readonly edges?: ReadonlyArray<{
			readonly node: {
				readonly id: string;
				readonly companyContact?: {
					readonly id: string;
					readonly customer?: {
						readonly id: string;
						readonly firstName?: string | null;
						readonly lastName?: string | null;
						readonly defaultEmailAddress?: { readonly emailAddress?: string | null } | null;
					} | null;
				} | null;
			};
		}>;
		readonly pageInfo?: { readonly hasNextPage: boolean; readonly endCursor: string | null };
	} | null;
};

type RoleAssignmentEdge = NonNullable<NonNullable<CompanyLocationNode['roleAssignments']>['edges']>[number];
type RoleAssignmentNode = NonNullable<NonNullable<CompanyLocationNode['roleAssignments']>['nodes']>[number];

interface CompanyLocationsResponse {
	readonly companyLocations: {
		readonly edges: ReadonlyArray<{ readonly node: CompanyLocationNode }>;
		readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
	};
}

interface LocationDetailsResponse {
	readonly companyLocation: CompanyLocationNode | null;
}

export interface LocationCandidateInput {
	readonly env: ShopifyEnv;
	readonly shipToAddress?: string | null;
	readonly facilityName?: string | null;
	readonly buyerEmail?: string | null;
	readonly zip?: string | null;
}

export interface LocationCandidates {
	readonly candidates: LocationMatcherCandidate[];
	readonly fuzzyTop3: ShopifyLocationSummary[];
	readonly zipPrefixMatches: ShopifyLocationSummary[];
	readonly domainMatches: ShopifyLocationSummary[];
	readonly totalLocationsScanned: number;
}

export interface LocationMatcherCandidate {
	readonly id: string;
	readonly name: string;
	readonly companyName: string;
	readonly shippingAddress: string;
	readonly billingAddress: string | null;
	readonly emailDomains: string[];
}

function emailDomain(email?: string | null): string | null {
	const domain = email?.split('@')[1]?.toLowerCase().trim();
	return domain || null;
}

function zipPrefix(zip?: string | null): string | null {
	const digits = zip?.replace(/\D/g, '').slice(0, 3);
	return digits && digits.length === 3 ? digits : null;
}

function normalize(value?: string | null): string {
	return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreLocation(input: LocationCandidateInput, location: ShopifyLocationSummary): number {
	const haystack = normalize([
		location.name,
		location.companyName,
		location.shippingAddress?.address1,
		location.shippingAddress?.city,
		location.shippingAddress?.province,
		location.shippingAddress?.zip,
	].filter(Boolean).join(' '));
	const needles = normalize([input.shipToAddress, input.facilityName].filter(Boolean).join(' '))
		.split(' ')
		.filter((part) => part.length >= 3);

	return needles.reduce((score, part) => score + (haystack.includes(part) ? 1 : 0), 0);
}

function mapLocation(node: CompanyLocationNode): ShopifyLocationSummary | null {
	if (!node.company) return null;
	if (node.name.toLowerCase().includes('(removed)') || node.name.toLowerCase().includes('sylke')) return null;

	const emails = node.roleAssignments?.nodes
		?.map((role) => role.companyContact?.customer?.defaultEmailAddress?.emailAddress ?? null)
		.filter((email): email is string => typeof email === 'string') ?? [];
	const domains = Array.from(new Set(emails.flatMap((email) => emailDomain(email) ?? []))).slice(0, 5);

	return {
		id: node.id,
		name: node.name,
		companyId: node.company.id,
		companyName: node.company.name,
		shippingAddress: node.shippingAddress
			? {
				address1: node.shippingAddress.address1 ?? null,
				address2: node.shippingAddress.address2 ?? null,
				city: node.shippingAddress.city ?? null,
				province: node.shippingAddress.province ?? null,
				zip: node.shippingAddress.zip ?? null,
				country: node.shippingAddress.country ?? null,
				countryCode: node.shippingAddress.countryCode ?? null,
				phone: node.shippingAddress.phone ?? null,
			}
			: null,
		billingAddress: node.billingAddress
			? {
				recipient: node.billingAddress.recipient ?? null,
				companyName: node.billingAddress.companyName ?? null,
				address1: node.billingAddress.address1 ?? null,
				address2: node.billingAddress.address2 ?? null,
				city: node.billingAddress.city ?? null,
				province: node.billingAddress.province ?? null,
				zip: node.billingAddress.zip ?? null,
				country: node.billingAddress.country ?? null,
				countryCode: node.billingAddress.countryCode ?? null,
				phone: node.billingAddress.phone ?? null,
			}
			: null,
		paymentTermsTemplateId: node.buyerExperienceConfiguration?.paymentTermsTemplate?.id ?? null,
		buyerEmailDomains: domains,
	};
}

function formatAddress(address?: ShopifyAddressNode | null): string | null {
	if (!address) {
		return null;
	}

	const line1 = [address.address1, address.address2].filter(Boolean).join(' ');
	const locality = [address.city, address.province, address.zip].filter(Boolean).join(', ');
	const country = address.countryCode ?? address.country;
	const formatted = [line1, locality, country].filter(Boolean).join(', ');
	return formatted || null;
}

function toMatcherCandidate(location: ShopifyLocationSummary): LocationMatcherCandidate | null {
	const shippingAddress = formatAddress(location.shippingAddress);
	if (!shippingAddress) {
		return null;
	}

	return {
		id: location.id,
		name: location.name,
		companyName: location.companyName,
		shippingAddress,
		billingAddress: formatAddress(location.billingAddress),
		emailDomains: location.buyerEmailDomains,
	};
}

function mergeCandidates(...groups: readonly ShopifyLocationSummary[][]): LocationMatcherCandidate[] {
	const byId = new Map<string, LocationMatcherCandidate>();

	for (const group of groups) {
		for (const location of group) {
			const candidate = toMatcherCandidate(location);
			if (candidate) {
				byId.set(candidate.id, candidate);
			}
		}
	}

	return Array.from(byId.values());
}

function roleAssignmentNodesFromEdges(edges: readonly RoleAssignmentEdge[]): RoleAssignmentNode[] {
	return edges.map((edge) => ({
		companyContact: {
			customer: {
				defaultEmailAddress: {
					emailAddress: edge.node.companyContact?.customer?.defaultEmailAddress?.emailAddress ?? null,
				},
			},
		},
	}));
}

function withRoleAssignmentEdges(node: CompanyLocationNode, edges: readonly RoleAssignmentEdge[]): CompanyLocationNode {
	return {
		...node,
		roleAssignments: {
			...(node.roleAssignments ?? {}),
			edges,
			nodes: roleAssignmentNodesFromEdges(edges),
		},
	};
}

async function fetchLocationDetailsNode(env: ShopifyEnv, locationId: string): Promise<CompanyLocationNode | null> {
	let location: CompanyLocationNode | null = null;
	const edges: RoleAssignmentEdge[] = [];
	let cursor: string | null = null;

	do {
		const data: LocationDetailsResponse = await shopifyGraphQL({
			env,
			query: LOCATION_DETAILS_QUERY,
			variables: { locationId, cursor },
		});

		if (!data.companyLocation) {
			return null;
		}

		location ??= data.companyLocation;
		edges.push(...(data.companyLocation.roleAssignments?.edges ?? []));

		const pageInfo = data.companyLocation.roleAssignments?.pageInfo;
		cursor = pageInfo?.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : null;
	} while (cursor);

	return location ? withRoleAssignmentEdges(location, edges) : null;
}

export async function fetchAllCompanyLocations(env: ShopifyEnv): Promise<ShopifyLocationSummary[]> {
	const locations: ShopifyLocationSummary[] = [];
	let cursor: string | null = null;
	let page = 0;
	const startedAt = Date.now();

	do {
		page += 1;
		const pageStartedAt = Date.now();
		const data: CompanyLocationsResponse = await shopifyGraphQL({
			env,
			query: COMPANY_LOCATIONS_QUERY,
			variables: { cursor },
		});
		for (const edge of data.companyLocations.edges) {
			const location = mapLocation(edge.node);
			if (location) locations.push(location);
		}
		cursor = data.companyLocations.pageInfo.hasNextPage && data.companyLocations.pageInfo.endCursor
			? data.companyLocations.pageInfo.endCursor
			: null;
		log('info', 'shopify.company_locations.page', {
			page,
			count: data.companyLocations.edges.length,
			totalMapped: locations.length,
			hasNextPage: cursor !== null,
			latencyMs: Date.now() - pageStartedAt,
		});
	} while (cursor);

	log('info', 'shopify.company_locations.completed', {
		pages: page,
		totalMapped: locations.length,
		latencyMs: Date.now() - startedAt,
	});

	return locations;
}

async function enrichLocationsWithRoleEmailDomains(
	env: ShopifyEnv,
	locations: readonly ShopifyLocationSummary[],
): Promise<ShopifyLocationSummary[]> {
	const enriched: ShopifyLocationSummary[] = [];
	for (const location of locations) {
		const node = await fetchLocationDetailsNode(env, location.id);
		enriched.push(node ? (mapLocation(node) ?? location) : location);
	}
	return enriched;
}

export async function getLocationCandidates(input: LocationCandidateInput): Promise<LocationCandidates> {
	const domain = emailDomain(input.buyerEmail);
	let locations = await fetchAllCompanyLocations(input.env);
	if (domain) {
		locations = await enrichLocationsWithRoleEmailDomains(input.env, locations);
	}
	const prefix = zipPrefix(input.zip ?? input.shipToAddress);

	const fuzzyTop3 = [...locations]
		.map((location) => ({ location, score: scoreLocation(input, location) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 3)
		.map((entry) => entry.location);

	const zipPrefixMatches = prefix
		? locations.filter((location) => zipPrefix(location.shippingAddress?.zip) === prefix)
		: [];
	const domainMatches = domain
		? locations.filter((location) => location.buyerEmailDomains.includes(domain))
		: [];

	return {
		candidates: mergeCandidates(fuzzyTop3, zipPrefixMatches, domainMatches),
		fuzzyTop3,
		zipPrefixMatches,
		domainMatches,
		totalLocationsScanned: locations.length,
	};
}

export async function getLocationDetails(env: ShopifyEnv, locationId: string) {
	const locationNode = await fetchLocationDetailsNode(env, locationId);
	const location = locationNode ? mapLocation(locationNode) : null;
	const customers = locationNode?.roleAssignments?.edges?.map((edge) => ({
		roleAssignmentId: edge.node.id,
		companyContactId: edge.node.companyContact?.id ?? null,
		customerId: edge.node.companyContact?.customer?.id ?? null,
		firstName: edge.node.companyContact?.customer?.firstName ?? null,
		lastName: edge.node.companyContact?.customer?.lastName ?? null,
		email: edge.node.companyContact?.customer?.defaultEmailAddress?.emailAddress ?? null,
	})) ?? [];

	return { location, customers };
}
