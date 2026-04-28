import chalk from "chalk";
import { findProjectRoot, loadDefinitions } from "../lib/config.js";
import type { ScreenshotDefinition } from "../types.js";

export const listCommand = async (): Promise<void> => {
	const projectRoot = findProjectRoot();
	const definitions = loadDefinitions(projectRoot);

	if (definitions.length === 0) {
		console.log(chalk.yellow("\nNo definitions found.\n"));
		return;
	}

	// Group by URL
	const byUrl = new Map<string, ScreenshotDefinition[]>();
	for (const def of definitions) {
		const list = byUrl.get(def.url) ?? [];
		list.push(def);
		byUrl.set(def.url, list);
	}

	console.log(
		chalk.bold(
			`\n📋 ${definitions.length} definition(s) across ${byUrl.size} URL(s)\n`,
		),
	);

	for (const [url, defs] of byUrl) {
		console.log(chalk.blue(`  ${url}`));
		for (const def of defs) {
			const decorations = def.decorations?.length ?? 0;
			const meta = [
				def.capture.mode,
				decorations > 0 ? `${decorations} annotations` : null,
			]
				.filter(Boolean)
				.join(", ");

			console.log(`    ${chalk.white(def.id)}  ${chalk.dim(meta)}`);
		}
	}
	console.log("");
};
