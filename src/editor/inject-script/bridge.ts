// Node ↔ page bridge. The Node side calls these via `page.evaluate` /
// `page.exposeFunction` to load existing data and to receive the saved
// payload. The GUI port will replace this with an IPC layer but keep the
// payload shape identical.

import { loadAnnotations, serializeAnnotations } from "./annotations.js";
import { loadCapture, serializeCapture } from "./crop.js";
import { showErrorToast } from "./dom.js";
import { state } from "./state.js";
import { setCaptureMode } from "./toolbar.js";
import type { CaptureSpec, Decoration } from "./types.js";

declare global {
	interface Window {
		__kagemusha_save: (payloadJson: string) => void;
		__kagemusha_loadAnnotations: (decorations: Decoration[]) => void;
		__kagemusha_loadCapture: (capture: CaptureSpec) => void;
	}
}

const save = (): void => {
	if (state.captureMode === "crop" && !state.captureCrop) {
		showErrorToast(
			"Crop mode is active but no area is drawn.\nDrag to define an area, or switch to Full Page.",
		);
		return;
	}

	const decorations = serializeAnnotations();
	const capture = serializeCapture();

	window.__kagemusha_save(JSON.stringify({ decorations, capture }));
};

export const initBridge = (): { save: () => void } => {
	window.__kagemusha_loadAnnotations = (decorations: Decoration[]) => {
		loadAnnotations(decorations);
	};
	window.__kagemusha_loadCapture = (capture: CaptureSpec) => {
		loadCapture(capture, (mode) => setCaptureMode(mode));
	};
	return { save };
};
