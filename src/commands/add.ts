import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { findProjectRoot } from "../lib/config.js";

interface AddOptions {
	capture?: string;
}

export const addCommand = async (
	pagePath: string,
	options: AddOptions,
): Promise<void> => {
	const projectRoot = findProjectRoot();
	const defsDir = path.join(projectRoot, ".kagemusha/definitions");
	fs.mkdirSync(defsDir, { recursive: true });

	const id =
		pagePath
			.replace(/^\//, "")
			.replace(/\.\w+$/, "")
			.replace(/[/\\]/g, "-")
			.replace(/[^a-zA-Z0-9-]/g, "") || "page";

	const defPath = path.join(defsDir, `${id}.json`);

	if (fs.existsSync(defPath)) {
		console.log(chalk.yellow(`\n⚠ Definition already exists: ${defPath}\n`));
		return;
	}

	const definition = {
		id,
		name: id,
		url: pagePath,
		capture: { mode: options.capture ?? "fullPage" },
		hideElements: [],
		decorations: [],
	};

	fs.writeFileSync(defPath, `${JSON.stringify(definition, null, 2)}\n`);
	console.log(chalk.green(`\n✅ Added ${id} → ${defPath}\n`));
};
