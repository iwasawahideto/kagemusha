import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { hasAuthState, resolveLoginScriptPath } from "../lib/auth.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { openInDefaultApp } from "../lib/open.js";
import { captureScreenshots } from "../lib/screenshot.js";

interface PreviewOptions {
	ids?: string;
	// Commander sets this false when `--no-open` is passed; true otherwise.
	open?: boolean;
}

// `preview` renders definitions (annotations included) to a local folder and
// opens them — a quick visual check with no diff, no canonical, and no S3/AWS.
// It's the "just show me the screenshots" counterpart to `capture` (which is
// the real diff-and-publish pipeline, and `capture --dry-run` its rehearsal).
export const previewCommand = async (
	options: PreviewOptions,
): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Preview\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.ids) {
		const ids = options.ids.split(",").map((s) => s.trim());
		definitions = definitions.filter((d) => ids.includes(d.id));
	}

	if (definitions.length === 0) {
		console.log(chalk.yellow("No screenshot definitions to preview.\n"));
		return;
	}

	// Auto-login (same as capture) so authed apps don't render the login page.
	if (
		!hasAuthState(projectRoot) &&
		resolveLoginScriptPath(config, projectRoot)
	) {
		console.log(
			chalk.blue("🔐 No saved session found, running login script...\n"),
		);
		const { loginCommand } = await import("./login.js");
		await loginCommand();
		if (!hasAuthState(projectRoot)) {
			process.exitCode = 1;
			return;
		}
	}

	const previewDir = path.join(projectRoot, "reports", "preview");
	fs.mkdirSync(previewDir, { recursive: true });

	console.log(
		chalk.blue(
			`📸 Rendering ${definitions.length} screenshot(s) to ${previewDir}...\n`,
		),
	);
	const failures = await captureScreenshots(config, definitions, projectRoot, {
		outputDir: previewDir,
	});
	const failureReasons = new Map(failures.map((f) => [f.id, f.reason]));

	const produced: string[] = [];
	for (const def of definitions) {
		const p = path.join(previewDir, `${def.id}.png`);
		if (!failureReasons.has(def.id) && fs.existsSync(p)) {
			produced.push(p);
			console.log(chalk.green(`  ✓ ${def.id}`));
		} else {
			const reason = failureReasons.get(def.id);
			console.log(chalk.red(`  ✗ ${def.id}${reason ? ` (${reason})` : ""}`));
		}
	}

	const open = options.open !== false;
	if (open) {
		for (const p of produced) {
			openInDefaultApp(p);
		}
	}

	console.log("");
	console.log(
		chalk.bold(`${produced.length} image(s) in ${previewDir}`) +
			(open
				? chalk.gray(" (opened)")
				: chalk.gray(" — drop --no-open to open them")),
	);
	console.log("");
};
