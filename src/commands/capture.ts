import { spawn } from "node:child_process";
import fs from "node:fs";
import chalk from "chalk";
import {
	createS3Canonical,
	getCanonicalPath,
	getOutputDir,
} from "../lib/canonical.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { type DiffStatus, diffImages } from "../lib/diff.js";
import { captureScreenshots } from "../lib/screenshot.js";
import {
	cleanupStaging,
	ensureStagingDirs,
	getReportDiffPath,
	getStagingDir,
	getStagingPath,
} from "../lib/staging.js";

interface CaptureOptions {
	ids?: string;
	dryRun?: boolean;
	open?: boolean;
	threshold?: string;
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

export const captureCommand = async (
	options: CaptureOptions,
): Promise<void> => {
	const dryRun = options.dryRun === true;
	console.log(
		chalk.bold(`\n🥷 Kagemusha — Capture${dryRun ? " (dry-run)" : ""}\n`),
	);

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.ids) {
		const ids = options.ids.split(",").map((s) => s.trim());
		definitions = definitions.filter((d) => ids.includes(d.id));
	}

	if (definitions.length === 0) {
		console.log(chalk.yellow("No screenshot definitions to capture.\n"));
		return;
	}

	ensureStagingDirs(projectRoot);

	const threshold = options.threshold
		? Number.parseFloat(options.threshold)
		: (config.screenshot.defaultDiffThreshold ?? 0.005);

	const remote = createS3Canonical(config);
	const outputDir = getOutputDir(config, projectRoot);
	const stagingDir = getStagingDir(projectRoot);

	if (remote) {
		console.log(chalk.gray(`  canonical: ${remote.label()}`));
	} else {
		console.log(chalk.gray(`  canonical: ${outputDir} (local)`));
	}

	// 1. Capture into staging (annotated)
	console.log(
		chalk.blue(
			`\n📸 Capturing ${definitions.length} screenshot(s) to staging...\n`,
		),
	);
	await captureScreenshots(config, definitions, projectRoot, {
		outputDir: stagingDir,
	});

	// 2. Diff each staging vs canonical
	const results: DiffStatus[] = [];
	// Track final paths (where the user can find each capture after the run)
	const finalPathFor = new Map<string, string>();

	const promote = async (
		id: string,
		stagingPath: string,
		canonicalPath: string,
	): Promise<void> => {
		fs.mkdirSync(outputDir, { recursive: true });
		// Push to remote first so a failure doesn't leave local ahead of S3
		if (remote) {
			await remote.push(id, stagingPath);
		}
		fs.copyFileSync(stagingPath, canonicalPath);
		fs.rmSync(stagingPath, { force: true });
		finalPathFor.set(id, canonicalPath);
	};

	for (const def of definitions) {
		const canonicalPath = getCanonicalPath(config, projectRoot, def.id);
		const stagingPath = getStagingPath(projectRoot, def.id);
		const diffPath = getReportDiffPath(projectRoot, def.id);

		if (!fs.existsSync(stagingPath)) {
			results.push({ id: def.id, status: "missing" });
			continue;
		}

		// Pull canonical from remote (S3) into outputDir; for local mode just check existence
		const fetchResult = remote
			? await remote.fetch(def.id, canonicalPath)
			: fs.existsSync(canonicalPath)
				? "ok"
				: "not-found";

		// New: no canonical yet — adopt staging as canonical (unless dry-run)
		if (fetchResult === "not-found") {
			if (dryRun) {
				finalPathFor.set(def.id, stagingPath);
			} else {
				await promote(def.id, stagingPath, canonicalPath);
			}
			results.push({ id: def.id, status: "new" });
			continue;
		}

		const result = await diffImages(canonicalPath, stagingPath, diffPath);

		if (result.match) {
			results.push({ id: def.id, status: "unchanged" });
			fs.rmSync(diffPath, { force: true });
			fs.rmSync(stagingPath, { force: true });
			finalPathFor.set(def.id, canonicalPath);
		} else if (result.reason === "layout-diff") {
			if (dryRun) {
				finalPathFor.set(def.id, stagingPath);
			} else {
				await promote(def.id, stagingPath, canonicalPath);
			}
			results.push({
				id: def.id,
				status: "changed",
				reason: "layout-diff",
				canonical: result.canonical,
				staging: result.staging,
			});
		} else {
			if (dryRun) {
				finalPathFor.set(def.id, stagingPath);
			} else {
				await promote(def.id, stagingPath, canonicalPath);
			}
			results.push({
				id: def.id,
				status: "changed",
				reason: "pixel-diff",
				diffPercentage: result.diffPercentage,
				diffPath,
			});
		}
	}

	// 3. Print summary
	const changed = results.filter((r) => r.status === "changed");
	const unchanged = results.filter((r) => r.status === "unchanged");
	const newly = results.filter((r) => r.status === "new");
	const missing = results.filter((r) => r.status === "missing");

	for (const r of results) {
		if (r.status === "unchanged") {
			console.log(chalk.gray(`  ✓ ${r.id}`));
		} else if (r.status === "new") {
			const action = dryRun ? "would be added" : "added to canonical";
			console.log(chalk.cyan(`  + ${r.id} (${action})`));
		} else if (r.status === "missing") {
			console.log(chalk.red(`  ✗ ${r.id} (capture failed)`));
		} else if (r.status === "changed") {
			const detail =
				r.reason === "pixel-diff"
					? `${r.diffPercentage.toFixed(2)}%`
					: `layout-diff: ${r.canonical.width}×${r.canonical.height} → ${r.staging.width}×${r.staging.height}`;
			const action = dryRun ? "→ would update" : "→ updated";
			console.log(
				chalk.yellow(`  ~ ${r.id} (${detail}) ${chalk.gray(action)}`),
			);
			if (r.reason === "pixel-diff") {
				console.log(chalk.gray(`      ↳ ${r.diffPath}`));
			}
		}
	}

	// 4. Cleanup staging — applied entries are already removed individually,
	// so this only matters when nothing changed (everything was unchanged).
	if (changed.length === 0 && newly.length === 0) {
		cleanupStaging(projectRoot);
	}

	console.log("");
	console.log(
		chalk.bold(
			`changed: ${changed.length} / unchanged: ${unchanged.length} / new: ${newly.length}` +
				(missing.length > 0 ? ` / missing: ${missing.length}` : ""),
		),
	);

	if (dryRun && (changed.length > 0 || newly.length > 0)) {
		console.log(
			chalk.gray(
				`\nDrop --dry-run to update canonical${remote ? ` (${remote.label()})` : ""}.`,
			),
		);
	}

	// 5. Open changed/new results in default viewer
	if (options.open) {
		for (const r of [...changed, ...newly]) {
			const p = finalPathFor.get(r.id);
			if (p && fs.existsSync(p)) {
				openInDefaultApp(p);
			}
		}
	}

	// Exit code: 1 if dry-run found pixel diffs over threshold (CI gate use case)
	if (dryRun) {
		const overThreshold = changed.filter(
			(r) =>
				r.status === "changed" &&
				r.reason === "pixel-diff" &&
				r.diffPercentage / 100 > threshold,
		);
		if (overThreshold.length > 0) {
			process.exitCode = 1;
		}
	}
	console.log("");
};
