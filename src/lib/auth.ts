import fs from "node:fs";
import path from "node:path";

const AUTH_STATE_FILE = "auth-state.json";
const AUTH_META_FILE = "auth-meta.json";
const KAGEMUSHA_DIR = ".kagemusha";

export const getAuthStatePath = (projectRoot: string): string =>
	path.join(projectRoot, KAGEMUSHA_DIR, AUTH_STATE_FILE);

export const hasAuthState = (projectRoot: string): boolean =>
	fs.existsSync(getAuthStatePath(projectRoot));

export const getAuthMetaPath = (projectRoot: string): string =>
	path.join(projectRoot, KAGEMUSHA_DIR, AUTH_META_FILE);
