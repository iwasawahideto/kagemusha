#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { captureCommand } from "./commands/capture.js";
import { discoverCommand } from "./commands/discover.js";
import { editCommand } from "./commands/edit.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { loginCommand } from "./commands/login.js";
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
	.command("capture")
	.description(
		"Capture screenshots, diff against canonical, and (with --apply) publish only what changed",
	)
	.option("--ids <ids>", "Comma-separated screenshot definition IDs")
	.option(
		"--apply",
		"Update canonical (S3 push or local outputDir) for changed/new files",
	)
	.option(
		"--threshold <ratio>",
		"Diff ratio (0-1) above which to flag as changed; overrides config",
	)
	.option(
		"--open",
		"Open changed/new results in the system default viewer (Preview / xdg-open / start)",
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
