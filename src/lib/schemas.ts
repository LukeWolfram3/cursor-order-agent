import { z } from 'zod';
import type { ClassificationResult, SpecialistRunResult } from '../types.js';

export const legacyRouterActionSchema = z.enum([
	'process_order',
	'reprocess_po',
	'request_extraction',
	'add_customer',
	'add_company_location',
	'corporate_account',
	'no_charge_trial',
	'bill_only',
	'po_examples',
	'create_github_issue',
	'no_action',
]);

export const specialistKindSchema = z.enum([
	'order',
	'reprocess_po',
	'quote_or_location_request',
	'add_customer',
	'add_company_location',
	'corporate_account',
	'no_charge_trial',
	'bill_only',
	'po_examples',
	'engineering_issue',
	'no_action',
]);

export const classificationResultSchema = z.object({
	specialist: specialistKindSchema,
	confidence: z.number().min(0).max(1),
	reason: z.string(),
	legacyAction: legacyRouterActionSchema.optional(),
}) satisfies z.ZodType<ClassificationResult>;

export const poSpecialistResultSchema = z.object({
	specialist: z.literal('order'),
	status: z.literal('ok'),
	summary: z.string(),
	text: z.string(),
	trace: z.array(z.object({
		ts: z.string(),
		phase: z.string(),
		data: z.record(z.unknown()).optional(),
	})).optional(),
	debugTrace: z.unknown().optional(),
}) satisfies z.ZodType<SpecialistRunResult>;

export const locationResearchMatchSchema = z.object({
	reasoning: z.string(),
	matchedLocationId: z.string().nullable(),
	matchedLocationName: z.string().nullable(),
	confidence: z.number().min(0).max(1),
	humanReviewNeeded: z.boolean(),
	humanReviewReason: z.string().nullable(),
});

export type LocationResearchMatch = z.infer<typeof locationResearchMatchSchema>;
