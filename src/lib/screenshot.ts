import fs from "node:fs";
import path from "node:path";
import type {
	CaptureAction,
	KagemushaConfig,
	ScreenshotDefinition,
} from "../types.js";
import { drawAnnotations } from "./annotate.js";
import { authContextOptions } from "./auth.js";
import { getOutputDir } from "./output-dir.js";
import { waitForPageReady } from "./page-ready.js";
import { launchOptionsFor } from "./playwright-launch.js";

type Page = import("playwright-core").Page;
type Locator = import("playwright-core").Locator;
type Browser = import("playwright-core").Browser;
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

// Zoom is applied by transforming the render context: viewport → base/zoom,
// DPR → baseDPR×zoom (Playwright has no zoom API). baseDPR is the config DPR
// (not def.viewport's): the editor renders + stores annotations at that DPR, so
// capture must match it or annotations drift.
export const effectiveRenderParams = (
	config: KagemushaConfig,
	def: Pick<ScreenshotDefinition, "viewport" | "zoom">,
	zoomOverride?: number,
): {
	zoom: number;
	viewport: { width: number; height: number };
	deviceScaleFactor: number;
} => {
	const base = def.viewport ?? config.screenshot.defaultViewport;
	const baseDpr = config.screenshot.defaultViewport.deviceScaleFactor ?? 2;
	const zoom = zoomOverride ?? def.zoom ?? 1;
	return {
		zoom,
		viewport: {
			width: Math.round(base.width / zoom),
			height: Math.round(base.height / zoom),
		},
		deviceScaleFactor: baseDpr * zoom,
	};
};

// The render viewport is base/zoom, so ÷zoom lands on the same content (as cropClip).
export const scrollTargetY = (scrollY: number, zoom: number): number =>
	scrollY / zoom;

// Live editor values that win over the definition on disk (capture passes none).
export interface RenderOverrides {
	zoom?: number;
	scrollY?: number;
}

const contextOptionsForZoom = (
	config: KagemushaConfig,
	projectRoot: string | undefined,
	def: Pick<ScreenshotDefinition, "viewport" | "zoom">,
	zoomOverride?: number,
) => {
	const { viewport, deviceScaleFactor } = effectiveRenderParams(
		config,
		def,
		zoomOverride,
	);
	return {
		baseURL: config.app.baseUrl,
		viewport,
		deviceScaleFactor,
		...authContextOptions(projectRoot),
	};
};

