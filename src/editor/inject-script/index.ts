// Editor entry point. Bundled by esbuild into a single IIFE
// (dist/editor/inject-script.js) and injected by edit.ts via page.evaluate.
//
// Bootstrap order:
//   1. SVG layer  (= must exist before annotation/crop modules touch it)
//   2. Toolbar    (= depends on svg ref for the cropping/drawing classes)
//   3. Crop hooks (= register enter/exit callbacks on the toolbar)
//   4. Bridge     (= expose window.__kagemusha_* functions)
//   5. Mouse + keyboard dispatcher

import * as annotations from "./annotations.js";
import { initBridge } from "./bridge.js";
import * as crop from "./crop.js";
import { initSvgLayer } from "./svg.js";
import { initToolbar } from "./toolbar.js";

const { svg } = initSvgLayer();

let bridgeSave: () => void = () => {};

initToolbar(
	{
		onToolChange: () => {
			// Toolbar already updates state.tool and svg classes. Nothing extra
			// to do here right now, but the hook is here so the future record
			// module can detach listeners on tool change.
		},
		onSave: () => bridgeSave(),
		onDelete: () => annotations.deleteSelected(),
	},
	svg,
);

crop.initCrop();
({ save: bridgeSave } = initBridge());

// --- Mouse dispatcher ---
// Single mousedown handler on the SVG layer; route to crop if the current
// tool is crop, otherwise to annotations.

svg.addEventListener("mousedown", (e: MouseEvent) => {
	if (crop.handleMouseDown(e)) return;
	annotations.handleMouseDown(e);
});

document.addEventListener("mousemove", (e: MouseEvent) => {
	if (crop.handleMouseMove(e)) return;
	annotations.handleMouseMove(e);
});

document.addEventListener("mouseup", (e: MouseEvent) => {
	if (crop.handleMouseUp(e)) return;
	annotations.handleMouseUp(e);
});

document.addEventListener("keydown", (e: KeyboardEvent) =>
	annotations.handleKeyDown(e),
);
