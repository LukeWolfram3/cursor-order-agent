import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadPrompt(relativePath: string): Promise<string> {
	const fullPath = path.join(REPO_ROOT, 'prompts', relativePath);
	return readFile(fullPath, 'utf8');
}

export async function loadPromptBundle(paths: readonly string[]): Promise<string> {
	const parts = await Promise.all(paths.map((p) => loadPrompt(p)));
	return parts.join('\n\n');
}
