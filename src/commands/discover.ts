import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { findProjectRoot, loadConfig } from "../lib/config.js";
import { getAuthStatePath, hasAuthState } from "./login.js";

export const discoverCommand = async (): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Discover Pages\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);

	const { chromium } = await import("playwright-chromium");
	const browser = await chromium.launch({ headless: true });

	const authStatePath = getAuthStatePath(projectRoot);
	const context = await browser.newContext({
		viewport: {
			width: config.screenshot.defaultViewport.width,
			height: config.screenshot.defaultViewport.height,
		},
		...(hasAuthState(projectRoot) ? { storageState: authStatePath } : {}),
	});

	const origin = new URL(config.app.baseUrl).origin;
	const discoveredPaths = new Set<string>();

	// Determine start URL from auth meta or base URL
	let startUrl = config.app.baseUrl;
	const metaPath = path.join(projectRoot, ".kagemusha", "auth-meta.json");
	if (fs.existsSync(metaPath)) {
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
		if (meta.loginPath) {
			discoveredPaths.add(meta.loginPath);
			console.log(chalk.green(`  + ${meta.loginPath} (login)`));
		}
		if (meta.landingPath) {
			startUrl = new URL(meta.landingPath, config.app.baseUrl).toString();
		}
	}

	console.log(chalk.blue(`🔍 Auto-discovering pages from navigation...\n`));

	const page = await context.newPage();
	await page.goto(startUrl, { waitUntil: "networkidle", timeout: 15000 });

	// Record starting page
	const startPath = new URL(page.url()).pathname;
	discoveredPaths.add(startPath);
	console.log(chalk.green(`  + ${startPath}`));

	// Find all clickable nav elements
	const navLinks = await page.evaluate((orig) => {
		const selectors = [
			"nav a",
			"aside a",
			"[role='navigation'] a",
			"nav button",
			"aside button",
			"[role='navigation'] button",
			"[data-testid*='nav'] a",
			"[data-testid*='menu'] a",
			"[class*='sidebar'] a",
			"[class*='Sidebar'] a",
			"[class*='nav'] a",
			"[class*='Nav'] a",
			"[class*='menu'] a",
			"[class*='Menu'] a",
		];

		const elements: { index: number; text: string; tag: string }[] = [];
		const seen = new Set<string>();

		for (const sel of selectors) {
			for (const el of Array.from(document.querySelectorAll(sel))) {
				const text = (el.textContent ?? "").trim().substring(0, 50);
				const key = `${el.tagName}-${text}`;
				if (seen.has(key) || !text) continue;
				seen.add(key);

				// Skip external links
				if (el instanceof HTMLAnchorElement) {
					try {
						const url = new URL(el.href);
						if (url.origin !== orig) continue;
					} catch {
						continue;
					}
				}

				// Get index for later clicking
				const all = Array.from(document.querySelectorAll(sel));
				const idx = all.indexOf(el);
				elements.push({ index: idx, text, tag: sel });
			}
		}
		return elements;
	}, origin);

	console.log(
		chalk.gray(`  Found ${navLinks.length} navigation elements to try\n`),
	);

	// Click each nav element and record URL changes
	for (const link of navLinks) {
		try {
			const elements = page.locator(link.tag);
			const el = elements.nth(link.index);

			if (!(await el.isVisible())) continue;

			const beforeUrl = page.url();
			await el.click({ timeout: 3000 });
			await page
				.waitForLoadState("networkidle", { timeout: 5000 })
				.catch(() => {});
			await page.waitForTimeout(500);

			const afterUrl = page.url();
			const afterPath = new URL(afterUrl).pathname;

			if (afterUrl !== beforeUrl && new URL(afterUrl).origin === origin) {
				if (!discoveredPaths.has(afterPath)) {
					discoveredPaths.add(afterPath);
					console.log(
						chalk.green(`  + ${afterPath}  ${chalk.gray(link.text)}`),
					);
				}
			}

			// Go back to start page for next click
			if (afterUrl !== beforeUrl) {
				await page.goto(startUrl, { waitUntil: "networkidle", timeout: 10000 });
			}
		} catch {
			// Skip elements that can't be clicked
		}
	}

	await browser.close();

	if (discoveredPaths.size === 0) {
		console.log(chalk.yellow("\n⚠ No pages discovered.\n"));
		return;
	}

	// Let user select which pages to add
	const inquirer = await import("inquirer");
	const { selected } = await inquirer.default.prompt<{ selected: string[] }>({
		type: "checkbox",
		name: "selected",
		message: "Select pages to add:",
		choices: [...discoveredPaths].map((p) => ({
			name: p,
			value: p,
			checked: true,
		})),
	});

	// Save definitions
	const defsDir = path.join(projectRoot, ".kagemusha/definitions");
	fs.mkdirSync(defsDir, { recursive: true });

	let added = 0;
	for (const pagePath of selected) {
		const id =
			pagePath
				.replace(/^\//, "")
				.replace(/\.\w+$/, "")
				.replace(/[/\\]/g, "-")
				.replace(/[^a-zA-Z0-9-]/g, "") || "page";

		const defPath = path.join(defsDir, `${id}.json`);
		if (fs.existsSync(defPath)) continue;

		const definition = {
			id,
			name: id,
			url: pagePath,
			capture: { mode: "fullPage" },
			hideElements: [],
			decorations: [],
		};

		fs.writeFileSync(defPath, `${JSON.stringify(definition, null, 2)}\n`);
		added++;
	}

	console.log(chalk.bold.green(`\n✅ Added ${added} new definition(s)\n`));
};
