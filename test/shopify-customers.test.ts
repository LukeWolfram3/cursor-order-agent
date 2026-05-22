import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyEnv } from '../src/types.js';

vi.mock('../src/inner-tools/shopify/locations.js', () => ({
	getLocationDetails: vi.fn(),
}));

import { getLocationDetails } from '../src/inner-tools/shopify/locations.js';
import { findCustomersForPO } from '../src/inner-tools/shopify/customers.js';

const getLocationDetailsMock = vi.mocked(getLocationDetails);
const env = {} as ShopifyEnv;

describe('findCustomersForPO', () => {
	beforeEach(() => {
		getLocationDetailsMock.mockReset();
	});

	it('prefers email matches over name matches', async () => {
		getLocationDetailsMock.mockResolvedValueOnce({
			location: { id: 'loc-1', name: 'North Hospital' },
			customers: [
				{
					roleAssignmentId: 'ra-1',
					companyContactId: null,
					customerId: 'customer-name',
					firstName: 'Pat',
					lastName: 'Buyer',
					email: 'other@example.com',
				},
				{
					roleAssignmentId: 'ra-2',
					companyContactId: null,
					customerId: 'customer-email',
					firstName: 'Someone',
					lastName: 'Else',
					email: ' BUYER@EXAMPLE.COM ',
				},
			],
		} as Awaited<ReturnType<typeof getLocationDetails>>);

		const result = await findCustomersForPO({
			env,
			locationId: 'loc-1',
			buyerEmail: 'buyer@example.com',
			buyerFirstName: 'Pat',
			buyerLastName: 'Buyer',
		});

		expect(result.matchBasis).toBe('email');
		expect(result.bestMatch).toMatchObject({ customerId: 'customer-email', emailMatch: true });
		expect(result.customers).toEqual([
			expect.objectContaining({ customerId: 'customer-name', nameMatch: true, emailMatch: false }),
			expect.objectContaining({ customerId: 'customer-email', email: 'buyer@example.com', emailMatch: true }),
		]);
	});

	it('falls back to no match when email and name are unusable', async () => {
		getLocationDetailsMock.mockResolvedValueOnce({
			location: null,
			customers: [{
				roleAssignmentId: 'ra-1',
				companyContactId: null,
				customerId: 'customer-1',
				firstName: null,
				lastName: null,
				email: null,
			}],
		} as Awaited<ReturnType<typeof getLocationDetails>>);

		const result = await findCustomersForPO({
			env,
			locationId: 'loc-1',
			buyerEmail: 'not-an-email',
		});

		expect(result.bestMatch).toBeNull();
		expect(result.matchBasis).toBe('none');
	});
});
