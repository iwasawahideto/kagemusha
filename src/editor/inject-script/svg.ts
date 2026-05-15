// SVG overlay layer — covers the entire page and hosts annotation shapes
// + crop visualization. Sits at z-index just below the toolbar.

import { SVG_NS } from "./state.js";

let svgEl: SVGElement | null = null;
let captureGroupEl: SVGGElement | null = null;

export const initSvgLayer = (): {
	svg: SVGElement;
	captureGroup: SVGGElement;
} => {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.id = "kagemusha-svg-layer";
	svg.classList.add("drawing");
	document.documentElement.appendChild(svg);

	const updateSvgSize = () => {
		svg.setAttribute("width", String(window.innerWidth));
		svg.setAttribute("height", String(document.documentElement.scrollHeight));
	};
	updateSvgSize();
	window.addEventListener("resize", updateSvgSize);

	const defs = document.createElementNS(SVG_NS, "defs");
	defs.innerHTML =
		'<marker id="kg-arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="#FF0000"><polygon points="0 0, 10 3.5, 0 7"/></marker>';
	svg.appendChild(defs);

	// Capture-region visualization goes BEFORE annotations so it renders behind.
	const captureGroup = document.createElementNS(SVG_NS, "g") as SVGGElement;
	captureGroup.id = "kagemusha-capture-group";
	svg.appendChild(captureGroup);

	svgEl = svg;
	captureGroupEl = captureGroup;
	return { svg, captureGroup };
};

export const getSvg = (): SVGElement => {
	if (!svgEl) throw new Error("SVG layer not initialized");
	return svgEl;
};

export const getCaptureGroup = (): SVGGElement => {
	if (!captureGroupEl) throw new Error("Capture group not initialized");
	return captureGroupEl;
};
