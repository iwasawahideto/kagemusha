import fs from "node:fs";
import path from "node:path";
import type { KagemushaConfig } from "../types.js";

const AUTH_STATE_FILE = "auth-state.json";
const AUTH_META_FILE = "auth-meta.json";
const KAGEMUSHA_DIR = ".kagemusha";
// .mjs is preferred (no ambiguity with package.json's "type" field). .js is
// accepted for projects that already declare "type": "module".
const DEFAULT_LOGIN_SCRIPTS = ["login.mjs", "login.js"];

// Resolves the path to the user-provided login script. Returns null if
// neither `auth.scriptPath` nor any default candidate exists.
// Both `login` and `capture` go through this so behavior stays in sync.
export const resolveLoginScriptPath = (
	config: KagemushaConfig,
	projectRoot: string,
): string | null => {
	const configured = config.auth?.scriptPath;
	if (configured) {
		const p = path.resolve(projectRoot, configured);
		return fs.existsSync(p) ? p : null;
	}
	for (const name of DEFAULT_LOGIN_SCRIPTS) {
		const p = path.join(projectRoot, KAGEMUSHA_DIR, name);
		if (fs.existsSync(p)) return p;
	}
	return null;
};

export const getAuthStatePath = (projectRoot: string): string =>
	path.join(projectRoot, KAGEMUSHA_DIR, AUTH_STATE_FILE);

export const hasAuthState = (projectRoot: string): boolean =>
	fs.existsSync(getAuthStatePath(projectRoot));

export const getAuthMetaPath = (projectRoot: string): string =>
	path.join(projectRoot, KAGEMUSHA_DIR, AUTH_META_FILE);

// Spread into Playwright's browser.newContext() options to enable auth reuse
// when a saved storageState exists. No-op when missing.
export const authContextOptions = (
	projectRoot: string | undefined,
): { storageState?: string } =>
	projectRoot && hasAuthState(projectRoot)
		? { storageState: getAuthStatePath(projectRoot) }
		: {};

// Standard browser.newContext() options used by login / edit / capture so all
// sessions render at identical viewport + DPR (avoids annotation drift between
// editor view and captured image).
export const defaultContextOptions = (
	config: KagemushaConfig,
	projectRoot: string | undefined,
) => {
	const vp = config.screenshot.defaultViewport;
	return {
		baseURL: config.app.baseUrl,
		viewport: { width: vp.width, height: vp.height },
		deviceScaleFactor: vp.deviceScaleFactor ?? 2,
		...authContextOptions(projectRoot),
	};
};
