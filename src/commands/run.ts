import chalk from "chalk";
import { annotateScreenshots } from "../lib/annotate.js";
import { findProjectRoot, loadConfig, loadDefinitions } from "../lib/config.js";
import { captureScreenshots } from "../lib/screenshot.js";
import { uploadToS3 } from "../lib/upload.js";

interface RunOptions {
	ids?: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
	console.log(chalk.bold("\n🥷 Kagemusha — Running pipeline\n"));

	const projectRoot = findProjectRoot();
	const config = loadConfig(projectRoot);
	let definitions = loadDefinitions(projectRoot);

	if (options.ids) {
		const ids = options.ids.split(",").map((s) => s.trim());
		definitions = definitions.filter((d) => ids.includes(d.id));
	}

	if (definitions.length === 0) {
		console.log(
			chalk.yellow("No screenshot definitions to process. Skipping."),
		);
		return;
	}

	console.log(
		chalk.gray(`  Found ${definitions.length} definition(s) to process\n`),
	);

	// Step 1: Capture
	console.log(chalk.blue("📸 Capturing screenshots..."));
	const captureResults = await captureScreenshots(
		config,
		definitions,
		projectRoot,
	);
	console.log(
		chalk.green(`  ✓ Captured ${captureResults.length} screenshot(s)\n`),
	);

	// Step 2: Annotate
	console.log(chalk.blue("🎨 Drawing annotations..."));
	const annotatedResults = await annotateScreenshots(
		definitions,
		captureResults,
		projectRoot,
	);
	console.log(
		chalk.green(`  ✓ Annotated ${annotatedResults.length} screenshot(s)\n`),
	);

	// Step 3: Publish
	if (config.publish?.destination === "s3") {
		console.log(chalk.blue("☁️  Uploading to S3..."));
		const uploadResults = await uploadToS3(
			config,
			annotatedResults,
			projectRoot,
		);
		console.log(
			chalk.green(`  ✓ Uploaded ${uploadResults.length} screenshot(s)\n`),
		);
	} else {
		console.log(chalk.green(`  Screenshots saved locally\n`));
	}

	console.log(chalk.bold.green("✅ Pipeline complete!\n"));
}
