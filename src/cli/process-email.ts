#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { parseWebhookBody, runSalesOpsPipeline } from '../http/run-handler.js';

function usage(): string {
	return [
		'Usage: pnpm process-email <payload.json>',
		'',
		'Payload must be JSON with:',
		'{ "graph": { "message": { "id": "..." }, "attachments": { "value": [] } }, "prompt": "optional" }',
	].join('\n');
}

async function main(): Promise<void> {
	const inputPath = process.argv[2];
	if (!inputPath || inputPath === '-h' || inputPath === '--help') {
		console.error(usage());
		process.exit(inputPath ? 0 : 2);
	}

	let body: unknown;
	try {
		body = JSON.parse(await readFile(inputPath, 'utf8'));
	} catch (error) {
		console.error(JSON.stringify({
			error: 'invalid_input_file',
			message: error instanceof Error ? error.message : String(error),
		}, null, 2));
		process.exit(1);
	}

	const input = parseWebhookBody(body);
	if (!input) {
		console.error(JSON.stringify({
			error: 'invalid_payload',
			message: 'Expected JSON body with graph.message.id and optional graph.attachments or prompt',
		}, null, 2));
		process.exit(1);
	}

	try {
		const result = await runSalesOpsPipeline(input);
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error(JSON.stringify({
			error: 'pipeline_failed',
			message: error instanceof Error ? error.message : String(error),
			details: error instanceof Error ? undefined : inspect(error),
		}, null, 2));
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(JSON.stringify({
		error: 'unhandled_error',
		message: error instanceof Error ? error.message : String(error),
	}, null, 2));
	process.exit(1);
});
