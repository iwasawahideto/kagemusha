import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { hasAuthState, resolveLoginScriptPath } from "../lib/auth.js";
import { handleAwsError } from "../lib/aws-error.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { classify, type DiffStatus, diffImages } from "../lib/diff.js";
import { openInDefaultApp } from "../lib/open.js";
import { getCanonicalPath, getOutputDir } from "../lib/output-dir.js";
import { createS3Canonical, type PushUrls } from "../lib/s3-canonical.js";
import { captureScreenshots, resolveUrl } from "../lib/screenshot.js";
import {
	cleanupStaging,
	ensureStagingDirs,
	getStagingDir,
	getStagingPath,
} from "../lib/staging.js";

interface CaptureOptions {
	ids?: string;
	dryRun?: boolean;
	open?: boolean;
	threshold?: string;
}

// Schema version of `reports/summary.json` (public API). Bump on breaking
// changes. v2: replaced `urls.before`/`urls.after` (mutable) with
// `urls.history`/`urls.previousHistory` (immutable). See README.
const SUMMARY_SCHEMA_VERSION = "2";

interface SummaryReport {
	schemaVersion: string;
	timestamp: string;
	dryRun: boolean;
	canonical: string;
	counts: {
		changed: number;
		unchanged: number;
		new: number;
		missing: number;
	};
	results: DiffStatus[];
}

const writeSummaryReport = (
	projectRoot: string,
	report: SummaryReport,
): void => {
	const reportPath = path.join(projectRoot, "reports", "summary.json");
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
};

export const captureCommand = async (
	options: CaptureOptions,
): Promise<void> => {
	try {
		await runCapture(options);
	} catch (e) {
		if (handleAwsError(e)) {
			process.exitCode = 1;
			return;
		}
		throw e;
	}
};

