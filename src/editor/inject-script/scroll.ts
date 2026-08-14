// Editor scroll position (= how far down the page the capture starts). The live
// DOM is deliberately overflow:hidden (see index.ts), so a scroll position can
// only be expressed over a snapshot — a wheel on the live page promotes the
// session to snapshot mode and carries the gesture over.

import { requestSnapshotRender } from "./render.js";
import { state } from "./state.js";

// Scrolling is a continuous gesture; wait for it to settle before paying for a
// Node round-trip render.
const SCROLL_DEBOUNCE_MS = 500;

const OWN_UI = "#kagemusha-toolbar, .kagemusha-steps-panel";

// Suppresses the scroll event our own restoreScroll() causes, so a re-render
// can't feed itself an endless loop of identical renders.
let restoring = false;

const wheelPixels = (e: WheelEvent): number => {
	if (e.deltaMode === 1) return e.deltaY * 16; // lines
	if (e.deltaMode === 2) return e.deltaY * window.innerHeight; // pages
	return e.deltaY;
};

const onScroll = (): void => {
	if (restoring || !state.snapshotMode) return;
	state.scrollY = window.scrollY;
	requestSnapshotRender(SCROLL_DEBOUNCE_MS);
};

const onWheel = (e: WheelEvent): void => {
	if (state.snapshotMode || state.recording) return;
	if (e.target instanceof Element && e.target.closest(OWN_UI)) return;
	state.scrollY = Math.max(0, state.scrollY + wheelPixels(e));
	requestSnapshotRender(SCROLL_DEBOUNCE_MS);
};

// Called once a fresh snapshot image has been sized, so swapping the image
// doesn't throw the user back to the top. A shorter re-render (lazy-load can
// change the full-page height) clamps the scroll — mirror that back into state
// so what we save is what the page can actually do.
export const restoreScroll = (): void => {
	if (window.scrollY === state.scrollY) return;
	restoring = true;
	window.scrollTo(0, state.scrollY);
	// Scroll events are dispatched before animation frame callbacks, so by here
	// our own event has already been swallowed.
	window.requestAnimationFrame(() => {
		state.scrollY = window.scrollY;
		restoring = false;
	});
};

export const initScroll = (): void => {
	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("wheel", onWheel, { passive: true });
};

export const serializeScroll = (): number => state.scrollY;

export const loadScroll = (scrollY: number): void => {
	state.scrollY = Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
};
