import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassificationResult, GraphMailSimulation, OrderSpecialistMcpResult } from '../src/types.js';
import { checkBearerAuth, getWebhookSecret } from '../src/http/auth.js';
import { parseWebhookBody, runSalesOpsPipeline } from '../src/http/run-handler.js';

const sampleGraph: GraphMailSimulation = {
	message: {
		id: 'msg-1',
		subject: 'PO 12345',
		body: { contentType: 'text', content: 'Please process this order.' },
	},
};

const classification: ClassificationResult = {
	specialist: 'order',
	confidence: 0.9,
	reason: 'Purchase order email',
};

const orderResult: OrderSpecialistMcpResult = {
	specialist: 'order',
	status: 'ok',
	summary: 'Draft order planned',
	text: 'Thanks for your order.',
	trace: [],
};

vi.mock('../src/lib/env.js', () => ({
	getAppEnv: () => ({
		SHOPIFY_KEY: 'test-token',
		SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
		SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
		SHOPIFY_API_VERSION: '2026-01',
		ANTHROPIC_API_KEY: 'test-key',
	}),
}));

vi.mock('../src/sub-agents/classifier.js', () => ({
	runClassifierSubAgent: vi.fn(),
}));

vi.mock('../src/sub-agents/order-specialist.js', () => ({
	runOrderSpecialistSubAgent: vi.fn(),
}));

import { runClassifierSubAgent } from '../src/sub-agents/classifier.js';
import { runOrderSpecialistSubAgent } from '../src/sub-agents/order-specialist.js';

describe('checkBearerAuth', () => {
	afterEach(() => {
		delete process.env.WEBHOOK_SECRET;
		delete process.env.WEBHOOK_API_KEY;
	});

	it('accepts a matching bearer token', () => {
		expect(checkBearerAuth('Bearer secret-1', 'secret-1')).toBe('ok');
	});

	it('rejects missing or invalid bearer tokens', () => {
		expect(checkBearerAuth(undefined, 'secret-1')).toBe('unauthorized');
		expect(checkBearerAuth('Bearer wrong', 'secret-1')).toBe('unauthorized');
		expect(checkBearerAuth('Basic secret-1', 'secret-1')).toBe('unauthorized');
	});

	it('reads WEBHOOK_SECRET or WEBHOOK_API_KEY from env', () => {
		process.env.WEBHOOK_SECRET = 'from-secret';
		expect(getWebhookSecret()).toBe('from-secret');
		delete process.env.WEBHOOK_SECRET;
		process.env.WEBHOOK_API_KEY = 'from-api-key';
		expect(getWebhookSecret()).toBe('from-api-key');
	});
});

describe('parseWebhookBody', () => {
	it('accepts graph.message and optional prompt', () => {
		expect(parseWebhookBody({ graph: sampleGraph, prompt: 'Handle urgently' })).toEqual({
			graph: sampleGraph,
			prompt: 'Handle urgently',
		});
	});

	it('rejects payloads without graph.message.id', () => {
		expect(parseWebhookBody({ graph: { message: {} } })).toBeNull();
		expect(parseWebhookBody({ prompt: 'missing graph' })).toBeNull();
	});
});

describe('runSalesOpsPipeline', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('runs the order specialist for high-confidence order emails', async () => {
		vi.mocked(runClassifierSubAgent).mockResolvedValue(classification);
		vi.mocked(runOrderSpecialistSubAgent).mockResolvedValue(orderResult);

		await expect(runSalesOpsPipeline({ graph: sampleGraph })).resolves.toEqual({
			classification,
			orderSpecialist: orderResult,
		});
		expect(runOrderSpecialistSubAgent).toHaveBeenCalledWith({
			env: expect.objectContaining({ ANTHROPIC_API_KEY: 'test-key' }),
			graph: sampleGraph,
			classificationReason: classification.reason,
		});
	});

	it('returns classification only for non-order specialists', async () => {
		vi.mocked(runClassifierSubAgent).mockResolvedValue({
			specialist: 'quote_or_location_request',
			confidence: 0.95,
			reason: 'Quote request',
		});

		await expect(runSalesOpsPipeline({ graph: sampleGraph, prompt: 'note' })).resolves.toEqual({
			classification: {
				specialist: 'quote_or_location_request',
				confidence: 0.95,
				reason: 'Quote request',
			},
			message: 'Only the order specialist is wired in this POC.',
			prompt: 'note',
		});
		expect(runOrderSpecialistSubAgent).not.toHaveBeenCalled();
	});

	it('returns classification only when order confidence is below threshold', async () => {
		vi.mocked(runClassifierSubAgent).mockResolvedValue({
			specialist: 'order',
			confidence: 0.4,
			reason: 'Uncertain',
		});

		await expect(runSalesOpsPipeline({ graph: sampleGraph })).resolves.toMatchObject({
			classification: {
				specialist: 'order',
				confidence: 0.4,
			},
			message: 'Only the order specialist is wired in this POC.',
		});
		expect(runOrderSpecialistSubAgent).not.toHaveBeenCalled();
	});
});
