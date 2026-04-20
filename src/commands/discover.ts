import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { findProjectRoot, loadConfig } from "../lib/config.js";
import { discoverPages } from "../lib/crawl.js";

export const discoverCommand = async (): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Discover Pages\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);

	console.log(chalk.blue(`🔍 Crawling ${config.app.baseUrl} for pages...\n`));

	let pages: { path: string; title: string }[] = [];
	try {
		pages = await discoverPages(config.app.baseUrl, config, projectRoot);
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

	// Let user select which pages to add
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

	if (selected.length === 0) {
		console.log(chalk.yellow("\n⚠ No pages selected.\n"));
		return;
	}

	// Save definitions
	const defsDir = path.join(projectRoot, ".kagemusha/definitions");
	fs.mkdirSync(defsDir, { recursive: true });

	let added = 0;
	for (const pagePath of selected) {
		const id =
			pagePath
				.replace(/^\//, "")
				.replace(/\.\w+$/, "")
				.replace(/[/\\]/g, "-")
				.replace(/[^a-zA-Z0-9-]/g, "") || "page";

		const defPath = path.join(defsDir, `${id}.json`);
		if (fs.existsSync(defPath)) continue;

		const definition = {
			id,
			name: id,
			url: pagePath,
			capture: { mode: "fullPage" },
			hideElements: [],
			decorations: [],
		};

		fs.writeFileSync(defPath, `${JSON.stringify(definition, null, 2)}\n`);
		added++;
	}

	console.log(chalk.bold.green(`\n✅ Added ${added} new definition(s)\n`));
};
