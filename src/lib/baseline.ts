import fs from "node:fs";
import path from "node:path";

const BASELINES_DIR = "baselines";
const SCREENSHOTS_DIR = "screenshots";
const REPORTS_DIR = path.join("reports", "diff");

export const getBaselinePath = (projectRoot: string, id: string): string =>
	path.join(projectRoot, BASELINES_DIR, `${id}.png`);

export const getCurrentPath = (projectRoot: string, id: string): string =>
	path.join(projectRoot, SCREENSHOTS_DIR, `${id}.png`);

export const getDiffPath = (projectRoot: string, id: string): string =>
	path.join(projectRoot, REPORTS_DIR, `${id}.diff.png`);

export const ensureBaselineDirs = (projectRoot: string): void => {
	fs.mkdirSync(path.join(projectRoot, BASELINES_DIR), { recursive: true });
	fs.mkdirSync(path.join(projectRoot, REPORTS_DIR), { recursive: true });
};

export const adoptAsBaseline = (projectRoot: string, id: string): void => {
	const current = getCurrentPath(projectRoot, id);
	const baseline = getBaselinePath(projectRoot, id);
	fs.mkdirSync(path.dirname(baseline), { recursive: true });
	fs.copyFileSync(current, baseline);
};
