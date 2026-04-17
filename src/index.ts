#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { captureCommand } from "./commands/capture.js";
import { previewCommand } from "./commands/preview.js";
import { validateCommand } from "./commands/validate.js";

const BANNER = `
  ${chalk.bold("kagemusha")} ${chalk.gray("v0.1.0")}
  ${chalk.dim("The shadow warrior for your documentation.")}

  ${chalk.white("Auto-update help center screenshots")}
  ${chalk.white("when your code changes.")}
`;

const program = new Command();

program
  .name("kagemusha")
  .version("0.1.0")
  .addHelpText("beforeAll", BANNER)
  .configureHelp({
    sortSubcommands: false,
  });

program
  .command("init")
  .description("Set up config, screenshot definitions, and GitHub Actions workflow")
  .action(initCommand);

program
  .command("run")
  .description("Run full pipeline: capture → upload to S3")
  .option("--ids <ids>", "Comma-separated screenshot definition IDs")
  .action(runCommand);

program
  .command("capture")
  .description("Capture screenshots only")
  .option("--ids <ids>", "Comma-separated screenshot definition IDs")
  .option("--all", "Capture all definitions")
  .action(captureCommand);

program
  .command("preview")
  .description("Preview screenshots locally (opens browser)")
  .option("--id <id>", "Preview a specific definition")
  .action(previewCommand);

program
  .command("validate")
  .description("Validate config and definition files")
  .action(validateCommand);

// Phase 2 commands
program
  .command("compare")
  .description("Compare screenshots with baselines (VRT) " + chalk.yellow("[coming soon]"))
  .action(() => {
    console.log(chalk.yellow("\n🚧 compare is coming in Phase 2.\n"));
  });

program
  .command("publish")
  .description("Publish screenshots to Intercom / external services " + chalk.yellow("[coming soon]"))
  .action(() => {
    console.log(chalk.yellow("\n🚧 publish is coming in Phase 2.\n"));
  });

program.parse();
