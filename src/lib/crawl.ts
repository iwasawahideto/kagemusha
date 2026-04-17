import type { Page } from "playwright-chromium";

export interface DiscoveredPage {
	path: string;
	title: string;
}

export async function discoverPages(
	baseUrl: string,
	maxDepth: number = 2,
	maxPages: number = 50,
): Promise<DiscoveredPage[]> {
	const { chromium } = await import("playwright-chromium");
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext();

	const origin = new URL(baseUrl).origin;
	const visited = new Set<string>();
	const results: DiscoveredPage[] = [];
	const queue: { url: string; depth: number }[] = [{ url: baseUrl, depth: 0 }];

	try {
		while (queue.length > 0 && results.length < maxPages) {
			const item = queue.shift();
			if (!item) break;

			const normalized = normalizeUrl(item.url, origin);
			if (!normalized || visited.has(normalized)) continue;
			visited.add(normalized);

			try {
				const page = await context.newPage();
				await page.goto(normalized, {
					waitUntil: "domcontentloaded",
					timeout: 10000,
				});

				const title = await page.title();
				const pagePath = new URL(page.url()).pathname;

				results.push({
					path: pagePath,
					title: title || pagePath,
				});

				if (item.depth < maxDepth) {
					const links = await collectLinks(page, origin);
					for (const link of links) {
						if (!visited.has(link)) {
							queue.push({ url: link, depth: item.depth + 1 });
						}
					}
				}

				await page.close();
			} catch {
				// Skip pages that fail to load
			}
		}
	} finally {
		await browser.close();
	}

	return results;
}

async function collectLinks(page: Page, origin: string): Promise<string[]> {
	const hrefs = await page.evaluate(() =>
		Array.from(document.querySelectorAll("a[href]")).map(
			(a) => (a as HTMLAnchorElement).href,
		),
	);

	return hrefs
		.map((href) => normalizeUrl(href, origin))
		.filter((url): url is string => url !== null);
}

function normalizeUrl(url: string, origin: string): string | null {
	try {
		const parsed = new URL(url, origin);

		// Same origin only
		if (parsed.origin !== origin) return null;

		// Skip non-page resources
		const skip = [
			".js",
			".css",
			".png",
			".jpg",
			".jpeg",
			".gif",
			".svg",
			".ico",
			".woff",
			".woff2",
			".ttf",
			".eot",
			".pdf",
			".zip",
			".json",
			".xml",
		];
		if (skip.some((ext) => parsed.pathname.endsWith(ext))) return null;

		// Skip anchors and mailto
		if (url.startsWith("mailto:") || url.startsWith("tel:")) return null;

		// Remove hash and search params for deduplication
		parsed.hash = "";
		parsed.search = "";

		return parsed.toString();
	} catch {
		return null;
	}
}
