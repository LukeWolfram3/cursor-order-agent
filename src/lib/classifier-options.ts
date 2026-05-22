import type { LegacyRouterAction, SpecialistKind } from '../types.js';

export interface ClassifierOption {
	readonly specialist: SpecialistKind;
	readonly legacyAction: LegacyRouterAction;
	readonly description: string;
	readonly wired: boolean;
}

export const CLASSIFIER_OPTIONS: readonly ClassifierOption[] = [
	{
		specialist: 'order',
		legacyAction: 'process_order',
		description: 'Purchase order or email clearly requesting a new order.',
		wired: true,
	},
	{
		specialist: 'reprocess_po',
		legacyAction: 'reprocess_po',
		description: 'Reply asking to reprocess a PO previously flagged as duplicate.',
		wired: false,
	},
	{
		specialist: 'quote_or_location_request',
		legacyAction: 'request_extraction',
		description: 'New quote, pricing request, or standalone add-location request.',
		wired: false,
	},
	{
		specialist: 'add_customer',
		legacyAction: 'add_customer',
		description: 'Request or confirmation to add a customer to an existing location.',
		wired: false,
	},
	{
		specialist: 'add_company_location',
		legacyAction: 'add_company_location',
		description: 'Confirmation or request to create a Shopify company/location.',
		wired: false,
	},
	{
		specialist: 'corporate_account',
		legacyAction: 'corporate_account',
		description: 'Corporate account application.',
		wired: false,
	},
	{
		specialist: 'no_charge_trial',
		legacyAction: 'no_charge_trial',
		description: 'Free sample or no-charge-trial request.',
		wired: false,
	},
	{
		specialist: 'bill_only',
		legacyAction: 'bill_only',
		description: 'Bill-only form submission or request.',
		wired: false,
	},
	{
		specialist: 'po_examples',
		legacyAction: 'po_examples',
		description: 'Request for example PO files from a location or company.',
		wired: false,
	},
	{
		specialist: 'engineering_issue',
		legacyAction: 'create_github_issue',
		description: 'Bug report or improvement request for the AI worker.',
		wired: false,
	},
	{
		specialist: 'no_action',
		legacyAction: 'no_action',
		description: 'No actionable sales-ops request, spam, remittance notice, or irrelevant automation.',
		wired: false,
	},
];

export const WIRED_SPECIALISTS = CLASSIFIER_OPTIONS
	.filter((option) => option.wired)
	.map((option) => option.specialist);

export function formatClassifierOptionsForPrompt(): string {
	return [
		'CLASSIFIER_OPTIONS:',
		JSON.stringify(CLASSIFIER_OPTIONS, null, 2),
		'',
		`WIRED_SPECIALISTS (only these run a real specialist today): ${JSON.stringify(WIRED_SPECIALISTS)}`,
	].join('\n');
}
