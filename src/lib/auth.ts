import fs from "node:fs";
import path from "node:path";
import type { KagemushaConfig } from "../types.js";

const AUTH_STATE_FILE = "auth-state.json";
const AUTH_META_FILE = "auth-meta.json";
const KAGEMUSHA_DIR = ".kagemusha";
const DEFAULT_LOGIN_PATH = "/login";
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

// Returns null for "" / "/", which would match every pathname and flag every page.
const normalizeLoginPath = (raw: string): string | null => {
	const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
	const trimmed = withSlash.replace(/\/+$/, "");
	return trimmed === "" ? null : trimmed;
};

// Any read/parse failure falls back to /login rather than disabling the check.
export const resolveLoginPath = (projectRoot: string): string => {
	try {
		const meta = JSON.parse(
			fs.readFileSync(getAuthMetaPath(projectRoot), "utf-8"),
		) as { loginPath?: unknown };
		if (typeof meta.loginPath !== "string") return DEFAULT_LOGIN_PATH;
		return normalizeLoginPath(meta.loginPath) ?? DEFAULT_LOGIN_PATH;
	} catch {
		return DEFAULT_LOGIN_PATH;
	}
};

// Segment-aware so /login matches /login and /login/sso but not /login-help.
const isUnderLoginPath = (pathname: string, loginPath: string): boolean => {
	const p = pathname.replace(/\/+$/, "") || "/";
	return p === loginPath || p.startsWith(`${loginPath}/`);
};

// Biased toward false: a false positive blocks a legitimate edit session, while
// a false negative just restores today's behavior.
export const isLoginRedirect = (opts: {
	finalUrl: string;
	defUrl: string;
	baseUrl: string;
	loginPath: string;
}): boolean => {
	let final: URL;
	let def: URL;
	let base: URL;
	try {
		final = new URL(opts.finalUrl);
		def = new URL(opts.defUrl);
		base = new URL(opts.baseUrl);
	} catch {
		return false;
	}

	// Annotating the login screen itself is a legitimate definition.
	if (isUnderLoginPath(def.pathname, opts.loginPath)) return false;

	if (isUnderLoginPath(final.pathname, opts.loginPath)) return true;

	// Off both origins → external SSO (Okta, Google, …), whose paths we can't know.
	return final.origin !== base.origin && final.origin !== def.origin;
};

// login / edit share one viewport + DPR so annotations don't drift.
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
