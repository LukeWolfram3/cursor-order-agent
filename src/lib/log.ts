type LogLevel = 'info' | 'warn' | 'error';

const REDACTED_KEYS = [
	'api_key',
	'apikey',
	'authorization',
	'contentbytes',
	'gemini_key',
	'shopify_key',
	'token',
	'x-shopify-access-token',
];

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
	const payload = sanitize({
		ts: new Date().toISOString(),
		level,
		event,
		...fields,
	});
	const message = JSON.stringify(payload);

	if (level === 'error') {
		console.error(message);
		return;
	}

	if (level === 'warn') {
		console.warn(message);
		return;
	}

	console.log(message);
}

export function errorFields(error: unknown): Record<string, unknown> {
	if (!(error instanceof Error)) {
		return {
			message: String(error),
		};
	}

	return {
		name: error.name,
		message: error.message,
		stack: error.stack?.split('\n').slice(0, 8).join('\n'),
		cause: error.cause instanceof Error ? error.cause.message : error.cause,
	};
}

export function byteLength(value: string | null | undefined): number {
	return new TextEncoder().encode(value ?? '').byteLength;
}

function sanitize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitize);
	}

	if (!isRecord(value)) {
		return value;
	}

	return Object.fromEntries(Object.entries(value).map(([key, child]) => {
		if (REDACTED_KEYS.some((redacted) => key.toLowerCase().includes(redacted))) {
			return [key, '[redacted]'];
		}

		return [key, sanitize(child)];
	}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
