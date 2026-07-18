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

// Runs `fn` with a fresh headless browser + context, closing both afterward.
// Shared by capture (many defs) and the editor snapshot render (one def).
const withHeadlessContext = async <T>(
	config: KagemushaConfig,
	projectRoot: string,
	fn: (context: BrowserContext) => Promise<T>,
): Promise<T> => {
	const { chromium } = await loadPlaywright();
	const browser = await chromium.launch({
		headless: true,
		...launchOptionsFor(),
	});
	try {
		const context = await browser.newContext(
			defaultContextOptions(config, projectRoot),
		);
		try {
			return await fn(context);
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
};

export const captureScreenshots = async (
	config: KagemushaConfig,
	definitions: ScreenshotDefinition[],
	projectRoot: string,
	options: { outputDir?: string } = {},
): Promise<CaptureFailure[]> => {
	const outputDir = options.outputDir ?? getOutputDir(config, projectRoot);
	fs.mkdirSync(outputDir, { recursive: true });

	const failures: CaptureFailure[] = [];
	await withHeadlessContext(config, projectRoot, async (context) => {
		for (const def of definitions) {
			try {
				await captureOne(context, config, def, outputDir);
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e);
				failures.push({ id: def.id, reason });
				console.error(`  ⚠ ${def.id}: ${reason}`);
			}
		}
	});
	return failures;
};

// Open a page, navigate to `def`, and prepare it for a screenshot: viewport,
// hidden elements, and replayed `steps` (re-running the recorded beforeCapture
// to reproduce the page state). Shared by capture and the editor snapshot render.
const openPreparedPage = async (
	context: BrowserContext,
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	steps: CaptureAction[] | undefined,
	replayOpts: ReplayOptions = {},
): Promise<Page> => {
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
	if (steps?.length) {
		await executeActions(page, steps, replayOpts);
	}
	return page;
};

const captureOne = async (
	context: BrowserContext,
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	outputDir: string,
): Promise<void> => {
	const page = await openPreparedPage(context, config, def, def.beforeCapture);
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

// Editor snapshot replay: `soft` skips a failing step, `timeout` fails fast. Capture passes neither.
export interface ReplayOptions {
	soft?: boolean;
	timeout?: number;
}

// Ambiguous `text=` selectors can match a hidden dup; act on the first VISIBLE
// match so a dropdown trigger opens instead of timing out on the hidden one.
const actOnFirstVisible = async (
	page: Page,
	selector: string,
	timeout: number | undefined,
	kind: "click" | "hover",
): Promise<void> => {
	const loc = page.locator(selector);
	const count = await loc.count();
	for (let i = 0; i < count; i++) {
		const nth = loc.nth(i);
		let visible = false;
		try {
			visible = await nth.isVisible();
		} catch {
			visible = false;
		}
		if (visible) {
			if (kind === "click") await nth.click({ timeout });
			else await nth.hover({ timeout });
			return;
		}
	}
	if (kind === "click") await page.click(selector, { timeout });
	else await page.hover(selector, { timeout });
};

const runAction = async (
	page: Page,
	action: CaptureAction,
	opts: ReplayOptions,
): Promise<void> => {
	const timeout = opts.timeout;
	switch (action.action) {
		case "click":
			if (action.optional && !(await isPresent(page, action.selector))) return;
			if (opts.soft) {
				await actOnFirstVisible(page, action.selector, timeout, "click");
				return;
			}
			await page.click(action.selector, { timeout });
			return;
		case "type":
			if (action.optional && !(await isPresent(page, action.selector))) return;
			await page.fill(action.selector, action.text, { timeout });
			return;
		case "select":
			if (action.optional && !(await isPresent(page, action.selector))) return;
			await page.selectOption(action.selector, action.value, { timeout });
			return;
		case "hover":
			if (action.optional && !(await isPresent(page, action.selector))) return;
			if (opts.soft) {
				await actOnFirstVisible(page, action.selector, timeout, "hover");
				return;
			}
			await page.hover(action.selector, { timeout });
			return;
		case "scroll":
			if (action.selector) {
				await page
					.locator(action.selector)
					.evaluate((el, y) => el.scrollTo(0, y), action.y);
			} else {
				await page.evaluate((y) => window.scrollTo(0, y), action.y);
			}
			return;
		case "wait":
			await page.waitForTimeout(action.ms);
			return;
		case "waitForSelector":
			try {
				await page.waitForSelector(action.selector, {
					timeout: action.timeout ?? timeout ?? 10000,
				});
			} catch (e) {
				// `optional: true` turns wait-for-selector failures into a
				// no-op (= the rest of beforeCapture continues). Without
				// optional, the timeout bubbles up and fails the capture.
				if (!action.optional) throw e;
			}
			return;
		case "waitForNavigation":
			await page.waitForLoadState("networkidle", {
				timeout: action.timeout ?? 30000,
			});
			return;
		case "evaluate":
			await page.evaluate(action.script);
			return;
	}
};

// Replays beforeCapture — capture (strict) and the editor snapshot render (soft).
export const executeActions = async (
	page: Page,
	actions: CaptureAction[],
	opts: ReplayOptions = {},
): Promise<void> => {
	for (const action of actions) {
		try {
			await runAction(page, action, opts);
		} catch (e) {
			if (!opts.soft) throw e;
			const where = "selector" in action ? ` ${action.selector}` : "";
			const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
			console.warn(`  ⚠ replay: skipped ${action.action}${where} — ${msg}`);
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

// Renders `def` after replaying `steps`, headlessly, and returns a fullPage PNG
// — the editor's annotation backdrop. Headless is required: a headed browser
// drops :hover before the screenshot.
export const renderSnapshot = async (
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	steps: CaptureAction[],
	projectRoot: string,
): Promise<Buffer> =>
	withHeadlessContext(config, projectRoot, async (context) => {
		// Soft: skipping a failed item-select leaves the menu open to annotate.
		const page = await openPreparedPage(context, config, def, steps, {
			soft: true,
			timeout: 5000,
		});
		return page.screenshot({ fullPage: true });
	});

// Exported so `capture` can compute the page URL for `summary.json` /
// notifications without re-implementing the {param} substitution + baseUrl
// resolution logic.
export const resolveUrl = (
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
