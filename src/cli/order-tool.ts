#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { getAppEnv } from '../lib/env.js';
import { normalizeExtractedPO } from '../lib/po/normalize.js';
import { extractedPOSchema } from '../lib/po/schemas.js';
import { getLocationCandidates, getLocationDetails } from '../inner-tools/shopify/locations.js';
import { findCustomersForPO } from '../inner-tools/shopify/customers.js';
import { lookupVariants } from '../inner-tools/shopify/variants.js';
import { getCatalogContext } from '../inner-tools/shopify/catalogs.js';
import { planDraftOrder } from '../inner-tools/dry-run/draft-order-planner.js';
import { planCustomerAction } from '../inner-tools/dry-run/customer-action-planner.js';
import { planLocationUpdates } from '../inner-tools/dry-run/location-update-planner.js';

const TOOL_NAMES = [
	'validate_extracted_po',
	'shopify_get_location_candidates',
	'shopify_get_location_details',
	'shopify_find_customers_for_po',
	'shopify_lookup_variants',
	'shopify_get_catalog_context',
	'shopify_plan_draft_order',
	'shopify_plan_customer_action',
	'shopify_plan_location_updates',
] as const;

function usage(): string {
	return [
		'Usage: pnpm order-tool <tool-name> <input.json>',
		'',
		'Tools:',
		...TOOL_NAMES.map((name) => `  - ${name}`),
	].join('\n');
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, 'utf8'));
}

async function main(): Promise<void> {
	const toolName = process.argv[2];
	const inputPath = process.argv[3];

	if (!toolName || toolName === '-h' || toolName === '--help' || !inputPath) {
		console.error(usage());
		process.exit(toolName === '-h' || toolName === '--help' ? 0 : 2);
	}

	if (!TOOL_NAMES.includes(toolName as typeof TOOL_NAMES[number])) {
		console.error(JSON.stringify({ error: 'unknown_tool', toolName }, null, 2));
		process.exit(2);
	}

	const input = await readJson(inputPath);

	let result: unknown;
	switch (toolName) {
		case 'validate_extracted_po': {
			const normalized = normalizeExtractedPO(input as Record<string, unknown>);
			const parsed = extractedPOSchema.parse(normalized);
			result = parsed;
			break;
		}
		case 'shopify_get_location_candidates': {
			const env = getAppEnv();
			result = await getLocationCandidates({ env, ...(input as Omit<Parameters<typeof getLocationCandidates>[0], 'env'>) });
			break;
		}
		case 'shopify_get_location_details': {
			const env = getAppEnv();
			result = await getLocationDetails(env, (input as { locationId: string }).locationId);
			break;
		}
		case 'shopify_find_customers_for_po': {
			const env = getAppEnv();
			result = await findCustomersForPO({ env, ...(input as Omit<Parameters<typeof findCustomersForPO>[0], 'env'>) });
			break;
		}
		case 'shopify_lookup_variants': {
			const env = getAppEnv();
			result = await lookupVariants({ env, ...(input as Omit<Parameters<typeof lookupVariants>[0], 'env'>) });
			break;
		}
		case 'shopify_get_catalog_context': {
			const env = getAppEnv();
			result = await getCatalogContext({ env, ...(input as Omit<Parameters<typeof getCatalogContext>[0], 'env'>) });
			break;
		}
		case 'shopify_plan_draft_order':
			result = planDraftOrder(input as Parameters<typeof planDraftOrder>[0]);
			break;
		case 'shopify_plan_customer_action':
			result = planCustomerAction(input as Parameters<typeof planCustomerAction>[0]);
			break;
		case 'shopify_plan_location_updates':
			result = planLocationUpdates(input as Parameters<typeof planLocationUpdates>[0]);
			break;
	}

	console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
	console.error(JSON.stringify({
		error: 'order_tool_failed',
		message: error instanceof Error ? error.message : String(error),
		details: error instanceof Error ? undefined : inspect(error),
	}, null, 2));
	process.exit(1);
});
