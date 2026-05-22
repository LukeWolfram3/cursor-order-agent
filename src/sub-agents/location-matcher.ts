import Anthropic from '@anthropic-ai/sdk';
import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.mjs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AppEnv } from '../types.js';
import { locationResearchMatchSchema, type LocationResearchMatch } from '../lib/schemas.js';
import { loadPrompt } from '../lib/prompts.js';
import { getAnthropicClient, resolveModel } from '../lib/anthropic-client.js';
import { log, errorFields } from '../lib/log.js';

const OUTPUT_TOOL_NAME = 'submit_location_match';

function enforceConfidenceThreshold(result: LocationResearchMatch): LocationResearchMatch {
	if (result.matchedLocationId && result.confidence < 0.85) {
		return {
			...result,
			matchedLocationId: null,
			matchedLocationName: null,
			humanReviewNeeded: true,
			humanReviewReason: result.humanReviewReason
				?? `Matched confidence ${result.confidence} is below the 0.85 threshold.`,
		};
	}
	return result;
}

export async function runLocationResearchMatcherSubAgent(input: {
	readonly env: AppEnv;
	readonly messageId: string;
	readonly poLocationContext: unknown;
	readonly candidates: unknown;
}): Promise<LocationResearchMatch> {
	const startedAt = Date.now();

	log('info', 'subagent.start', {
		messageId: input.messageId,
		subagent: 'location-research-matcher',
		candidateCount: Array.isArray(input.candidates) ? input.candidates.length : undefined,
	});

	try {
		const system = await loadPrompt('order-agent/sub-agents/location-research-matcher.md');
		const client = getAnthropicClient(input.env.ANTHROPIC_API_KEY);
		const model = resolveModel(input.env, 'matcher');

		const outputTool: Tool = {
			name: OUTPUT_TOOL_NAME,
			description: 'Submit the location research match result.',
			input_schema: zodToJsonSchema(locationResearchMatchSchema, {
				name: OUTPUT_TOOL_NAME,
				$refStrategy: 'none',
			}) as Tool['input_schema'],
		};

		const webSearchTool = {
			type: 'web_search_20250305' as const,
			name: 'web_search',
			max_uses: 3,
		};

		const userPrompt = [
			'You MUST perform at least one web_search on your first step before submitting your final match.',
			'',
			JSON.stringify({
				poLocationContext: input.poLocationContext,
				candidates: input.candidates,
			}, null, 2),
		].join('\n');

		const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];

		for (let step = 0; step < 3; step++) {
			const response = await client.messages.create({
				model,
				max_tokens: 1500,
				temperature: 0,
				system,
				tools: [webSearchTool as unknown as Tool, outputTool],
				tool_choice: step === 0
					? { type: 'tool', name: 'web_search' }
					: { type: 'tool', name: OUTPUT_TOOL_NAME },
				messages,
			});

			const submitUse = response.content.find(
				(block): block is ToolUseBlock => block.type === 'tool_use' && block.name === OUTPUT_TOOL_NAME,
			);

			if (submitUse) {
				const parsed = locationResearchMatchSchema.safeParse(submitUse.input);
				if (!parsed.success) {
					throw new Error(`Location matcher returned invalid result: ${parsed.error.message}`);
				}
				const result = enforceConfidenceThreshold(parsed.data);
				log('info', 'subagent.completed', {
					messageId: input.messageId,
					subagent: 'location-research-matcher',
					latencyMs: Date.now() - startedAt,
					matchedLocationId: result.matchedLocationId,
					confidence: result.confidence,
				});
				return result;
			}

			messages.push({ role: 'assistant', content: response.content });
			// web_search results are handled server-side; continue loop
			if (response.stop_reason === 'end_turn') {
				break;
			}
		}

		throw new Error('Location matcher did not submit a result');
	} catch (error) {
		log('error', 'error.caught', {
			messageId: input.messageId,
			phase: 'subagent.location-research-matcher',
			latencyMs: Date.now() - startedAt,
			...errorFields(error),
		});
		throw error;
	}
}
