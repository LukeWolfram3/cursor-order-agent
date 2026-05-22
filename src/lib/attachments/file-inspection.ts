export type AttachmentFileKind =
	| 'pdf'
	| 'png'
	| 'jpeg'
	| 'gif'
	| 'tiff'
	| 'rtf'
	| 'doc'
	| 'docx'
	| 'xls'
	| 'xlsx'
	| 'csv'
	| 'text'
	| 'html'
	| 'unknown';

export interface InspectAttachmentInput {
	readonly filename: string;
	readonly contentType?: string | null;
	readonly contentBytes?: string;
}

export interface AttachmentInspection {
	readonly filename: string;
	readonly declaredContentType: string | null;
	readonly detectedKind: AttachmentFileKind;
	readonly detectedMimeType: string;
	readonly providerCanReadNatively: boolean;
	readonly needsConversion: boolean;
	readonly suggestedConversionTarget: 'none' | 'text' | 'png_pages';
	readonly reason: string;
}

const KIND_TO_MIME: Record<AttachmentFileKind, string> = {
	pdf: 'application/pdf',
	png: 'image/png',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	tiff: 'image/tiff',
	rtf: 'application/rtf',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	csv: 'text/csv',
	text: 'text/plain',
	html: 'text/html',
	unknown: 'application/octet-stream',
};

function normalizeContentType(contentType: string | null | undefined): string {
	return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function extensionOf(filename: string): string {
	const index = filename.lastIndexOf('.');
	return index >= 0 ? filename.slice(index + 1).toLowerCase() : '';
}

function detectFromContentType(contentType: string): AttachmentFileKind | null {
	if (!contentType) return null;
	if (contentType.includes('pdf')) return 'pdf';
	if (contentType.includes('png')) return 'png';
	if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpeg';
	if (contentType.includes('gif')) return 'gif';
	if (contentType.includes('tiff') || contentType.includes('tif')) return 'tiff';
	if (contentType.includes('rtf')) return 'rtf';
	if (contentType.includes('wordprocessingml')) return 'docx';
	if (contentType.includes('msword')) return 'doc';
	if (contentType.includes('spreadsheetml')) return 'xlsx';
	if (contentType.includes('excel')) return 'xls';
	if (contentType.includes('csv')) return 'csv';
	if (contentType.includes('html')) return 'html';
	if (contentType.includes('text')) return 'text';
	return null;
}

function detectFromExtension(filename: string): AttachmentFileKind | null {
	const ext = extensionOf(filename);
	if (ext === 'jpg') return 'jpeg';
	if (['pdf', 'png', 'jpeg', 'gif', 'tiff', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'csv'].includes(ext)) {
		return ext as AttachmentFileKind;
	}
	if (ext === 'tif') return 'tiff';
	if (ext === 'txt') return 'text';
	if (ext === 'htm' || ext === 'html') return 'html';
	return null;
}

export function inspectAttachmentFile(input: InspectAttachmentInput): AttachmentInspection {
	const declaredContentType = normalizeContentType(input.contentType) || null;
	const detectedKind = detectFromContentType(declaredContentType ?? '')
		?? detectFromExtension(input.filename)
		?? 'unknown';

	const providerCanReadNatively = ['pdf', 'png', 'jpeg', 'gif', 'text', 'html', 'csv'].includes(detectedKind);
	const needsConversion = ['tiff', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'unknown'].includes(detectedKind);
	const suggestedConversionTarget = needsConversion
		? detectedKind === 'csv'
			? 'text'
			: 'png_pages'
		: 'none';

	return {
		filename: input.filename,
		declaredContentType,
		detectedKind,
		detectedMimeType: declaredContentType ?? KIND_TO_MIME[detectedKind],
		providerCanReadNatively,
		needsConversion,
		suggestedConversionTarget,
		reason: needsConversion
			? `${detectedKind} is not expected to be readable from metadata alone in this POC.`
			: `${detectedKind} can be passed to the model without document conversion.`,
	};
}
