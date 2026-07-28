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
import { launchOptionsFor } from "../lib/playwright-launch.js";
import {
	createSnapshotRenderer,
	type SnapshotRenderer,
} from "../lib/screenshot.js";
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

	// Lazily launched on the first snapshot, then reused across renders.
	let rendererPromise: Promise<SnapshotRenderer> | null = null;
	const getRenderer = (): Promise<SnapshotRenderer> => {
		if (!rendererPromise)
			rendererPromise = createSnapshotRenderer(config, projectRoot);
		return rendererPromise;
	};
	const closeRenderer = async (): Promise<void> => {
		if (!rendererPromise) return;
		try {
			await (await rendererPromise).close();
		} catch {}
	};

	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		headless: false,
		args: ["--start-maximized"],
		...launchOptionsFor(),
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

	if (def.hideElements?.length) {
		for (const selector of def.hideElements) {
			await page.evaluate((sel) => {
				document.querySelectorAll(sel).forEach((el) => {
					(el as HTMLElement).style.display = "none";
				});
			}, selector);
		}
	}

	const setLoading = async (on: boolean): Promise<void> => {
		await page
			.evaluate((v) => {
				(
					window as unknown as {
						__kagemusha_snapshotLoading?: (on: boolean) => void;
					}
				).__kagemusha_snapshotLoading?.(v);
			}, on)
			.catch(() => {});
	};

	const showSnapshot = async (
		steps: CaptureAction[],
		zoom = 1,
	): Promise<void> => {
		// Veil during the render; enterSnapshotMode drops it once the image lands.
		await setLoading(true);
		try {
			const r = await getRenderer();
			const buffer = await r.render(def, steps, zoom);
			const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
			await page.evaluate((url) => {
				(
					window as unknown as {
						__kagemusha_enterSnapshotMode: (u: string) => void;
					}
				).__kagemusha_enterSnapshotMode(url);
			}, dataUrl);
		} catch (e) {
			await setLoading(false);
			throw e;
		}
	};

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
			zoom?: number;
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
				// Drop the default so unzoomed defs stay unchanged in json.
				zoom: payload.zoom && payload.zoom !== 1 ? payload.zoom : undefined,
			};
		}
		saveDefinitions(allDefs, projectRoot);
		saveResolve();
	});

	// Record → Stop sends the recorded steps here to render the snapshot.
	await page.exposeFunction("__kagemusha_replay", async (stepsJson: string) => {
		try {
			const steps = JSON.parse(stepsJson) as CaptureAction[];
			console.log(
				chalk.blue("📸 Rendering the replayed state (headless snapshot)..."),
			);
			await showSnapshot(steps);
			console.log(
				chalk.blue("🎨 Snapshot ready — draw annotations, then click Save.\n"),
			);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			console.log(chalk.yellow(`⚠ Snapshot render failed: ${reason}`));
			console.log(
				chalk.gray(
					"  You can still draw on the live page, or fix the step and Record again.",
				),
			);
		}
	});

	await page.exposeFunction(
		"__kagemusha_setZoom",
		async (payloadJson: string) => {
			try {
				const { zoom, steps } = JSON.parse(payloadJson) as {
					zoom: number;
					steps: CaptureAction[];
				};
				console.log(
					chalk.blue(`🔍 Rendering at ${Math.round(zoom * 100)}%...`),
				);
				await showSnapshot(steps, zoom);
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e);
				console.log(chalk.yellow(`⚠ Zoom render failed: ${reason}`));
			}
		},
	);

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

	const initialZoom = def.zoom ?? 1;
	await page.evaluate((z) => {
		(
			window as unknown as {
				__kagemusha_loadZoom: (zoom: number) => void;
			}
		).__kagemusha_loadZoom(z);
	}, initialZoom);

	if (def.beforeCapture?.length || initialZoom !== 1) {
		try {
			console.log(chalk.blue("📸 Rendering initial snapshot..."));
			await showSnapshot(def.beforeCapture ?? [], initialZoom);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			console.log(chalk.yellow(`⚠ Snapshot render failed: ${reason}`));
			console.log(
				chalk.gray("  Continuing on the live page. Mark flaky steps optional."),
			);
		}
	}

	console.log(
		chalk.blue("🎨 Editor ready. Draw annotations, then click Save.\n"),
	);

	// process.exit guarantees this one-shot command exits even if a browser
	// leaves a lingering handle; the window closes first so it disappears at once.
	const shutdown = async (): Promise<never> => {
		await browser.close().catch(() => {});
		await Promise.race([
			closeRenderer(),
			new Promise<void>((resolve) => setTimeout(resolve, 3000)),
		]);
		process.exit(0);
	};

	try {
		await savePromise;
	} catch {
		console.log(chalk.yellow("\n⚠ Editor closed without saving.\n"));
		await shutdown();
	}

	console.log(
		chalk.bold.green(`\n✅ Saved ${savedCount} annotation(s) for ${def.id}\n`),
	);
	await shutdown();
};
