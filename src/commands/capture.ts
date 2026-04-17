import chalk from "chalk";
import {
  loadConfig,
  loadDefinitions,
  findProjectRoot,
} from "../lib/config.js";
import { captureScreenshots } from "../lib/screenshot.js";
import { annotateScreenshots } from "../lib/annotate.js";

interface CaptureOptions {
  ids?: string;
  all?: boolean;
}

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

  console.log(chalk.blue(`📸 Capturing ${definitions.length} screenshot(s)...`));
  const results = await captureScreenshots(config, definitions, projectRoot);

  console.log(chalk.blue("🎨 Drawing annotations..."));
  await annotateScreenshots(definitions, results, projectRoot);

  console.log(chalk.bold.green(`\n✅ Done! Screenshots saved to screenshots/\n`));

  for (const r of results) {
    console.log(chalk.gray(`  ${r.id} → ${r.rawPath}`));
  }
}
