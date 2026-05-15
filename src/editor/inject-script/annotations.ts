// Annotation tools: rect, arrow, label. Each is created via mousedown drag
// on the SVG layer and can be moved by clicking + dragging an existing shape.
//
// State and the SVG element handle live in respective module imports — this
// file owns all of the annotation-specific DOM mutation logic, the index.ts
// dispatcher just routes raw mouse events to handlers exported here.

import { getMousePos, measureSvgTextWidth } from "./dom.js";
import { allocateAnnotationId, SVG_NS, state } from "./state.js";
import { getSvg } from "./svg.js";
import type { Annotation, Decoration } from "./types.js";

const isLabelInput = (el: Element | null): boolean =>
	(el as HTMLElement | null)?.tagName === "INPUT";

export const deselectAll = (): void => {
	state.selectedId = null;
	getSvg()
		.querySelectorAll(".annotation")
		.forEach((el) => {
			el.classList.remove("selected");
		});
};

export const selectEl = (el: Element): void => {
	deselectAll();
	state.selectedId = (el as HTMLElement).dataset.id ?? null;
	el.classList.add("selected");
};

export const deleteSelected = (): void => {
	if (!state.selectedId) return;
	const el = getSvg().querySelector(`[data-id="${state.selectedId}"]`);
	if (el) el.remove();
	state.annotations = state.annotations.filter(
		(a) => a.id !== state.selectedId,
	);
	state.selectedId = null;
};

const startMove = (e: MouseEvent, id: string): void => {
	e.stopPropagation();
	const el = getSvg().querySelector(`[data-id="${id}"]`);
	if (!el) return;
	selectEl(el);
	const p = getMousePos(e);
	state.dragState = {
		type: "move",
		id,
		el: el as SVGElement,
		lastX: p.x,
		lastY: p.y,
	};
};

const createLabelGroup = (
	id: string,
	x: number,
	y: number,
	text: string,
	fontSize = 14,
): SVGGElement => {
	const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
	g.classList.add("annotation");
	(g as unknown as HTMLElement).dataset.id = id;
	const bg = document.createElementNS(SVG_NS, "rect");
	const txt = document.createElementNS(SVG_NS, "text");
	txt.textContent = text;
	txt.setAttribute("x", String(x + 6));
	txt.setAttribute("y", String(y + 16));
	txt.setAttribute("fill", "#FF0000");
	txt.setAttribute("font-size", String(fontSize));
	txt.setAttribute("font-family", "-apple-system, sans-serif");
	const tw = measureSvgTextWidth(getSvg(), text, fontSize, SVG_NS) + 12;
	bg.setAttribute("x", String(x));
	bg.setAttribute("y", String(y));
	bg.setAttribute("width", String(tw));
	bg.setAttribute("height", "24");
	bg.setAttribute("fill", "#FFFFFF");
	bg.setAttribute("rx", "4");
	g.appendChild(bg);
	g.appendChild(txt);
	return g;
};

// --- Mouse handlers (called by index.ts dispatcher) ---

// Returns true if the event was handled. Returning false lets the dispatcher
// fall through to crop handling (for events not on an annotation).
export const handleMouseDown = (e: MouseEvent): boolean => {
	if ((e.target as Element)?.closest(".annotation")) return false;

	deselectAll();
	const p = getMousePos(e);
	const svg = getSvg();

	if (state.tool === "rect") {
		const id = allocateAnnotationId();
		const rect = document.createElementNS(SVG_NS, "rect");
		rect.setAttribute("x", String(p.x));
		rect.setAttribute("y", String(p.y));
		rect.setAttribute("width", "0");
		rect.setAttribute("height", "0");
		rect.setAttribute("fill", "none");
		rect.setAttribute("stroke", "#FF0000");
		rect.setAttribute("stroke-width", "3");
		rect.setAttribute("rx", "4");
		rect.classList.add("annotation");
		(rect as unknown as HTMLElement).dataset.id = id;
		svg.appendChild(rect);
		state.dragState = {
			type: "create-rect",
			id,
			el: rect,
			sx: p.x,
			sy: p.y,
		};
		return true;
	}

	if (state.tool === "arrow") {
		const id = allocateAnnotationId();
		const line = document.createElementNS(SVG_NS, "line");
		line.setAttribute("x1", String(p.x));
		line.setAttribute("y1", String(p.y));
		line.setAttribute("x2", String(p.x));
		line.setAttribute("y2", String(p.y));
		line.setAttribute("stroke", "#FF0000");
		line.setAttribute("stroke-width", "3");
		line.setAttribute("marker-end", "url(#kg-arrowhead)");
		line.classList.add("annotation");
		(line as unknown as HTMLElement).dataset.id = id;
		svg.appendChild(line);
		state.dragState = {
			type: "create-arrow",
			id,
			el: line,
			sx: p.x,
			sy: p.y,
		};
		return true;
	}

	if (state.tool === "label") {
		const id = allocateAnnotationId();
		const input = document.createElement("input");
		input.type = "text";
		input.value = "";
		input.placeholder = "Type label...";
		input.style.cssText =
			"position:fixed;z-index:var(--kg-z-top);padding:4px 8px;background:#fff;border:none;border-radius:4px;color:#FF0000;font-size:14px;font-family:-apple-system,sans-serif;outline:2px solid #6366f1;min-width:80px;box-shadow:0 2px 8px rgba(0,0,0,0.2);";
		input.style.left = `${e.clientX}px`;
		input.style.top = `${e.clientY}px`;
		// <html> 直下 (toolbar/svg と同じ) なので host SPA の inert に巻き込まれない
		document.documentElement.appendChild(input);
		svg.classList.remove("drawing");
		setTimeout(() => input.focus(), 50);

		let labelFinished = false;
		const finishLabel = () => {
			if (labelFinished) return;
			labelFinished = true;
			const text = input.value.trim();
			input.remove();
			svg.classList.add("drawing");
			if (!text) return;

			const g = createLabelGroup(id, p.x, p.y, text);
			svg.appendChild(g);
			state.annotations.push({ id, type: "label", x: p.x, y: p.y, text });
			selectEl(g);
			g.addEventListener("mousedown", (ev: MouseEvent) => startMove(ev, id));
		};

		input.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Enter") finishLabel();
			if (ev.key === "Escape") {
				labelFinished = true;
				input.remove();
				svg.classList.add("drawing");
			}
		});
		input.addEventListener("blur", finishLabel);
		return true;
	}

	return false;
};

