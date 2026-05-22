import { createServer } from 'node:http';
import { log, errorFields } from '../lib/log.js';
import { handleRequest } from './router.js';
import { sendJson } from './responses.js';

const PORT = Number(process.env.PORT ?? 8787);

const server = createServer((req, res) => {
	void handleRequest(req, res).catch((error) => {
		log('error', 'server.unhandled', {
			method: req.method,
			path: req.url,
			...errorFields(error),
		});
		if (!res.headersSent) {
			sendJson(res, 500, {
				error: 'internal',
				message: error instanceof Error ? error.message : String(error),
			});
		} else {
			res.end();
		}
	});
});

server.listen(PORT, () => {
	log('info', 'webhook.listening', { port: PORT, paths: ['/webhook', '/run', '/health'] });
});
