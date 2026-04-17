import chalk from "chalk";
import { chromium } from "playwright";
import {
  loadConfig,
  loadDefinitions,
  findProjectRoot,
} from "../lib/config.js";
import { captureScreenshots } from "../lib/screenshot.js";
import { annotateScreenshots } from "../lib/annotate.js";

interface PreviewOptions {
  id?: string;
}

export async function previewCommand(options: PreviewOptions): Promise<void> {
  console.log(chalk.bold("\n🥷 Kagemusha — Preview\n"));

  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);

  let definitions = loadDefinitions(projectRoot);
  if (options.id) {
    definitions = definitions.filter((d) => d.id === options.id);
    if (definitions.length === 0) {
      console.log(chalk.red(`Definition not found: ${options.id}`));
      return;
    }
  }

  console.log(chalk.blue(`📸 Capturing ${definitions.length} screenshot(s)...`));
  const results = await captureScreenshots(config, definitions, projectRoot);
  const annotated = await annotateScreenshots(definitions, results, projectRoot);

  console.log(chalk.green("\n✅ Screenshots captured. Opening preview...\n"));

  // Open annotated screenshots in browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  for (const result of annotated) {
    const page = await context.newPage();
    await page.goto(`file://${result.annotatedPath}`);
  }

  console.log(chalk.gray("Press Ctrl+C to close preview.\n"));

  // Keep process alive until user closes
  await new Promise(() => {});
}