// Callers make their own contexts: deviceScaleFactor (= zoom) is context-level.
const withHeadlessBrowser = async <T>(
	fn: (browser: Browser) => Promise<T>,
): Promise<T> => {
	const { chromium } = await loadPlaywright();
	const browser = await chromium.launch({
		headless: true,
		...launchOptionsFor(),
	});
	try {
		return await fn(browser);
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
	// Group by effective DPR (stable sort) so mixed-zoom sets open one context
	// per DPR instead of re-creating it on every change in definition order.
	const ordered = [...definitions].sort(
		(a, b) =>
			effectiveRenderParams(config, a).deviceScaleFactor -
			effectiveRenderParams(config, b).deviceScaleFactor,
	);
	await withHeadlessBrowser(async (browser) => {
		let context: BrowserContext | null = null;
		let currentDsf: number | null = null;
		try {
			for (const def of ordered) {
				const dsf = effectiveRenderParams(config, def).deviceScaleFactor;
				if (!context || dsf !== currentDsf) {
					if (context) await context.close();
					context = await browser.newContext(
						contextOptionsForZoom(config, projectRoot, def),
					);
					currentDsf = dsf;
				}
				try {
					await captureOne(context, config, def, outputDir);
				} catch (e) {
					const reason = e instanceof Error ? e.message : String(e);
					failures.push({ id: def.id, reason });
					console.error(`  ⚠ ${def.id}: ${reason}`);
				}
			}
		} finally {
			if (context) await context.close();
		}
	});
	return failures;
};

// Open a page, navigate to `def`, and prepare it for a screenshot: viewport,
// hidden elements, replayed `steps` (re-running the recorded beforeCapture), and
// the saved scroll position. Shared by capture and the editor snapshot render.
export const openPreparedPage = async (
	context: BrowserContext,
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	steps: CaptureAction[] | undefined,
	replayOpts: ReplayOptions = {},
	overrides: RenderOverrides = {},
): Promise<Page> => {
	const page = await context.newPage();
	const { zoom, viewport } = effectiveRenderParams(config, def, overrides.zoom);
	await page.setViewportSize(viewport);
	const url = resolveUrl(config.app.baseUrl, def.url, def.urlParams);
	await page.goto(url, { waitUntil: "load", timeout: 60000 });
	await waitForPageReady(page);
	if (def.hideElements?.length) {
		await hideElements(page, def.hideElements);
	}
	if (steps?.length) {
		await executeActions(page, steps, { ...replayOpts, zoom });
	}
	// After the steps: beforeCapture may scroll, and the saved position is post-replay.
	const scrollY = overrides.scrollY ?? def.scrollY ?? 0;
	if (scrollY > 0) {
		await page.evaluate(
			(y) => window.scrollTo({ top: y, behavior: "instant" }),
			scrollTargetY(scrollY, zoom),
		);
		// Content below the fold is often lazy-loaded — let it settle.
		await waitForPageReady(page);
	}
	return page;
};

const captureOne = async (
	context: BrowserContext,
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	outputDir: string,
): Promise<void> => {
	const { zoom } = effectiveRenderParams(config, def);
	const page = await openPreparedPage(context, config, def, def.beforeCapture);
	const buffer = await takeScreenshotBuffer(page, def, zoom);
	await page.close();

	const finalPath = path.join(outputDir, `${def.id}.png`);
	if (def.decorations?.length) {
		const dpr = config.screenshot.defaultViewport.deviceScaleFactor ?? 2;
		await drawAnnotations(buffer, finalPath, def.decorations, def.capture, dpr);
	} else {
		fs.writeFileSync(finalPath, buffer);
	}
};

// crop is stored in base-viewport CSS px; the capture viewport is base/zoom, so
// the clip is divided by zoom to land on the same content.
export const cropClip = (
	crop: { start: { x: number; y: number }; end: { x: number; y: number } },
	zoom: number,
): { x: number; y: number; width: number; height: number } => ({
	x: crop.start.x / zoom,
	y: crop.start.y / zoom,
	width: (crop.end.x - crop.start.x) / zoom,
	height: (crop.end.y - crop.start.y) / zoom,
});

export const takeScreenshotBuffer = async (
	page: Page,
	def: ScreenshotDefinition,
	zoom = 1,
): Promise<Buffer> => {
	switch (def.capture.mode) {
		case "fullPage":
			return await page.screenshot({ fullPage: true });

		// fullPage makes Playwright read `clip` as document-relative, not viewport-relative.
		case "crop":
			return await page.screenshot({
				fullPage: true,
				clip: cropClip(def.capture.crop, zoom),
			});

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

// `soft` skips a failing step instead of aborting; `timeout` fails fast. Capture
// passes neither (strict, default timeout). Visible-match preference always applies.
export interface ReplayOptions {
	soft?: boolean;
	timeout?: number;
	zoom?: number;
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

// A recorded container selector can go ambiguous by capture time, and a strict
// locator would fail the whole capture — prefer a visible match that can scroll.
const scrollFirstVisible = async (
	page: Page,
	selector: string,
	y: number,
): Promise<void> => {
	const loc = page.locator(selector);
	const scrollTo = (target: Locator): Promise<void> =>
		target.evaluate((el, v) => el.scrollTo({ top: v, behavior: "instant" }), y);
	const count = await loc.count();
	// Unique (or missing — then evaluate reports it) needs no disambiguation.
	if (count <= 1) {
		await scrollTo(loc);
		return;
	}
	let firstVisible: Locator | null = null;
	for (let i = 0; i < count; i++) {
		const nth = loc.nth(i);
		try {
			if (!(await nth.isVisible())) continue;
			if (await nth.evaluate((el) => el.scrollHeight > el.clientHeight)) {
				await scrollTo(nth);
				return;
			}
		} catch {
			continue;
		}
		firstVisible ??= nth;
	}
	await scrollTo(firstVisible ?? loc.first());
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
			await actOnFirstVisible(page, action.selector, timeout, "click");
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
			await actOnFirstVisible(page, action.selector, timeout, "hover");
			return;
		case "scroll": {
			const y = scrollTargetY(action.y, opts.zoom ?? 1);
			// `behavior: instant` overrides CSS scroll-behavior: smooth, which would
			// still be animating when the screenshot is taken.
			if (action.selector) {
				await scrollFirstVisible(page, action.selector, y);
			} else {
				await page.evaluate(
					(v) => window.scrollTo({ top: v, behavior: "instant" }),
					y,
				);
			}
			return;
		}
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

// Headless is required: a headed browser drops :hover before the screenshot.
const renderSnapshotBuffer = async (
	browser: Browser,
	config: KagemushaConfig,
	projectRoot: string,
	def: ScreenshotDefinition,
	steps: CaptureAction[],
	overrides: RenderOverrides,
): Promise<Buffer> => {
	const context = await browser.newContext(
		contextOptionsForZoom(config, projectRoot, def, overrides.zoom),
	);
	try {
		// Soft: skipping a failed item-select leaves the menu open to annotate.
		const page = await openPreparedPage(
			context,
			config,
			def,
			steps,
			{ soft: true, timeout: 5000 },
			overrides,
		);
		return await page.screenshot({ fullPage: true });
	} finally {
		await context.close();
	}
};

export interface SnapshotRenderer {
	render: (
		def: ScreenshotDefinition,
		steps: CaptureAction[],
		overrides?: RenderOverrides,
	) => Promise<Buffer>;
	close: () => Promise<void>;
}

// One long-lived browser reused across renders (skips per-render Chrome launch).
export const createSnapshotRenderer = async (
	config: KagemushaConfig,
	projectRoot: string,
): Promise<SnapshotRenderer> => {
	const { chromium } = await loadPlaywright();
	const browser = await chromium.launch({
		headless: true,
		...launchOptionsFor(),
	});
	// Absorb the fresh-Chrome first-page cost (~1.5s) here, not on the first render.
	await browser
		.newPage()
		.then((p) => p.close())
		.catch(() => {});
	return {
		render: (def, steps, overrides = {}) =>
			renderSnapshotBuffer(browser, config, projectRoot, def, steps, overrides),
		close: () => browser.close(),
	};
};

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
