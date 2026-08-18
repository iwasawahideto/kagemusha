import { describe, expect, it } from "bun:test";
import type { CaptureAction } from "../../types.js";
import { appendScrollStep } from "./steps.js";

const click = (selector: string): CaptureAction => ({
	action: "click",
	selector,
});

describe("appendScrollStep", () => {
	it("appends to an empty list", () => {
		expect(appendScrollStep([], { action: "scroll", y: 800 })).toEqual([
			{ action: "scroll", y: 800 },
		]);
	});

	it("replaces the previous scroll of the same selector", () => {
		const steps = appendScrollStep(
			[{ action: "scroll", selector: ".foo", y: 300 }],
			{ action: "scroll", selector: ".foo", y: 800 },
		);
		expect(steps).toEqual([{ action: "scroll", selector: ".foo", y: 800 }]);
	});

	it("replaces the previous document scroll (both without selector)", () => {
		const steps = appendScrollStep([{ action: "scroll", y: 300 }], {
			action: "scroll",
			y: 0,
		});
		expect(steps).toEqual([{ action: "scroll", y: 0 }]);
	});

	it("keeps scrolls of different targets", () => {
		const steps = appendScrollStep(
			[{ action: "scroll", selector: ".foo", y: 300 }],
			{ action: "scroll", selector: ".bar", y: 100 },
		);
		expect(steps).toEqual([
			{ action: "scroll", selector: ".foo", y: 300 },
			{ action: "scroll", selector: ".bar", y: 100 },
		]);
	});

	it("does not merge a document scroll into an element scroll", () => {
		const steps = appendScrollStep(
			[{ action: "scroll", selector: ".foo", y: 300 }],
			{ action: "scroll", y: 100 },
		);
		expect(steps).toHaveLength(2);
	});

	it("keeps order when another step separates two scrolls of one target", () => {
		const steps = appendScrollStep(
			[{ action: "scroll", selector: ".foo", y: 300 }, click("button")],
			{ action: "scroll", selector: ".foo", y: 800 },
		);
		expect(steps).toEqual([
			{ action: "scroll", selector: ".foo", y: 300 },
			click("button"),
			{ action: "scroll", selector: ".foo", y: 800 },
		]);
	});

	it("does not mutate the input list", () => {
		const original: CaptureAction[] = [
			{ action: "scroll", selector: ".foo", y: 300 },
		];
		appendScrollStep(original, { action: "scroll", selector: ".foo", y: 800 });
		expect(original).toEqual([{ action: "scroll", selector: ".foo", y: 300 }]);
	});
});
