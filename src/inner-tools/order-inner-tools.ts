import { z } from 'zod';
import type { AppEnv, GraphMailSimulation } from '../types.js';
import { extractedPOSchema } from '../lib/po/schemas.js';
import { runPOExtractorSubAgent } from '../sub-agents/extractor.js';
import { runLocationResearchMatcherSubAgent } from '../sub-agents/location-matcher.js';
import { getLocationCandidates, getLocationDetails } from './shopify/locations.js';
import { findCustomersForPO } from './shopify/customers.js';
import { lookupVariants } from './shopify/variants.js';
import { getCatalogContext } from './shopify/catalogs.js';
import { planDraftOrder } from './dry-run/draft-order-planner.js';
import { planCustomerAction } from './dry-run/customer-action-planner.js';
import { planLocationUpdates } from './dry-run/location-update-planner.js';
import { poSpecialistResultSchema } from '../lib/schemas.js';
import type { InnerToolDefinition } from '../lib/anthropic-client.js';
import { summarizeToolResult } from '../lib/trace.js';

function normalizeCandidateInput(candidates: unknown): unknown {
	if (!isRecord(candidates)) return candidates;
	if (Array.isArray(candidates.candidates)) return candidates.candidates;

	const byId = new Map<string, unknown>();
	for (const key of ['fuzzyTop3', 'zipPrefixMatches', 'domainMatches']) {
		const group = candidates[key];
		if (!Array.isArray(group)) continue;

		for (const candidate of group) {
			if (isRecord(candidate) && typeof candidate.id === 'string') {
				byId.set(candidate.id, candidate);
			}
		}
	}

	return byId.size > 0 ? Array.from(byId.values()) : candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const ORDER_INNER_TOOL_NAMES = [
	'extract_order_data',
	'shopify_get_location_candidates',
	'match_location_with_research',
	'shopify_get_location_details',
	'shopify_find_customers_for_po',
	'shopify_lookup_variants',
	'shopify_get_catalog_context',
	'shopify_plan_draft_order',
	'shopify_plan_customer_action',
	'shopify_plan_location_updates',
	'submit_final_result',
] as const;

export function createOrderInnerTools(
	env: AppEnv,
	graph: GraphMailSimulation,
	hooks?: {
		onToolStart?: (name: string, input: unknown) => void;
		onToolComplete?: (name: string, result: unknown) => void;
		onToolFailed?: (name: string, error: unknown) => void;
	},
): { tools: InnerToolDefinition[]; outputTool: InnerToolDefinition } {
	const messageId = graph.message.id;

	const wrap = <T>(name: string, execute: (input: T) => Promise<unknown>): InnerToolDefinition['execute'] => {
		return async (input: unknown) => {
			hooks?.onToolStart?.(name, input);
			try {
				const result = await execute(input as T);
				hooks?.onToolComplete?.(name, summarizeToolResult(result));
				return result;
			} catch (error) {
				hooks?.onToolFailed?.(name, error);
				throw error;
			}
		};
	};

	const extractOrderDataSchema = z.object({
		emailContext: z.string(),
		attachmentContext: z.string().nullable().optional(),
		attachmentIds: z.array(z.string()).optional(),
	});
	const locationCandidatesSchema = z.object({
		shipToAddress: z.string().nullable().optional(),
		facilityName: z.string().nullable().optional(),
		buyerEmail: z.string().nullable().optional(),
		zip: z.string().nullable().optional(),
	});
	const matchLocationSchema = z.object({
		poLocationContext: z.unknown(),
		candidates: z.unknown(),
	});
	const locationDetailsSchema = z.object({ locationId: z.string() });
	const findCustomersSchema = z.object({
		locationId: z.string(),
		buyerEmail: z.string().nullable().optional(),
		secondaryBuyerEmail: z.string().nullable().optional(),
		buyerFirstName: z.string().nullable().optional(),
		buyerLastName: z.string().nullable().optional(),
	});
	const lookupVariantsSchema = z.object({
		items: z.array(z.object({
			sku: z.string(),
			quantity: z.number().nullable().optional(),
		})),
	});
	const catalogContextSchema = z.object({
		locationId: z.string(),
		companyId: z.string(),
		skus: z.array(z.string()).optional(),
		includeAllCatalogs: z.boolean().optional(),
	});
	const planDraftOrderSchema = z.object({
		po: extractedPOSchema,
		locationId: z.string(),
		companyContactId: z.string().nullable().optional(),
		customerId: z.string().nullable().optional(),
		shippingMethod: z.string().nullable().optional(),
		lineItems: z.array(z.object({
			sku: z.string().nullable().optional(),
			variantId: z.string().nullable().optional(),
			title: z.string().nullable().optional(),
			quantity: z.number(),
			unitPrice: z.number().nullable().optional(),
			currencyCode: z.string().nullable().optional(),
			discount: z.object({
				type: z.enum(['percentage', 'fixed_amount']),
				value: z.number(),
				title: z.string().nullable().optional(),
				description: z.string().nullable().optional(),
				reason: z.string().nullable().optional(),
			}).nullable().optional(),
			source: z.string().nullable().optional(),
		})).optional(),
		currencyCode: z.string().nullable().optional(),
		notes: z.string().nullable().optional(),
	});
	const planCustomerActionSchema = z.object({
		action: z.enum(['create_customer', 'assign_contact_to_location', 'send_b2b_invite', 'none']),
		customerEmail: z.string().nullable().optional(),
		customerFirstName: z.string().nullable().optional(),
		customerLastName: z.string().nullable().optional(),
		companyId: z.string().nullable().optional(),
		locationId: z.string().nullable().optional(),
		reason: z.string(),
	});
	const planLocationUpdatesSchema = z.object({
		locationId: z.string(),
		apEmail: z.string().nullable().optional(),
		invoiceSubmissionEmail: z.string().nullable().optional(),
		phone: z.string().nullable().optional(),
		reason: z.string(),
	});

	const tools: InnerToolDefinition[] = [
		{
			name: 'extract_order_data',
			description: 'Delegate order data extraction to a focused sub-agent. Returns structured order JSON.',
			inputSchema: extractOrderDataSchema,
			execute: wrap<z.infer<typeof extractOrderDataSchema>>('extract_order_data', async (input) => runPOExtractorSubAgent({
				env,
				messageId,
				graph,
				emailContext: input.emailContext,
				attachmentContext: input.attachmentContext,
				attachmentIds: input.attachmentIds,
			})),
		},
		{
			name: 'shopify_get_location_candidates',
			description: 'Read Shopify company locations and return candidate matches for ship-to.',
			inputSchema: locationCandidatesSchema,
			execute: wrap<z.infer<typeof locationCandidatesSchema>>('shopify_get_location_candidates', async (input) => getLocationCandidates({ env, ...input })),
		},
		{
			name: 'match_location_with_research',
			description: 'Delegate location matching with web research sub-agent.',
			inputSchema: matchLocationSchema,
			execute: wrap<z.infer<typeof matchLocationSchema>>('match_location_with_research', async (input) => runLocationResearchMatcherSubAgent({
				env,
				messageId,
				poLocationContext: input.poLocationContext,
				candidates: normalizeCandidateInput(input.candidates),
			})),
		},
		{
			name: 'shopify_get_location_details',
			description: 'Read full Shopify company-location context for a selected location.',
			inputSchema: locationDetailsSchema,
			execute: wrap<z.infer<typeof locationDetailsSchema>>('shopify_get_location_details', async (input) => getLocationDetails(env, input.locationId)),
		},
		{
			name: 'shopify_find_customers_for_po',
			description: 'Read Shopify customers at a matched location.',
			inputSchema: findCustomersSchema,
			execute: wrap<z.infer<typeof findCustomersSchema>>('shopify_find_customers_for_po', async (input) => findCustomersForPO({ env, ...input })),
		},
		{
			name: 'shopify_lookup_variants',
			description: 'Read Shopify product variants by SKU.',
			inputSchema: lookupVariantsSchema,
			execute: wrap<z.infer<typeof lookupVariantsSchema>>('shopify_lookup_variants', async (input) => lookupVariants({ env, ...input })),
		},
		{
			name: 'shopify_get_catalog_context',
			description: 'Read Shopify catalog context for a matched location and company.',
			inputSchema: catalogContextSchema,
			execute: wrap<z.infer<typeof catalogContextSchema>>('shopify_get_catalog_context', async (input) => getCatalogContext({ env, ...input })),
		},
		{
			name: 'shopify_plan_draft_order',
			description: 'Dry-run draft order creation. Never mutates Shopify.',
			inputSchema: planDraftOrderSchema,
			execute: wrap<z.infer<typeof planDraftOrderSchema>>('shopify_plan_draft_order', async (input) => planDraftOrder(input)),
		},
		{
			name: 'shopify_plan_customer_action',
			description: 'Dry-run customer action. Never mutates Shopify.',
			inputSchema: planCustomerActionSchema,
			execute: wrap<z.infer<typeof planCustomerActionSchema>>('shopify_plan_customer_action', async (input) => planCustomerAction(input)),
		},
		{
			name: 'shopify_plan_location_updates',
			description: 'Dry-run location updates. Never mutates Shopify.',
			inputSchema: planLocationUpdatesSchema,
			execute: wrap<z.infer<typeof planLocationUpdatesSchema>>('shopify_plan_location_updates', async (input) => planLocationUpdates(input)),
		},
	];

	const outputTool: InnerToolDefinition = {
		name: 'submit_final_result',
		description: 'Submit the final order processing result. Call exactly once when done.',
		inputSchema: poSpecialistResultSchema,
		execute: async (input) => {
			const parsed = poSpecialistResultSchema.parse(input);
			return parsed;
		},
	};

	return { tools, outputTool };
}
