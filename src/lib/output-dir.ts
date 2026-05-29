import path from "node:path";
import type { KagemushaConfig } from "../types.js";

// Where canonical screenshots live on the local filesystem.
//
// Both modes use this directory:
// - local destination: this *is* the source of truth
// - s3 destination: this holds a working copy of what was fetched from S3
//   for diffing (and where staging is written before push)
//
// Kept here (separate from S3 backend code in `s3-canonical.ts`) because
// these helpers are local-FS-only and used by capture / screenshot
// regardless of whether a remote is configured.

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
