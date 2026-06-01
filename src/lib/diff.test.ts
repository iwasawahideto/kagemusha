import { describe, expect, it } from "bun:test";
import { isOverThreshold } from "./diff.js";

// diffPercentage is in % (e.g. 2.34), threshold is in fraction (e.g. 0.005).

describe("isOverThreshold", () => {
	it("returns true when diff exceeds threshold", () => {
		expect(isOverThreshold(2.34, 0.005)).toBe(true);
	});

	it("returns false when diff is below threshold (the bug-fix symptom)", () => {
		expect(isOverThreshold(0.16, 0.005)).toBe(false);
	});

	it("returns false when diff exactly equals threshold (strict >)", () => {
		expect(isOverThreshold(0.5, 0.005)).toBe(false);
	});

	it("returns false for diffs that render as 0% but are non-zero", () => {
		// jq's `(d * 100 | floor) / 100` rounds 0.001 down to "0".
		expect(isOverThreshold(0.001, 0.005)).toBe(false);
	});

	it("threshold = 0 means every non-zero diff is over", () => {
		expect(isOverThreshold(0.000001, 0)).toBe(true);
	});
});
