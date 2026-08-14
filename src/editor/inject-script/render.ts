// Debounced "re-render the snapshot" request. Shared by zoom and scroll, which
// both change how the headless render must be set up — one channel so a zoom
// render can't drop the current scroll position (or the other way round).

import { serializeSteps } from "./record.js";
import { exitSnapshotMode } from "./snapshot.js";
import { state } from "./state.js";

let debounceTimer: number | undefined;

export const requestSnapshotRender = (delayMs: number): void => {
	window.clearTimeout(debounceTimer);
	debounceTimer = window.setTimeout(() => {
		const steps = serializeSteps();
		// Nothing left that needs a headless render → return to the live DOM.
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
