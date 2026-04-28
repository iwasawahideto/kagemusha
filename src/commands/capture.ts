import chalk from "chalk";
import { annotateScreenshots } from "../lib/annotate.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { captureScreenshots } from "../lib/screenshot.js";

interface CaptureOptions {
	ids?: string;
	open?: boolean;
}

export async function captureCommand(options: CaptureOptions): Promise<void> {
	console.log(chalk.bold("\n🥷 Kagemusha — Capture screenshots\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.ids) {
		const ids = options.ids.split(",").map((s) => s.trim());
		definitions = definitions.filter((d) => ids.includes(d.id));
	}

	if (definitions.length === 0) {
		console.log(chalk.yellow("No screenshot definitions found."));
		return;
	}

	console.log(
		chalk.blue(`📸 Capturing ${definitions.length} screenshot(s)...`),
	);
	const results = await captureScreenshots(config, definitions, projectRoot);

	console.log(chalk.blue("🎨 Drawing annotations..."));
	const annotated = await annotateScreenshots(
		definitions,
		results,
		projectRoot,
	);

	console.log(
		chalk.bold.green(`\n✅ Done! Screenshots saved to screenshots/\n`),
	);

	for (const r of annotated) {
		console.log(chalk.gray(`  ${r.id} → ${r.annotatedPath}`));
	}

	if (options.open) {
		const { chromium } = await import("playwright-chromium");
		const browser = await chromium.launch({ headless: false });
		const context = await browser.newContext();

		for (const result of annotated) {
			const page = await context.newPage();
			await page.goto(`file://${result.annotatedPath}`);
		}

		console.log(chalk.gray("\nPress Ctrl+C to close preview.\n"));
		await new Promise(() => {});
	}
}
