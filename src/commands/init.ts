import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { stringify as toYaml } from "yaml";
import { hasAuthState } from "../lib/auth.js";
import { loadDefinitions, saveDefinitions } from "../lib/config.js";
import { discoverPages } from "../lib/crawl.js";
import { deriveIdFromPath } from "../lib/definition.js";
import type { KagemushaConfig, ScreenshotDefinition } from "../types.js";

export const initCommand = async (): Promise<void> => {
	console.log(chalk.bold("\n🥷 Kagemusha — Setup\n"));

	const cwd = process.cwd();

	if (fs.existsSync(path.join(cwd, "kagemusha.config.yaml"))) {
		const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>({
			type: "confirm",
			name: "overwrite",
			message: "kagemusha.config.yaml already exists. Overwrite?",
			default: false,
		});
		if (!overwrite) {
			console.log(chalk.yellow("Aborted."));
			return;
		}
	}

	// Step 1: Basic config
	const { baseUrl } = await inquirer.prompt<{ baseUrl: string }>({
		type: "input",
		name: "baseUrl",
		message: "Target URL (the app to take screenshots of):",
		default: "http://localhost:3000",
	});

	const { destination } = await inquirer.prompt<{ destination: string }>({
		type: "list",
		name: "destination",
		message: "Where to save screenshots?",
		choices: [
			{ name: "Local (./screenshots)", value: "local" },
			{ name: "S3", value: "s3" },
		],
	});

	let outputDir = "./screenshots";
	let cdnBucket = "";
	let cdnBaseUrl = "";

	if (destination === "local") {
		const { dir } = await inquirer.prompt<{ dir: string }>({
			type: "input",
			name: "dir",
			message: "Output directory for screenshots:",
			default: "./screenshots",
		});
		outputDir = dir;
	} else {
		const { bucket } = await inquirer.prompt<{ bucket: string }>({
			type: "input",
			name: "bucket",
			message: "S3 bucket name:",
			default: "kagemusha-screenshots",
		});
		cdnBucket = bucket;

		const { url } = await inquirer.prompt<{ url: string }>({
			type: "input",
			name: "url",
			message: "S3 public URL base:",
			default: `https://${bucket}.s3.ap-northeast-1.amazonaws.com`,
		});
		cdnBaseUrl = url;
	}

	// Build config
	const config: KagemushaConfig = {
		app: { baseUrl },
		screenshot: {
			defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
			defaultDiffThreshold: 0.005,
		},
		publish:
			destination === "local"
				? { destination: "local", outputDir }
				: { destination: "s3", cdnBucket, cdnBaseUrl },
	};

	// Write config
	fs.writeFileSync(
		path.join(cwd, "kagemusha.config.yaml"),
		toYaml(config, { lineWidth: 120 }),
	);
	console.log(chalk.green("\n✓ Created kagemusha.config.yaml"));

	// Update .gitignore so canonical/staging artifacts don't pollute the repo.
	// Canonical lives in S3 (or a local outputDir for testing) — never in git.
	updateGitignore(cwd, outputDir);

	// Step 2: Discover pages and create screenshot definitions

	// Check if login is needed
	if (!hasAuthState(cwd)) {
		const { needsLogin } = await inquirer.prompt<{ needsLogin: boolean }>({
			type: "confirm",
			name: "needsLogin",
			message: "Does this app require login?",
			default: true,
		});

		if (needsLogin) {
			console.log(chalk.blue("\n🔐 Opening browser for login...\n"));
			const { loginCommand } = await import("./login.js");
			await loginCommand();
		}
	} else {
		console.log(chalk.green("  ✓ Using saved login session\n"));
	}

	console.log(chalk.blue(`🔍 Scanning ${baseUrl} for pages...\n`));

	let pages: { path: string; title: string }[] = [];
	try {
		pages = await discoverPages(baseUrl, cwd);
	} catch {
		console.log(chalk.yellow("  Could not auto-discover pages.\n"));
	}

	let selectedPaths: string[] = [];

	if (pages.length > 0) {
		console.log(chalk.green(`  Found ${pages.length} page(s)\n`));

		const { selected } = await inquirer.prompt<{ selected: string[] }>({
			type: "checkbox",
			name: "selected",
			message: "Select pages to capture (space to toggle):",
			choices: pages.map((p) => ({
				name: `${p.path}  ${chalk.gray(p.title)}`,
				value: p.path,
				checked: true,
			})),
		});
		selectedPaths = selected;
	} else {
		console.log(chalk.yellow("  No pages found. Add them manually.\n"));

		let addMore = true;
		while (addMore) {
			const { manualPath } = await inquirer.prompt<{ manualPath: string }>({
				type: "input",
				name: "manualPath",
				message: "Page path (e.g. /index.html):",
			});
			selectedPaths.push(manualPath);

			const { more } = await inquirer.prompt<{ more: boolean }>({
				type: "confirm",
				name: "more",
				message: "Add another page?",
				default: false,
			});
			addMore = more;
		}
	}

	// Preserve existing definitions; merge new ones (skip ID duplicates)
	const existing = loadDefinitions(cwd);
	let merged: ScreenshotDefinition[] = existing;
	let resetExisting = false;

	if (existing.length > 0) {
		const { keepExisting } = await inquirer.prompt<{ keepExisting: boolean }>({
			type: "confirm",
			name: "keepExisting",
			message: `${existing.length} existing definition(s) found. Keep them and merge new selections?`,
			default: true,
		});
		if (!keepExisting) {
			console.log(
				chalk.yellow(
					`  ⚠ ${existing.length} existing definition(s) will be replaced.`,
				),
			);
			merged = [];
			resetExisting = true;
		}
	}

	const existingIds = new Set(merged.map((d) => d.id));
	let added = 0;
	for (const pagePath of selectedPaths) {
		const id = deriveIdFromPath(pagePath);
		if (existingIds.has(id)) {
			console.log(chalk.gray(`  ↷ ${id} (already exists, skipped)`));
			continue;
		}
		const def: ScreenshotDefinition = {
			id,
			name: id,
			url: pagePath,
			capture: { mode: "fullPage" as const },
			hideElements: [],
			decorations: [],
		};
		merged.push(def);
		existingIds.add(id);
		added++;
		console.log(chalk.green(`  ✓ ${id}`));
	}

	if (added > 0 || resetExisting) {
		saveDefinitions(merged, cwd);
	}
	console.log("");

	// Step 3: GitHub Actions workflow
	const { createWorkflow } = await inquirer.prompt<{ createWorkflow: boolean }>(
		{
			type: "confirm",
			name: "createWorkflow",
			message: "Generate GitHub Actions workflow?",
			default: true,
		},
	);

	if (createWorkflow) {
		const workflowDir = path.join(cwd, ".github/workflows");
		fs.mkdirSync(workflowDir, { recursive: true });
		fs.writeFileSync(
			path.join(workflowDir, "kagemusha.yml"),
			generateWorkflowTemplate(),
		);
		console.log(chalk.green("✓ Created .github/workflows/kagemusha.yml"));
	}

	console.log(chalk.bold.green("\n✅ Setup complete!\n"));
	console.log(chalk.gray("Next steps:"));
	console.log(
		chalk.gray(
			"  npx kagemusha capture            — Capture & publish changed",
		),
	);
	console.log(
		chalk.gray("  npx kagemusha capture --dry-run  — Preview diffs only"),
	);
	console.log(
		chalk.gray("  npx kagemusha edit               — Edit annotations\n"),
	);
};

