import {
	PO_EXTRACTION_DEFAULT_VALUES_BY_PATH,
	PO_EXTRACTION_ENUM_VALUE_REMAP_BY_PATH,
	PO_EXTRACTION_ENUM_VALUES_BY_PATH,
	PO_EXTRACTION_FIELD_NAME_ECHOES,
	PO_EXTRACTION_GLN_FIELDS,
	PO_EXTRACTION_GLN_PATTERN,
} from './schemas.js';

type JsonRecord = Record<string, unknown>;

export function normalizeExtractedPO(rawOutput: JsonRecord): JsonRecord {
	const normalized = structuredClone(rawOutput);

	normalizeFieldNameEchoes(normalized);
	normalizeGlnFields(normalized);
	normalizeLineItemSkus(normalized);
	normalizeTopLevelEnums(normalized);
	applyDefaultValues(normalized);

	return normalized;
}

function normalizeFieldNameEchoes(output: JsonRecord): void {
	for (const [field, echoes] of PO_EXTRACTION_FIELD_NAME_ECHOES.entries()) {
		const value = output[field];
		if (typeof value !== 'string') {
			continue;
		}

		const normalizedValue = value.trim().toLowerCase();
		if (echoes.some((echo) => echo.trim().toLowerCase() === normalizedValue)) {
			output[field] = null;
		}
	}
}

function normalizeGlnFields(output: JsonRecord): void {
	for (const field of PO_EXTRACTION_GLN_FIELDS) {
		const value = output[field];
		if (typeof value === 'string' && !PO_EXTRACTION_GLN_PATTERN.test(value.trim())) {
			output[field] = null;
		}
	}
}

function normalizeLineItemSkus(output: JsonRecord): void {
	const lineItems = getLineItems(output);
	const skuPath = 'line_items.line_items_array[].SKU';
	const remap = PO_EXTRACTION_ENUM_VALUE_REMAP_BY_PATH[skuPath];
	const allowedValues = new Set<string>(PO_EXTRACTION_ENUM_VALUES_BY_PATH[skuPath]);

	for (const item of lineItems) {
		const value = item.SKU;
		if (typeof value !== 'string') {
			continue;
		}

		const remapped = remap[value as keyof typeof remap] ?? value;
		item.SKU = allowedValues.has(remapped) ? remapped : null;
	}
}

function normalizeTopLevelEnums(output: JsonRecord): void {
	for (const [path, allowedValues] of Object.entries(PO_EXTRACTION_ENUM_VALUES_BY_PATH)) {
		if (path.includes('[]')) {
			continue;
		}

		const value = output[path];
		if (typeof value === 'string' && !new Set<string>(allowedValues).has(value)) {
			output[path] = null;
		}
	}
}

function applyDefaultValues(output: JsonRecord): void {
	for (const [path, defaultValue] of Object.entries(PO_EXTRACTION_DEFAULT_VALUES_BY_PATH)) {
		if (output[path] === null || output[path] === undefined) {
			output[path] = defaultValue;
		}
	}

	if (!isRecord(output.line_items)) {
		output.line_items = { line_items_array: [] };
		return;
	}

	if (!Array.isArray(output.line_items.line_items_array)) {
		output.line_items.line_items_array = [];
	}
}

function getLineItems(output: JsonRecord): JsonRecord[] {
	if (!isRecord(output.line_items)) {
		return [];
	}

	if (!Array.isArray(output.line_items.line_items_array)) {
		return [];
	}

	return output.line_items.line_items_array.filter(isRecord);
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
