import chalk from "chalk";
import {
	findProjectRoot,
	loadConfig,
	loadDefinitions,
	saveDefinitions,
} from "../lib/config.js";
import { discoverPages } from "../lib/crawl.js";
import { deriveIdFromPath } from "../lib/definition.js";

export const discoverCommand = async (): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Discover Pages\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);

	console.log(chalk.blue(`🔍 Crawling ${config.app.baseUrl} for pages...\n`));

	let pages: { path: string; title: string }[] = [];
	try {
		pages = await discoverPages(config.app.baseUrl, projectRoot);
	} catch (e) {
		console.log(
			chalk.red(
				`\n❌ Failed to crawl: ${e instanceof Error ? e.message : e}\n`,
			),
		);
		return;
	}

	if (pages.length === 0) {
		console.log(chalk.yellow("\n⚠ No pages discovered.\n"));
		return;
	}

	console.log(chalk.green(`\n  Found ${pages.length} page(s)\n`));

	const inquirer = await import("inquirer");
	const { selected } = await inquirer.default.prompt<{ selected: string[] }>({
		type: "checkbox",
		name: "selected",
		message: `Select pages to add (${pages.length} found):`,
		choices: pages.map((p) => ({
			name: `${p.path}  ${chalk.gray(p.title)}`,
			value: p.path,
			checked: true,
		})),
		pageSize: 30,
		loop: false,
	});

	// Clear inquirer's verbose answer output
	process.stdout.write("\x1B[1A\x1B[2K");

	if (selected.length === 0) {
		console.log(chalk.yellow("\n⚠ No pages selected.\n"));
		return;
	}

	const definitions = loadDefinitions(projectRoot);
	const existingIds = new Set(definitions.map((d) => d.id));

	let added = 0;
	for (const pagePath of selected) {
		const id = deriveIdFromPath(pagePath);
		if (existingIds.has(id)) continue;

		definitions.push({
			id,
			name: id,
			url: pagePath,
			capture: { mode: "fullPage" },
			hideElements: [],
			decorations: [],
		});
		added++;
	}

	saveDefinitions(definitions, projectRoot);
	console.log(chalk.bold.green(`✅ Added ${added} new definition(s)\n`));
};
