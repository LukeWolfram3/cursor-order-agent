import type { AppEnv } from '../types.js';

export function getAppEnv(): AppEnv {
	const shopifyKey = process.env.SHOPIFY_KEY ?? process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	if (!anthropicKey) {
		throw new Error('ANTHROPIC_API_KEY is not configured');
	}
	if (!shopifyKey) {
		throw new Error('SHOPIFY_KEY or SHOPIFY_ADMIN_ACCESS_TOKEN is not configured');
	}
	const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
	if (!storeDomain) {
		throw new Error('SHOPIFY_STORE_DOMAIN is not configured');
	}
	return {
		SHOPIFY_KEY: shopifyKey,
		SHOPIFY_ADMIN_ACCESS_TOKEN: shopifyKey,
		SHOPIFY_STORE_DOMAIN: storeDomain,
		SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION ?? '2026-01',
		ANTHROPIC_API_KEY: anthropicKey,
		CLASSIFIER_MODEL: process.env.CLASSIFIER_MODEL,
		ORDER_SPECIALIST_MODEL: process.env.ORDER_SPECIALIST_MODEL,
		EXTRACTOR_MODEL: process.env.EXTRACTOR_MODEL,
		LOCATION_MATCHER_MODEL: process.env.LOCATION_MATCHER_MODEL,
	};
}
