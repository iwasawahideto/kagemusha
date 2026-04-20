import fs from "node:fs";
import path from "node:path";
import type {
	CaptureAction,
	CaptureResult,
	KagemushaConfig,
	ScreenshotDefinition,
} from "../types.js";

type Browser = import("playwright-chromium").Browser;
type Page = import("playwright-chromium").Page;
type BrowserContext = import("playwright-chromium").BrowserContext;

async function loadPlaywright() {
	try {
		return await import("playwright-chromium");
	} catch {
		throw new Error(
			"Playwright is required for screenshot capture.\n" +
				"Install it with: npm install -D playwright && npx playwright install chromium",
		);
	}
}

const SCREENSHOTS_DIR = "screenshots";

export async function captureScreenshots(
	config: KagemushaConfig,
	definitions: ScreenshotDefinition[],
	projectRoot: string,
): Promise<CaptureResult[]> {
	const outputDir = path.join(projectRoot, SCREENSHOTS_DIR);
	fs.mkdirSync(outputDir, { recursive: true });

	const { chromium } = await loadPlaywright();
	const browser = await chromium.launch({ headless: true });
	const results: CaptureResult[] = [];

	try {
		const context = await createContext(browser, config, projectRoot);

		for (const def of definitions) {
			const result = await captureOne(context, config, def, outputDir);
			results.push(result);
		}

		await context.close();
	} finally {
		await browser.close();
	}

	return results;
}

async function createContext(
	browser: Browser,
	config: KagemushaConfig,
	projectRoot: string,
): Promise<BrowserContext> {
	const viewport = config.screenshot.defaultViewport;
	const authStatePath = path.join(projectRoot, ".kagemusha", "auth-state.json");
	const hasAuth = fs.existsSync(authStatePath);

	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height },
		deviceScaleFactor: viewport.deviceScaleFactor ?? 2,
		...(hasAuth ? { storageState: authStatePath } : {}),
	});

	return context;
}

async function captureOne(
	context: BrowserContext,
	config: KagemushaConfig,
	def: ScreenshotDefinition,
	outputDir: string,
): Promise<CaptureResult> {
	const page = await context.newPage();

	if (def.viewport) {
		await page.setViewportSize({
			width: def.viewport.width,
			height: def.viewport.height,
		});
	}

	const url = resolveUrl(config.app.baseUrl, def.url, def.urlParams);
	await page.goto(url, { waitUntil: "networkidle" });

	if (def.hideElements?.length) {
		await hideElements(page, def.hideElements);
	}

	if (def.beforeCapture?.length) {
		await executeActions(page, def.beforeCapture);
	}

	const rawPath = path.join(outputDir, `${def.id}.raw.png`);
	await takeScreenshot(page, def, rawPath);

	await page.close();

	const timestamp = new Date().toISOString();

	return {
		id: def.id,
		rawPath,
		annotatedPath: rawPath, // annotate step will create the final version
		timestamp,
	};
}

async function takeScreenshot(
	page: Page,
	def: ScreenshotDefinition,
	outputPath: string,
): Promise<void> {
	switch (def.capture.mode) {
		case "fullPage":
			await page.screenshot({ path: outputPath, fullPage: true });
			break;

		case "selector": {
			const element = await page.waitForSelector(def.capture.selector, {
				timeout: 10000,
			});
			if (!element) {
				throw new Error(
					`Element not found: ${def.capture.selector} (definition: ${def.id})`,
				);
			}
			await element.screenshot({ path: outputPath });
			break;
		}

		case "crop": {
			const { start, end } = def.capture.crop;
			await page.screenshot({
				path: outputPath,
				clip: {
					x: start.x,
					y: start.y,
					width: end.x - start.x,
					height: end.y - start.y,
				},
			});
			break;
		}
	}
}

async function executeActions(
	page: Page,
	actions: CaptureAction[],
): Promise<void> {
	for (const action of actions) {
		switch (action.action) {
			case "click":
				await page.click(action.selector);
				break;
			case "type":
				await page.fill(action.selector, action.text);
				break;
			case "select":
				await page.selectOption(action.selector, action.value);
				break;
			case "hover":
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
				await page.waitForSelector(action.selector, {
					timeout: action.timeout ?? 10000,
				});
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
}

async function hideElements(page: Page, selectors: string[]): Promise<void> {
	for (const selector of selectors) {
		await page.evaluate((sel) => {
			document.querySelectorAll(sel).forEach((el) => {
				(el as HTMLElement).style.display = "none";
			});
		}, selector);
	}
}

function resolveUrl(
	baseUrl: string,
	urlPath: string,
	params?: Record<string, string>,
): string {
	let resolved = urlPath;
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			resolved = resolved.replace(`{${key}}`, value);
		}
	}
	return new URL(resolved, baseUrl).toString();
}
