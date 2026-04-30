#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { captureCommand } from "./commands/capture.js";
import { compareCommand } from "./commands/compare.js";
import { discoverCommand } from "./commands/discover.js";
import { editCommand } from "./commands/edit.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { loginCommand } from "./commands/login.js";
import { runCommand } from "./commands/run.js";
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
	.description(
		"Set up config, screenshot definitions, and GitHub Actions workflow",
	)
	.action(initCommand);

program
	.command("login")
	.description("Log in to your app (opens browser, saves session)")
	.action(loginCommand);

program
	.command("add <path>")
	.description(
		"Add a screenshot definition (defaults to fullPage; use 'edit' to change capture range)",
	)
	.option("--id <id>", "Custom definition ID (auto-suffixed if exists)")
	.action(addCommand);

program
	.command("discover")
	.description("Auto-discover pages by crawling your app")
	.action(discoverCommand);

program
	.command("list")
	.description("List current screenshot definitions")
	.action(listCommand);

program
	.command("run")
	.description("Run full pipeline: capture → upload to S3")
	.option("--ids <ids>", "Comma-separated screenshot definition IDs")
	.action(runCommand);

program
	.command("capture")
	.description("Capture screenshots (all definitions if --ids is omitted)")
	.option("--ids <ids>", "Comma-separated screenshot definition IDs")
	.option(
		"--open",
		"Open screenshots in the system default viewer (Preview / xdg-open / start)",
	)
	.action(captureCommand);

program
	.command("edit")
	.description("Open visual annotation editor for a screenshot")
	.option("--id <id>", "Screenshot definition ID to edit")
	.action(editCommand);

program
	.command("validate")
	.description("Validate config and definition files")
	.action(validateCommand);

program
	.command("compare")
	.description(
		"Capture into staging and diff against canonical screenshots/ (pure-JS pixelmatch)",
	)
	.option("--ids <ids>", "Comma-separated screenshot definition IDs")
	.option(
		"--threshold <ratio>",
		"Diff ratio (0-1) to flag as changed; overrides config",
	)
	.option(
		"--apply",
		"Promote changed staging captures to screenshots/ (= update canonical)",
	)
	.action(compareCommand);

// Phase 2 commands

program
	.command("publish")
	.description(
		"Publish screenshots to Intercom / external services " +
			chalk.yellow("[coming soon]"),
	)
	.action(() => {
		console.log(chalk.yellow("\n🚧 publish is coming in Phase 2.\n"));
	});

program.parse();
