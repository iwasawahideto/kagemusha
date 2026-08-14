import { describe, expect, it } from "bun:test";
import type { ScreenshotDefinition } from "../types.js";
import { validateDefinition } from "./config.js";

const mkDef = (
	over: Partial<ScreenshotDefinition> = {},
): ScreenshotDefinition =>
	({
		id: "dashboard",
		name: "Dashboard",
		url: "/dashboard",
		capture: { mode: "fullPage" },
		...over,
	}) as ScreenshotDefinition;

const scrollErrors = (def: ScreenshotDefinition): string[] =>
	validateDefinition(def).filter((e) => e.startsWith("scrollY"));

describe("validateDefinition — scrollY", () => {
	it("absent is valid (the default is 0)", () => {
		expect(validateDefinition(mkDef())).toEqual([]);
	});

	it("0 and positive numbers are valid", () => {
		expect(scrollErrors(mkDef({ scrollY: 0 }))).toEqual([]);
		expect(scrollErrors(mkDef({ scrollY: 1840.5 }))).toEqual([]);
	});

	it("rejects negatives", () => {
		expect(scrollErrors(mkDef({ scrollY: -1 }))).toHaveLength(1);
	});

	it("rejects non-finite numbers", () => {
		expect(scrollErrors(mkDef({ scrollY: Number.NaN }))).toHaveLength(1);
		expect(
			scrollErrors(mkDef({ scrollY: Number.POSITIVE_INFINITY })),
		).toHaveLength(1);
	});

	it("rejects non-numbers (hand-edited definitions.json)", () => {
		expect(
			scrollErrors(mkDef({ scrollY: "800" as unknown as number })),
		).toHaveLength(1);
	});
});
