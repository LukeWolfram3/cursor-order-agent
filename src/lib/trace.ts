import type { TraceEvent } from '../types.js';

const traces = new Map<string, TraceEvent[]>();

export function createTraceCollector(runId: string): {
	push: (phase: string, data?: Record<string, unknown>) => void;
	getTrace: () => readonly TraceEvent[];
} {
	const events: TraceEvent[] = [];
	traces.set(runId, events);
	return {
		push(phase, data) {
			events.push({
				ts: new Date().toISOString(),
				phase,
				data,
			});
		},
		getTrace() {
			return events;
		},
	};
}

export function summarizeToolResult(result: unknown): unknown {
	if (Array.isArray(result)) {
		return { type: 'array', length: result.length };
	}
	if (!isRecord(result)) {
		return result;
	}

	return {
		keys: Object.keys(result),
		specialist: result.specialist,
		status: result.status,
		summary: result.summary,
		matchedLocationId: result.matchedLocationId,
		matchedLocationName: result.matchedLocationName,
		confidence: result.confidence,
		lineItemCount: isRecord(result.line_items) && Array.isArray(result.line_items.line_items_array)
			? result.line_items.line_items_array.length
			: undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
