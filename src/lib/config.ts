import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { KagemushaConfig, Route, ScreenshotDefinition } from "../types.js";

const CONFIG_FILENAME = "kagemusha.config.yaml";
const DEFINITIONS_FILE = ".kagemusha/definitions.json";
const ROUTING_FILENAME = ".kagemusha/routing.yaml";

export function findProjectRoot(startDir: string = process.cwd()): string {
	let dir = startDir;
	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	throw new Error(
		`${CONFIG_FILENAME} not found. Run "kagemusha init" to set up your project.`,
	);
}

export function loadConfig(projectRoot?: string): KagemushaConfig {
	const root = projectRoot ?? findProjectRoot();
	const configPath = path.join(root, CONFIG_FILENAME);

	if (!fs.existsSync(configPath)) {
		throw new Error(`Config file not found: ${configPath}`);
	}

	const raw = fs.readFileSync(configPath, "utf-8");
	const config = parseYaml(raw) as KagemushaConfig;
	resolveEnvVars(config);
	return config;
}

export function getDefinitionsPath(projectRoot?: string): string {
	const root = projectRoot ?? findProjectRoot();
	return path.join(root, DEFINITIONS_FILE);
}

export function loadDefinitions(projectRoot?: string): ScreenshotDefinition[] {
	const defsPath = getDefinitionsPath(projectRoot);

	if (!fs.existsSync(defsPath)) {
		return [];
	}

	const content = fs.readFileSync(defsPath, "utf-8");
	return JSON.parse(content) as ScreenshotDefinition[];
}

export function saveDefinitions(
	definitions: ScreenshotDefinition[],
	projectRoot?: string,
): void {
	const defsPath = getDefinitionsPath(projectRoot);
	fs.mkdirSync(path.dirname(defsPath), { recursive: true });
	fs.writeFileSync(defsPath, `${JSON.stringify(definitions, null, 2)}\n`);
}

export function loadRouting(projectRoot?: string): Route[] {
	const root = projectRoot ?? findProjectRoot();
	const routingPath = path.join(root, ROUTING_FILENAME);

	if (!fs.existsSync(routingPath)) {
		return [];
	}

	const raw = fs.readFileSync(routingPath, "utf-8");
	const parsed = parseYaml(raw) as { routes?: Route[] };
	return parsed.routes ?? [];
}

export function loadDefinitionById(
	id: string,
	projectRoot?: string,
): ScreenshotDefinition | undefined {
	const defs = loadDefinitions(projectRoot);
	return defs.find((d) => d.id === id);
}

function resolveEnvVars(obj: unknown): void {
	if (obj === null || obj === undefined) return;
	if (typeof obj === "object") {
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			if (typeof value === "string") {
				(obj as Record<string, unknown>)[key] = value.replace(
					/\$\{(\w+)\}/g,
					(_, envVar: string) => {
						const v = process.env[envVar];
						if (v === undefined) {
							throw new Error(
								`Environment variable \${${envVar}} is referenced in kagemusha.config.yaml but not set.`,
							);
						}
						return v;
					},
				);
			} else if (typeof value === "object") {
				resolveEnvVars(value);
			}
		}
	}
}

export function validateConfig(config: KagemushaConfig): string[] {
	const errors: string[] = [];

	if (!config.app?.baseUrl) {
		errors.push("app.baseUrl is required");
	}
	if (!config.screenshot?.defaultViewport) {
		errors.push("screenshot.defaultViewport is required");
	}

	return errors;
}

export function validateDefinition(def: ScreenshotDefinition): string[] {
	const errors: string[] = [];

	if (!def.id) errors.push("id is required");
	if (!def.url) errors.push("url is required");
	if (!def.capture) errors.push("capture is required");
	if (
		def.capture &&
		!["fullPage", "selector", "crop"].includes(def.capture.mode)
	) {
		errors.push(`capture.mode must be "fullPage", "selector", or "crop"`);
	}

	return errors;
}
