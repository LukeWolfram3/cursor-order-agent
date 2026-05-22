import type { AppEnv, ClassificationResult, GraphMailSimulation } from '../types.js';
import { classificationResultSchema } from '../lib/schemas.js';
import { formatClassifierOptionsForPrompt, CLASSIFIER_OPTIONS } from '../lib/classifier-options.js';
import { loadPromptBundle } from '../lib/prompts.js';
import { buildGraphMailText, enrichGraphWithInspections } from '../lib/graph-format.js';
import { runStructuredToolOutput, type InnerToolDefinition } from '../lib/anthropic-client.js';
import { log, errorFields } from '../lib/log.js';

const OUTPUT_TOOL_NAME = 'submit_classification';

export async function runClassifierSubAgent(input: {
	readonly env: AppEnv;
	readonly graph: GraphMailSimulation;
}): Promise<ClassificationResult> {
	const startedAt = Date.now();
	const graph = enrichGraphWithInspections(input.graph);
	const messageId = graph.message.id;

	log('info', 'subagent.start', { messageId, subagent: 'classifier' });

	try {
		const system = await loadPromptBundle([
			'shared/shopify-store-overview.md',
			'classifier/system.md',
			'classifier/skills/routing-signals.md',
		]);

		const outputTool: InnerToolDefinition = {
			name: OUTPUT_TOOL_NAME,
			description: 'Submit the email classification result.',
			inputSchema: classificationResultSchema,
			execute: async (data) => data,
		};

		const result = await runStructuredToolOutput<ClassificationResult>({
			env: input.env,
			modelKind: 'classifier',
			system: [
				system,
				'',
				formatClassifierOptionsForPrompt(),
				'',
				'Return your classification by calling submit_classification exactly once.',
			].join('\n'),
			userContent: buildGraphMailText(graph),
			outputTool,
			maxTokens: 2000,
		});

		// Attach legacyAction if missing
		const withLegacy = result.legacyAction
			? result
			: {
				...result,
				legacyAction: CLASSIFIER_OPTIONS.find((o) => o.specialist === result.specialist)?.legacyAction,
			};

		log('info', 'subagent.completed', {
			messageId,
			subagent: 'classifier',
			latencyMs: Date.now() - startedAt,
			specialist: withLegacy.specialist,
			confidence: withLegacy.confidence,
		});

		return withLegacy;
	} catch (error) {
		log('error', 'error.caught', {
			messageId,
			phase: 'subagent.classifier',
			latencyMs: Date.now() - startedAt,
			...errorFields(error),
		});
		throw error;
	}
}
