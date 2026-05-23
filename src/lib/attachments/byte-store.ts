import { createHash } from 'node:crypto';
import type { GraphAttachment, GraphMailSimulation } from '../../types.js';

interface StoredAttachmentBytes {
	readonly messageId: string;
	readonly attachmentId: string;
	readonly filename: string;
	readonly contentType?: string | null;
	readonly contentBytes: string;
	readonly createdAt: number;
}

const attachmentsByRef = new Map<string, StoredAttachmentBytes>();
const attachmentRefByMessageKey = new Map<string, string>();

function messageAttachmentKey(messageId: string, attachmentId: string): string {
	return `${messageId}\u0000${attachmentId}`;
}

function attachmentRef(messageId: string, attachmentId: string, contentBytes: string): string {
	const hash = createHash('sha256')
		.update(messageId)
		.update('\u0000')
		.update(attachmentId)
		.update('\u0000')
		.update(contentBytes)
		.digest('hex')
		.slice(0, 24);
	return `staged-attachment:${hash}`;
}

export function clearAttachmentByteStore(): void {
	attachmentsByRef.clear();
	attachmentRefByMessageKey.clear();
}

export function stageAttachmentBytes(input: {
	readonly messageId: string;
	readonly attachment: GraphAttachment;
}): string | null {
	const contentBytes = input.attachment.contentBytes;
	if (!contentBytes) return null;

	const ref = attachmentRef(input.messageId, input.attachment.id, contentBytes);
	const stored: StoredAttachmentBytes = {
		messageId: input.messageId,
		attachmentId: input.attachment.id,
		filename: input.attachment.name,
		contentType: input.attachment.contentType,
		contentBytes,
		createdAt: Date.now(),
	};

	attachmentsByRef.set(ref, stored);
	attachmentRefByMessageKey.set(messageAttachmentKey(input.messageId, input.attachment.id), ref);
	return ref;
}

export function stageGraphAttachmentBytes(graph: GraphMailSimulation): GraphMailSimulation {
	const attachments = graph.attachments?.value ?? [];
	if (attachments.length === 0) return graph;

	let stagedAny = false;
	const sanitizedAttachments = attachments.map((attachment) => {
		const ref = stageAttachmentBytes({ messageId: graph.message.id, attachment });
		if (!ref) return attachment;

		stagedAny = true;
		const { contentBytes: _contentBytes, ...metadata } = attachment;
		return {
			...metadata,
			contentBytesRef: ref,
		};
	});

	if (!stagedAny) return graph;

	return {
		...graph,
		attachments: {
			...graph.attachments,
			value: sanitizedAttachments,
		},
	};
}

export function resolveAttachmentBytes(input: {
	readonly messageId: string;
	readonly attachment: GraphAttachment;
}): string | undefined {
	if (input.attachment.contentBytes) {
		return input.attachment.contentBytes;
	}

	if (input.attachment.contentBytesRef) {
		const stored = attachmentsByRef.get(input.attachment.contentBytesRef);
		if (stored) return stored.contentBytes;
	}

	const ref = attachmentRefByMessageKey.get(messageAttachmentKey(input.messageId, input.attachment.id));
	if (!ref) return undefined;

	return attachmentsByRef.get(ref)?.contentBytes;
}

export function hasResolvableAttachmentBytes(input: {
	readonly messageId: string;
	readonly attachment: GraphAttachment;
}): boolean {
	return typeof resolveAttachmentBytes(input) === 'string';
}
