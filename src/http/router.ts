import type { IncomingMessage, ServerResponse } from 'node:http';
import { log } from '../lib/log.js';
import { handleWebhookRun } from './run-handler.js';
import { sendJson } from './responses.js';

const RUN_PATHS = new Set(['/webhook', '/run']);

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	log('info', 'request.received', {
		method: req.method,
		path: url.pathname,
		contentLength: req.headers['content-length'],
	});

	if (req.method === 'POST' && RUN_PATHS.has(url.pathname)) {
		await handleWebhookRun(req, res);
		return;
	}

	if (req.method === 'GET' && url.pathname === '/health') {
		sendJson(res, 200, { ok: true });
		return;
	}

	sendJson(res, 404, { error: 'Not found' });
}
