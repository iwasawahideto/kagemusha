import { spawn } from "node:child_process";
import chalk from "chalk";
import { annotateScreenshots } from "../lib/annotate.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { captureScreenshots } from "../lib/screenshot.js";

interface CaptureOptions {
	ids?: string;
	open?: boolean;
}

// Open a file with the OS's default viewer (Preview on macOS, etc.).
// `detached + unref` lets the kagemusha process exit while the viewer keeps
// running.
const openInDefaultApp = (filePath: string): void => {
	const cmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";
	const args = process.platform === "win32" ? ["", filePath] : [filePath];
	spawn(cmd, args, {
		detached: true,
		stdio: "ignore",
		shell: process.platform === "win32",
	}).unref();
};

export async function captureCommand(options: CaptureOptions): Promise<void> {
	console.log(chalk.bold("\n🥷 Kagemusha — Capture screenshots\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.ids) {
		const ids = options.ids.split(",").map((s) => s.trim());
		definitions = definitions.filter((d) => ids.includes(d.id));
	}

	if (definitions.length === 0) {
		console.log(chalk.yellow("No screenshot definitions found."));
		return;
	}

	console.log(
		chalk.blue(`📸 Capturing ${definitions.length} screenshot(s)...`),
	);
	const results = await captureScreenshots(config, definitions, projectRoot);

	console.log(chalk.blue("🎨 Drawing annotations..."));
	const annotated = await annotateScreenshots(
		definitions,
		results,
		projectRoot,
	);

	console.log(
		chalk.bold.green(`\n✅ Done! Screenshots saved to screenshots/\n`),
	);

	for (const r of annotated) {
		console.log(chalk.gray(`  ${r.id} → ${r.annotatedPath}`));
	}

	if (options.open) {
		for (const result of annotated) {
			openInDefaultApp(result.annotatedPath);
		}
	}
}
