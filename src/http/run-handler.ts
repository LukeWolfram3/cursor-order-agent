import type { IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
	ClassificationResult,
	GraphMailSimulation,
	OrderSpecialistMcpResult,
} from '../types.js';
import { getAppEnv } from '../lib/env.js';
import { log, errorFields } from '../lib/log.js';
import { runClassifierSubAgent } from '../sub-agents/classifier.js';
import { runOrderSpecialistSubAgent } from '../sub-agents/order-specialist.js';
import { stageGraphAttachmentBytes } from '../lib/attachments/byte-store.js';
import { checkBearerAuth, getWebhookSecret } from './auth.js';
import { sendJson } from './responses.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const webhookBodySchema = z.object({
	graph: z
		.object({
			message: z.object({
				id: z.string().min(1),
			}).passthrough(),
		})
		.passthrough()
		.transform((value) => value as unknown as GraphMailSimulation),
	prompt: z.string().optional(),
});

export type WebhookRunInput = z.infer<typeof webhookBodySchema>;

export interface WebhookRunResult {
	readonly classification: ClassificationResult;
	readonly orderSpecialist?: OrderSpecialistMcpResult;
	readonly message?: string;
	readonly prompt?: string;
}

export function parseWebhookBody(body: unknown): WebhookRunInput | null {
	const parsed = webhookBodySchema.safeParse(body);
	return parsed.success ? parsed.data : null;
}

function resolveRepoLocalPath(localPath: string): string {
	if (path.isAbsolute(localPath)) {
		if (!localPath.startsWith(REPO_ROOT + path.sep)) {
			throw new Error(`Attachment localPath must be inside the repository: ${localPath}`);
		}
		return localPath;
	}

	const resolved = path.resolve(REPO_ROOT, localPath);
	if (!resolved.startsWith(REPO_ROOT + path.sep)) {
		throw new Error(`Attachment localPath must stay inside the repository: ${localPath}`);
	}
	return resolved;
}

async function hydrateLocalAttachmentBytes(graph: GraphMailSimulation): Promise<GraphMailSimulation> {
	const attachments = graph.attachments?.value ?? [];
	if (attachments.length === 0) return graph;

	let hydratedAny = false;
	const hydratedAttachments = await Promise.all(attachments.map(async (attachment) => {
		if (attachment.contentBytes || !attachment.localPath) return attachment;

		hydratedAny = true;
		const contentBytes = await readFile(resolveRepoLocalPath(attachment.localPath), 'base64');
		return {
			...attachment,
			contentBytes,
		};
	}));

	if (!hydratedAny) return graph;

	return {
		...graph,
		attachments: {
			...graph.attachments,
			value: hydratedAttachments,
		},
	};
}

export async function runSalesOpsPipeline(input: WebhookRunInput): Promise<WebhookRunResult> {
	const env = getAppEnv();
	const graph = stageGraphAttachmentBytes(await hydrateLocalAttachmentBytes(input.graph));
	const classification = await runClassifierSubAgent({ env, graph });

	if (classification.specialist === 'order' && classification.confidence >= 0.5) {
		const orderSpecialist = await runOrderSpecialistSubAgent({
			env,
			graph,
			classificationReason: classification.reason,
		});
		return {
			classification,
			orderSpecialist,
			...(input.prompt ? { prompt: input.prompt } : {}),
		};
	}

	return {
		classification,
		message: 'Only the order specialist is wired in this POC.',
		...(input.prompt ? { prompt: input.prompt } : {}),
	};
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

export async function handleWebhookRun(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
	const startedAt = Date.now();
	const auth = checkBearerAuth(req.headers.authorization, getWebhookSecret());

	if (auth === 'misconfigured') {
		sendJson(res, 500, { error: 'WEBHOOK_SECRET or WEBHOOK_API_KEY is not configured' });
		return;
	}
	if (auth === 'unauthorized') {
		sendJson(res, 401, { error: 'Unauthorized' });
		return;
	}

	let body: unknown;
	try {
		const raw = await readRequestBody(req);
		body = raw.length > 0 ? JSON.parse(raw) : null;
	} catch {
		sendJson(res, 400, { error: 'Invalid JSON body' });
		return;
	}

	const input = parseWebhookBody(body);
	if (!input) {
		sendJson(res, 400, {
			error: 'Expected JSON body with graph.message.id and optional graph.attachments or prompt',
		});
		return;
	}

	const messageId = input.graph.message.id;
	log('info', 'webhook.parsed', {
		messageId,
		hasPrompt: Boolean(input.prompt),
		attachmentCount: input.graph.attachments?.value?.length ?? 0,
	});

	try {
		const result = await runSalesOpsPipeline(input);
		log('info', 'webhook.completed', {
			messageId,
			latencyMs: Date.now() - startedAt,
			specialist: result.classification.specialist,
			confidence: result.classification.confidence,
			ranOrderSpecialist: Boolean(result.orderSpecialist),
		});
		sendJson(res, 200, result);
	} catch (error) {
		log('error', 'error.caught', {
			messageId,
			phase: 'webhook.pipeline',
			latencyMs: Date.now() - startedAt,
			...errorFields(error),
		});
		sendJson(res, 500, {
			error: 'internal',
			message: error instanceof Error ? error.message : String(error),
		});
	}
}
