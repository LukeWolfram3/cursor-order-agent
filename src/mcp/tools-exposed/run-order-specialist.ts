import { z } from 'zod';
import type { GraphMailSimulation } from '../../types.js';
import { getAppEnv } from '../../lib/env.js';
import { runOrderSpecialistSubAgent } from '../../sub-agents/order-specialist.js';
import { stageGraphAttachmentBytes } from '../../lib/attachments/byte-store.js';

export const runOrderSpecialistInputSchema = z.object({
	graph: z.record(z.unknown()).transform((value) => value as unknown as GraphMailSimulation),
	classificationReason: z.string().optional(),
});

export type RunOrderSpecialistInput = z.infer<typeof runOrderSpecialistInputSchema>;

export async function runOrderSpecialistHandler(input: RunOrderSpecialistInput) {
	const env = getAppEnv();
	const graph = stageGraphAttachmentBytes(input.graph);
	const result = await runOrderSpecialistSubAgent({
		env,
		graph,
		classificationReason: input.classificationReason,
	});
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
	};
}
