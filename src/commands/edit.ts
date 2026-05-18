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
import { waitForPageReady } from "../lib/page-ready.js";
import { executeActions } from "../lib/screenshot.js";
import type { CaptureAction, ScreenshotDefinition } from "../types.js";

interface EditOptions {
	id?: string;
}

const loadEditorScript = (): string => {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	// Bundled by esbuild into a single IIFE — no ESM artifacts to strip.
	const scriptPath = path.join(__dirname, "..", "editor", "inject-script.js");
	return fs.readFileSync(scriptPath, "utf-8");
};

export const editCommand = async (options: EditOptions): Promise<void> => {
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
	const browser = await chromium.launch({
		headless: false,
		args: ["--start-maximized"],
	});
	const context = await browser.newContext(
		defaultContextOptions(config, projectRoot),
	);
	const page = await context.newPage();

	// Without a dialog listener, Playwright dismisses window.alert/confirm/
	// prompt instantly. The editor's record mode uses confirm()/prompt() for
	// "overwrite existing steps?" and "wait how many ms?"; this no-op listener
	// keeps the native dialog open so the user can actually answer.
	page.on("dialog", () => {
		/* leave open for user interaction */
	});

	// Maximize the OS window via CDP — `--start-maximized` is a hint that
	// macOS often ignores. CDP's setWindowBounds is authoritative.
	const cdp = await context.newCDPSession(page);
	try {
		const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as {
			windowId: number;
		};
		await cdp.send("Browser.setWindowBounds", {
			windowId,
			bounds: { windowState: "maximized" },
		});
	} catch {
		// CDP unavailable on some channels — fall through with default size
	}

	const urlPath = def.url.replace(
		/\{(\w+)\}/g,
		(_, key) => def.urlParams?.[key] ?? "",
	);
	const fullUrl = new URL(urlPath, config.app.baseUrl).toString();

	console.log(chalk.blue(`🌐 Opening ${fullUrl}...`));
	// No timeout — user is interactively editing, hitting a 30s timeout
	// mid-edit would be infuriating.
	await page.goto(fullUrl, { waitUntil: "load", timeout: 0 });
	await waitForPageReady(page);

	// Replay existing beforeCapture so the user authors annotations on the
	// same page state kagemusha will eventually screenshot (= modal closed,
	// hover active, scrolled-into-view, etc). Non-optional failures here
	// would break the edit session, so we soften them to a warning — the
	// user can still operate, just with a less-accurate base state.
	if (def.beforeCapture?.length) {
		try {
			await executeActions(page, def.beforeCapture);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			console.log(
				chalk.yellow(`⚠ beforeCapture step failed during edit: ${reason}`),
			);
			console.log(
				chalk.gray(
					"  Continuing without that step. Mark it `optional: true` in definitions.json if it's intermittent.",
				),
			);
		}
	}

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
			beforeCapture?: CaptureAction[];
		};
		savedCount = payload.decorations?.length ?? 0;
		const allDefs = loadDefinitions(projectRoot);
		const idx = allDefs.findIndex((d) => d.id === def.id);
		if (idx >= 0) {
			allDefs[idx] = {
				...def,
				decorations: payload.decorations,
				capture: payload.capture,
				// Editor always sends the current step list (= seeded from existing
				// beforeCapture on load). Empty array → drop the field entirely so
				// definitions.json stays clean for defs that don't need pre-steps.
				beforeCapture:
					payload.beforeCapture && payload.beforeCapture.length > 0
						? payload.beforeCapture
						: undefined,
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

	// Seed the Steps panel from existing beforeCapture. Always call (even with
	// empty array) so the panel can render its initial state.
	await page.evaluate((steps) => {
		(
			window as unknown as {
				__kagemusha_loadSteps: (s: unknown[]) => void;
			}
		).__kagemusha_loadSteps(steps);
	}, def.beforeCapture ?? []);

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
};
