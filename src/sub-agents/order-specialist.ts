import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { AppEnv, GraphMailSimulation, OrderSpecialistMcpResult, TraceEvent } from '../types.js';
import { loadPromptBundle } from '../lib/prompts.js';
import { buildGraphMailText, enrichGraphWithInspections } from '../lib/graph-format.js';
import { runToolLoop } from '../lib/anthropic-client.js';
import { createOrderInnerTools } from '../inner-tools/order-inner-tools.js';
import { poSpecialistResultSchema } from '../lib/schemas.js';
import { log, errorFields } from '../lib/log.js';

export async function runOrderSpecialistSubAgent(input: {
	readonly env: AppEnv;
	readonly graph: GraphMailSimulation;
	readonly classificationReason?: string;
}): Promise<OrderSpecialistMcpResult> {
	const startedAt = Date.now();
	const graph = enrichGraphWithInspections(input.graph);
	const messageId = graph.message.id;
	const trace: TraceEvent[] = [];

	const pushTrace = (phase: string, data?: Record<string, unknown>) => {
		trace.push({ ts: new Date().toISOString(), phase, data });
	};

	pushTrace('specialist.start', { messageId, classificationReason: input.classificationReason });

	try {
		const system = await loadPromptBundle([
			'shared/shopify-store-overview.md',
			'shared/skills/catalogs.md',
			'shared/skills/products.md',
			'order-agent/system.md',
			'order-agent/skills/order-workflow.md',
			'order-agent/skills/order-policies.md',
		]);

		const runtimeContract = [
			'',
			'Runtime contract: after using tools, call submit_final_result exactly once with your final summary and reply text.',
			'Shopify read tools are real; shopify_plan_* tools are dry-runs only and never mutate Shopify.',
			'Duplicate PO checking is disabled for this POC — do not block on duplicates.',
		].join('\n');

		const userContent: MessageParam['content'] = buildGraphMailText(graph);

		const { tools, outputTool } = createOrderInnerTools(input.env, graph, {
			onToolStart: (name, toolInput) => {
				pushTrace('tool.start', { tool: name, inputKeys: typeof toolInput === 'object' && toolInput ? Object.keys(toolInput as object) : undefined });
				log('info', 'tool.start', { messageId, tool: name });
			},
			onToolComplete: (name, result) => {
				pushTrace('tool.completed', { tool: name, result });
				log('info', 'tool.completed', { messageId, tool: name });
			},
			onToolFailed: (name, error) => {
				pushTrace('tool.failed', { tool: name, error: errorFields(error) });
				log('error', 'tool.failed', { messageId, tool: name, ...errorFields(error) });
			},
		});

		const raw = await runToolLoop({
			env: input.env,
			modelKind: 'order',
			system: system + runtimeContract,
			userContent,
			tools,
			outputTool,
			maxSteps: 12,
			maxTokens: 8000,
		});

		const parsed = poSpecialistResultSchema.parse({
			...(raw as object),
			trace,
		});

		pushTrace('specialist.completed', {
			messageId,
			latencyMs: Date.now() - startedAt,
			summary: parsed.summary,
		});

		log('info', 'specialist.completed', {
			messageId,
			latencyMs: Date.now() - startedAt,
			summary: parsed.summary,
		});

		return {
			specialist: 'order',
			status: 'ok',
			summary: parsed.summary,
			text: parsed.text,
			trace,
		};
	} catch (error) {
		pushTrace('error.caught', { ...errorFields(error) });
		log('error', 'error.caught', {
			messageId,
			phase: 'specialist.order',
			latencyMs: Date.now() - startedAt,
			...errorFields(error),
		});

		return {
			specialist: 'order',
			status: 'error',
			summary: 'Order specialist failed',
			text: error instanceof Error ? error.message : String(error),
			trace,
		};
	}
}
