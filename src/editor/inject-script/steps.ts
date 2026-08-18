// Recorded-step list transforms. Pure — no DOM, no editor state.

import type { CaptureAction } from "./types.js";

export type ScrollAction = Extract<CaptureAction, { action: "scroll" }>;

// A back-and-forth scroll of one target is a single intent: only where it came
// to rest matters. Any other step in between makes the order meaningful again.
export const appendScrollStep = (
	steps: CaptureAction[],
	step: ScrollAction,
): CaptureAction[] => {
	const last = steps[steps.length - 1];
	if (last?.action === "scroll" && last.selector === step.selector) {
		return [...steps.slice(0, -1), step];
	}
	return [...steps, step];
};
