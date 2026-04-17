import inquirer from "inquirer";
import fs from "node:fs";
import path from "node:path";
import { stringify as toYaml } from "yaml";
import chalk from "chalk";

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
    message: "Staging environment URL:",
    default: "https://staging.example.com",
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
      { type: "input", name: "loginUrl", message: "Login page path:", default: "/login" },
      { type: "input", name: "emailSelector", message: "Email input selector:", default: "#email" },
      { type: "input", name: "passwordSelector", message: "Password input selector:", default: "#password" },
      { type: "input", name: "submitSelector", message: "Login button selector:", default: "button[type='submit']" },
    ]);
    loginUrl = authAnswers.loginUrl;
    emailSelector = authAnswers.emailSelector;
    passwordSelector = authAnswers.passwordSelector;
    submitSelector = authAnswers.submitSelector;
  }

  const { cdnBucket } = await inquirer.prompt<{ cdnBucket: string }>({
    type: "input",
    name: "cdnBucket",
    message: "S3 bucket name for screenshots:",
    default: "kagemusha-screenshots",
  });

  const { cdnBaseUrl } = await inquirer.prompt<{ cdnBaseUrl: string }>({
    type: "input",
    name: "cdnBaseUrl",
    message: "S3 public URL base:",
    default: `https://${cdnBucket}.s3.ap-northeast-1.amazonaws.com`,
  });

  // Build config
  const config: Record<string, unknown> = {
    app: { baseUrl },
    screenshot: {
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
      defaultDiffThreshold: 0.5,
    },
    publish: {
      destination: "s3",
      cdnBucket,
      cdnBaseUrl,
    },
  };

  if (needsAuth) {
    config.auth = {
      loginUrl,
      steps: [
        { action: "type", selector: emailSelector, text: "${KAGEMUSHA_DEMO_EMAIL}" },
        { action: "type", selector: passwordSelector, text: "${KAGEMUSHA_DEMO_PASSWORD}" },
        { action: "click", selector: submitSelector },
        { action: "waitForNavigation" },
      ],
    };
  }

  // Write config
  fs.writeFileSync(
    path.join(cwd, "kagemusha.config.yaml"),
    toYaml(config, { lineWidth: 120 })
  );
  console.log(chalk.green("\n✓ Created kagemusha.config.yaml"));

  // Step 2: Screenshot definitions
  fs.mkdirSync(path.join(cwd, ".kagemusha/definitions"), { recursive: true });

  let addMore = true;
  while (addMore) {
    const { id } = await inquirer.prompt<{ id: string }>({
      type: "input", name: "id", message: "Screenshot ID (e.g. survey-result-page):",
    });
    const { name } = await inquirer.prompt<{ name: string }>({
      type: "input", name: "name", message: "Display name:",
    });
    const { url } = await inquirer.prompt<{ url: string }>({
      type: "input", name: "url", message: "Page path (e.g. /surveys/123/results):",
    });
    const { captureMode } = await inquirer.prompt<{ captureMode: string }>({
      type: "list",
      name: "captureMode",
      message: "Capture mode:",
      choices: [
        { name: "Full page", value: "fullPage" },
        { name: "CSS selector", value: "selector" },
        { name: "Crop (coordinates)", value: "crop" },
      ],
    });

    let capture: Record<string, unknown> = { mode: captureMode };
    if (captureMode === "selector") {
      const { selector } = await inquirer.prompt<{ selector: string }>({
        type: "input", name: "selector", message: "CSS selector for capture:",
      });
      capture = { mode: "selector", selector };
    }

    const definition = { id, name, url, capture, hideElements: [], decorations: [] };

    const defPath = path.join(cwd, ".kagemusha/definitions", `${id}.json`);
    fs.writeFileSync(defPath, JSON.stringify(definition, null, 2) + "\n");
    console.log(chalk.green(`✓ Created ${defPath}`));

    const { more } = await inquirer.prompt<{ more: boolean }>({
      type: "confirm", name: "more", message: "Add another screenshot definition?", default: false,
    });
    addMore = more;
  }

  // Step 3: GitHub Actions workflow
  const { createWorkflow } = await inquirer.prompt<{ createWorkflow: boolean }>({
    type: "confirm",
    name: "createWorkflow",
    message: "Generate GitHub Actions workflow?",
    default: true,
  });

  if (createWorkflow) {
    const workflowDir = path.join(cwd, ".github/workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "kagemusha.yml"), generateWorkflowTemplate());
    console.log(chalk.green("✓ Created .github/workflows/kagemusha.yml"));
  }

  console.log(chalk.bold.green("\n✅ Setup complete!\n"));
  console.log(chalk.gray("Next steps:"));
  console.log(chalk.gray("  npx kagemusha preview    — Preview screenshots locally"));
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
