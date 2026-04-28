import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { defaultContextOptions } from "../lib/auth.js";
import {
	findProjectRoot,
	loadConfig,
	loadDefinitions,
	saveDefinitions,
} from "../lib/config.js";
import type { ScreenshotDefinition } from "../types.js";

interface EditOptions {
	id?: string;
}

const loadEditorScript = (): string => {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const scriptPath = path.join(__dirname, "..", "editor", "inject-script.js");
	return fs
		.readFileSync(scriptPath, "utf-8")
		.replace(/^export\s*\{\s*\};?\s*$/m, "");
};

export async function editCommand(options: EditOptions): Promise<void> {
	console.log(chalk.bold("\n🥷 Kagemusha — Annotation Editor\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.id) {
		definitions = definitions.filter((d) => d.id === options.id);
	}

	if (definitions.length === 0) {
		console.log(chalk.red("No definitions found."));
		return;
	}

	if (definitions.length > 1) {
		const inquirer = await import("inquirer");
		const { selected } = await inquirer.default.prompt<{ selected: string }>({
			type: "list",
			name: "selected",
			message: "Which page to edit?",
			choices: definitions.map((d) => ({ name: d.id, value: d.id })),
		});
		definitions = definitions.filter((d) => d.id === selected);
	}

	const def = definitions[0];

	const { chromium } = await import("playwright-chromium");
	const browser = await chromium.launch({ headless: false });
	const context = await browser.newContext(
		defaultContextOptions(config, projectRoot),
	);
	const page = await context.newPage();

	const urlPath = def.url.replace(
		/\{(\w+)\}/g,
		(_, key) => def.urlParams?.[key] ?? "",
	);
	const fullUrl = new URL(urlPath, config.app.baseUrl).toString();

	console.log(chalk.blue(`🌐 Opening ${fullUrl}...`));
	await page.goto(fullUrl, { waitUntil: "networkidle" });

	if (def.hideElements?.length) {
		for (const selector of def.hideElements) {
			await page.evaluate((sel) => {
				document.querySelectorAll(sel).forEach((el) => {
					(el as HTMLElement).style.display = "none";
				});
			}, selector);
		}
	}

	// Expose save function from Node.js to browser
	let savedCount = 0;
	let saveResolve: () => void;
	const savePromise = new Promise<void>((resolve) => {
		saveResolve = resolve;
	});

	// Expose save function BEFORE injecting script
	await page.exposeFunction("__kagemusha_save", (payloadJson: string) => {
		const payload = JSON.parse(payloadJson) as {
			decorations: ScreenshotDefinition["decorations"];
			capture: ScreenshotDefinition["capture"];
		};
		savedCount = payload.decorations?.length ?? 0;
		// Update this definition in the full list and save
		const allDefs = loadDefinitions(projectRoot);
		const idx = allDefs.findIndex((d) => d.id === def.id);
		if (idx >= 0) {
			allDefs[idx] = {
				...def,
				decorations: payload.decorations,
				capture: payload.capture,
			};
		}
		saveDefinitions(allDefs, projectRoot);
		saveResolve();
	});

	// Inject editor script — DPR is read from window.devicePixelRatio inside,
	// which matches the value set on the browser context above.
	const editorScript = loadEditorScript();
	await page.evaluate(editorScript);

	// Load existing annotations (script is now loaded)
	if (def.decorations?.length) {
		await page.evaluate((decs) => {
			(
				window as unknown as {
					__kagemusha_loadAnnotations: (d: unknown[]) => void;
				}
			).__kagemusha_loadAnnotations(decs);
		}, def.decorations);
	}

	// Load existing capture config
	await page.evaluate((cap) => {
		(
			window as unknown as {
				__kagemusha_loadCapture: (c: unknown) => void;
			}
		).__kagemusha_loadCapture(cap);
	}, def.capture);

	console.log(
		chalk.blue("🎨 Editor ready. Draw annotations, then click Save.\n"),
	);

	// Wait for save or browser close
	try {
		await savePromise;
	} catch {
		console.log(chalk.yellow("\n⚠ Editor closed without saving.\n"));
		await browser.close().catch(() => {});
		return;
	}

	await browser.close();

	console.log(
		chalk.bold.green(`\n✅ Saved ${savedCount} annotation(s) for ${def.id}\n`),
	);
}
