import { describe, expect, it } from "bun:test";
import { isOverThreshold } from "./diff.js";

describe("isOverThreshold", () => {
	// diffPercentage is in % (e.g. 2.34), threshold is in fraction (e.g. 0.005).

	it("returns true when diff exceeds threshold", () => {
		// 2.34% > 0.5%
		expect(isOverThreshold(2.34, 0.005)).toBe(true);
	});

	it("returns false when diff is below threshold", () => {
		// 0.16% <= 0.5% — the symptom the bug fix is targeting
		expect(isOverThreshold(0.16, 0.005)).toBe(false);
	});

	it("returns false when diff exactly equals threshold (strict >)", () => {
		// 0.5% is not > 0.5% — borderline counts as unchanged.
		// Locks in the same `> threshold` semantic the dry-run gate had.
		expect(isOverThreshold(0.5, 0.005)).toBe(false);
	});

	it("returns false for diffs that round-display to 0% but are non-zero", () => {
		// jq template shows `(d * 100 | floor) / 100` so 0.001% renders as 0%.
		// Pre-fix these still triggered "changed"; with threshold filtering
		// they should not.
		expect(isOverThreshold(0.001, 0.005)).toBe(false);
	});

	it("threshold = 0 means every non-zero diff is over", () => {
		expect(isOverThreshold(0.000001, 0)).toBe(true);
	});
});
