import fs from "node:fs";
import path from "node:path";

const STAGING_DIR = path.join(".kagemusha", ".staging");
const REPORTS_DIR = path.join("reports", "diff");

export const getStagingDir = (projectRoot: string): string =>
	path.join(projectRoot, STAGING_DIR);

export const getStagingPath = (projectRoot: string, id: string): string =>
	path.join(projectRoot, STAGING_DIR, `${id}.png`);

export const getReportDiffPath = (projectRoot: string, id: string): string =>
	path.join(projectRoot, REPORTS_DIR, `${id}.diff.png`);

export const ensureStagingDirs = (projectRoot: string): void => {
	fs.mkdirSync(getStagingDir(projectRoot), { recursive: true });
	fs.mkdirSync(path.join(projectRoot, REPORTS_DIR), { recursive: true });
};

/** Move staging file to canonical location, overwriting if it exists. */
export const promoteToCanonical = (
	stagingPath: string,
	canonicalPath: string,
): void => {
	fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
	fs.copyFileSync(stagingPath, canonicalPath);
	fs.rmSync(stagingPath, { force: true });
};

export const cleanupStaging = (projectRoot: string): void => {
	const dir = getStagingDir(projectRoot);
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
};
