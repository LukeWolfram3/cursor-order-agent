import Anthropic from '@anthropic-ai/sdk';
import type {
	MessageParam,
	Tool,
	ToolResultBlockParam,
	ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.mjs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { AppEnv } from '../types.js';
import { log, errorFields } from './log.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function getAnthropicClient(apiKey: string): Anthropic {
	return new Anthropic({ apiKey });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function stringProperty(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const property = value[key];
	return typeof property === 'string' ? property : undefined;
}

export function contextualizeAnthropicError(error: unknown, modelKind: string): Error | undefined {
	if (!isRecord(error) || error.status !== 401) {
		return undefined;
	}

	const body = isRecord(error.error) ? error.error.error : undefined;
	const bodyType = stringProperty(body, 'type');
	const bodyMessage = stringProperty(body, 'message');
	const message = error instanceof Error ? error.message : bodyMessage;
	const requestId = stringProperty(error, 'request_id');
	const isInvalidApiKey =
		bodyType === 'authentication_error' ||
		bodyMessage?.includes('x-api-key') ||
		message?.includes('x-api-key');

	if (!isInvalidApiKey) {
		return undefined;
	}

	const requestSuffix = requestId ? ` Request ID: ${requestId}.` : '';
	return new Error(
		`Anthropic authentication failed while running ${modelKind}: ANTHROPIC_API_KEY was rejected by Anthropic (invalid x-api-key). Verify the MCP server secret value.${requestSuffix}`,
		{ cause: error },
	);
}

async function runAnthropicRequest<T>(modelKind: string, request: () => Promise<T>): Promise<T> {
	try {
		return await request();
	} catch (error) {
		throw contextualizeAnthropicError(error, modelKind) ?? error;
	}
}

export function resolveModel(env: AppEnv, kind: 'classifier' | 'order' | 'extractor' | 'matcher'): string {
	switch (kind) {
		case 'classifier':
			return env.CLASSIFIER_MODEL ?? DEFAULT_MODEL;
		case 'order':
			return env.ORDER_SPECIALIST_MODEL ?? DEFAULT_MODEL;
		case 'extractor':
			return env.EXTRACTOR_MODEL ?? DEFAULT_MODEL;
		case 'matcher':
			return env.LOCATION_MATCHER_MODEL ?? DEFAULT_MODEL;
	}
}

export function zodToolSchema(schema: z.ZodTypeAny, name: string, description: string): Tool {
	const jsonSchema = zodToJsonSchema(schema, { $refStrategy: 'none' });
	return {
		name,
		description,
		input_schema: jsonSchema as Tool['input_schema'],
	};
}

export interface InnerToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: z.ZodTypeAny;
	readonly execute: (input: unknown) => Promise<unknown>;
}

export function innerToolsToAnthropicTools(tools: readonly InnerToolDefinition[]): Tool[] {
	return tools.map((tool) => zodToolSchema(tool.inputSchema, tool.name, tool.description));
}

export async function runStructuredToolOutput<T>(options: {
	readonly env: AppEnv;
	readonly modelKind: 'classifier' | 'extractor' | 'matcher';
	readonly system: string;
	readonly userContent: MessageParam['content'];
	readonly outputTool: InnerToolDefinition;
	readonly maxTokens?: number;
	readonly extraTools?: Tool[];
	readonly forceFirstToolName?: string;
	readonly maxSteps?: number;
}): Promise<T> {
	const client = getAnthropicClient(options.env.ANTHROPIC_API_KEY);
	const model = resolveModel(options.env, options.modelKind);
	const allInner = [options.outputTool, ...(options.extraTools ? [] : [])];
	const anthropicTools = [
		...innerToolsToAnthropicTools(allInner),
		...(options.extraTools ?? []),
	];

	const messages: MessageParam[] = [{ role: 'user', content: options.userContent }];
	const maxSteps = options.maxSteps ?? 1;

	for (let step = 0; step < maxSteps; step++) {
		const toolChoice = step === 0 && options.forceFirstToolName
			? { type: 'tool' as const, name: options.forceFirstToolName }
			: step < maxSteps - 1 && options.extraTools?.length
				? { type: 'any' as const }
				: { type: 'tool' as const, name: options.outputTool.name };

		const response = await runAnthropicRequest(options.modelKind, () => client.messages.create({
			model,
			max_tokens: options.maxTokens ?? 4096,
			temperature: 0,
			system: options.system,
			tools: anthropicTools,
			tool_choice: toolChoice,
			messages,
		}));

		const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
		if (toolUses.length === 0) {
			throw new Error(`Model did not return a tool call on step ${step}`);
		}

		const toolResults: ToolResultBlockParam[] = [];
		for (const toolUse of toolUses) {
			if (toolUse.name === options.outputTool.name) {
				const parsed = options.outputTool.inputSchema.safeParse(toolUse.input);
				if (!parsed.success) {
					throw new Error(`Invalid structured output: ${parsed.error.message}`);
				}
				return parsed.data as T;
			}

			const inner = allInner.find((t) => t.name === toolUse.name);
			if (inner) {
				const parsed = inner.inputSchema.safeParse(toolUse.input);
				if (!parsed.success) {
					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: JSON.stringify({ error: parsed.error.message }),
						is_error: true,
					});
					continue;
				}
				try {
					const output = await inner.execute(parsed.data);
					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: JSON.stringify(output),
					});
				} catch (error) {
					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: JSON.stringify({ error: errorFields(error) }),
						is_error: true,
					});
				}
				continue;
			}

			// Built-in web_search handled by API — should not appear as tool_use we execute
			if (toolUse.name === 'web_search' || toolUse.name === 'web_search_20250305') {
				continue;
			}

			throw new Error(`Unknown tool call: ${toolUse.name}`);
		}

		if (toolResults.length > 0) {
			messages.push({ role: 'assistant', content: response.content });
			messages.push({ role: 'user', content: toolResults });
		}
	}

	throw new Error('Structured tool output was not produced');
}

