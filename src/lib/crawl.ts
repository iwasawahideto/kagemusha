import fs from "node:fs";
import chalk from "chalk";
import type { BrowserContext, Page } from "playwright-chromium";
import { getAuthMetaPath, getAuthStatePath, hasAuthState } from "./auth.js";

export interface DiscoveredPage {
	path: string;
	title: string;
}

export const discoverPages = async (
	baseUrl: string,
	projectRoot?: string,
	maxDepth = 3,
	maxPages = 200,
): Promise<DiscoveredPage[]> => {
	const { chromium } = await import("playwright-chromium");
	const browser = await chromium.launch({ headless: true });

	const hasAuth = projectRoot ? hasAuthState(projectRoot) : false;

	const context = await browser.newContext(
		hasAuth && projectRoot
			? { storageState: getAuthStatePath(projectRoot) }
			: {},
	);

	const origin = new URL(baseUrl).origin;
	const visited = new Set<string>();
	const results: DiscoveredPage[] = [];

	const metaPath = projectRoot ? getAuthMetaPath(projectRoot) : "";
	let startUrl = baseUrl;
	let loginPath = "";

	if (metaPath && fs.existsSync(metaPath)) {
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

		if (meta.loginPath) {
			loginPath = meta.loginPath;
			const loginUrl = new URL(meta.loginPath, baseUrl).toString();
			results.push({ path: meta.loginPath, title: "Login" });
			visited.add(normalizeUrl(loginUrl, origin) ?? loginUrl);
		}

		if (meta.landingPath) {
			startUrl = new URL(meta.landingPath, baseUrl).toString();
		}
	}

	const seenPatterns = new Set<string>();

	try {
		// Phase 1: Click nav elements on start page to discover SPA routes
		console.log(chalk.gray("  Phase 1: Clicking navigation elements...\n"));
		const navUrls = await discoverByClicking(
			context,
			startUrl,
			origin,
			loginPath,
		);

		// Add start page
		const startNorm = normalizeUrl(startUrl, origin);
		if (startNorm) {
			const startPattern = toPattern(new URL(startNorm).pathname);
			seenPatterns.add(startPattern);
			visited.add(startNorm);
		}

		// Queue nav-discovered URLs for BFS
		const queue: { url: string; depth: number }[] = [];
		for (const url of navUrls) {
			const norm = normalizeUrl(url, origin);
			if (!norm || visited.has(norm)) continue;
			const pat = toPattern(new URL(norm).pathname);
			if (seenPatterns.has(pat)) continue;
			queue.push({ url: norm, depth: 1 });
		}

		// Also queue startUrl for link collection
		if (startNorm && !visited.has(startNorm)) {
			queue.unshift({ url: startNorm, depth: 0 });
		}

		// Add start page to results
		try {
			const page = await context.newPage();
			await page.goto(startUrl, {
				waitUntil: "networkidle",
				timeout: 60000,
			});
			const title = await page.title();
			const pagePath = new URL(page.url()).pathname;

			// Detect expired session
			if (loginPath && pagePath === loginPath) {
				console.log(
					chalk.yellow(
						`\n⚠ Redirected to ${loginPath} — session expired? Run "kagemusha login" first.\n`,
					),
				);
				await page.close();
				await browser.close();
				return results;
			}

			const startPattern = toPattern(pagePath);
			seenPatterns.add(startPattern);
			results.push({ path: pagePath, title: title || pagePath });
			console.log(
				chalk.gray(`  ${pagePath}`) +
					`  ${chalk.green("✓")} ${chalk.white(title)}`,
			);

			// Collect <a href> links from start page
			const links = await collectLinks(page, origin);
			for (const link of links) {
				if (visited.has(link)) continue;
				const linkPattern = toPattern(new URL(link).pathname);
				if (seenPatterns.has(linkPattern)) continue;
				queue.push({ url: link, depth: 1 });
			}

			await page.close();
		} catch {
			// start page failed, continue with nav-discovered URLs
		}

		// Phase 2: BFS crawl from discovered URLs
		if (queue.length > 0) {
			console.log(
				chalk.gray(
					`\n  Phase 2: Crawling ${queue.length} discovered URLs...\n`,
				),
			);
		}

		while (queue.length > 0 && results.length < maxPages) {
			const item = queue.shift();
			if (!item) break;

			const normalized = normalizeUrl(item.url, origin);
			if (!normalized || visited.has(normalized)) continue;

			const pattern = toPattern(new URL(normalized).pathname);
			if (seenPatterns.has(pattern)) continue;
			seenPatterns.add(pattern);

			visited.add(normalized);

			const urlPath = new URL(normalized).pathname;

			try {
				process.stdout.write(chalk.gray(`  ${urlPath}`));

				const page = await context.newPage();
				await page.goto(normalized, {
					waitUntil: "networkidle",
					timeout: 60000,
				});

				const title = await page.title();
				const pagePath = new URL(page.url()).pathname;

				// Skip if redirected to a known pattern
				const finalPattern = toPattern(pagePath);
				if (finalPattern !== pattern && seenPatterns.has(finalPattern)) {
					process.stdout.write(chalk.gray(" (skip)\n"));
					await page.close();
					continue;
				}
				seenPatterns.add(finalPattern);

				process.stdout.write(`  ${chalk.green("✓")} ${chalk.white(title)}\n`);

				results.push({
					path: pagePath,
					title: title || pagePath,
				});

				if (item.depth < maxDepth) {
					const links = await collectLinks(page, origin);
					for (const link of links) {
						if (visited.has(link)) continue;
						const linkPattern = toPattern(new URL(link).pathname);
						if (seenPatterns.has(linkPattern)) continue;
						queue.push({ url: link, depth: item.depth + 1 });
					}
				}

				await page.close();
			} catch {
				process.stdout.write(chalk.yellow(" (timeout, skip)\n"));
			}
		}

		if (results.length >= maxPages) {
			console.log(chalk.gray(`\n  Reached max ${maxPages} pages, stopping.\n`));
		}
	} finally {
		await browser.close();
	}

	return results;
};

