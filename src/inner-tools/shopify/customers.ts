import type { ShopifyEnv } from '../../types.js';
import { getLocationDetails } from './locations.js';

export interface FindCustomersForPOInput {
	readonly env: ShopifyEnv;
	readonly locationId: string;
	readonly buyerEmail?: string | null;
	readonly secondaryBuyerEmail?: string | null;
	readonly buyerFirstName?: string | null;
	readonly buyerLastName?: string | null;
}

function normalizeEmail(email?: string | null): string | null {
	const value = email?.trim().toLowerCase();
	return value && value.includes('@') ? value : null;
}

function normalizeName(first?: string | null, last?: string | null): string | null {
	const value = `${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
	return value || null;
}

export async function findCustomersForPO(input: FindCustomersForPOInput) {
	const details = await getLocationDetails(input.env, input.locationId);
	const requestedEmails = [
		normalizeEmail(input.buyerEmail),
		normalizeEmail(input.secondaryBuyerEmail),
	].filter((email): email is string => email !== null);
	const requestedName = normalizeName(input.buyerFirstName, input.buyerLastName);

	const customers = details.customers.map((customer) => {
		const email = normalizeEmail(customer.email);
		const fullName = normalizeName(customer.firstName, customer.lastName);
		return {
			...customer,
			email,
			fullName,
			emailMatch: email !== null && requestedEmails.includes(email),
			nameMatch: requestedName !== null && fullName === requestedName,
		};
	});

	return {
		location: details.location,
		customers,
		bestMatch: customers.find((customer) => customer.emailMatch)
			?? customers.find((customer) => customer.nameMatch)
			?? null,
		matchBasis: customers.some((customer) => customer.emailMatch)
			? 'email'
			: customers.some((customer) => customer.nameMatch)
				? 'name'
				: 'none' as 'email' | 'name' | 'none',
	};
}
