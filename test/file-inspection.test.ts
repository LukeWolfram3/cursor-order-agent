import { describe, expect, it } from 'vitest';
import { inspectAttachmentFile } from '../src/lib/attachments/file-inspection.js';

describe('inspectAttachmentFile', () => {
	it('treats PDFs and images as model-readable inputs', () => {
		expect(inspectAttachmentFile({
			filename: 'PO-1001.PDF',
			contentType: 'application/pdf; name=PO-1001.PDF',
		})).toMatchObject({
			detectedKind: 'pdf',
			detectedMimeType: 'application/pdf',
			providerCanReadNatively: true,
			needsConversion: false,
			suggestedConversionTarget: 'none',
		});

		expect(inspectAttachmentFile({
			filename: 'scan.jpg',
			contentType: null,
		})).toMatchObject({
			detectedKind: 'jpeg',
			detectedMimeType: 'image/jpeg',
			providerCanReadNatively: true,
			needsConversion: false,
		});
	});
});
