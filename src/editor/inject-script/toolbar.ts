// Toolbar — fixed-position bar at the top of the page with annotation tool
// buttons and capture-mode toggles. Appended to <html> so host SPA modals
// that mark <body>'s children as `inert` / `aria-hidden="true"` don't disable
// our toolbar interactions.

import { state, TOOLBAR_HEIGHT_FALLBACK } from "./state.js";
import type { Tool } from "./types.js";

const TOOLBAR_HTML = `
  <style>
    /* INT_MAX guarantees kagemusha UI sits above any host SPA dialog / modal. */
    :root {
      --kg-z-top: 2147483647;
      --kg-z-below-top: 2147483646;
    }
    #kagemusha-toolbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: var(--kg-z-top);
      background: #16213e; padding: 8px 16px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); font-family: -apple-system, sans-serif;
      flex-wrap: nowrap; overflow-x: auto;
    }
    #kagemusha-toolbar button {
      padding: 6px 12px; border: 1px solid #444; border-radius: 6px;
      background: #1a1a2e; color: #fff; font-size: 13px; cursor: pointer;
    }
    #kagemusha-toolbar button:hover { background: #2a2a4e; }
    #kagemusha-toolbar button.active { background: #6366f1; border-color: #6366f1; }
    #kagemusha-toolbar button.cap-btn.active { background: #0ea5e9; border-color: #0ea5e9; }
    #kagemusha-toolbar .sep { width: 1px; height: 24px; background: #444; }
    #kagemusha-toolbar .title { color: #888; font-size: 13px; }
    #kagemusha-toolbar .group-label { color: #7a89b0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: -4px; }
    #kagemusha-toolbar .save-btn { background: #22c55e; border-color: #22c55e; font-weight: 600; margin-left: auto; }
    #kagemusha-toolbar .save-btn:hover { background: #16a34a; }
    #kagemusha-svg-layer {
      position: absolute; top: 0; left: 0; width: 100%;
      z-index: var(--kg-z-below-top); pointer-events: none;
    }
    #kagemusha-svg-layer.drawing { pointer-events: auto; cursor: crosshair; }
    #kagemusha-svg-layer.cropping { pointer-events: auto; cursor: crosshair; }
    #kagemusha-svg-layer .annotation { pointer-events: auto; cursor: move; }
    #kagemusha-svg-layer.cropping .annotation { pointer-events: none; }
    #kagemusha-svg-layer .annotation.selected { filter: drop-shadow(0 0 3px #6366f1); }
    #kagemusha-svg-layer .capture-crop-box { fill: rgba(14,165,233,0.10); stroke: #0ea5e9; stroke-width: 2; stroke-dasharray: 8 4; pointer-events: none; }
    #kagemusha-svg-layer.cropping .capture-crop-box { pointer-events: auto; cursor: move; }
    #kagemusha-svg-layer .crop-handle { fill: #fff; stroke: #0ea5e9; stroke-width: 2; pointer-events: none; }
    #kagemusha-svg-layer.cropping .crop-handle { pointer-events: auto; }
    #kagemusha-svg-layer .crop-handle.nw, #kagemusha-svg-layer .crop-handle.se { cursor: nwse-resize; }
    #kagemusha-svg-layer .crop-handle.ne, #kagemusha-svg-layer .crop-handle.sw { cursor: nesw-resize; }
    #kagemusha-svg-layer .crop-handle.n, #kagemusha-svg-layer .crop-handle.s { cursor: ns-resize; }
    #kagemusha-svg-layer .crop-handle.e, #kagemusha-svg-layer .crop-handle.w { cursor: ew-resize; }
    .kagemusha-hint {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      color: #fff; background: rgba(0,0,0,0.7); padding: 6px 16px; border-radius: 8px;
      font-size: 12px; z-index: var(--kg-z-top); font-family: -apple-system, sans-serif;
    }
  </style>
  <span class="title">🥷</span>
  <span class="group-label">Capture</span>
  <button id="kg-cap-full" class="cap-btn active">📷 Full</button>
  <button id="kg-cap-crop" class="cap-btn">✂️ Crop</button>
  <div class="sep"></div>
  <span class="group-label">Annotate</span>
  <button id="kg-tool-rect" class="active">▭ Rect</button>
  <button id="kg-tool-arrow">→ Arrow</button>
  <button id="kg-tool-label">T Label</button>
  <div class="sep"></div>
  <button id="kg-delete">🗑 Delete</button>
  <button class="save-btn" id="kg-save">💾 Save</button>
`;