export const handleMouseMove = (e: MouseEvent): boolean => {
	const drag = state.dragState;
	if (!drag) return false;
	const p = getMousePos(e);

	if (drag.type === "create-rect") {
		drag.el.setAttribute("x", String(Math.min(drag.sx ?? 0, p.x)));
		drag.el.setAttribute("y", String(Math.min(drag.sy ?? 0, p.y)));
		drag.el.setAttribute("width", String(Math.abs(p.x - (drag.sx ?? 0))));
		drag.el.setAttribute("height", String(Math.abs(p.y - (drag.sy ?? 0))));
	} else if (drag.type === "create-arrow") {
		drag.el.setAttribute("x2", String(p.x));
		drag.el.setAttribute("y2", String(p.y));
	} else if (drag.type === "move") {
		const a = state.annotations.find((ann) => ann.id === drag.id);
		if (!a) return true;
		const dx = p.x - (drag.lastX ?? 0);
		const dy = p.y - (drag.lastY ?? 0);
		drag.lastX = p.x;
		drag.lastY = p.y;

		if (a.type === "rect") {
			a.x = (a.x ?? 0) + dx;
			a.y = (a.y ?? 0) + dy;
			drag.el.setAttribute("x", String(a.x));
			drag.el.setAttribute("y", String(a.y));
		} else if (a.type === "arrow") {
			a.fromX = (a.fromX ?? 0) + dx;
			a.fromY = (a.fromY ?? 0) + dy;
			a.toX = (a.toX ?? 0) + dx;
			a.toY = (a.toY ?? 0) + dy;
			drag.el.setAttribute("x1", String(a.fromX));
			drag.el.setAttribute("y1", String(a.fromY));
			drag.el.setAttribute("x2", String(a.toX));
			drag.el.setAttribute("y2", String(a.toY));
		} else if (a.type === "label") {
			a.x = (a.x ?? 0) + dx;
			a.y = (a.y ?? 0) + dy;
			const bg = drag.el.querySelector("rect");
			const txt = drag.el.querySelector("text");
			bg?.setAttribute("x", String(a.x));
			bg?.setAttribute("y", String(a.y));
			txt?.setAttribute("x", String(a.x + 6));
			txt?.setAttribute("y", String(a.y + 16));
		}
	}
	return true;
};

export const handleMouseUp = (e: MouseEvent): boolean => {
	const drag = state.dragState;
	if (!drag) return false;
	const p = getMousePos(e);

	if (drag.type === "create-rect") {
		const w = Math.abs(p.x - (drag.sx ?? 0));
		const h = Math.abs(p.y - (drag.sy ?? 0));
		if (w < 5 && h < 5) {
			drag.el.remove();
		} else {
			const a: Annotation = {
				id: drag.id,
				type: "rect",
				x: Math.min(drag.sx ?? 0, p.x),
				y: Math.min(drag.sy ?? 0, p.y),
				width: w,
				height: h,
			};
			state.annotations.push(a);
			selectEl(drag.el);
			const capturedId = drag.id;
			drag.el.addEventListener("mousedown", (ev: MouseEvent) =>
				startMove(ev, capturedId),
			);
		}
	} else if (drag.type === "create-arrow") {
		const dist = Math.hypot(p.x - (drag.sx ?? 0), p.y - (drag.sy ?? 0));
		if (dist < 5) {
			drag.el.remove();
		} else {
			const a: Annotation = {
				id: drag.id,
				type: "arrow",
				fromX: drag.sx,
				fromY: drag.sy,
				toX: p.x,
				toY: p.y,
			};
			state.annotations.push(a);
			selectEl(drag.el);
			const capturedId = drag.id;
			drag.el.addEventListener("mousedown", (ev: MouseEvent) =>
				startMove(ev, capturedId),
			);
		}
	}
	state.dragState = null;
	return true;
};

