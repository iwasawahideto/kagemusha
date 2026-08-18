import { describe, expect, it } from "bun:test";
import type { Page } from "playwright-core";
import type {
	CaptureAction,
	KagemushaConfig,
	ScreenshotDefinition,
} from "../types.js";
import {
	cropClip,
	effectiveRenderParams,
	executeActions,
	openPreparedPage,
	resolveUrl,
	scrollTargetY,
	takeScreenshotBuffer,
} from "./screenshot.js";

const BASE = "https://app.example.com";

const mkConfig = (deviceScaleFactor = 2): KagemushaConfig => ({
	app: { baseUrl: BASE },
	screenshot: {
		defaultViewport: { width: 1440, height: 900, deviceScaleFactor },
		defaultDiffThreshold: 0.005,
	},
});

describe("effectiveRenderParams", () => {
	it("no zoom → config viewport + DPR unchanged", () => {
		expect(effectiveRenderParams(mkConfig(), {})).toEqual({
			zoom: 1,
			viewport: { width: 1440, height: 900 },
			deviceScaleFactor: 2,
		});
	});

	it("zoom shrinks viewport by 1/z and scales DPR by z (real browser zoom)", () => {
		expect(effectiveRenderParams(mkConfig(), { zoom: 0.9 })).toEqual({
			zoom: 0.9,
			viewport: { width: 1600, height: 1000 },
			deviceScaleFactor: 1.8,
		});
		expect(effectiveRenderParams(mkConfig(), { zoom: 0.5 })).toEqual({
			zoom: 0.5,
			viewport: { width: 2880, height: 1800 },
			deviceScaleFactor: 1,
		});
	});

	it("output device dimensions stay constant across zoom (ladder values)", () => {
		for (const zoom of [1, 0.9, 0.75, 0.5]) {
			const p = effectiveRenderParams(mkConfig(), { zoom });
			expect(p.viewport.width * p.deviceScaleFactor).toBeCloseTo(1440 * 2, 5);
			expect(p.viewport.height * p.deviceScaleFactor).toBeCloseTo(900 * 2, 5);
		}
	});

	it("uses def.viewport as the base when present", () => {
		expect(
			effectiveRenderParams(mkConfig(), {
				viewport: { width: 800, height: 600 },
			}),
		).toEqual({
			zoom: 1,
			viewport: { width: 800, height: 600 },
			deviceScaleFactor: 2,
		});
	});

	it("DPR comes from config, never def.viewport (avoids annotation drift)", () => {
		const p = effectiveRenderParams(mkConfig(2), {
			viewport: { width: 800, height: 600, deviceScaleFactor: 5 },
		});
		expect(p.deviceScaleFactor).toBe(2);
	});

	it("zoomOverride wins over def.zoom", () => {
		expect(
			effectiveRenderParams(mkConfig(), { zoom: 0.5 }, 1).viewport,
		).toEqual({
			width: 1440,
			height: 900,
		});
	});
});

describe("cropClip", () => {
	const crop = { start: { x: 100, y: 50 }, end: { x: 400, y: 250 } };

	it("zoom=1 keeps the stored CSS px", () => {
		expect(cropClip(crop, 1)).toEqual({
			x: 100,
			y: 50,
			width: 300,
			height: 200,
		});
	});

	it("divides by zoom so the clip lands on the same content", () => {
		expect(cropClip(crop, 0.5)).toEqual({
			x: 200,
			y: 100,
			width: 600,
			height: 400,
		});
	});

	it("crop device size is zoom-invariant (÷zoom × DPR×zoom cancels)", () => {
		const baseDpr = 2;
		for (const zoom of [1, 0.9, 0.75, 0.5]) {
			const clip = cropClip(crop, zoom);
			expect(clip.width * (baseDpr * zoom)).toBeCloseTo(300 * baseDpr, 5);
		}
	});
});

describe("scrollTargetY", () => {
	it("zoom=1 keeps the stored CSS px", () => {
		expect(scrollTargetY(800, 1)).toBe(800);
	});

	it("divides by zoom so the viewport lands on the same content", () => {
		expect(scrollTargetY(800, 0.5)).toBe(1600);
		expect(scrollTargetY(900, 1.5)).toBe(600);
	});

	it("device-pixel offset is zoom-invariant (÷zoom × DPR×zoom cancels)", () => {
		const baseDpr = 2;
		for (const zoom of [1, 0.9, 0.75, 0.5]) {
			expect(scrollTargetY(800, zoom) * (baseDpr * zoom)).toBeCloseTo(
				800 * baseDpr,
				5,
			);
		}
	});
});

