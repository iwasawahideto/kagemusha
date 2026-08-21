// Recorded-step list transforms. Pure — no DOM, no editor state.

import type { CaptureAction } from "./types.js";

export type ScrollAction = Extract<CaptureAction, { action: "scroll" }>;

// Only where a back-and-forth scroll came to rest matters — unless a step intervenes.
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
