import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import chalk from "chalk";
import {
	defaultContextOptions,
	getAuthMetaPath,
	getAuthStatePath,
	resolveLoginScriptPath,
} from "../lib/auth.js";
import { findProjectRoot, loadConfig } from "../lib/config.js";
import { LoginError } from "../lib/login-error.js";
import { launchOptionsFor } from "../lib/playwright-launch.js";
import type { KagemushaConfig } from "../types.js";

type Page = import("playwright-core").Page;

interface LoginScriptModule {
	login: (page: Page) => Promise<void>;
}

interface LoginOptions {
	headed?: boolean;
}

export const loginCommand = async (
	options: LoginOptions = {},
): Promise<void> => {
	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	const scriptPath = resolveLoginScriptPath(config, projectRoot);

	try {
		if (scriptPath) {
			await runScriptedLogin(scriptPath, config, projectRoot, options);
		} else {
			await runInteractiveLogin(config, projectRoot);
		}
	} catch (e) {
		if (e instanceof LoginError) {
			// Friendly message + screenshot already printed inside runScriptedLogin.
			// Just signal failure via exit code without dumping a stack.
			process.exitCode = 1;
			return;
		}
		throw e;
	}
};

const runScriptedLogin = async (
	scriptPath: string,
	config: KagemushaConfig,
	projectRoot: string,
	options: LoginOptions = {},
): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Login (scripted)\n"));
	console.log(chalk.gray(`  using: ${path.relative(projectRoot, scriptPath)}`));
	if (options.headed) {
		console.log(chalk.gray(`  mode:  headed (debug)\n`));
	} else {
		console.log("");
	}

	const mod = (await import(pathToFileURL(scriptPath).href)) as Partial<
		LoginScriptModule & { default?: LoginScriptModule["login"] }
	>;
	const loginFn = mod.login ?? mod.default;
	if (typeof loginFn !== "function") {
		throw new Error(
			`${scriptPath} must export a 'login(page)' function (named or default export).`,
		);
	}

	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		headless: !options.headed,
		...launchOptionsFor(),
	});
	// projectRoot=undefined → no storageState applied (we are creating one).
	const context = await browser.newContext(
		defaultContextOptions(config, undefined),
	);
	const page = await context.newPage();

	try {
		try {
			await loginFn(page);
		} catch (e) {
			console.error(chalk.red(`\n✗ Login script threw: ${formatError(e)}`));
			console.error(chalk.gray(`  Last URL: ${page.url()}`));
			console.error(
				chalk.yellow(
					`\nHint:\n` +
						`  - Re-run with --headed to watch the flow live: \`kagemusha login --headed\`\n` +
						`  - Verify form selectors in .kagemusha/login.mjs match the live page\n` +
						`  - Check that the credentials env vars are correct`,
				),
			);
			throw new LoginError(`login script threw: ${formatError(e)}`);
		}

		const landingUrl = page.url();
		const landingPath = new URL(landingUrl).pathname;

		// Verify login actually succeeded — landing on /login* means we failed silently.
		if (landingPath.startsWith("/login") || landingPath === "/") {
			console.error(
				chalk.red(
					`\n✗ Login script completed but the page is still on ${landingPath}.`,
				),
			);
			console.error(
				chalk.yellow(
					`\nHint:\n` +
						`  - Re-run with \`kagemusha login --headed\` to see the live flow\n` +
						`  - Verify selectors / credentials in .kagemusha/login.mjs`,
				),
			);
			throw new LoginError(`stuck on ${landingPath} after login script`);
		}

		// Verify the storageState actually has cookies (= a session was established).
		const state = await context.storageState();
		const cookieCount = state.cookies?.length ?? 0;
		if (cookieCount === 0) {
			console.warn(
				chalk.yellow(
					`⚠ Login script finished but no cookies were set — the saved session may be empty.`,
				),
			);
		}

		const authStatePath = getAuthStatePath(projectRoot);
		fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
		await context.storageState({ path: authStatePath });

		const metaPath = getAuthMetaPath(projectRoot);
		fs.writeFileSync(
			metaPath,
			JSON.stringify({ loginPath: "/login", landingPath }, null, 2),
		);

		console.log(chalk.bold.green("\n✅ Session saved"));
		console.log(
			chalk.gray(`   Landing: ${landingPath}  (${cookieCount} cookies)\n`),
		);
	} finally {
		await browser.close();
	}
};

const formatError = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

const runInteractiveLogin = async (
	config: KagemushaConfig,
	projectRoot: string,
): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Login\n"));

	const inquirer = await import("inquirer");
	const { loginPath } = await inquirer.default.prompt<{ loginPath: string }>({
		type: "input",
		name: "loginPath",
		message: "Login page path (e.g. /login):",
		default: "/login",
	});

	const loginUrl = new URL(loginPath, config.app.baseUrl).toString();

	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		headless: false,
		...launchOptionsFor(),
	});
	const context = await browser.newContext(
		defaultContextOptions(config, undefined),
	);
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

	const landingUrl = page.url();
	const landingPath = new URL(landingUrl).pathname;

	if (landingPath === loginPath) {
		console.log(
			chalk.yellow(
				`\n⚠ Still on ${loginPath} — looks like login wasn't completed.`,
			),
		);
		console.log(
			chalk.yellow(
				"  Session not saved. Re-run 'kagemusha login' after signing in.\n",
			),
		);
		await browser.close();
		return;
	}

	const authStatePath = getAuthStatePath(projectRoot);
	fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
	await context.storageState({ path: authStatePath });

	const metaPath = getAuthMetaPath(projectRoot);
	fs.writeFileSync(
		metaPath,
		JSON.stringify({ loginPath, landingPath }, null, 2),
	);

	await browser.close();

	console.log(chalk.bold.green("\n✅ Session saved"));
	console.log(chalk.gray(`   Landing page: ${landingPath}\n`));
};
