import fs from "node:fs";
import chalk from "chalk";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { type DiffStatus, diffImages } from "../lib/diff.js";
import {
	captureScreenshots,
	getDefaultScreenshotsDir,
} from "../lib/screenshot.js";
import {
	cleanupStaging,
	ensureStagingDirs,
	getReportDiffPath,
	getStagingDir,
	getStagingPath,
	promoteToCanonical,
} from "../lib/staging.js";

interface CompareOptions {
	ids?: string;
	threshold?: string;
	apply?: boolean;
}

export const compareCommand = async (
	options: CompareOptions,
): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Compare\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.ids) {
		const ids = options.ids.split(",").map((s) => s.trim());
		definitions = definitions.filter((d) => ids.includes(d.id));
	}

	if (definitions.length === 0) {
		console.log(chalk.yellow("No screenshot definitions to compare.\n"));
		return;
	}

	ensureStagingDirs(projectRoot);

	const threshold = options.threshold
		? Number.parseFloat(options.threshold)
		: (config.screenshot.defaultDiffThreshold ?? 0.005);

	const canonicalDir = getDefaultScreenshotsDir(projectRoot);
	const stagingDir = getStagingDir(projectRoot);

	// 1. Capture all selected definitions into staging (does NOT touch canonical)
	console.log(
		chalk.blue(
			`📸 Capturing ${definitions.length} screenshot(s) to staging...\n`,
		),
	);
	await captureScreenshots(config, definitions, projectRoot, {
		outputDir: stagingDir,
	});

	// 2. Diff each staging vs canonical
	const results: DiffStatus[] = [];

	for (const def of definitions) {
		const canonicalPath = `${canonicalDir}/${def.id}.png`;
		const stagingPath = getStagingPath(projectRoot, def.id);
		const diffPath = getReportDiffPath(projectRoot, def.id);

		if (!fs.existsSync(stagingPath)) {
			results.push({ id: def.id, status: "missing" });
			continue;
		}

		// New: no canonical yet — adopt staging as canonical (only if --apply)
		if (!fs.existsSync(canonicalPath)) {
			if (options.apply) {
				promoteToCanonical(stagingPath, canonicalPath);
			}
			results.push({ id: def.id, status: "new" });
			continue;
		}

		const result = await diffImages(canonicalPath, stagingPath, diffPath);

		if (result.match) {
			results.push({ id: def.id, status: "unchanged" });
			fs.rmSync(diffPath, { force: true });
			fs.rmSync(stagingPath, { force: true });
		} else if (result.reason === "layout-diff") {
			if (options.apply) {
				promoteToCanonical(stagingPath, canonicalPath);
			}
			results.push({
				id: def.id,
				status: "changed",
				reason: "layout-diff",
			});
		} else {
			if (options.apply) {
				promoteToCanonical(stagingPath, canonicalPath);
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
			const action = options.apply ? "added to canonical" : "would be added";
			console.log(chalk.cyan(`  + ${r.id} (${action})`));
		} else if (r.status === "missing") {
			console.log(chalk.yellow(`  ? ${r.id} (capture missing)`));
		} else if (r.status === "changed") {
			const pct =
				r.reason === "pixel-diff" && r.diffPercentage !== undefined
					? ` (${r.diffPercentage.toFixed(2)}%)`
					: ` (${r.reason})`;
			const action = options.apply ? "→ updated" : "→ would update";
			console.log(chalk.red(`  ✗ ${r.id}${pct} ${chalk.gray(action)}`));
			if (r.diffPath) {
				console.log(chalk.gray(`      ↳ ${r.diffPath}`));
			}
		}
	}

	// 4. Cleanup staging dir if everything was unchanged
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

	if (!options.apply && (changed.length > 0 || newly.length > 0)) {
		console.log(
			chalk.gray(
				`\nRun with --apply to update canonical screenshots/ for changed files.`,
			),
		);
	}

	// Exit code: 1 if changed (CI 用)
	const overThreshold = changed.filter(
		(r) =>
			r.status === "changed" &&
			r.reason === "pixel-diff" &&
			r.diffPercentage !== undefined &&
			r.diffPercentage / 100 > threshold,
	);
	if (overThreshold.length > 0) {
		if (!options.apply) {
			process.exitCode = 1;
		}
	}
	console.log("");
};
