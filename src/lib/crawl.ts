import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-chromium";
import type { KagemushaConfig } from "../types.js";

export interface DiscoveredPage {
	path: string;
	title: string;
}

export const discoverPages = async (
	baseUrl: string,
	_config?: KagemushaConfig,
	projectRoot?: string,
	maxDepth = 2,
	maxPages = 50,
): Promise<DiscoveredPage[]> => {
	const { chromium } = await import("playwright-chromium");
	const browser = await chromium.launch({ headless: true });

	// Use saved auth state if available
	const authStatePath = projectRoot
		? path.join(projectRoot, ".kagemusha", "auth-state.json")
		: "";
	const hasAuth = authStatePath && fs.existsSync(authStatePath);

	const context = await browser.newContext(
		hasAuth ? { storageState: authStatePath } : {},
	);

	const origin = new URL(baseUrl).origin;
	const visited = new Set<string>();
	const results: DiscoveredPage[] = [];

	// Read auth metadata for login page and landing page
	const metaPath = projectRoot
		? path.join(projectRoot, ".kagemusha", "auth-meta.json")
		: "";
	let startUrl = baseUrl;

	if (metaPath && fs.existsSync(metaPath)) {
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

		// Add login page to results
		if (meta.loginPath) {
			const loginUrl = new URL(meta.loginPath, baseUrl).toString();
			results.push({ path: meta.loginPath, title: "Login" });
			visited.add(normalizeUrl(loginUrl, origin) ?? loginUrl);
		}

		// Use landing page as crawl starting point
		if (meta.landingPath) {
			startUrl = new URL(meta.landingPath, baseUrl).toString();
		}
	}

	const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];

	const seenPatterns = new Set<string>();

	try {
		while (queue.length > 0 && results.length < maxPages) {
			const item = queue.shift();
			if (!item) break;

			const normalized = normalizeUrl(item.url, origin);
			if (!normalized || visited.has(normalized)) continue;

			// Deduplicate by URL pattern (replace IDs/UUIDs with *)
			const pattern = toPattern(new URL(normalized).pathname);
			if (seenPatterns.has(pattern)) continue;

			visited.add(normalized);

			try {
				const urlPath = new URL(normalized).pathname;
				process.stdout.write(`  Scanning ${urlPath}...`);

				const page = await context.newPage();
				await page.goto(normalized, {
					waitUntil: "networkidle",
					timeout: 15000,
				});

				const title = await page.title();
				const pagePath = new URL(page.url()).pathname;

				// Also check pattern of the final URL (after redirects)
				const finalPattern = toPattern(pagePath);
				if (seenPatterns.has(finalPattern)) {
					process.stdout.write(" (duplicate pattern, skipping)\n");
					await page.close();
					continue;
				}
				seenPatterns.add(finalPattern);

				process.stdout.write(` ${title}\n`);

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
				process.stdout.write(" (failed, skipping)\n");
			}
		}
	} finally {
		await browser.close();
	}

	return results;
};

// Replace numeric IDs, UUIDs, and hex strings with * to detect same-structure URLs
const toPattern = (pathname: string): string =>
	pathname
		.split("/")
		.map((seg) =>
			// UUID
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				seg,
			)
				? "*"
				: // Pure number
					/^\d+$/.test(seg)
					? "*"
					: // Long hex string (8+ chars)
						/^[0-9a-f]{8,}$/i.test(seg)
						? "*"
						: seg,
		)
		.join("/");

const collectLinks = async (page: Page, origin: string): Promise<string[]> => {
	const hrefs = await page.evaluate(() =>
		Array.from(document.querySelectorAll("a[href]")).map(
			(a) => (a as HTMLAnchorElement).href,
		),
	);

	return hrefs
		.map((href) => normalizeUrl(href, origin))
		.filter((url): url is string => url !== null);
};

const normalizeUrl = (url: string, origin: string): string | null => {
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
};
