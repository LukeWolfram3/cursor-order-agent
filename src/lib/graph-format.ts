import { inspectAttachmentFile } from './attachments/file-inspection.js';
import type {
	GraphAttachment,
	GraphAttachmentInspection,
	GraphMailSimulation,
	GraphRecipient,
} from '../types.js';

export interface AgentAttachmentContent {
	readonly attachmentId: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly contentBytes: string;
}

function formatRecipient(recipient: GraphRecipient | null | undefined): string {
	if (!recipient) return '[none]';
	const name = recipient.emailAddress.name;
	const address = recipient.emailAddress.address;
	return name ? `${name} <${address}>` : address;
}

function formatRecipientList(recipients: readonly GraphRecipient[] | undefined): string {
	if (!recipients || recipients.length === 0) return '[none]';
	return recipients.map(formatRecipient).join(', ');
}

function formatAttachment(attachment: GraphAttachment): string {
	return [
		`- id: ${attachment.id}`,
		`  name: ${attachment.name}`,
		`  type: ${attachment.contentType ?? '[unknown]'}`,
		`  size: ${attachment.size ?? '[unknown]'}`,
		`  inline: ${attachment.isInline ?? false}`,
		`  hasContentBytes: ${typeof attachment.contentBytes === 'string'}`,
	].join('\n');
}

function formatAttachmentInspection(inspection: GraphAttachmentInspection): string {
	return [
		`- attachmentId: ${inspection.attachmentId}`,
		`  filename: ${inspection.filename}`,
		`  declaredContentType: ${inspection.declaredContentType ?? '[unknown]'}`,
		`  detectedKind: ${inspection.detectedKind}`,
		`  detectedMimeType: ${inspection.detectedMimeType}`,
		`  providerCanReadNatively: ${inspection.providerCanReadNatively}`,
		`  readableContentRequired: ${inspection.needsConversion}`,
		`  suggestedConversionTarget: ${inspection.suggestedConversionTarget}`,
		`  reason: ${inspection.reason}`,
	].join('\n');
}

function mimeTypeForAttachment(
	attachment: GraphAttachment,
	inspections: readonly GraphAttachmentInspection[],
): string | null {
	const declared = attachment.contentType?.trim();
	if (declared) return declared;

	const inspection = inspections.find((candidate) => candidate.attachmentId === attachment.id);
	return inspection?.detectedMimeType ?? null;
}

function isModelReadableMimeType(mimeType: string | null): mimeType is string {
	if (!mimeType) return false;
	return mimeType === 'application/pdf' || /^image\/(png|jpeg|jpg|webp|gif)$/i.test(mimeType);
}

export function getModelReadableAttachments(
	graph: GraphMailSimulation,
	attachmentIds?: readonly string[],
): AgentAttachmentContent[] {
	const attachments = graph.attachments?.value ?? [];
	const attachmentIdSet = attachmentIds ? new Set(attachmentIds) : null;

	return attachments.flatMap((attachment): AgentAttachmentContent[] => {
		if (attachmentIdSet && !attachmentIdSet.has(attachment.id)) return [];
		if (!attachment.contentBytes) return [];

		const mimeType = mimeTypeForAttachment(attachment, graph.attachmentInspections ?? []);
		if (!isModelReadableMimeType(mimeType)) return [];

		return [{
			attachmentId: attachment.id,
			filename: attachment.name,
			mimeType,
			contentBytes: attachment.contentBytes,
		}];
	});
}

export function enrichGraphWithInspections(graph: GraphMailSimulation): GraphMailSimulation {
	if (graph.attachmentInspections?.length) {
		return graph;
	}
	const attachments = graph.attachments?.value ?? [];
	if (attachments.length === 0) {
		return graph;
	}
	const attachmentInspections = attachments.map((attachment) => {
		const inspection = inspectAttachmentFile({
			filename: attachment.name,
			contentType: attachment.contentType,
			contentBytes: attachment.contentBytes,
		});
		return {
			...inspection,
			attachmentId: attachment.id,
		};
	});
	return { ...graph, attachmentInspections };
}

export function buildGraphMailText(graph: GraphMailSimulation): string {
	const { message } = graph;
	const attachments = graph.attachments?.value ?? [];
	const attachmentInspections = graph.attachmentInspections ?? [];

	return [
		'Microsoft Graph message payload:',
		`message.id: ${message.id}`,
		`subject: ${message.subject ?? '[none]'}`,
		`from: ${formatRecipient(message.from)}`,
		`sender: ${formatRecipient(message.sender)}`,
		`to: ${formatRecipientList(message.toRecipients)}`,
		`cc: ${formatRecipientList(message.ccRecipients)}`,
		`receivedDateTime: ${message.receivedDateTime ?? '[none]'}`,
		`sentDateTime: ${message.sentDateTime ?? '[none]'}`,
		`conversationId: ${message.conversationId ?? '[none]'}`,
		`internetMessageId: ${message.internetMessageId ?? '[none]'}`,
		`hasAttachments: ${message.hasAttachments ?? false}`,
		`body.contentType: ${message.body?.contentType ?? '[none]'}`,
		'body.content:',
		message.body?.content ?? message.bodyPreview ?? '[none]',
		'attachments:',
		attachments.length > 0 ? attachments.map(formatAttachment).join('\n') : '[none]',
		'attachmentInspections:',
		attachmentInspections.length > 0 ? attachmentInspections.map(formatAttachmentInspection).join('\n') : '[none]',
	].join('\n');
}
