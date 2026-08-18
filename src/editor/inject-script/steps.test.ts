import { describe, expect, it } from "bun:test";
import type { CaptureAction } from "../../types.js";
import {
	appendScrollStep,
	dropTrailingScrollStep,
	trailingScrollY,
} from "./steps.js";

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

describe("trailingScrollY", () => {
	it("is 0 for an empty list", () => {
		expect(trailingScrollY([], ".foo")).toBe(0);
	});

	it("returns the trailing scroll of the same selector", () => {
		expect(
			trailingScrollY([{ action: "scroll", selector: ".foo", y: 300 }], ".foo"),
		).toBe(300);
	});

	it("is 0 for a different selector", () => {
		expect(
			trailingScrollY([{ action: "scroll", selector: ".foo", y: 300 }], ".bar"),
		).toBe(0);
	});

	it("is 0 when another step comes after the scroll", () => {
		expect(
			trailingScrollY(
				[{ action: "scroll", selector: ".foo", y: 300 }, click("button")],
				".foo",
			),
		).toBe(0);
	});

	it("matches the document scroll on an undefined selector", () => {
		expect(trailingScrollY([{ action: "scroll", y: 300 }], undefined)).toBe(
			300,
		);
	});

	it("does not match an element scroll on an undefined selector", () => {
		expect(
			trailingScrollY(
				[{ action: "scroll", selector: ".foo", y: 300 }],
				undefined,
			),
		).toBe(0);
	});
});

describe("dropTrailingScrollStep", () => {
	it("drops the trailing scroll of the same selector", () => {
		expect(
			dropTrailingScrollStep(
				[click("button"), { action: "scroll", selector: ".foo", y: 40 }],
				".foo",
			),
		).toEqual([click("button")]);
	});

	it("keeps a trailing scroll of another selector", () => {
		const steps: CaptureAction[] = [
			{ action: "scroll", selector: ".foo", y: 40 },
		];
		expect(dropTrailingScrollStep(steps, ".bar")).toEqual(steps);
	});

	it("keeps everything when the last step isn't a scroll", () => {
		const steps: CaptureAction[] = [
			{ action: "scroll", selector: ".foo", y: 40 },
			click("button"),
		];
		expect(dropTrailingScrollStep(steps, ".foo")).toEqual(steps);
	});

	it("is a no-op on an empty list", () => {
		expect(dropTrailingScrollStep([], ".foo")).toEqual([]);
	});

	it("does not mutate the input list", () => {
		const original: CaptureAction[] = [
			{ action: "scroll", selector: ".foo", y: 40 },
		];
		dropTrailingScrollStep(original, ".foo");
		expect(original).toHaveLength(1);
	});
});
