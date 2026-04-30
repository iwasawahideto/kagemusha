import fs from "node:fs";
import chalk from "chalk";
import {
	adoptAsBaseline,
	ensureBaselineDirs,
	getBaselinePath,
	getCurrentPath,
	getDiffPath,
} from "../lib/baseline.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { type DiffStatus, diffImages } from "../lib/diff.js";

interface CompareOptions {
	ids?: string;
	threshold?: string;
	updateBaseline?: boolean;
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

	ensureBaselineDirs(projectRoot);

	// 0-1 の比率。0.005 = 0.5% の pixel が違ったら "changed"
	const threshold = options.threshold
		? Number.parseFloat(options.threshold)
		: (config.screenshot.defaultDiffThreshold ?? 0.005);

	const results: DiffStatus[] = [];

	for (const def of definitions) {
		const baseline = getBaselinePath(projectRoot, def.id);
		const current = getCurrentPath(projectRoot, def.id);
		const diffPath = getDiffPath(projectRoot, def.id);

		if (!fs.existsSync(current)) {
			results.push({ id: def.id, status: "missing" });
			continue;
		}

		// 初回 or --update-baseline 指定時 → 現状を baseline として採用
		if (!fs.existsSync(baseline) || options.updateBaseline) {
			adoptAsBaseline(projectRoot, def.id);
			results.push({
				id: def.id,
				status: options.updateBaseline ? "unchanged" : "new",
			});
			continue;
		}

		const result = await diffImages(baseline, current, diffPath);

		if (result.match) {
			results.push({ id: def.id, status: "unchanged" });
			// 一致したら diff ファイル消す (要らないので)
			fs.rmSync(diffPath, { force: true });
		} else if (result.reason === "layout-diff") {
			results.push({
				id: def.id,
				status: "changed",
				reason: "layout-diff",
			});
		} else {
			results.push({
				id: def.id,
				status: "changed",
				reason: "pixel-diff",
				diffPercentage: result.diffPercentage,
				diffPath,
			});
		}
	}

	// 集計
	const changed = results.filter((r) => r.status === "changed");
	const unchanged = results.filter((r) => r.status === "unchanged");
	const newly = results.filter((r) => r.status === "new");
	const missing = results.filter((r) => r.status === "missing");

	for (const r of results) {
		if (r.status === "unchanged") {
			console.log(chalk.gray(`  ✓ ${r.id}`));
		} else if (r.status === "new") {
			console.log(chalk.cyan(`  + ${r.id} (new baseline)`));
		} else if (r.status === "missing") {
			console.log(chalk.yellow(`  ? ${r.id} (current screenshot missing)`));
		} else if (r.status === "changed") {
			const pct =
				r.reason === "pixel-diff" && r.diffPercentage !== undefined
					? ` (${r.diffPercentage.toFixed(2)}%)`
					: ` (${r.reason})`;
			console.log(chalk.red(`  ✗ ${r.id}${pct}`));
			if (r.diffPath) {
				console.log(chalk.gray(`      ↳ ${r.diffPath}`));
			}
		}
	}

	console.log("");
	console.log(
		chalk.bold(
			`changed: ${changed.length} / unchanged: ${unchanged.length} / new: ${newly.length}` +
				(missing.length > 0 ? ` / missing: ${missing.length}` : ""),
		),
	);

	// threshold 超えがあれば exit 1 (CI で止めるため)
	const overThreshold = changed.filter(
		(r) =>
			r.status === "changed" &&
			r.reason === "pixel-diff" &&
			r.diffPercentage !== undefined &&
			r.diffPercentage / 100 > threshold,
	);
	if (overThreshold.length > 0) {
		console.log(
			chalk.red(
				`\n${overThreshold.length} screenshot(s) over threshold (${(threshold * 100).toFixed(2)}%).\n`,
			),
		);
		process.exitCode = 1;
	} else {
		console.log("");
	}
};