let svgRef: SVGElement | null = null;

// Crop module registers visual hooks via `registerCropHooks` after init.
// Setter-based wiring avoids a circular import (toolbar → crop → toolbar).
let cropOnEnter: () => void = () => {};
let cropOnExit: () => void = () => {};

interface ToolbarCallbacks {
	onToolChange: (next: Tool) => void;
	onSave: () => void;
	onDelete: () => void;
}

let callbacks: ToolbarCallbacks | null = null;

export const initToolbar = (cb: ToolbarCallbacks, svg: SVGElement): void => {
	callbacks = cb;
	svgRef = svg;

	const toolbar = document.createElement("div");
	toolbar.id = "kagemusha-toolbar";
	toolbar.innerHTML = TOOLBAR_HTML;
	// Append to <html> (not <body>) so SPA modals that mark <body>'s children
	// as `inert` / `aria-hidden="true"` don't disable our toolbar interactions.
	document.documentElement.appendChild(toolbar);

	state.toolbarHeight =
		Math.ceil(toolbar.getBoundingClientRect().height) ||
		TOOLBAR_HEIGHT_FALLBACK;
	document.body.style.paddingTop = `${state.toolbarHeight}px`;

	const hint = document.createElement("div");
	hint.className = "kagemusha-hint";
	hint.textContent =
		"Click and drag to add annotations. Click to select. Press Delete to remove.";
	document.documentElement.appendChild(hint);

	document
		.getElementById("kg-tool-rect")
		?.addEventListener("click", () => setTool("rect"));
	document
		.getElementById("kg-tool-arrow")
		?.addEventListener("click", () => setTool("arrow"));
	document
		.getElementById("kg-tool-label")
		?.addEventListener("click", () => setTool("label"));
	document
		.getElementById("kg-cap-full")
		?.addEventListener("click", () => setCaptureMode("fullPage"));
	document
		.getElementById("kg-cap-crop")
		?.addEventListener("click", () =>
			setCaptureMode("crop", { resetSelection: !state.captureCrop }),
		);
	document
		.getElementById("kg-delete")
		?.addEventListener("click", () => cb.onDelete());
	document
		.getElementById("kg-save")
		?.addEventListener("click", () => cb.onSave());
};

const updateCaptureUi = (): void => {
	document
		.querySelectorAll<HTMLElement>("#kagemusha-toolbar .cap-btn")
		.forEach((b) => {
			b.classList.remove("active");
		});
	const activeId =
		state.captureMode === "fullPage" ? "kg-cap-full" : "kg-cap-crop";
	document.getElementById(activeId)?.classList.add("active");
	if (svgRef) {
		svgRef.classList.toggle("cropping", state.tool === "crop");
		svgRef.classList.toggle(
			"drawing",
			state.tool === "rect" || state.tool === "arrow" || state.tool === "label",
		);
	}
};

export const setTool = (t: Tool): void => {
	state.tool = t;
	document
		.querySelectorAll<HTMLElement>(
			"#kg-tool-rect, #kg-tool-arrow, #kg-tool-label",
		)
		.forEach((b) => {
			b.classList.remove("active");
		});
	if (t === "rect" || t === "arrow" || t === "label") {
		document.getElementById(`kg-tool-${t}`)?.classList.add("active");
	}
	updateCaptureUi();
	callbacks?.onToolChange(t);
};

export const setCaptureMode = (
	mode: "fullPage" | "crop",
	opts: { resetSelection?: boolean } = {},
): void => {
	state.captureMode = mode;
	if (mode === "fullPage") {
		state.captureCrop = null;
		cropOnExit();
		setTool("rect");
	} else {
		if (opts.resetSelection) state.captureCrop = null;
		cropOnEnter();
		// Switch tool indicator but leave the visual state of crop selection alone
		state.tool = "crop";
		updateCaptureUi();
	}
	callbacks?.onToolChange(state.tool);
};

// Allow crop module to register its visual-clear / redraw hooks.
export const registerCropHooks = (
	onEnter: () => void,
	onExit: () => void,
): void => {
	cropOnEnter = onEnter;
	cropOnExit = onExit;
};
