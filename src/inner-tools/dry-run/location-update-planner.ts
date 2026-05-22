export interface PlanLocationUpdatesInput {
	readonly locationId: string;
	readonly apEmail?: string | null;
	readonly invoiceSubmissionEmail?: string | null;
	readonly phone?: string | null;
	readonly reason: string;
}

export function planLocationUpdates(input: PlanLocationUpdatesInput) {
	const updates = [
		input.apEmail ? { field: 'accounts_payable_email', value: input.apEmail } : null,
		input.invoiceSubmissionEmail ? { field: 'invoice_submission_email', value: input.invoiceSubmissionEmail } : null,
		input.phone ? { field: 'phone', value: input.phone } : null,
	].filter((update): update is { field: string; value: string } => update !== null);

	return {
		mock: true,
		wouldMutateShopify: false,
		locationId: input.locationId,
		reason: input.reason,
		updates,
	};
}
