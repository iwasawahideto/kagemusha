// Crop mode — defines the capture region (= what kagemusha actually
// screenshots). User drags to create a rectangle, with 8 handles (corners +
// edges) for resize and a body region for move. Coordinates live in raw
// page CSS pixels — same coordinate system the host page uses, so no
// translation is needed when capture replays the saved crop.

import { getMousePos } from "./dom.js";
import { HANDLE_SIZE, MIN_CROP, SVG_NS, state } from "./state.js";
import { getCaptureGroup } from "./svg.js";
import { registerCropHooks } from "./toolbar.js";
import type { CaptureSpec, CropHandle } from "./types.js";

const HANDLE_POSITIONS: ReadonlyArray<{
	handle: CropHandle;
	pos: (c: { x: number; y: number; w: number; h: number }) => {
		cx: number;
		cy: number;
	};
}> = [
	{ handle: "nw", pos: (c) => ({ cx: c.x, cy: c.y }) },
	{ handle: "n", pos: (c) => ({ cx: c.x + c.w / 2, cy: c.y }) },
	{ handle: "ne", pos: (c) => ({ cx: c.x + c.w, cy: c.y }) },
	{ handle: "e", pos: (c) => ({ cx: c.x + c.w, cy: c.y + c.h / 2 }) },
	{ handle: "se", pos: (c) => ({ cx: c.x + c.w, cy: c.y + c.h }) },
	{ handle: "s", pos: (c) => ({ cx: c.x + c.w / 2, cy: c.y + c.h }) },
	{ handle: "sw", pos: (c) => ({ cx: c.x, cy: c.y + c.h }) },
	{ handle: "w", pos: (c) => ({ cx: c.x, cy: c.y + c.h / 2 }) },
];

const clearVisual = (): void => {
	getCaptureGroup().replaceChildren();
};

const redrawVisual = (): void => {
	if (state.captureMode !== "crop" || !state.captureCrop) {
		clearVisual();
		return;
	}
	clearVisual();
	const g = getCaptureGroup();
	const c = state.captureCrop;

	const r = document.createElementNS(SVG_NS, "rect");
	r.setAttribute("x", String(c.x));
	r.setAttribute("y", String(c.y));
	r.setAttribute("width", String(c.w));
	r.setAttribute("height", String(c.h));
	r.setAttribute("class", "capture-crop-box");
	g.appendChild(r);

	for (const { handle, pos } of HANDLE_POSITIONS) {
		const { cx, cy } = pos(c);
		const h = document.createElementNS(SVG_NS, "rect");
		h.setAttribute("x", String(cx - HANDLE_SIZE / 2));
		h.setAttribute("y", String(cy - HANDLE_SIZE / 2));
		h.setAttribute("width", String(HANDLE_SIZE));
		h.setAttribute("height", String(HANDLE_SIZE));
		h.setAttribute("class", `crop-handle ${handle}`);
		h.dataset.handle = handle;
		g.appendChild(h);
	}
};

// Re-export so the bridge / load layer can request a redraw after loading.
export const redrawCropVisual = redrawVisual;

// Hook crop visuals into toolbar's enter/exit transitions.
export const initCrop = (): void => {
	registerCropHooks(
		// onEnter: redraw existing selection (if any)
		() => redrawVisual(),
		// onExit: clear visualization
		() => clearVisual(),
	);
};

// --- Mouse handlers (called by index.ts dispatcher when tool === "crop") ---

export const handleMouseDown = (e: MouseEvent): boolean => {
	if (state.tool !== "crop") return false;
	e.preventDefault();
	const p = getMousePos(e);
	const target = e.target as Element;
	const handleAttr = (target as HTMLElement).dataset?.handle as
		| CropHandle
		| undefined;

	if (handleAttr && state.captureCrop) {
		state.cropDragState = {
			kind: "resize",
			handle: handleAttr,
			sx: p.x,
			sy: p.y,
			orig: { ...state.captureCrop },
		};
		return true;
	}

	if (target?.classList?.contains("capture-crop-box") && state.captureCrop) {
		state.cropDragState = {
			kind: "move",
			sx: p.x,
			sy: p.y,
			orig: { ...state.captureCrop },
		};
		return true;
	}

	// Otherwise: drag-to-create new crop (replaces existing)
	state.cropDragState = { kind: "create", sx: p.x, sy: p.y };
	state.captureCrop = null;
	clearVisual();
	const r = document.createElementNS(SVG_NS, "rect");
	r.setAttribute("x", String(p.x));
	r.setAttribute("y", String(p.y));
	r.setAttribute("width", "0");
	r.setAttribute("height", "0");
	r.setAttribute("class", "capture-crop-box");
	getCaptureGroup().appendChild(r);
	return true;
};

