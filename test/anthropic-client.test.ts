import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToolSchema } from '../src/lib/anthropic-client.js';

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
