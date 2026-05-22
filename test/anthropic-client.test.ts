import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	contextualizeAnthropicError,
	zodToolSchema,
} from '../src/lib/anthropic-client.js';

describe('zodToolSchema', () => {
	it('builds Anthropic tool input schemas with a concrete root object', () => {
		const tool = zodToolSchema(
			z.object({
				reason: z.string(),
			}),
			'submit_result',
			'Submit the result.',
		);

		expect(tool.input_schema).toMatchObject({
			type: 'object',
			properties: {
				reason: { type: 'string' },
			},
			required: ['reason'],
		});
		expect(tool.input_schema).not.toHaveProperty('$ref');
	});
});

describe('contextualizeAnthropicError', () => {
	it('explains invalid Anthropic API keys with the relevant secret name', () => {
		const providerError = Object.assign(
			new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
			{
				status: 401,
				error: {
					type: 'error',
					error: {
						type: 'authentication_error',
						message: 'invalid x-api-key',
					},
				},
				request_id: 'req_test',
			},
		);

		const contextualError = contextualizeAnthropicError(providerError, 'classifier');

		expect(contextualError).toBeInstanceOf(Error);
		expect(contextualError?.message).toContain('ANTHROPIC_API_KEY was rejected by Anthropic');
		expect(contextualError?.message).toContain('classifier');
		expect(contextualError?.message).toContain('req_test');
		expect(contextualError?.cause).toBe(providerError);
	});

	it('leaves unrelated errors untouched', () => {
		expect(contextualizeAnthropicError(new Error('boom'), 'classifier')).toBeUndefined();
		expect(contextualizeAnthropicError({ status: 429, message: 'rate limit' }, 'classifier')).toBeUndefined();
	});
});
