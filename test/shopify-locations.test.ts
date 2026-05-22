import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyEnv } from '../src/types.js';

vi.mock('../src/inner-tools/shopify/client.js', () => ({
	shopifyGraphQL: vi.fn(),
}));

import { shopifyGraphQL } from '../src/inner-tools/shopify/client.js';
import { getLocationCandidates, getLocationDetails } from '../src/inner-tools/shopify/locations.js';

const shopifyGraphQLMock = vi.mocked(shopifyGraphQL);
const env = {
	SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
	SHOPIFY_API_VERSION: '2026-01',
} as ShopifyEnv;

function locationNode(id: string, name: string, zip: string) {
	return {
		id,
		name,
		company: { id: `company-${id}`, name: `${name} Company` },
		shippingAddress: {
			address1: `${id} Main St`,
			address2: null,
			city: 'Austin',
			province: 'TX',
			zip,
			country: 'United States',
			countryCode: 'US',
			phone: null,
		},
		billingAddress: null,
		buyerExperienceConfiguration: { paymentTermsTemplate: { id: 'terms-1' } },
		roleAssignments: { nodes: [] },
	};
}

function roleEdge(id: string, email: string) {
	return {
		node: {
			id,
			companyContact: {
				id: `contact-${id}`,
				customer: {
					id: `customer-${id}`,
					firstName: 'Buyer',
					lastName: id,
					defaultEmailAddress: { emailAddress: email },
				},
			},
		},
	};
}

describe('Shopify location queries', () => {
	beforeEach(() => {
		shopifyGraphQLMock.mockReset();
	});

	it('paginates company locations and role assignments for domain matching', async () => {
		shopifyGraphQLMock
			.mockResolvedValueOnce({
				companyLocations: {
					edges: [{ node: locationNode('loc-1', 'North Hospital', '78701') }],
					pageInfo: { hasNextPage: true, endCursor: 'company-page-2' },
				},
			})
			.mockResolvedValueOnce({
				companyLocations: {
					edges: [{ node: locationNode('loc-2', 'South Clinic', '73301') }],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			})
			.mockResolvedValueOnce({
				companyLocation: {
					...locationNode('loc-1', 'North Hospital', '78701'),
					roleAssignments: {
						edges: [roleEdge('1', 'admin@north.example')],
						pageInfo: { hasNextPage: true, endCursor: 'roles-page-2' },
					},
				},
			})
			.mockResolvedValueOnce({
				companyLocation: {
					...locationNode('loc-1', 'North Hospital', '78701'),
					roleAssignments: {
						edges: [roleEdge('2', 'buyer@hospital.org')],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			})
			.mockResolvedValueOnce({
				companyLocation: {
					...locationNode('loc-2', 'South Clinic', '73301'),
					roleAssignments: {
						edges: [roleEdge('3', 'buyer@other.org')],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});

		const result = await getLocationCandidates({
			env,
			buyerEmail: 'BUYER@hospital.org',
			shipToAddress: 'unmatched text',
		});

		expect(result.totalLocationsScanned).toBe(2);
		expect(result.domainMatches).toHaveLength(1);
		expect(result.domainMatches[0]?.id).toBe('loc-1');
		expect(result.candidates).toEqual([expect.objectContaining({
			id: 'loc-1',
			emailDomains: ['north.example', 'hospital.org'],
		})]);
		expect(shopifyGraphQLMock).toHaveBeenCalledTimes(5);
		expect(shopifyGraphQLMock.mock.calls.map((call) => call[0].variables)).toEqual([
			{ cursor: null },
			{ cursor: 'company-page-2' },
			{ locationId: 'loc-1', cursor: null },
			{ locationId: 'loc-1', cursor: 'roles-page-2' },
			{ locationId: 'loc-2', cursor: null },
		]);
	});

	it('returns customers from every role-assignment page', async () => {
		shopifyGraphQLMock
			.mockResolvedValueOnce({
				companyLocation: {
					...locationNode('loc-1', 'North Hospital', '78701'),
					roleAssignments: {
						edges: [roleEdge('1', 'first@hospital.org')],
						pageInfo: { hasNextPage: true, endCursor: 'next-role-page' },
					},
				},
			})
			.mockResolvedValueOnce({
				companyLocation: {
					...locationNode('loc-1', 'North Hospital', '78701'),
					roleAssignments: {
						edges: [roleEdge('2', 'second@hospital.org')],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});

		const result = await getLocationDetails(env, 'loc-1');

		expect(result.location?.buyerEmailDomains).toEqual(['hospital.org']);
		expect(result.customers.map((customer) => customer.email)).toEqual([
			'first@hospital.org',
			'second@hospital.org',
		]);
		expect(shopifyGraphQLMock.mock.calls.map((call) => call[0].variables)).toEqual([
			{ locationId: 'loc-1', cursor: null },
			{ locationId: 'loc-1', cursor: 'next-role-page' },
		]);
	});
});
