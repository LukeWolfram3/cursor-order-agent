import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { AppEnv, GraphMailSimulation } from '../types.js';
import { extractedPOSchema, type ExtractedPO } from '../lib/po/schemas.js';
import { normalizeExtractedPO } from '../lib/po/normalize.js';
import { loadPrompt } from '../lib/prompts.js';
import { buildGraphMailText, getModelReadableAttachments } from '../lib/graph-format.js';
import { runStructuredToolOutput, type InnerToolDefinition } from '../lib/anthropic-client.js';
import { log, errorFields } from '../lib/log.js';

const OUTPUT_TOOL_NAME = 'submit_extracted_order';

export async function runPOExtractorSubAgent(input: {
	readonly env: AppEnv;
	readonly messageId: string;
	readonly graph: GraphMailSimulation;
	readonly emailContext: string;
	readonly attachmentContext?: string | null;
	readonly attachmentIds?: readonly string[];
}): Promise<ExtractedPO> {
	const startedAt = Date.now();
	const attachments = getModelReadableAttachments(input.graph, input.attachmentIds);

	log('info', 'subagent.start', {
		messageId: input.messageId,
		subagent: 'po-extractor',
		attachmentCount: attachments.length,
	});

	try {
		const system = await loadPrompt('order-agent/sub-agents/po-extractor.md');

		const userText = [
			'EMAIL CONTEXT:',
			input.emailContext,
			'',
			'ATTACHMENT CONTEXT:',
			input.attachmentContext ?? 'No attachment context provided.',
			'',
			'ATTACHED FILES:',
			attachments.length > 0
				? attachments.map((a) => `${a.attachmentId}: ${a.filename} (${a.mimeType})`).join('\n')
				: 'No model-readable attached files provided.',
			'',
			`Today's date: ${new Date().toISOString().slice(0, 10)}`,
		].join('\n');

		const userContent: MessageParam['content'] = [
			{ type: 'text', text: userText },
			...attachments.map((attachment) => ({
				type: 'document' as const,
				source: {
					type: 'base64' as const,
					media_type: attachment.mimeType as 'application/pdf',
					data: attachment.contentBytes,
				},
			})),
		];

		const outputTool: InnerToolDefinition = {
			name: OUTPUT_TOOL_NAME,
			description: 'Submit structured extracted order data.',
			inputSchema: extractedPOSchema,
			execute: async (data) => data,
		};

		const raw = await runStructuredToolOutput<Record<string, unknown>>({
			env: input.env,
			modelKind: 'extractor',
			system: [
				system,
				'',
				'Return extracted order data by calling submit_extracted_order exactly once with valid JSON matching the schema.',
			].join('\n'),
			userContent,
			outputTool,
			maxTokens: 4000,
		});

		const normalized = normalizeExtractedPO(raw);
		const parsed = extractedPOSchema.safeParse(normalized);
		if (!parsed.success) {
			throw new Error(`PO extractor returned invalid structured data: ${parsed.error.message}`);
		}

		log('info', 'subagent.completed', {
			messageId: input.messageId,
			subagent: 'po-extractor',
			latencyMs: Date.now() - startedAt,
			lineItemCount: parsed.data.line_items.line_items_array.length,
		});

		return parsed.data;
	} catch (error) {
		log('error', 'error.caught', {
			messageId: input.messageId,
			phase: 'subagent.po-extractor',
			latencyMs: Date.now() - startedAt,
			...errorFields(error),
		});
		throw error;
	}
}