export const handleMouseMove = (e: MouseEvent): boolean => {
	const cds = state.cropDragState;
	if (!cds) return false;
	const p = getMousePos(e);

	if (cds.kind === "create") {
		const x = Math.min(cds.sx, p.x);
		const y = Math.min(cds.sy, p.y);
		const w = Math.abs(p.x - cds.sx);
		const h = Math.abs(p.y - cds.sy);
		const r = getCaptureGroup().firstChild as SVGRectElement | null;
		if (r) {
			r.setAttribute("x", String(x));
			r.setAttribute("y", String(y));
			r.setAttribute("width", String(w));
			r.setAttribute("height", String(h));
		}
		return true;
	}

	if (cds.kind === "move") {
		const dx = p.x - cds.sx;
		const dy = p.y - cds.sy;
		state.captureCrop = {
			x: cds.orig.x + dx,
			y: cds.orig.y + dy,
			w: cds.orig.w,
			h: cds.orig.h,
		};
		redrawVisual();
		return true;
	}

	// resize
	const dx = p.x - cds.sx;
	const dy = p.y - cds.sy;
	const o = cds.orig;
	let nx = o.x;
	let ny = o.y;
	let nw = o.w;
	let nh = o.h;
	const h = cds.handle;
	if (h.includes("w")) {
		nx = o.x + dx;
		nw = o.w - dx;
	}
	if (h.includes("e")) {
		nw = o.w + dx;
	}
	if (h.includes("n")) {
		ny = o.y + dy;
		nh = o.h - dy;
	}
	if (h.includes("s")) {
		nh = o.h + dy;
	}
	if (nw < MIN_CROP) {
		if (h.includes("w")) nx = o.x + (o.w - MIN_CROP);
		nw = MIN_CROP;
	}
	if (nh < MIN_CROP) {
		if (h.includes("n")) ny = o.y + (o.h - MIN_CROP);
		nh = MIN_CROP;
	}
	state.captureCrop = { x: nx, y: ny, w: nw, h: nh };
	redrawVisual();
	return true;
};

export const handleMouseUp = (e: MouseEvent): boolean => {
	const cds = state.cropDragState;
	if (!cds) return false;
	if (cds.kind === "create") {
		const p = getMousePos(e);
		const w = Math.abs(p.x - cds.sx);
		const h = Math.abs(p.y - cds.sy);
		if (w < 5 || h < 5) {
			state.cropDragState = null;
			redrawVisual();
			return true;
		}
		state.captureCrop = {
			x: Math.min(cds.sx, p.x),
			y: Math.min(cds.sy, p.y),
			w,
			h,
		};
	}
	// move / resize already applied during mousemove
	state.cropDragState = null;
	redrawVisual();
	return true;
};

// --- Load (= bridge calls this from definitions.json) ---

export const loadCapture = (
	capture: CaptureSpec,
	setMode: (m: "fullPage" | "crop") => void,
): void => {
	if (!capture || !["fullPage", "crop"].includes(capture.mode)) {
		// Unknown / legacy mode (e.g. removed "selector") — fall back to fullPage
		setMode("fullPage");
		return;
	}
	if (capture.mode === "fullPage") {
		setMode("fullPage");
		return;
	}
	if (capture.mode === "crop") {
		// crop is stored in page CSS pixels (not DPR-scaled). No toolbar
		// offset — the toolbar is an overlay, host content stays at its
		// native position.
		const sx = capture.crop.start.x;
		const sy = capture.crop.start.y;
		const ex = capture.crop.end.x;
		const ey = capture.crop.end.y;
		state.captureCrop = { x: sx, y: sy, w: ex - sx, h: ey - sy };
		state.captureMode = "crop";
		setMode("crop");
		redrawVisual();
	}
};

// Serialize current crop selection back to definitions.json shape.
// Returns null if no crop is set or mode is fullPage.
export const serializeCapture = (): CaptureSpec => {
	if (state.captureMode === "crop" && state.captureCrop) {
		const c = state.captureCrop;
		return {
			mode: "crop",
			crop: {
				start: { x: Math.round(c.x), y: Math.round(c.y) },
				end: {
					x: Math.round(c.x + c.w),
					y: Math.round(c.y + c.h),
				},
			},
		};
	}
	return { mode: "fullPage" };
};
