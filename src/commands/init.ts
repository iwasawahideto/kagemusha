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
			defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
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
			const { ciAuto } = await inquirer.prompt<{ ciAuto: boolean }>({
				type: "confirm",
				name: "ciAuto",
				message:
					"Generate a login.js skeleton for headless / CI auto-login? (recommended)",
				default: true,
			});

			if (ciAuto) {
				const skeletonPath = path.join(cwd, ".kagemusha", "login.mjs");
				if (!fs.existsSync(skeletonPath)) {
					fs.mkdirSync(path.dirname(skeletonPath), { recursive: true });
					fs.writeFileSync(skeletonPath, generateLoginSkeleton());
					console.log(
						chalk.green("✓ Created .kagemusha/login.mjs (edit before use)"),
					);
				}
			}

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

		// Notification formatter is user-editable (= belongs to the project,
		// not to kagemusha). Place a Slack-shaped skeleton next to login.mjs.
		const notifyJqPath = path.join(cwd, ".kagemusha", "notify-slack.jq");
		if (!fs.existsSync(notifyJqPath)) {
			fs.mkdirSync(path.dirname(notifyJqPath), { recursive: true });
			fs.writeFileSync(notifyJqPath, generateNotifySlackJq());
			console.log(
				chalk.green(
					"✓ Created .kagemusha/notify-slack.jq (edit to customize format)",
				),
			);
		}
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

// login.mjs は team で共有されるべき (selector / フロー定義は team property)
// なので意図的に gitignore しない。
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

const generateLoginSkeleton = (): string =>
	`// Custom login flow — runs headless, called by \`kagemusha login\`.
// Saved storage state is reused by \`kagemusha capture\` for all definitions.
//
// Examples:
//   - Form login:     fill email/password, submit, wait for redirect
//   - HTTP basic:     set extraHTTPHeaders or httpCredentials in kagemusha.config.yaml
//   - Token-based:    inject Authorization header via extraHTTPHeaders
//   - SSO / OAuth:    fall back to interactive \`kagemusha login\` (delete this file)
//
// The page already has \`baseURL\` set from kagemusha.config.yaml, so relative
// paths work in \`page.goto('/login')\`.
//
// ⚠️ Env var naming:
// The example below uses MY_APP_EMAIL / MY_APP_PASSWORD as placeholders.
// Rename them to whatever fits your project (e.g. STAGING_EMAIL, WEVOX_TEST_EMAIL).
// Avoid:
//   - Generic names like EMAIL / PASSWORD (collide with shell rc / other tools)
//   - KAGEMUSHA_* prefix (reserved for kagemusha's own future config / GUI auth)

/** @param {import('playwright-chromium').Page} page */
export const login = async (page) => {
	await page.goto("/login");

	await page.fill('input[name="email"]', process.env.MY_APP_EMAIL ?? "");
	await page.fill('input[name="password"]', process.env.MY_APP_PASSWORD ?? "");
	await page.click('button[type="submit"]');

	// Wait until we leave the login URL (= login succeeded).
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};
`;

const generateWorkflowTemplate = (): string =>
	`name: Kagemusha - Screenshot Update

# Triggered when main is updated (= push or PR merge land on main).
on:
  push:
    branches: [main]
  workflow_dispatch:

# Cancel in-progress runs when a newer merge arrives — kagemusha always
# captures the full set, so the latest run subsumes any earlier one.
concurrency:
  group: kagemusha
  cancel-in-progress: true

# OIDC is recommended over long-lived access keys.
# To use OIDC instead: replace the AWS env vars below with
# \`uses: aws-actions/configure-aws-credentials@v4\` + \`role-to-assume\` and
# add \`permissions: { id-token: write, contents: read }\`.

jobs:
  update-screenshots:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install chromium

      # If your app needs login, kagemusha auto-runs .kagemusha/login.mjs
      # (generated by \`kagemusha init\`) to create a fresh session.
      # Set login credentials as secrets and pass them as env below.
      #
      # For SSO / MFA apps where scripted login isn't possible, use:
      #   - name: Restore login session
      #     if: env.KAGEMUSHA_STORAGE_STATE != ''
      #     run: mkdir -p .kagemusha && echo "$KAGEMUSHA_STORAGE_STATE" | base64 --decode > .kagemusha/auth-state.json
      #     env:
      #       KAGEMUSHA_STORAGE_STATE: \${{ secrets.KAGEMUSHA_STORAGE_STATE }}

      # Pulls canonical from S3, diffs against fresh capture,
      # pushes only what changed back to S3. No screenshots/ commit needed.
      # Region is auto-detected from publish.cdnBaseUrl in kagemusha.config.yaml.
      - run: npx kagemusha capture
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          # Rename these to match what your .kagemusha/login.mjs reads.
          # Avoid generic names (EMAIL) or KAGEMUSHA_* (reserved).
          MY_APP_EMAIL: \${{ secrets.MY_APP_EMAIL }}
          MY_APP_PASSWORD: \${{ secrets.MY_APP_PASSWORD }}

      # Keep summary.json as artifact for later review
      - uses: actions/upload-artifact@v4
        with:
          name: kagemusha-reports
          path: reports/
          if-no-files-found: ignore

      # Slack notification: one message per changed/new screenshot.
      # Slack unfurls image URLs per-message, so the preview comes out
      # clean even with many updates. Format defined in
      # .kagemusha/notify-slack.jq — each line of jq output becomes one
      # POST body. Test locally:
      #   jq -c -f .kagemusha/notify-slack.jq reports/summary.json
      - name: Slack notify
        env:
          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          [ -n "$SLACK_WEBHOOK_URL" ] || exit 0
          jq -c -f .kagemusha/notify-slack.jq reports/summary.json | while IFS= read -r payload; do
            [ -z "$payload" ] && continue
            curl -sS -X POST "$SLACK_WEBHOOK_URL" \\
              -H 'Content-Type: application/json' \\
              --data "$payload"
          done
`;

const generateNotifySlackJq =
	(): string => `# Slack notification formatter for kagemusha.
# Called by .github/workflows/kagemusha.yml on reports/summary.json.
# Emits ONE Slack payload object per changed/new screenshot — the
# workflow loops over the lines and POSTs each as a separate message.
# Slack unfurls image URLs per-message, so before/after previews render
# cleanly even when many pages changed.
#
# Each emitted object is a full Slack chat.postMessage body, so you can
# customize freely (add blocks, attachments, channel override, etc).
#
# Test locally:
#   jq -c -f .kagemusha/notify-slack.jq reports/summary.json

.results[]
| select(.status == "changed" or .status == "new")
| {
    text: (
      if .status == "changed" then
        "📸 *\\(.id)* changed (\\((.diffPercentage * 100 | floor) / 100)%)" +
        (if .urls.before then "\\nBefore: \\(.urls.before)" else "" end) +
        (if .urls.after  then "\\nAfter:  \\(.urls.after)"  else "" end)
      else
        "📸 *\\(.id)* added" +
        (if .urls.after then "\\n\\(.urls.after)" else "" end)
      end
    )
  }
`;