export async function runToolLoop(options: {
	readonly env: AppEnv;
	readonly modelKind: 'order';
	readonly system: string;
	readonly userContent: MessageParam['content'];
	readonly tools: readonly InnerToolDefinition[];
	readonly outputTool: InnerToolDefinition;
	readonly maxSteps?: number;
	readonly maxTokens?: number;
	readonly onToolStart?: (name: string, input: unknown) => void;
	readonly onToolComplete?: (name: string, result: unknown) => void;
	readonly onToolFailed?: (name: string, error: unknown) => void;
}): Promise<unknown> {
	const client = getAnthropicClient(options.env.ANTHROPIC_API_KEY);
	const model = resolveModel(options.env, options.modelKind);
	const allTools = [...options.tools, options.outputTool];
	const anthropicTools = innerToolsToAnthropicTools(allTools);
	const messages: MessageParam[] = [{ role: 'user', content: options.userContent }];
	const maxSteps = options.maxSteps ?? 12;

	for (let step = 0; step < maxSteps; step++) {
		log('info', 'agent.step', { step, model });

		const response = await runAnthropicRequest(options.modelKind, () => client.messages.create({
			model,
			max_tokens: options.maxTokens ?? 8000,
			temperature: 0,
			system: options.system,
			tools: anthropicTools,
			tool_choice: { type: 'auto' },
			messages,
		}));

		const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
		const textBlocks = response.content.filter((block) => block.type === 'text');

		if (toolUses.length === 0) {
			if (textBlocks.length > 0) {
				log('warn', 'agent.text_without_tools', { text: textBlocks.map((b) => b.text).join('\n').slice(0, 500) });
			}
			break;
		}

		const toolResults: ToolResultBlockParam[] = [];
		let finalOutput: unknown;

		for (const toolUse of toolUses) {
			const def = allTools.find((t) => t.name === toolUse.name);
			if (!def) {
				throw new Error(`Unknown tool: ${toolUse.name}`);
			}

			const parsed = def.inputSchema.safeParse(toolUse.input);
			if (!parsed.success) {
				options.onToolFailed?.(toolUse.name, parsed.error);
				toolResults.push({
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: JSON.stringify({ error: parsed.error.message }),
					is_error: true,
				});
				continue;
			}

			options.onToolStart?.(toolUse.name, parsed.data);
			try {
				const output = await def.execute(parsed.data);
				options.onToolComplete?.(toolUse.name, output);
				if (toolUse.name === options.outputTool.name) {
					finalOutput = output;
				}
				toolResults.push({
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: JSON.stringify(output),
				});
			} catch (error) {
				options.onToolFailed?.(toolUse.name, error);
				toolResults.push({
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: JSON.stringify({ error: errorFields(error) }),
					is_error: true,
				});
			}
		}

		messages.push({ role: 'assistant', content: response.content });
		if (toolResults.length > 0) {
			messages.push({ role: 'user', content: toolResults });
		}

		if (finalOutput !== undefined) {
			return finalOutput;
		}

		if (response.stop_reason === 'end_turn') {
			break;
		}
	}

	throw new Error('Order specialist did not call submit_final_result');
}
