import chalk from "chalk";
import {
	findProjectRoot,
	loadConfig,
	loadDefinitions,
	validateConfig,
	validateDefinition,
} from "../lib/config.js";

export async function validateCommand(): Promise<void> {
	console.log(chalk.bold("\n🥷 Kagemusha — Validate\n"));

	let hasErrors = false;

	try {
		const projectRoot = findProjectRoot();

		// Validate config
		console.log(chalk.blue("Checking kagemusha.config.yaml..."));
		const config = loadConfig(projectRoot);
		const configErrors = validateConfig(config);
		if (configErrors.length > 0) {
			hasErrors = true;
			for (const err of configErrors) {
				console.log(chalk.red(`  ✗ ${err}`));
			}
		} else {
			console.log(chalk.green("  ✓ Config is valid"));
		}

		// Validate definitions
		const definitions = loadDefinitions(projectRoot);
		console.log(
			chalk.blue(`\nChecking ${definitions.length} definition(s)...`),
		);

		for (const def of definitions) {
			const errors = validateDefinition(def);
			if (errors.length > 0) {
				hasErrors = true;
				console.log(chalk.red(`  ✗ ${def.id ?? "(no id)"}`));
				for (const err of errors) {
					console.log(chalk.red(`    - ${err}`));
				}
			} else {
				console.log(chalk.green(`  ✓ ${def.id}`));
			}
		}

		if (definitions.length === 0) {
			console.log(
				chalk.yellow("  No definitions found in .kagemusha/definitions.json"),
			);
		}
	} catch (err) {
		hasErrors = true;
		console.log(chalk.red(`\n✗ ${(err as Error).message}`));
	}

	if (hasErrors) {
		console.log(chalk.red("\n❌ Validation failed\n"));
		process.exit(1);
	} else {
		console.log(chalk.bold.green("\n✅ All checks passed!\n"));
	}
}
