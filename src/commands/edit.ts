import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";

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
	const context = await browser.newContext({
		viewport: {
			width: config.screenshot.defaultViewport.width,
			height: config.screenshot.defaultViewport.height,
		},
	});
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
	const defPath = path.join(
		projectRoot,
		".kagemusha/definitions",
		`${def.id}.json`,
	);

	let savedCount = 0;
	let saveResolve: () => void;
	const savePromise = new Promise<void>((resolve) => {
		saveResolve = resolve;
	});

	// Expose save function BEFORE injecting script
	await page.exposeFunction("__kagemusha_save", (decorationsJson: string) => {
		const decorations = JSON.parse(decorationsJson);
		savedCount = decorations.length;
		const updatedDef = { ...def, decorations };
		fs.writeFileSync(defPath, `${JSON.stringify(updatedDef, null, 2)}\n`);
		saveResolve();
	});

	// Set dpr BEFORE injecting script
	const dpr = config.screenshot.defaultViewport.deviceScaleFactor ?? 2;
	await page.evaluate((d) => {
		(window as unknown as { __kagemusha_dpr: number }).__kagemusha_dpr = d;
	}, dpr);

	// Inject editor script and wait for it to fully load
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
		chalk.bold.green(`\n✅ Saved ${savedCount} annotation(s) to ${defPath}\n`),
	);
}