describe("takeScreenshotBuffer", () => {
	const mkPage = () => {
		const shots: Record<string, unknown>[] = [];
		const page = {
			screenshot: async (opts: Record<string, unknown>) => {
				shots.push(opts);
				return Buffer.alloc(0);
			},
		};
		return { page: page as unknown as Page, shots };
	};

	const mkDef = (capture: ScreenshotDefinition["capture"]) =>
		({ id: "d", name: "d", url: "/d", capture }) as ScreenshotDefinition;

	it("fullPage mode screenshots the whole document, unclipped", async () => {
		const { page, shots } = mkPage();
		await takeScreenshotBuffer(page, mkDef({ mode: "fullPage" }));
		expect(shots[0]).toEqual({ fullPage: true });
	});

	it("crop mode clips with fullPage so the clip is document-relative", async () => {
		const { page, shots } = mkPage();
		await takeScreenshotBuffer(
			page,
			mkDef({
				mode: "crop",
				crop: { start: { x: 100, y: 1200 }, end: { x: 400, y: 1400 } },
			}),
		);
		expect(shots[0]).toEqual({
			fullPage: true,
			clip: { x: 100, y: 1200, width: 300, height: 200 },
		});
	});

	it("crop mode divides the clip by zoom", async () => {
		const { page, shots } = mkPage();
		await takeScreenshotBuffer(
			page,
			mkDef({
				mode: "crop",
				crop: { start: { x: 100, y: 1200 }, end: { x: 400, y: 1400 } },
			}),
			0.5,
		);
		expect(shots[0]).toEqual({
			fullPage: true,
			clip: { x: 200, y: 2400, width: 600, height: 400 },
		});
	});
});

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
		evaluate: async (_fn: unknown, arg?: unknown) => {
			calls.push(`evaluate:${String(arg)}`);
		},
		setViewportSize: async (v: { width: number; height: number }) => {
			calls.push(`viewport:${v.width}x${v.height}`);
		},
		goto: async (url: string) => {
			calls.push(`goto:${url}`);
		},
		waitForLoadState: async () => {
			calls.push("loadState");
		},
		locator: (sel: string) => {
			const vis = cfg.visible?.[sel] ?? [true];
			return {
				count: async () => vis.length,
				evaluate: async (_fn: unknown, arg?: unknown) => {
					calls.push(`loc.evaluate:${sel}:${String(arg)}`);
				},
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

	it("scroll action: base CSS px by default (zoom=1)", async () => {
		const { page, calls } = makeFakePage();
		await executeActions(page, [{ action: "scroll", y: 800 }]);
		expect(calls).toEqual(["evaluate:800"]);
	});

	it("scroll action: divided by the render zoom", async () => {
		const { page, calls } = makeFakePage();
		await executeActions(page, [{ action: "scroll", y: 800 }], { zoom: 0.5 });
		expect(calls).toEqual(["evaluate:1600"]);
	});

	it("scroll action on a selector is zoom-corrected too", async () => {
		const { page, calls } = makeFakePage();
		await executeActions(
			page,
			[{ action: "scroll", selector: ".pane", y: 300 }],
			{
				zoom: 1.5,
			},
		);
		expect(calls).toEqual(["loc.evaluate:.pane:200"]);
	});
});

describe("openPreparedPage (scroll application)", () => {
	const mkDef = (
		over: Partial<ScreenshotDefinition> = {},
	): ScreenshotDefinition =>
		({
			id: "d",
			name: "d",
			url: "/d",
			capture: { mode: "fullPage" },
			...over,
		}) as ScreenshotDefinition;

	const open = async (
		def: ScreenshotDefinition,
		overrides?: { zoom?: number; scrollY?: number },
	) => {
		const { page, calls } = makeFakePage();
		const context = {
			newPage: async () => page,
		} as unknown as Parameters<typeof openPreparedPage>[0];
		await openPreparedPage(
			context,
			mkConfig(),
			def,
			def.beforeCapture,
			{},
			overrides,
		);
		return calls;
	};

	it("no scrollY → never scrolls", async () => {
		expect(await open(mkDef())).not.toContain("evaluate:0");
	});

	it("def.scrollY is applied as-is at zoom 1", async () => {
		expect(await open(mkDef({ scrollY: 640 }))).toContain("evaluate:640");
	});

	it("def.scrollY is divided by def.zoom", async () => {
		expect(await open(mkDef({ scrollY: 640, zoom: 0.8 }))).toContain(
			"evaluate:800",
		);
	});

	it("overrides win over the definition (editor drives live values)", async () => {
		const calls = await open(mkDef({ scrollY: 640, zoom: 0.8 }), {
			zoom: 1,
			scrollY: 200,
		});
		expect(calls).toContain("evaluate:200");
		expect(calls).not.toContain("evaluate:800");
	});

	it("scrolls after replaying beforeCapture, not before", async () => {
		const calls = await open(
			mkDef({
				scrollY: 640,
				beforeCapture: [{ action: "click", selector: "a" }],
			}),
		);
		expect(calls.indexOf("loc.click:a#0:")).toBeLessThan(
			calls.indexOf("evaluate:640"),
		);
	});
});
