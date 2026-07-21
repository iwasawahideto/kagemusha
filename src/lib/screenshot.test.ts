import { describe, expect, it } from "bun:test";
import type { Page } from "playwright-core";
import type { CaptureAction } from "../types.js";
import { executeActions, resolveUrl } from "./screenshot.js";

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

// Fake Page recording the interactions executeActions/runAction/actOnFirstVisible
// perform, so the soft-replay logic can be tested without a real browser.
interface FakePageConfig {
	present?: (sel: string) => boolean; // page.$ returns non-null?
	visible?: Record<string, boolean[]>; // locator(sel): visibility per nth match
	failLocatorClick?: Set<string>; // nth.click() throws for these selectors
	failPageClick?: Set<string>; // page.click() throws for these selectors
}

const makeFakePage = (cfg: FakePageConfig = {}) => {
	const calls: string[] = [];
	const t = (o?: { timeout?: number }) => o?.timeout ?? "";
	const page = {
		$: async (sel: string) => ((cfg.present?.(sel) ?? true) ? {} : null),
		click: async (sel: string, o?: { timeout?: number }) => {
			calls.push(`click:${sel}:${t(o)}`);
			if (cfg.failPageClick?.has(sel)) throw new Error("page.click failed");
		},
		hover: async (sel: string, o?: { timeout?: number }) => {
			calls.push(`hover:${sel}:${t(o)}`);
		},
		fill: async (sel: string) => {
			calls.push(`fill:${sel}`);
		},
		selectOption: async (sel: string) => {
			calls.push(`select:${sel}`);
		},
		locator: (sel: string) => {
			const vis = cfg.visible?.[sel] ?? [true];
			return {
				count: async () => vis.length,
				nth: (i: number) => ({
					isVisible: async () => vis[i],
					click: async (o?: { timeout?: number }) => {
						calls.push(`loc.click:${sel}#${i}:${t(o)}`);
						if (cfg.failLocatorClick?.has(sel))
							throw new Error("loc.click failed");
					},
					hover: async (o?: { timeout?: number }) => {
						calls.push(`loc.hover:${sel}#${i}:${t(o)}`);
					},
				}),
			};
		},
		waitForTimeout: async () => {
			calls.push("wait");
		},
	};
	return { page: page as unknown as Page, calls };
};

describe("executeActions (soft replay)", () => {
	it("soft: skips a failing step and continues with the rest", async () => {
		const { page, calls } = makeFakePage({ failLocatorClick: new Set(["a"]) });
		const steps: CaptureAction[] = [
			{ action: "click", selector: "a", optional: true },
			{ action: "click", selector: "b", optional: true },
		];
		await executeActions(page, steps, { soft: true, timeout: 5000 });
		// "a" was attempted then skipped; "b" still ran.
		expect(calls).toContain("loc.click:a#0:5000");
		expect(calls).toContain("loc.click:b#0:5000");
	});

	it("soft: clicks the first VISIBLE match of an ambiguous selector", async () => {
		const { page, calls } = makeFakePage({
			visible: { 'text="x"': [false, true] },
		});
		await executeActions(
			page,
			[{ action: "click", selector: 'text="x"', optional: true }],
			{ soft: true, timeout: 3000 },
		);
		expect(calls).toContain('loc.click:text="x"#1:3000');
		expect(calls.some((c) => c.startsWith('loc.click:text="x"#0'))).toBe(false);
	});

	it("soft: hover also prefers the first visible match", async () => {
		const { page, calls } = makeFakePage({ visible: { h: [false, true] } });
		await executeActions(
			page,
			[{ action: "hover", selector: "h", optional: true }],
			{ soft: true, timeout: 4000 },
		);
		expect(calls).toContain("loc.hover:h#1:4000");
	});

	it("optional: skips entirely when the element is absent", async () => {
		const { page, calls } = makeFakePage({ present: () => false });
		await executeActions(
			page,
			[{ action: "click", selector: "gone", optional: true }],
			{ soft: true },
		);
		expect(calls).toEqual([]);
	});

	it("non-soft: a failing step propagates (capture stays strict)", async () => {
		const { page } = makeFakePage({ failLocatorClick: new Set(["a"]) });
		await expect(
			executeActions(page, [{ action: "click", selector: "a" }]),
		).rejects.toThrow();
	});

	it("non-soft: also prefers the first visible match (capture)", async () => {
		const { page, calls } = makeFakePage({
			visible: { 'text="x"': [false, true] },
		});
		await executeActions(page, [{ action: "click", selector: 'text="x"' }]);
		expect(calls).toContain('loc.click:text="x"#1:');
	});
});
