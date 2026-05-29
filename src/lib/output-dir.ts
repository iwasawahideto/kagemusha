import path from "node:path";
import type { KagemushaConfig } from "../types.js";

// Local FS path for canonical screenshots. Source of truth in local mode;
// working copy of S3 in s3 mode.

const DEFAULT_OUTPUT_DIR = "screenshots";

export const getOutputDir = (
	config: KagemushaConfig,
	projectRoot: string,
): string => {
	const configured = config.publish?.outputDir ?? DEFAULT_OUTPUT_DIR;
	return path.isAbsolute(configured)
		? configured
		: path.join(projectRoot, configured);
};

export const getCanonicalPath = (
	config: KagemushaConfig,
	projectRoot: string,
	id: string,
): string => path.join(getOutputDir(config, projectRoot), `${id}.png`);
