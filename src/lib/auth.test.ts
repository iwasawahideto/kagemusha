import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLoginRedirect, resolveLoginPath } from "./auth.js";

const BASE = "https://app.example.com";

const check = (
	finalUrl: string,
	defUrl = `${BASE}/dashboard`,
	loginPath = "/login",
): boolean => isLoginRedirect({ finalUrl, defUrl, baseUrl: BASE, loginPath });

describe("isLoginRedirect", () => {
	it("landing on the requested page → false", () => {
		expect(check(`${BASE}/dashboard`)).toBe(false);
	});

	it("landing elsewhere inside the app → false", () => {
		expect(check(`${BASE}/dashboard/overview`)).toBe(false);
		expect(check(`${BASE}/`)).toBe(false);
	});

	it("redirected to the login page → true", () => {
		expect(check(`${BASE}/login`)).toBe(true);
	});

	it("login page with a return-to query → true", () => {
		expect(check(`${BASE}/login?next=%2Fdashboard`)).toBe(true);
	});

	it("login sub-path (e.g. /login/sso) → true", () => {
		expect(check(`${BASE}/login/sso`)).toBe(true);
	});

	it("trailing slash on the login page → true", () => {
		expect(check(`${BASE}/login/`)).toBe(true);
	});

	it("a path that merely starts with the login path → false", () => {
		// /login-help is a marketing page, not the login form.
		expect(check(`${BASE}/login-help`)).toBe(false);
	});

	it("definition targeting the login page itself → false", () => {
		expect(check(`${BASE}/login`, `${BASE}/login`)).toBe(false);
		// Even after the app rewrites it (e.g. /login → /login/sso).
		expect(check(`${BASE}/login/sso`, `${BASE}/login`)).toBe(false);
	});

	it("external IdP origin (SSO) → true", () => {
		expect(check("https://acme.okta.com/app/xyz/sso/saml")).toBe(true);
		expect(check("https://accounts.google.com/o/oauth2/auth")).toBe(true);
	});

	it("external origin is allowed when the definition points there", () => {
		expect(
			check("https://docs.example.org/guide", "https://docs.example.org/guide"),
		).toBe(false);
	});

	it("custom loginPath is honored", () => {
		expect(
			check(`${BASE}/auth/signin`, `${BASE}/dashboard`, "/auth/signin"),
		).toBe(true);
		// …and the default no longer matches.
		expect(check(`${BASE}/login`, `${BASE}/dashboard`, "/auth/signin")).toBe(
			false,
		);
	});

	it("unparseable URLs → false (never block on a parse failure)", () => {
		expect(check("not-a-url")).toBe(false);
		expect(check(`${BASE}/login`, "not-a-url")).toBe(false);
		expect(
			isLoginRedirect({
				finalUrl: `${BASE}/login`,
				defUrl: `${BASE}/dashboard`,
				baseUrl: "",
				loginPath: "/login",
			}),
		).toBe(false);
	});
});

describe("resolveLoginPath", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kagemusha-auth-test-"));
		fs.mkdirSync(path.join(tmpDir, ".kagemusha"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const writeMeta = (content: string): void => {
		fs.writeFileSync(
			path.join(tmpDir, ".kagemusha", "auth-meta.json"),
			content,
		);
	};

	it("defaults to /login when auth-meta.json is absent", () => {
		expect(resolveLoginPath(tmpDir)).toBe("/login");
	});

	it("reads loginPath from auth-meta.json", () => {
		writeMeta(
			JSON.stringify({ loginPath: "/auth/signin", landingPath: "/home" }),
		);
		expect(resolveLoginPath(tmpDir)).toBe("/auth/signin");
	});

	it("normalizes a missing leading slash and a trailing slash", () => {
		writeMeta(JSON.stringify({ loginPath: "signin/" }));
		expect(resolveLoginPath(tmpDir)).toBe("/signin");
	});

	it("falls back on malformed json / wrong types / root path", () => {
		writeMeta("{ not json");
		expect(resolveLoginPath(tmpDir)).toBe("/login");
		writeMeta(JSON.stringify({ landingPath: "/home" }));
		expect(resolveLoginPath(tmpDir)).toBe("/login");
		// "/" would match every pathname and flag every page.
		writeMeta(JSON.stringify({ loginPath: "/" }));
		expect(resolveLoginPath(tmpDir)).toBe("/login");
	});

	it("a custom loginPath drives the redirect check end to end", () => {
		writeMeta(JSON.stringify({ loginPath: "/auth/signin" }));
		expect(
			isLoginRedirect({
				finalUrl: `${BASE}/auth/signin?next=%2Fdashboard`,
				defUrl: `${BASE}/dashboard`,
				baseUrl: BASE,
				loginPath: resolveLoginPath(tmpDir),
			}),
		).toBe(true);
	});
});