export const handleKeyDown = (e: KeyboardEvent): void => {
	if (e.key === "Delete" || e.key === "Backspace") {
		if (isLabelInput(document.activeElement)) return;
		deleteSelected();
	}
};

// Load decorations from definitions.json into the SVG layer.
// Decorations are stored in DPR-scaled coordinates; convert back to CSS pixels.
export const loadAnnotations = (decorations: Decoration[]): void => {
	const dpr = window.devicePixelRatio || 1;
	const svg = getSvg();
	for (const d of decorations) {
		const id = allocateAnnotationId();
		if (d.type === "rect" && d.target) {
			const rx = d.target.x / dpr;
			const ry = d.target.y / dpr + state.toolbarHeight;
			const rw = d.target.width / dpr;
			const rh = d.target.height / dpr;
			const rect = document.createElementNS(SVG_NS, "rect");
			rect.setAttribute("x", String(rx));
			rect.setAttribute("y", String(ry));
			rect.setAttribute("width", String(rw));
			rect.setAttribute("height", String(rh));
			rect.setAttribute("fill", "none");
			rect.setAttribute("stroke", d.style?.color ?? "#FF0000");
			rect.setAttribute("stroke-width", "3");
			rect.setAttribute("rx", "4");
			rect.classList.add("annotation");
			(rect as unknown as HTMLElement).dataset.id = id;
			svg.appendChild(rect);
			state.annotations.push({
				id,
				type: "rect",
				x: rx,
				y: ry,
				width: rw,
				height: rh,
			});
			rect.addEventListener("mousedown", (ev: MouseEvent) => startMove(ev, id));
		} else if (d.type === "arrow" && d.from && d.to) {
			const ax1 = d.from.x / dpr;
			const ay1 = d.from.y / dpr + state.toolbarHeight;
			const ax2 = d.to.x / dpr;
			const ay2 = d.to.y / dpr + state.toolbarHeight;
			const line = document.createElementNS(SVG_NS, "line");
			line.setAttribute("x1", String(ax1));
			line.setAttribute("y1", String(ay1));
			line.setAttribute("x2", String(ax2));
			line.setAttribute("y2", String(ay2));
			line.setAttribute("stroke", d.style?.color ?? "#FF0000");
			line.setAttribute("stroke-width", "3");
			line.setAttribute("marker-end", "url(#kg-arrowhead)");
			line.classList.add("annotation");
			(line as unknown as HTMLElement).dataset.id = id;
			svg.appendChild(line);
			state.annotations.push({
				id,
				type: "arrow",
				fromX: ax1,
				fromY: ay1,
				toX: ax2,
				toY: ay2,
			});
			line.addEventListener("mousedown", (ev: MouseEvent) => startMove(ev, id));
		} else if (d.type === "label" && d.position) {
			const lx = d.position.x / dpr;
			const ly = d.position.y / dpr + state.toolbarHeight;
			const fontSize = (d.style?.fontSize ?? 14) / dpr;
			const g = createLabelGroup(id, lx, ly, d.text ?? "", fontSize);
			svg.appendChild(g);
			state.annotations.push({
				id,
				type: "label",
				x: lx,
				y: ly,
				text: d.text,
			});
			g.addEventListener("mousedown", (ev: MouseEvent) => startMove(ev, id));
		}
	}
};

// Serialize current annotations back to definitions.json shape.
// Inverse of loadAnnotations: CSS pixels → DPR-scaled, toolbar offset removed.
export const serializeAnnotations = (): Decoration[] => {
	const dpr = window.devicePixelRatio || 1;
	const s = Math.round;
	const tb = state.toolbarHeight;
	return state.annotations
		.map((a): Decoration | null => {
			if (a.type === "rect") {
				return {
					type: "rect",
					target: {
						x: s((a.x ?? 0) * dpr),
						y: s(((a.y ?? 0) - tb) * dpr),
						width: s((a.width ?? 0) * dpr),
						height: s((a.height ?? 0) * dpr),
					},
					style: { color: "#FF0000", strokeWidth: s(3 * dpr) },
				};
			}
			if (a.type === "arrow") {
				return {
					type: "arrow",
					from: {
						x: s((a.fromX ?? 0) * dpr),
						y: s(((a.fromY ?? 0) - tb) * dpr),
					},
					to: {
						x: s((a.toX ?? 0) * dpr),
						y: s(((a.toY ?? 0) - tb) * dpr),
					},
					style: { color: "#FF0000", strokeWidth: s(3 * dpr) },
				};
			}
			if (a.type === "label") {
				return {
					type: "label",
					text: a.text,
					position: {
						x: s((a.x ?? 0) * dpr),
						y: s(((a.y ?? 0) - tb) * dpr),
					},
					style: {
						fontSize: s(14 * dpr),
						color: "#FF0000",
						background: "#FFFFFF",
					},
				};
			}
			return null;
		})
		.filter((d): d is Decoration => d !== null);
};
