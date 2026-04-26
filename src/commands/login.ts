import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { getAuthMetaPath, getAuthStatePath } from "../lib/auth.js";
import { findProjectRoot, loadConfig } from "../lib/config.js";

export const loginCommand = async (): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Login\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);

	const inquirer = await import("inquirer");
	const { loginPath } = await inquirer.default.prompt<{ loginPath: string }>({
		type: "input",
		name: "loginPath",
		message: "Login page path (e.g. /login):",
		default: "/login",
	});

	const loginUrl = new URL(loginPath, config.app.baseUrl).toString();

	const { chromium } = await import("playwright-chromium");
	const browser = await chromium.launch({ headless: false });
	const context = await browser.newContext({
		viewport: {
			width: config.screenshot.defaultViewport.width,
			height: config.screenshot.defaultViewport.height,
		},
	});
	const page = await context.newPage();

	console.log(chalk.blue(`🌐 Opening ${loginUrl}...`));
	console.log(chalk.gray("   Log in manually in the browser.\n"));

	await page.goto(loginUrl, { waitUntil: "networkidle" });

	await inquirer.default.prompt({
		type: "confirm",
		name: "done",
		message: "Done logging in?",
		default: true,
	});

	// Record the URL after login (used as crawl starting point)
	const landingUrl = page.url();
	const landingPath = new URL(landingUrl).pathname;

	// Save session state
	const authStatePath = getAuthStatePath(projectRoot);
	fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
	await context.storageState({ path: authStatePath });

	// Save landing page path for crawl starting point
	const metaPath = getAuthMetaPath(projectRoot);
	fs.writeFileSync(
		metaPath,
		JSON.stringify({ loginPath, landingPath }, null, 2),
	);

	await browser.close();

	console.log(chalk.bold.green("\n✅ Session saved"));
	console.log(chalk.gray(`   Landing page: ${landingPath}\n`));
};
