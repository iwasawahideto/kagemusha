// Editor scroll position. The live DOM is deliberately overflow:hidden (see
// index.ts), so a scroll position can only be expressed over a snapshot.

import { requestSnapshotRender } from "./render.js";
import { state } from "./state.js";

const SCROLL_DEBOUNCE_MS = 500;

const OWN_UI = "#kagemusha-toolbar, .kagemusha-steps-panel";

// Suppresses the scroll event restoreScroll() itself causes, which would re-render forever.
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

const SCROLLABLE_OVERFLOW = ["auto", "scroll", "overlay"];

const EDITOR_LAYERS = `${OWN_UI}, #kagemusha-svg-layer, #kagemusha-snapshot, .kagemusha-prompt, .kagemusha-picker-outline`;

const isScrollable = (el: Element): boolean => {
	const { overflowY, visibility } = window.getComputedStyle(el);
	return (
		visibility !== "hidden" &&
		SCROLLABLE_OVERFLOW.includes(overflowY) &&
		el.scrollHeight > el.clientHeight
	);
};

const containsPoint = (rect: DOMRect, x: number, y: number): boolean =>
	x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

// Editor layers cover every point, but it's the page underneath that scrolls.
const hitTestScrollable = (x: number, y: number): Element | null => {
	for (const el of document.elementsFromPoint(x, y)) {
		if (el.closest(EDITOR_LAYERS)) continue;
		if (isScrollable(el)) return el;
	}
	return null;
};

// A modal left open in the live DOM puts pointer-events:none on everything under
// it, hiding its own scroller from the hit test — fall back to geometry.
const geometricScrollable = (x: number, y: number): Element | null => {
	let best: Element | null = null;
	let bestArea = Number.POSITIVE_INFINITY;
	for (const el of Array.from(document.querySelectorAll("*"))) {
		const rect = el.getBoundingClientRect();
		const area = rect.width * rect.height;
		if (area === 0 || area >= bestArea) continue;
		if (!containsPoint(rect, x, y)) continue;
		if (el.closest(EDITOR_LAYERS) || !isScrollable(el)) continue;
		best = el;
		bestArea = area;
	}
	return best;
};

// A full scan per wheel is too slow — reuse the last hit while the pointer is in its rect.
let lastGeometricHit: Element | null = null;

const scrollableUnderPointer = (x: number, y: number): Element | null => {
	const hit = hitTestScrollable(x, y);
	if (hit) return hit;
	const cached = lastGeometricHit;
	if (
		cached?.isConnected &&
		containsPoint(cached.getBoundingClientRect(), x, y) &&
		isScrollable(cached)
	) {
		return cached;
	}
	lastGeometricHit = geometricScrollable(x, y);
	return lastGeometricHit;
};

// Recording a scroll is Record's job — nothing here may touch what capture replays.
const onWheel = (e: WheelEvent): void => {
	if (state.snapshotMode || state.recording) return;
	if (e.target instanceof Element && e.target.closest(OWN_UI)) return;
	const container = scrollableUnderPointer(e.clientX, e.clientY);
	if (container) {
		// The overlay took the hit test, so the browser scrolls nothing by itself.
		if (!container.contains(e.target as Node)) {
			container.scrollTop += wheelPixels(e);
		}
		return;
	}
	state.scrollY = Math.max(0, state.scrollY + wheelPixels(e));
	requestSnapshotRender(SCROLL_DEBOUNCE_MS);
};

// The browser may clamp to a shorter document, so mirror the result back into state.
export const restoreScroll = (): void => {
	if (window.scrollY === state.scrollY) return;
	restoring = true;
	window.scrollTo(0, state.scrollY);
	// Scroll events fire before rAF callbacks, so ours has already been swallowed.
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