// Click nav/sidebar link elements and collect URLs they navigate to
const discoverByClicking = async (
	context: BrowserContext,
	startUrl: string,
	origin: string,
	loginPath: string,
): Promise<string[]> => {
	const page = await context.newPage();
	await page.goto(startUrl, { waitUntil: "networkidle", timeout: 60000 });

	// Check if redirected to login
	if (loginPath && new URL(page.url()).pathname === loginPath) {
		await page.close();
		return [];
	}

	// Use getByRole to find link elements inside navigation landmarks + page-wide links
	const navLinks = page.getByRole("navigation").getByRole("link");
	const allLinks = page.getByRole("link");

	// Deduplicate: nav links first, then remaining page links
	const seen = new Set<string>();
	const targets: { locator: ReturnType<Page["getByRole"]>; index: number }[] =
		[];

	for (const source of [navLinks, allLinks]) {
		const count = await source.count();
		for (let i = 0; i < count; i++) {
			const text = ((await source.nth(i).textContent()) ?? "").trim();
			if (!text || seen.has(text)) continue;
			seen.add(text);
			targets.push({ locator: source, index: i });
		}
	}

	console.log(chalk.gray(`  Found ${targets.length} link elements to try\n`));

	const discoveredUrls: string[] = [];

	for (const target of targets) {
		try {
			const el = target.locator.nth(target.index);
			if (!(await el.isVisible())) continue;

			const beforeUrl = page.url();
			await el.click({ timeout: 3000 });
			await page
				.waitForLoadState("networkidle", { timeout: 5000 })
				.catch(() => {});
			await page.waitForTimeout(500);

			const afterUrl = page.url();

			if (afterUrl !== beforeUrl && new URL(afterUrl).origin === origin) {
				const afterPath = new URL(afterUrl).pathname;
				if (afterPath !== loginPath) {
					const text = ((await el.textContent()) ?? "").trim();
					discoveredUrls.push(afterUrl);
					console.log(
						chalk.green(`  + ${afterPath}`) + chalk.gray(`  ${text}`),
					);
				}

				await page.goto(startUrl, {
					waitUntil: "networkidle",
					timeout: 10000,
				});
			}
		} catch {
			// Skip elements that can't be clicked
		}
	}

	await page.close();
	return discoveredUrls;
};

// Replace numeric IDs, UUIDs, and hex strings with * to detect same-structure URLs
const toPattern = (pathname: string): string =>
	pathname
		.split("/")
		.map((seg) =>
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				seg,
			)
				? "*"
				: /^\d+$/.test(seg)
					? "*"
					: /^[0-9a-f]{8,}$/i.test(seg)
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

		if (parsed.origin !== origin) return null;

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

		if (url.startsWith("mailto:") || url.startsWith("tel:")) return null;

		parsed.hash = "";
		parsed.search = "";

		return parsed.toString();
	} catch {
		return null;
	}
};
