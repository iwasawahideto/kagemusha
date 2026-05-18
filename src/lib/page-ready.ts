type Page = import("playwright-core").Page;

/**
 * After `page.goto({ waitUntil: "load" })`, wait for the SPA to settle before
 * capturing or letting the user edit. Strategy:
 *
 * 1. Best-effort `networkidle` with a 3s cap — succeeds quickly on pages
 *    whose initial API fetches complete fast. SPAs with permanent socket
 *    connections never reach networkidle, but we cap the wait so they don't
 *    hang the run.
 * 2. 500ms hydration buffer so React / Vue have time to mount after the
 *    initial render.
 *
 * Pages that need more than this should add a per-definition
 * `beforeCapture: [{action:"waitForSelector",selector:"..."}]`.
 */
export const waitForPageReady = async (page: Page): Promise<void> => {
	await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
	await page.waitForTimeout(500);
};
