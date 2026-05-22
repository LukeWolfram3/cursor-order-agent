#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
	classifyEmailHandler,
	classifyEmailInputSchema,
} from './tools-exposed/classify-email.js';
import {
	runOrderSpecialistHandler,
	runOrderSpecialistInputSchema,
} from './tools-exposed/run-order-specialist.js';

const server = new McpServer({
	name: 'cursor-order-agent',
	version: '0.1.0',
});

const graphInputShape = {
	graph: z.record(z.unknown()).describe('Microsoft Graph mail simulation JSON (message + optional attachments)'),
};

server.registerTool(
	'classify_email',
	{
		description: 'Classify a Microsoft Graph-shaped sales-ops email and return specialist routing JSON.',
		inputSchema: graphInputShape,
	},
	async (args) => classifyEmailHandler(classifyEmailInputSchema.parse(args)),
);

server.registerTool(
	'run_order_specialist',
	{
		description: 'Run the order specialist multi-step loop (extract, match location, Shopify reads, dry-run planners). Returns summary, reply text, and trace.',
		inputSchema: {
			...graphInputShape,
			classificationReason: z.string().optional().describe('Classifier reason string for context'),
		},
	},
	async (args) => runOrderSpecialistHandler(runOrderSpecialistInputSchema.parse(args)),
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