const runCapture = async (options: CaptureOptions): Promise<void> => {
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

	// Auto-login: if a login script exists (auth.scriptPath, or default
	// .kagemusha/login.mjs) but no saved session is on disk, run it before
	// capturing. This is what makes CI work with no pre-baked storage state.
	if (
		!hasAuthState(projectRoot) &&
		resolveLoginScriptPath(config, projectRoot)
	) {
		console.log(
			chalk.blue("🔐 No saved session found, running login script...\n"),
		);
		const { loginCommand } = await import("./login.js");
		await loginCommand();
		// loginCommand absorbs LoginError and sets exitCode internally.
		// If no auth-state was produced, abort capture so we don't screenshot
		// the login screen.
		if (!hasAuthState(projectRoot)) {
			process.exitCode = 1;
			return;
		}
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
	const failures = await captureScreenshots(config, definitions, projectRoot, {
		outputDir: stagingDir,
	});
	const failureReasons = new Map(failures.map((f) => [f.id, f.reason]));

	// 2. Diff each staging vs canonical
	// Two-pass: first compute diffs serially (pixelmatch is CPU-bound, no win
	// from parallelizing), then push everything to remote in parallel
	// (= I/O-bound, big win — 50 changed defs go from ~25s serial to ~3-4s).
	//
	// `onUrls` is bundled into each PendingPush so the result-entry mutation is
	// co-located with the entry it belongs to (= no separate index-zipped array
	// that has to stay in sync).
	type PendingPush = {
		id: string;
		stagingPath: string;
		canonicalPath: string;
		onUrls: (urls: PushUrls | undefined) => void;
	};

	const results: DiffStatus[] = [];
	// Track final paths (where the user can find each capture after the run)
	const finalPathFor = new Map<string, string>();
	const pendingPushes: PendingPush[] = [];

	for (const def of definitions) {
		const canonicalPath = getCanonicalPath(config, projectRoot, def.id);
		const stagingPath = getStagingPath(projectRoot, def.id);
		const pageUrl = resolveUrl(config.app.baseUrl, def.url, def.urlParams);

		if (!fs.existsSync(stagingPath)) {
			results.push({
				id: def.id,
				pageUrl,
				status: "missing",
				reason: failureReasons.get(def.id),
			});
			continue;
		}

		// Pull canonical from remote (S3) into outputDir; for local mode just check existence
		const fetchResult = remote
			? await remote.fetch(def.id, canonicalPath)
			: fs.existsSync(canonicalPath)
				? "ok"
				: "not-found";

		const queuePush = (push: PendingPush): void => {
			if (dryRun) {
				finalPathFor.set(def.id, push.stagingPath);
			} else {
				pendingPushes.push(push);
			}
		};

		// New: no canonical yet — adopt staging as canonical (unless dry-run)
		if (fetchResult === "not-found") {
			const result: DiffStatus = { id: def.id, pageUrl, status: "new" };
			results.push(result);
			queuePush({
				id: def.id,
				stagingPath,
				canonicalPath,
				onUrls: (urls) => {
					if (urls) result.urls = urls;
				},
			});
			continue;
		}

		const verdict = classify(
			await diffImages(canonicalPath, stagingPath),
			threshold,
		);

		if (verdict.kind === "unchanged") {
			results.push({ id: def.id, pageUrl, status: "unchanged" });
			fs.rmSync(stagingPath, { force: true });
			finalPathFor.set(def.id, canonicalPath);
		} else if (verdict.kind === "layout-changed") {
			const item: DiffStatus = {
				id: def.id,
				pageUrl,
				status: "changed",
				reason: "layout-diff",
				canonical: verdict.canonical,
				staging: verdict.staging,
			};
			results.push(item);
			queuePush({
				id: def.id,
				stagingPath,
				canonicalPath,
				onUrls: (urls) => {
					if (urls) item.urls = urls;
				},
			});
		} else {
			const item: DiffStatus = {
				id: def.id,
				pageUrl,
				status: "changed",
				reason: "pixel-diff",
				diffPercentage: verdict.diffPercentage,
			};
			results.push(item);
			queuePush({
				id: def.id,
				stagingPath,
				canonicalPath,
				onUrls: (urls) => {
					if (urls) item.urls = urls;
				},
			});
		}
	}

	// Parallel promote — push to remote + copy to local outputDir.
	// Promise.all keeps S3 throughput high while node manages local fs serially.
	if (pendingPushes.length > 0) {
		fs.mkdirSync(outputDir, { recursive: true });
		await Promise.all(
			pendingPushes.map(async ({ id, stagingPath, canonicalPath, onUrls }) => {
				// Push to remote first so a failure doesn't leave local ahead of S3
				const urls = remote ? await remote.push(id, stagingPath) : undefined;
				fs.copyFileSync(stagingPath, canonicalPath);
				fs.rmSync(stagingPath, { force: true });
				finalPathFor.set(id, canonicalPath);
				onUrls(urls);
			}),
		);
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
			const detail = r.reason ? `: ${r.reason}` : "";
			console.log(chalk.red(`  ✗ ${r.id} (capture failed${detail})`));
		} else if (r.status === "changed") {
			const detail =
				r.reason === "pixel-diff"
					? `${r.diffPercentage.toFixed(2)}%`
					: `layout-diff: ${r.canonical.width}×${r.canonical.height} → ${r.staging.width}×${r.staging.height}`;
			const action = dryRun ? "→ would update" : "→ updated";
			console.log(
				chalk.yellow(`  ~ ${r.id} (${detail}) ${chalk.gray(action)}`),
			);
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

	// 5. Write the structured report.
	// `reports/summary.json` is part of kagemusha's PUBLIC API — see README
	// "Notifications" section. Bump `schemaVersion` (or kagemusha major) on
	// breaking changes to the shape.
	writeSummaryReport(projectRoot, {
		schemaVersion: SUMMARY_SCHEMA_VERSION,
		timestamp: new Date().toISOString(),
		dryRun,
		canonical: remote ? remote.label() : `${outputDir} (local)`,
		counts: {
			changed: changed.length,
			unchanged: unchanged.length,
			new: newly.length,
			missing: missing.length,
		},
		results,
	});

	// 6. Open changed/new results in default viewer
	if (options.open) {
		for (const r of [...changed, ...newly]) {
			const p = finalPathFor.get(r.id);
			if (p && fs.existsSync(p)) {
				openInDefaultApp(p);
			}
		}
	}

	// dry-run CI gate: exit 1 if any pixel-diff change remains (sub-threshold
	// ones were already reclassified to unchanged above).
	if (dryRun) {
		const pixelChanges = changed.filter(
			(r) => r.status === "changed" && r.reason === "pixel-diff",
		);
		if (pixelChanges.length > 0) {
			process.exitCode = 1;
		}
	}
	console.log("");
};
