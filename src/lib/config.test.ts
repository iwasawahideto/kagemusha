import { describe, expect, it } from "bun:test";
import type { KagemushaConfig, ScreenshotDefinition } from "../types.js";
import { validateConfig, validateDefinition } from "./config.js";

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

const mkConfig = (publish?: KagemushaConfig["publish"]): KagemushaConfig =>
	({
		app: { baseUrl: "https://app.example.com" },
		screenshot: {
			defaultViewport: { width: 1440, height: 900 },
			defaultDiffThreshold: 0.005,
		},
		...(publish ? { publish } : {}),
	}) as KagemushaConfig;

const regionErrors = (config: KagemushaConfig): string[] =>
	validateConfig(config).filter((e) => e.startsWith("publish.region"));

describe("validateConfig — publish.region", () => {
	it("absent is valid (falls back to cdnBaseUrl / SDK default)", () => {
		expect(validateConfig(mkConfig())).toEqual([]);
		expect(
			validateConfig(mkConfig({ destination: "s3", cdnBucket: "test-bucket" })),
		).toEqual([]);
	});

	it("a non-empty string is valid", () => {
		expect(
			regionErrors(mkConfig({ destination: "s3", region: "ap-northeast-1" })),
		).toEqual([]);
	});

	it("rejects empty / whitespace-only regions", () => {
		expect(
			regionErrors(mkConfig({ destination: "s3", region: "" })),
		).toHaveLength(1);
		expect(
			regionErrors(mkConfig({ destination: "s3", region: "   " })),
		).toHaveLength(1);
	});

	it("rejects non-strings (hand-edited yaml)", () => {
		expect(
			regionErrors(
				mkConfig({
					destination: "s3",
					region: 1 as unknown as string,
				}),
			),
		).toHaveLength(1);
	});
});
