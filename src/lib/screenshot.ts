import fs from "node:fs";
import path from "node:path";
import type {
	CaptureAction,
	KagemushaConfig,
	ScreenshotDefinition,
} from "../types.js";
import { drawAnnotations } from "./annotate.js";
import { defaultContextOptions } from "./auth.js";
import { getOutputDir } from "./output-dir.js";
import { waitForPageReady } from "./page-ready.js";
import { launchOptionsFor } from "./playwright-launch.js";

type Page = import("playwright-core").Page;
type BrowserContext = import("playwright-core").BrowserContext;

const loadPlaywright = async () => {
	try {
		return await import("playwright-core");
	} catch {
		throw new Error(
			"playwright-core could not be loaded — kagemusha's install may be corrupted. Try reinstalling @wasao/kagemusha.",
		);
	}
};

export interface CaptureFailure {
	id: string;
	reason: string;
}

export const captureScreenshots = async (
	config: KagemushaConfig,
	definitions: ScreenshotDefinition[],
	projectRoot: string,
	options: { outputDir?: string } = {},
): Promise<CaptureFailure[]> => {
	const outputDir = options.outputDir ?? getOutputDir(config, projectRoot);
	fs.mkdirSync(outputDir, { recursive: true });

	const { chromium } = await loadPlaywright();
	const browser = await chromium.launch({
		headless: true,
		...launchOptionsFor(),
	});
	const failures: CaptureFailure[] = [];

	try {
		const context = await browser.newContext(
			defaultContextOptions(config, projectRoot),
		);

		for (const def of definitions) {
			try {
				await captureOne(context, config, def, outputDir);
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e);
				failures.push({ id: def.id, reason });
				console.error(`  ⚠ ${def.id}: ${reason}`);
			}
		}

		await context.close();
	} finally {
		await browser.close();
	}

	return failures;
};

const captureOne = async (
	context: BrowserContext,
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	outputDir: string,
): Promise<void> => {
	const page = await context.newPage();

	if (def.viewport) {
		await page.setViewportSize({
			width: def.viewport.width,
			height: def.viewport.height,
		});
	}

	const url = resolveUrl(config.app.baseUrl, def.url, def.urlParams);
	await page.goto(url, { waitUntil: "load", timeout: 60000 });
	await waitForPageReady(page);

	if (def.hideElements?.length) {
		await hideElements(page, def.hideElements);
	}

	if (def.beforeCapture?.length) {
		await executeActions(page, def.beforeCapture);
	}

	const buffer = await takeScreenshotBuffer(page, def);
	await page.close();

	const finalPath = path.join(outputDir, `${def.id}.png`);
	if (def.decorations?.length) {
		const dpr = config.screenshot.defaultViewport.deviceScaleFactor ?? 2;
		await drawAnnotations(buffer, finalPath, def.decorations, def.capture, dpr);
	} else {
		fs.writeFileSync(finalPath, buffer);
	}
};

const takeScreenshotBuffer = async (
	page: Page,
	def: ScreenshotDefinition,
): Promise<Buffer> => {
	switch (def.capture.mode) {
		case "fullPage":
			return await page.screenshot({ fullPage: true });

		case "crop": {
			const { start, end } = def.capture.crop;
			return await page.screenshot({
				clip: {
					x: start.x,
					y: start.y,
					width: end.x - start.x,
					height: end.y - start.y,
				},
			});
		}

		default:
			console.warn(
				`  ⚠ ${def.id}: unknown capture mode "${(def.capture as { mode: string }).mode}", falling back to fullPage.`,
			);
			return await page.screenshot({ fullPage: true });
	}
};

// Returns false (= skip the step) when `optional: true` and the selector
// doesn't match anything on the page. The page.$ probe completes
// instantly — no Playwright timeout involved.
const isPresent = async (page: Page, selector: string): Promise<boolean> =>
	(await page.$(selector)) !== null;

// Exported so the `edit` command can replay beforeCapture before injecting
// the editor — that way users author annotations on the same page state
// kagemusha will eventually screenshot.
export const executeActions = async (
	page: Page,
	actions: CaptureAction[],
): Promise<void> => {
	for (const action of actions) {
		switch (action.action) {
			case "click":
				if (action.optional && !(await isPresent(page, action.selector))) break;
				await page.click(action.selector);
				break;
			case "type":
				if (action.optional && !(await isPresent(page, action.selector))) break;
				await page.fill(action.selector, action.text);
				break;
			case "select":
				if (action.optional && !(await isPresent(page, action.selector))) break;
				await page.selectOption(action.selector, action.value);
				break;
			case "hover":
				if (action.optional && !(await isPresent(page, action.selector))) break;
				await page.hover(action.selector);
				break;
			case "scroll":
				if (action.selector) {
					await page
						.locator(action.selector)
						.evaluate((el, y) => el.scrollTo(0, y), action.y);
				} else {
					await page.evaluate((y) => window.scrollTo(0, y), action.y);
				}
				break;
			case "wait":
				await page.waitForTimeout(action.ms);
				break;
			case "waitForSelector":
				try {
					await page.waitForSelector(action.selector, {
						timeout: action.timeout ?? 10000,
					});
				} catch (e) {
					// `optional: true` turns wait-for-selector failures into a
					// no-op (= the rest of beforeCapture continues). Without
					// optional, the timeout bubbles up and fails the capture.
					if (!action.optional) throw e;
				}
				break;
			case "waitForNavigation":
				await page.waitForLoadState("networkidle", {
					timeout: action.timeout ?? 30000,
				});
				break;
			case "evaluate":
				await page.evaluate(action.script);
				break;
		}
	}
};

const hideElements = async (page: Page, selectors: string[]): Promise<void> => {
	for (const selector of selectors) {
		await page.evaluate((sel) => {
			document.querySelectorAll(sel).forEach((el) => {
				(el as HTMLElement).style.display = "none";
			});
		}, selector);
	}
};

const resolveUrl = (
	baseUrl: string,
	urlPath: string,
	params?: Record<string, string>,
): string => {
	let resolved = urlPath;
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			resolved = resolved.replace(`{${key}}`, value);
		}
	}
	return new URL(resolved, baseUrl).toString();
};
