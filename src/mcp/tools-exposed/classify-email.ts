import { z } from 'zod';
import type { GraphMailSimulation } from '../../types.js';
import { getAppEnv } from '../../lib/env.js';
import { runClassifierSubAgent } from '../../sub-agents/classifier.js';

export const classifyEmailInputSchema = z.object({
	graph: z.record(z.unknown()).transform((value) => value as unknown as GraphMailSimulation),
});

export type ClassifyEmailInput = z.infer<typeof classifyEmailInputSchema>;

export async function classifyEmailHandler(input: ClassifyEmailInput) {
	const env = getAppEnv();
	const result = await runClassifierSubAgent({ env, graph: input.graph });
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
	};
}
