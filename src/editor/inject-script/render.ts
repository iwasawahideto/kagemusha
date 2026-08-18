// Debounced snapshot re-render. One channel for zoom / scroll / Record → Stop so
// a render for one of them can never drop another's current value.

import { serializeSteps } from "./record.js";
import { exitSnapshotMode } from "./snapshot.js";
import { state } from "./state.js";

let debounceTimer: number | undefined;

export const requestSnapshotRender = (delayMs: number): void => {
	window.clearTimeout(debounceTimer);
	debounceTimer = window.setTimeout(() => {
		const steps = serializeSteps();
		if (state.zoom === 1 && state.scrollY === 0 && steps.length === 0) {
			exitSnapshotMode();
			return;
		}
		window
			.__kagemusha_render(
				JSON.stringify({ zoom: state.zoom, scrollY: state.scrollY, steps }),
			)
			.catch(() => {});
	}, delayMs);
};
