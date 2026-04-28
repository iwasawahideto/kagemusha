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
// running. We deliberately avoid `shell: true` so paths with spaces don't get
// re-split — argv is passed straight through to the program.
const openInDefaultApp = (filePath: string): void => {
	if (process.platform === "darwin") {
		spawn("open", [filePath], { detached: true, stdio: "ignore" }).unref();
	} else if (process.platform === "win32") {
		// `start` is a cmd.exe builtin; we invoke cmd directly. The empty
		// string after `start` is the (required) window title placeholder.
		spawn("cmd", ["/c", "start", "", filePath], {
			detached: true,
			stdio: "ignore",
		}).unref();
	} else {
		spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" }).unref();
	}
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
	const annotated = await annotateScreenshots(definitions, results, config);

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
