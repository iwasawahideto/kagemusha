// Node ↔ page bridge. The Node side calls these via `page.evaluate` /
// `page.exposeFunction` to load existing data and to receive the saved
// payload. The GUI port will replace this with an IPC layer but keep the
// payload shape identical.

import { loadAnnotations, serializeAnnotations } from "./annotations.js";
import { loadCapture, serializeCapture } from "./crop.js";
import { showErrorToast } from "./dom.js";
import { loadSteps, serializeSteps } from "./record.js";
import { loadScroll, restoreScroll, serializeScroll } from "./scroll.js";
import { enterSnapshotMode, setSnapshotLoading } from "./snapshot.js";
import { state } from "./state.js";
import { setCaptureMode } from "./toolbar.js";
import type { CaptureAction, CaptureSpec, Decoration } from "./types.js";
import { loadZoom, serializeZoom } from "./zoom.js";

declare global {
	interface Window {
		__kagemusha_save: (payloadJson: string) => void;
		__kagemusha_loadAnnotations: (decorations: Decoration[]) => void;
		__kagemusha_loadCapture: (capture: CaptureSpec) => void;
		__kagemusha_loadSteps: (steps: CaptureAction[]) => void;
		__kagemusha_loadZoom: (zoom: number) => void;
		__kagemusha_loadScroll: (scrollY: number) => void;
		__kagemusha_enterSnapshotMode: (dataUrl: string) => void;
		__kagemusha_snapshotLoading: (on: boolean) => void;
		__kagemusha_render: (payloadJson: string) => Promise<void>;
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
	const beforeCapture = serializeSteps();
	const zoom = serializeZoom();
	const scrollY = serializeScroll();

	window.__kagemusha_save(
		JSON.stringify({ decorations, capture, beforeCapture, zoom, scrollY }),
	);
};

export const initBridge = (): { save: () => void } => {
	window.__kagemusha_loadAnnotations = (decorations: Decoration[]) => {
		loadAnnotations(decorations);
	};
	window.__kagemusha_loadCapture = (capture: CaptureSpec) => {
		loadCapture(capture, (mode) => setCaptureMode(mode));
	};
	window.__kagemusha_loadSteps = (steps: CaptureAction[]) => {
		loadSteps(steps);
	};
	window.__kagemusha_loadZoom = (zoom: number) => {
		loadZoom(zoom);
	};
	window.__kagemusha_loadScroll = (scrollY: number) => {
		loadScroll(scrollY);
	};
	window.__kagemusha_enterSnapshotMode = (dataUrl: string) => {
		// Wired here (not inside snapshot.ts) to keep scroll ↔ snapshot acyclic.
		enterSnapshotMode(dataUrl, restoreScroll);
	};
	window.__kagemusha_snapshotLoading = (on: boolean) => {
		setSnapshotLoading(on);
	};
	return { save };
};
