import chalk from "chalk";
import {
	findProjectRoot,
	loadDefinitions,
	saveDefinitions,
} from "../lib/config.js";
import { deriveIdFromPath } from "../lib/definition.js";

interface AddOptions {
	capture?: string;
	id?: string;
}

export const addCommand = async (
	pagePath: string,
	options: AddOptions,
): Promise<void> => {
	const projectRoot = findProjectRoot();
	const definitions = loadDefinitions(projectRoot);

	const baseId = options.id ?? deriveIdFromPath(pagePath);

	// If ID already exists, append a suffix
	let id = baseId;
	let suffix = 2;
	while (definitions.some((d) => d.id === id)) {
		id = `${baseId}-${suffix}`;
		suffix++;
	}

	definitions.push({
		id,
		name: id,
		url: pagePath,
		capture: { mode: "fullPage" },
		hideElements: [],
		decorations: [],
	});

	saveDefinitions(definitions, projectRoot);
	console.log(chalk.green(`\n✅ Added ${id}\n`));
};
