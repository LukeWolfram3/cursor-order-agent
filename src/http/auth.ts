export function getWebhookSecret(): string | undefined {
	return process.env.WEBHOOK_SECRET ?? process.env.WEBHOOK_API_KEY;
}

export type BearerAuthResult = 'ok' | 'misconfigured' | 'unauthorized';

export function checkBearerAuth(authHeader: string | undefined, secret: string | undefined): BearerAuthResult {
	if (!secret) return 'misconfigured';
	if (!authHeader?.startsWith('Bearer ')) return 'unauthorized';
	const token = authHeader.slice('Bearer '.length).trim();
	if (token.length === 0 || token !== secret) return 'unauthorized';
	return 'ok';
}
