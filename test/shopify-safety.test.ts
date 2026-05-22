import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readSource(path: string): string {
	return readFileSync(join(root, path), 'utf8');
}

describe('Shopify safety boundaries', () => {
	it('keeps Shopify GraphQL service operations read-only', () => {
		const queryFiles = readdirSync(join(root, 'src/inner-tools/shopify'))
			.filter((file) => file.endsWith('.ts') && file !== 'client.ts' && file !== 'duplicates.ts');

		for (const file of queryFiles) {
			expect(readSource(`src/inner-tools/shopify/${file}`), file).not.toMatch(/\bmutation\b/i);
		}
	});

	it('keeps dry-run planners disconnected from Shopify writes', () => {
		const dryRunFiles = readdirSync(join(root, 'src/inner-tools/dry-run'))
			.filter((file) => file.endsWith('.ts'));

		for (const file of dryRunFiles) {
			const source = readSource(`src/inner-tools/dry-run/${file}`);
			expect(source, file).not.toContain('shopifyGraphQL');
			expect(source, file).toContain('wouldMutateShopify: false');
		}
	});
});