const GITIGNORE_ENTRIES = [
	".kagemusha/.staging/",
	".kagemusha/.cache/",
	".kagemusha/auth-state.json",
	".kagemusha/auth-meta.json",
	"reports/",
];

// Strip trailing slash so `screenshots` and `screenshots/` are treated as the
// same gitignore entry (and we don't append duplicates).
const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

const updateGitignore = (cwd: string, outputDir: string): void => {
	const gitignorePath = path.join(cwd, ".gitignore");
	const existing = fs.existsSync(gitignorePath)
		? fs.readFileSync(gitignorePath, "utf8")
		: "";
	const present = new Set(
		existing
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.map(stripTrailingSlash),
	);

	const normalizedOutputDir = outputDir
		.replace(/^\.\//, "")
		.replace(/\/+$/, "");
	const entries = [...GITIGNORE_ENTRIES, `${normalizedOutputDir}/`];

	const additions = entries.filter((e) => !present.has(stripTrailingSlash(e)));
	if (additions.length === 0) return;

	const block = ["", "# kagemusha", ...additions, ""];
	const next =
		existing.endsWith("\n") || existing === ""
			? existing + block.join("\n")
			: `${existing}\n${block.join("\n")}`;
	fs.writeFileSync(gitignorePath, next);
	console.log(
		chalk.green(
			`✓ Updated .gitignore (added ${additions.length} kagemusha entries)`,
		),
	);
};

const generateWorkflowTemplate = (): string =>
	`name: Kagemusha - Screenshot Update

on:
  pull_request:
    types: [closed]
    branches: [main]
  workflow_dispatch:

# Serialize runs so concurrent merges can't race the S3 canonical
concurrency:
  group: kagemusha
  cancel-in-progress: false

jobs:
  update-screenshots:
    if: github.event.pull_request.merged == true || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install chromium

      # If your app needs login: run 'kagemusha login' locally,
      # then 'base64 -i .kagemusha/auth-state.json | pbcopy' and store it
      # as the KAGEMUSHA_STORAGE_STATE secret. Skip this step if not needed.
      - name: Restore login session
        if: env.KAGEMUSHA_STORAGE_STATE != ''
        run: |
          mkdir -p .kagemusha
          echo "$KAGEMUSHA_STORAGE_STATE" | base64 --decode > .kagemusha/auth-state.json
        env:
          KAGEMUSHA_STORAGE_STATE: \${{ secrets.KAGEMUSHA_STORAGE_STATE }}

      # Pulls canonical from S3, diffs against fresh capture,
      # pushes only what changed back to S3. No screenshots/ commit needed.
      - run: npx kagemusha capture
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}

      # Keep diff visualizations as artifacts for later review
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: kagemusha-diffs
          path: reports/diff/
          if-no-files-found: ignore
`;
