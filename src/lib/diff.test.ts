import { describe, expect, it } from "bun:test";
import { classify } from "./diff.js";

// `diffPercentage` is in % (e.g. 2.34), `threshold` is in fraction (e.g. 0.005).
const THRESHOLD = 0.005; // = 0.5%, the default in kagemusha.config.yaml

describe("classify", () => {
	it("match=true → unchanged", () => {
		expect(classify({ match: true }, THRESHOLD)).toEqual({ kind: "unchanged" });
	});

	it("layout-diff → layout-changed, carrying both dimensions", () => {
		const canonical = { width: 1440, height: 900 };
		const staging = { width: 1440, height: 1200 };
		expect(
			classify(
				{ match: false, reason: "layout-diff", canonical, staging },
				THRESHOLD,
			),
		).toEqual({ kind: "layout-changed", canonical, staging });
	});

	it("layout-diff ignores threshold (always layout-changed)", () => {
		// Even with threshold=1 (= 100%), a dimension mismatch is substantive.
		const canonical = { width: 100, height: 100 };
		const staging = { width: 100, height: 200 };
		expect(
			classify({ match: false, reason: "layout-diff", canonical, staging }, 1)
				.kind,
		).toBe("layout-changed");
	});

	it("pixel-diff above threshold → pixel-changed", () => {
		expect(
			classify(
				{
					match: false,
					reason: "pixel-diff",
					diffCount: 100,
					diffPercentage: 2.34,
				},
				THRESHOLD,
			),
		).toEqual({ kind: "pixel-changed", diffPercentage: 2.34 });
	});

	it("pixel-diff below threshold → unchanged (the bug-fix symptom)", () => {
		expect(
			classify(
				{
					match: false,
					reason: "pixel-diff",
					diffCount: 5,
					diffPercentage: 0.16,
				},
				THRESHOLD,
			),
		).toEqual({ kind: "unchanged" });
	});

	it("pixel-diff exactly at threshold → unchanged (strict >)", () => {
		expect(
			classify(
				{
					match: false,
					reason: "pixel-diff",
					diffCount: 10,
					diffPercentage: 0.5,
				},
				THRESHOLD,
			).kind,
		).toBe("unchanged");
	});

	it("pixel-diff that renders as 0% in jq → unchanged", () => {
		// jq's `(d * 100 | floor) / 100` floors 0.001 to 0; these were the
		// "(0%)" Slack notifications before the fix.
		expect(
			classify(
				{
					match: false,
					reason: "pixel-diff",
					diffCount: 1,
					diffPercentage: 0.001,
				},
				THRESHOLD,
			).kind,
		).toBe("unchanged");
	});

	it("threshold = 0 lets every non-zero pixel diff through", () => {
		expect(
			classify(
				{
					match: false,
					reason: "pixel-diff",
					diffCount: 1,
					diffPercentage: 0.000001,
				},
				0,
			).kind,
		).toBe("pixel-changed");
	});
});
