import type { AttachmentInspection } from './lib/attachments/file-inspection.js';

export interface ShopifyEnv {
	readonly SHOPIFY_STORE_DOMAIN: string;
	readonly SHOPIFY_KEY?: string;
	readonly SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
	readonly SHOPIFY_API_VERSION: string;
}

export interface AnthropicEnv {
	readonly ANTHROPIC_API_KEY: string;
	readonly CLASSIFIER_MODEL?: string;
	readonly ORDER_SPECIALIST_MODEL?: string;
	readonly EXTRACTOR_MODEL?: string;
	readonly LOCATION_MATCHER_MODEL?: string;
}

export type AppEnv = ShopifyEnv & AnthropicEnv;

export interface GraphEmailAddress {
	readonly name?: string | null;
	readonly address: string;
}

export interface GraphRecipient {
	readonly emailAddress: GraphEmailAddress;
}

export interface GraphMessageBody {
	readonly contentType: 'text' | 'html' | string;
	readonly content: string;
}

export interface GraphInternetMessageHeader {
	readonly name: string;
	readonly value: string;
}

export interface GraphMessage {
	readonly id: string;
	readonly subject?: string | null;
	readonly from?: GraphRecipient | null;
	readonly sender?: GraphRecipient | null;
	readonly toRecipients?: readonly GraphRecipient[];
	readonly ccRecipients?: readonly GraphRecipient[];
	readonly body?: GraphMessageBody | null;
	readonly bodyPreview?: string | null;
	readonly receivedDateTime?: string | null;
	readonly sentDateTime?: string | null;
	readonly hasAttachments?: boolean;
	readonly conversationId?: string | null;
	readonly internetMessageId?: string | null;
	readonly internetMessageHeaders?: readonly GraphInternetMessageHeader[];
}

export interface GraphAttachment {
	readonly '@odata.type'?: string;
	readonly id: string;
	readonly name: string;
	readonly contentType?: string | null;
	readonly size?: number;
	readonly isInline?: boolean;
	readonly contentId?: string | null;
	readonly contentBytes?: string;
	readonly contentBytesRef?: string;
	readonly localPath?: string;
}

export interface GraphAttachmentsResponse {
	readonly value: readonly GraphAttachment[];
}

export interface GraphAttachmentInspection extends AttachmentInspection {
	readonly attachmentId: string;
}

export interface GraphMailSimulation {
	readonly message: GraphMessage;
	readonly attachments?: GraphAttachmentsResponse;
	readonly attachmentInspections?: readonly GraphAttachmentInspection[];
}

export type SpecialistKind =
	| 'order'
	| 'reprocess_po'
	| 'quote_or_location_request'
	| 'add_customer'
	| 'add_company_location'
	| 'corporate_account'
	| 'no_charge_trial'
	| 'bill_only'
	| 'po_examples'
	| 'engineering_issue'
	| 'no_action';

export type LegacyRouterAction =
	| 'process_order'
	| 'reprocess_po'
	| 'request_extraction'
	| 'add_customer'
	| 'add_company_location'
	| 'corporate_account'
	| 'no_charge_trial'
	| 'bill_only'
	| 'po_examples'
	| 'create_github_issue'
	| 'no_action';

export interface ClassificationResult {
	readonly specialist: SpecialistKind;
	readonly confidence: number;
	readonly reason: string;
	readonly legacyAction?: LegacyRouterAction;
}

export interface TraceEvent {
	readonly ts: string;
	readonly phase: string;
	readonly data?: Record<string, unknown>;
}

export interface SpecialistRunResult {
	readonly specialist: SpecialistKind;
	readonly status: 'ok';
	readonly summary: string;
	readonly text: string;
	readonly trace?: readonly TraceEvent[];
	readonly debugTrace?: unknown;
}

export interface OrderSpecialistMcpResult {
	readonly specialist: 'order';
	readonly status: 'ok' | 'error';
	readonly summary: string;
	readonly text: string;
	readonly trace: readonly TraceEvent[];
}

export interface UnsupportedSpecialistResult {
	readonly status: 'unsupported_specialist';
	readonly classification: ClassificationResult;
	readonly message: string;
}
