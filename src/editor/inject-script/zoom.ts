// Editor zoom (= 縮尺). We own the value and re-render a snapshot on change;
// Chrome's native zoom can't be read because Playwright overrides viewport/DPR.

import { requestSnapshotRender } from "./render.js";
import { MAX_ZOOM, MIN_ZOOM, state, ZOOM_LEVELS } from "./state.js";

// Debounced so a burst of +/- coalesces into one Node re-render.
const ZOOM_DEBOUNCE_MS = 300;

const updateReadout = (): void => {
	const btn = document.getElementById("kg-zoom-level");
	if (!btn) return;
	btn.textContent = `${Math.round(state.zoom * 100)}%`;
	btn.classList.toggle("zoomed", state.zoom !== 1);
};

export const setZoom = (next: number): void => {
	const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
	if (clamped === state.zoom) return;
	state.zoom = clamped;
	updateReadout();
	requestSnapshotRender(ZOOM_DEBOUNCE_MS);
};

const step = (dir: 1 | -1): void => {
	const idx = ZOOM_LEVELS.indexOf(state.zoom);
	if (idx === -1) {
		setZoom(dir === 1 ? state.zoom * 1.1 : state.zoom / 1.1);
		return;
	}
	const nextIdx = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, idx + dir));
	setZoom(ZOOM_LEVELS[nextIdx]);
};

export const handleZoomKey = (e: KeyboardEvent): boolean => {
	if (!(e.metaKey || e.ctrlKey)) return false;
	if (e.key === "=" || e.key === "+") {
		e.preventDefault();
		step(1);
		return true;
	}
	if (e.key === "-") {
		e.preventDefault();
		step(-1);
		return true;
	}
	if (e.key === "0") {
		e.preventDefault();
		setZoom(1);
		return true;
	}
	return false;
};

export const initZoom = (): void => {
	document
		.getElementById("kg-zoom-in")
		?.addEventListener("click", () => step(1));
	document
		.getElementById("kg-zoom-out")
		?.addEventListener("click", () => step(-1));
	document
		.getElementById("kg-zoom-level")
		?.addEventListener("click", () => setZoom(1));
	updateReadout();
};

export const serializeZoom = (): number => state.zoom;

export const loadZoom = (zoom: number): void => {
	// Clamp into the editor's operable range so it never holds a value the UI
	// can't represent (a hand-edited out-of-range zoom snaps to the nearest).
	state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
	updateReadout();
};
