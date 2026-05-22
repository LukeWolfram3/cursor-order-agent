export interface PlanCustomerActionInput {
	readonly action: 'create_customer' | 'assign_contact_to_location' | 'send_b2b_invite' | 'none';
	readonly customerEmail?: string | null;
	readonly customerFirstName?: string | null;
	readonly customerLastName?: string | null;
	readonly companyId?: string | null;
	readonly locationId?: string | null;
	readonly reason: string;
}

export function planCustomerAction(input: PlanCustomerActionInput) {
	return {
		mock: true,
		wouldMutateShopify: false,
		action: input.action,
		reason: input.reason,
		plannedInput: {
			customerEmail: input.customerEmail ?? null,
			customerFirstName: input.customerFirstName ?? null,
			customerLastName: input.customerLastName ?? null,
			companyId: input.companyId ?? null,
			locationId: input.locationId ?? null,
		},
	};
}
