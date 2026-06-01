import { describe, expect, it } from "bun:test";
import { resolveUrl } from "./screenshot.js";

const BASE = "https://app.example.com";

describe("resolveUrl", () => {
	it("joins an absolute path against baseUrl", () => {
		expect(resolveUrl(BASE, "/dashboard")).toBe(
			"https://app.example.com/dashboard",
		);
	});

	it("joins a relative path against baseUrl (uses base directory)", () => {
		expect(resolveUrl(`${BASE}/base/`, "sub/page")).toBe(
			"https://app.example.com/base/sub/page",
		);
	});

	it("substitutes a single {key} from urlParams", () => {
		expect(resolveUrl(BASE, "/team/{teamId}/page", { teamId: "abc123" })).toBe(
			"https://app.example.com/team/abc123/page",
		);
	});

	it("substitutes multiple {key} occurrences across the path", () => {
		expect(
			resolveUrl(BASE, "/org/{orgId}/team/{teamId}", {
				orgId: "org-7",
				teamId: "team-42",
			}),
		).toBe("https://app.example.com/org/org-7/team/team-42");
	});

	it("leaves {key} unsubstituted (percent-encoded) when not in urlParams", () => {
		// `new URL(...)` percent-encodes `{` / `}` per WHATWG. This locks in
		// the current behavior so a future change to URL handling shows up here.
		expect(resolveUrl(BASE, "/team/{teamId}/page")).toBe(
			"https://app.example.com/team/%7BteamId%7D/page",
		);
	});

	it("baseUrl with trailing slash matches without (for absolute paths)", () => {
		expect(resolveUrl(`${BASE}/`, "/dashboard")).toBe(
			resolveUrl(BASE, "/dashboard"),
		);
	});
});
