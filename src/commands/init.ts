import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { stringify as toYaml } from "yaml";
import { discoverPages } from "../lib/crawl.js";

export async function initCommand(): Promise<void> {
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

	const { needsAuth } = await inquirer.prompt<{ needsAuth: boolean }>({
		type: "confirm",
		name: "needsAuth",
		message: "Does the app require login?",
		default: true,
	});

	let loginUrl = "/login";
	let emailSelector = "#email";
	let passwordSelector = "#password";
	let submitSelector = "button[type='submit']";

	if (needsAuth) {
		const authAnswers = await inquirer.prompt<{
			loginUrl: string;
			emailSelector: string;
			passwordSelector: string;
			submitSelector: string;
		}>([
			{
				type: "input",
				name: "loginUrl",
				message: "Login page path:",
				default: "/login",
			},
			{
				type: "input",
				name: "emailSelector",
				message: "Email input selector:",
				default: "#email",
			},
			{
				type: "input",
				name: "passwordSelector",
				message: "Password input selector:",
				default: "#password",
			},
			{
				type: "input",
				name: "submitSelector",
				message: "Login button selector:",
				default: "button[type='submit']",
			},
		]);
		loginUrl = authAnswers.loginUrl;
		emailSelector = authAnswers.emailSelector;
		passwordSelector = authAnswers.passwordSelector;
		submitSelector = authAnswers.submitSelector;
	}

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
	const config: Record<string, unknown> = {
		app: { baseUrl },
		screenshot: {
			defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
			defaultDiffThreshold: 0.5,
		},
	};

	if (destination === "local") {
		config.publish = {
			destination: "local",
			outputDir,
		};
	} else {
		config.publish = {
			destination: "s3",
			cdnBucket,
			cdnBaseUrl,
		};
	}

	if (needsAuth) {
		config.auth = {
			loginUrl,
			steps: [
				{
					action: "type",
					selector: emailSelector,
					text: "${KAGEMUSHA_DEMO_EMAIL}",
				},
				{
					action: "type",
					selector: passwordSelector,
					text: "${KAGEMUSHA_DEMO_PASSWORD}",
				},
				{ action: "click", selector: submitSelector },
				{ action: "waitForNavigation" },
			],
		};
	}

	// Write config
	fs.writeFileSync(
		path.join(cwd, "kagemusha.config.yaml"),
		toYaml(config, { lineWidth: 120 }),
	);
	console.log(chalk.green("\n✓ Created kagemusha.config.yaml"));

	// Step 2: Discover pages and create screenshot definitions
	fs.mkdirSync(path.join(cwd, ".kagemusha/definitions"), { recursive: true });

	console.log(chalk.blue(`\n🔍 Scanning ${baseUrl} for pages...\n`));

	let pages: { path: string; title: string }[] = [];
	try {
		pages = await discoverPages(baseUrl);
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

	for (const pagePath of selectedPaths) {
		const id = deriveIdFromPath(pagePath);
		const definition = {
			id,
			name: id,
			url: pagePath,
			capture: { mode: "fullPage" },
			hideElements: [],
			decorations: [],
		};

		const defPath = path.join(cwd, ".kagemusha/definitions", `${id}.json`);
		fs.writeFileSync(defPath, `${JSON.stringify(definition, null, 2)}\n`);
		console.log(chalk.green(`  ✓ ${id} → ${defPath}`));
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
		chalk.gray("  npx kagemusha preview    — Preview screenshots locally"),
	);
	console.log(chalk.gray("  npx kagemusha validate   — Validate config files"));
	console.log(chalk.gray("  npx kagemusha run        — Run full pipeline\n"));
}

function generateWorkflowTemplate(): string {
	return `name: Kagemusha - Screenshot Update

on:
  pull_request:
    types: [closed]
    branches: [main]
  workflow_dispatch:

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

      - run: npx kagemusha run
        env:
          KAGEMUSHA_DEMO_EMAIL: \${{ secrets.KAGEMUSHA_DEMO_EMAIL }}
          KAGEMUSHA_DEMO_PASSWORD: \${{ secrets.KAGEMUSHA_DEMO_PASSWORD }}
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
`;
}

function deriveIdFromPath(urlPath: string): string {
	return (
		urlPath
			.replace(/^\//, "")
			.replace(/\.\w+$/, "")
			.replace(/[/\\]/g, "-")
			.replace(/[^a-zA-Z0-9-]/g, "") || "page"
	);
}
