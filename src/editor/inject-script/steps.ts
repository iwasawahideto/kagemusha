// Recorded-step list transforms. Pure — no DOM, no editor state.

import type { CaptureAction } from "./types.js";

export type ScrollAction = Extract<CaptureAction, { action: "scroll" }>;

const trailingScrollFor = (
	steps: CaptureAction[],
	selector: string | undefined,
): ScrollAction | null => {
	const last = steps[steps.length - 1];
	return last?.action === "scroll" && last.selector === selector ? last : null;
};

// A back-and-forth scroll of one target is a single intent: only where it came
// to rest matters. Any other step in between makes the order meaningful again.
export const appendScrollStep = (
	steps: CaptureAction[],
	step: ScrollAction,
): CaptureAction[] => {
	if (trailingScrollFor(steps, step.selector)) {
		return [...steps.slice(0, -1), step];
	}
	return [...steps, step];
};

// Where a target already rests, so an incremental edit can add to it.
export const trailingScrollY = (
	steps: CaptureAction[],
	selector: string | undefined,
): number => trailingScrollFor(steps, selector)?.y ?? 0;

// Scrolling back to 0 is what the page does on load anyway — a y:0 step would
// only be noise in the list.
export const dropTrailingScrollStep = (
	steps: CaptureAction[],
	selector: string | undefined,
): CaptureAction[] =>
	trailingScrollFor(steps, selector) ? steps.slice(0, -1) : steps;
