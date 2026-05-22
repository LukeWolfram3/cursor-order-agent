import { describe, expect, it, beforeEach } from 'vitest';
import type { GraphMailSimulation } from '../src/types.js';
import {
	clearAttachmentByteStore,
	resolveAttachmentBytes,
	stageGraphAttachmentBytes,
} from '../src/lib/attachments/byte-store.js';
import {
	buildGraphMailText,
	getModelReadableAttachments,
} from '../src/lib/graph-format.js';

const pdfBytes = Buffer.from('%PDF-1.5 test fixture').toString('base64');

function graphFixture(): GraphMailSimulation {
	return {
		message: {
			id: 'msg-attachment-1',
			subject: 'PO 1001',
			body: { contentType: 'text', content: 'Attached PO.' },
			hasAttachments: true,
		},
		attachments: {
			value: [{
				id: 'att-pdf-1',
				name: 'PO-1001.pdf',
				contentType: 'application/pdf',
				size: 1234,
				isInline: false,
				contentBytes: pdfBytes,
			}],
		},
	};
}

describe('attachment byte store', () => {
	beforeEach(() => {
		clearAttachmentByteStore();
	});

	it('stages attachment bytes and returns a graph without inline contentBytes', () => {
		const staged = stageGraphAttachmentBytes(graphFixture());
		const attachment = staged.attachments?.value[0];

		expect(attachment?.contentBytes).toBeUndefined();
		expect(attachment?.contentBytesRef).toMatch(/^staged-attachment:/);
		expect(resolveAttachmentBytes({
			messageId: staged.message.id,
			attachment: attachment!,
		})).toBe(pdfBytes);
	});

	it('resolves staged bytes for model-readable attachments by attachment id', () => {
		const staged = stageGraphAttachmentBytes(graphFixture());

		expect(getModelReadableAttachments(staged, ['att-pdf-1'])).toEqual([{
			attachmentId: 'att-pdf-1',
			filename: 'PO-1001.pdf',
			mimeType: 'application/pdf',
			contentBytes: pdfBytes,
		}]);
	});

	it('keeps raw base64 out of graph mail text while reporting byte availability', () => {
		const staged = stageGraphAttachmentBytes(graphFixture());
		const text = buildGraphMailText(staged);

		expect(text).not.toContain(pdfBytes);
		expect(text).toContain('hasInlineContentBytes: false');
		expect(text).toContain('hasContentBytesRef: true');
		expect(text).toContain('hasResolvedContentBytes: true');
	});

	it('can resolve by message and attachment id when a later graph omits refs', () => {
		const original = graphFixture();
		stageGraphAttachmentBytes(original);
		const metadataOnly: GraphMailSimulation = {
			...original,
			attachments: {
				value: original.attachments!.value.map(({ contentBytes: _contentBytes, ...attachment }) => attachment),
			},
		};

		expect(getModelReadableAttachments(metadataOnly, ['att-pdf-1'])[0]?.contentBytes).toBe(pdfBytes);
	});
});
