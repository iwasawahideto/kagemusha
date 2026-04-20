// This script is injected into the target page to provide annotation editing.
// It adds a toolbar and SVG overlay layer on top of the actual page.
// This is a plain script (not a module) — no imports/exports.

// Type helpers for window properties set by edit.ts
const _win = window as unknown as {
	__kagemusha_dpr: number;
	__kagemusha_save: (decorationsJson: string) => void;
	__kagemusha_loadAnnotations: (decorations: Decoration[]) => void;
};

interface Decoration {
	type: "rect" | "arrow" | "label";
	target?: { x: number; y: number; width: number; height: number };
	from?: { x: number; y: number };
	to?: { x: number; y: number };
	position?: { x: number; y: number };
	text?: string;
	style?: {
		color?: string;
		strokeWidth?: number;
		fontSize?: number;
		background?: string;
	};
}

interface Annotation {
	id: string;
	type: "rect" | "arrow" | "label";
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	fromX?: number;
	fromY?: number;
	toX?: number;
	toY?: number;
	text?: string;
}

interface DragState {
	type: "create-rect" | "create-arrow" | "move";
	id: string;
	el: SVGElement;
	sx?: number;
	sy?: number;
	lastX?: number;
	lastY?: number;
}

const TOOLBAR_HEIGHT = 48;
const svgNS = "http://www.w3.org/2000/svg";

let tool = "rect";
let annotations: Annotation[] = [];
let selectedId: string | null = null;
let dragState: DragState | null = null;
let nextId = 1;

// --- TOOLBAR ---
const toolbar = document.createElement("div");
toolbar.id = "kagemusha-toolbar";
toolbar.innerHTML = `
  <style>
    #kagemusha-toolbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
      background: #16213e; padding: 8px 16px; display: flex; align-items: center; gap: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); font-family: -apple-system, sans-serif;
    }
    #kagemusha-toolbar button {
      padding: 6px 14px; border: 1px solid #444; border-radius: 6px;
      background: #1a1a2e; color: #fff; font-size: 13px; cursor: pointer;
    }
    #kagemusha-toolbar button:hover { background: #2a2a4e; }
    #kagemusha-toolbar button.active { background: #6366f1; border-color: #6366f1; }
    #kagemusha-toolbar .sep { width: 1px; height: 24px; background: #444; }
    #kagemusha-toolbar .title { color: #888; font-size: 13px; }
    #kagemusha-toolbar .save-btn { background: #22c55e; border-color: #22c55e; font-weight: 600; margin-left: auto; }
    #kagemusha-toolbar .save-btn:hover { background: #16a34a; }
    #kagemusha-svg-layer {
      position: absolute; top: 0; left: 0; width: 100%;
      z-index: 999998; pointer-events: none;
    }
    #kagemusha-svg-layer.drawing { pointer-events: auto; cursor: crosshair; }
    #kagemusha-svg-layer .annotation { pointer-events: auto; cursor: move; }
    #kagemusha-svg-layer .annotation.selected { filter: drop-shadow(0 0 3px #6366f1); }
    .kagemusha-hint {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      color: #fff; background: rgba(0,0,0,0.7); padding: 6px 16px; border-radius: 8px;
      font-size: 12px; z-index: 999999; font-family: -apple-system, sans-serif;
    }
  </style>
  <span class="title">🥷 Annotation Editor</span>
  <button id="kg-tool-rect" class="active">▭ Rectangle</button>
  <button id="kg-tool-arrow">→ Arrow</button>
  <button id="kg-tool-label">T Label</button>
  <div class="sep"></div>
  <button id="kg-delete">🗑 Delete</button>
  <button class="save-btn" id="kg-save">💾 Save</button>
`;
document.body.appendChild(toolbar);
document.body.style.paddingTop = `${TOOLBAR_HEIGHT}px`;

const hint = document.createElement("div");
hint.className = "kagemusha-hint";
hint.textContent =
	"Click and drag to add annotations. Click to select. Press Delete to remove.";
document.body.appendChild(hint);

// --- SVG LAYER ---
const svg = document.createElementNS(svgNS, "svg");
svg.id = "kagemusha-svg-layer";
svg.classList.add("drawing");
document.body.appendChild(svg);

const updateSvgSize = () => {
	svg.setAttribute("width", String(window.innerWidth));
	svg.setAttribute("height", String(document.documentElement.scrollHeight));
};
updateSvgSize();
window.addEventListener("resize", updateSvgSize);

const defs = document.createElementNS(svgNS, "defs");
defs.innerHTML =
	'<marker id="kg-arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="#FF0000"><polygon points="0 0, 10 3.5, 0 7"/></marker>';
svg.appendChild(defs);

// --- HELPERS ---
const getPos = (e: MouseEvent) => ({ x: e.pageX, y: e.pageY });

const deselectAll = () => {
	selectedId = null;
	svg.querySelectorAll(".annotation").forEach((el) => {
		el.classList.remove("selected");
	});
};

const selectEl = (el: Element) => {
	deselectAll();
	selectedId = (el as HTMLElement).dataset.id ?? null;
	el.classList.add("selected");
};

const deleteSelected = () => {
	if (!selectedId) return;
	const el = svg.querySelector(`[data-id="${selectedId}"]`);
	if (el) el.remove();
	annotations = annotations.filter((a) => a.id !== selectedId);
	selectedId = null;
};

const startMove = (e: MouseEvent, id: string) => {
	e.stopPropagation();
	const el = svg.querySelector(`[data-id="${id}"]`);
	if (!el) return;
	selectEl(el);
	const p = getPos(e);
	dragState = {
		type: "move",
		id,
		el: el as SVGElement,
		lastX: p.x,
		lastY: p.y,
	};
};

const measureTextWidth = (text: string, fontSize: number): number => {
	const tmp = document.createElementNS(svgNS, "text");
	tmp.setAttribute("font-size", String(fontSize));
	tmp.setAttribute("font-family", "-apple-system, sans-serif");
	tmp.textContent = text;
	svg.appendChild(tmp);
	const width = tmp.getBBox().width;
	tmp.remove();
	return width;
};

const createLabelGroup = (
	id: string,
	x: number,
	y: number,
	text: string,
	fontSize = 14,
): SVGGElement => {
	const g = document.createElementNS(svgNS, "g");
	g.classList.add("annotation");
	(g as unknown as HTMLElement).dataset.id = id;
	const bg = document.createElementNS(svgNS, "rect");
	const txt = document.createElementNS(svgNS, "text");
	txt.textContent = text;
	txt.setAttribute("x", String(x + 6));
	txt.setAttribute("y", String(y + 16));
	txt.setAttribute("fill", "#FF0000");
	txt.setAttribute("font-size", String(fontSize));
	txt.setAttribute("font-family", "-apple-system, sans-serif");
	const tw = measureTextWidth(text, fontSize) + 12;
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

// --- TOOLS ---
const setTool = (t: string) => {
	tool = t;
	document.querySelectorAll("#kagemusha-toolbar button").forEach((b) => {
		b.classList.remove("active");
	});
	document.getElementById(`kg-tool-${t}`)?.classList.add("active");
	svg.classList.toggle("drawing", true);
	deselectAll();
};

document
	.getElementById("kg-tool-rect")
	?.addEventListener("click", () => setTool("rect"));
document
	.getElementById("kg-tool-arrow")
	?.addEventListener("click", () => setTool("arrow"));
document
	.getElementById("kg-tool-label")
	?.addEventListener("click", () => setTool("label"));
document.getElementById("kg-delete")?.addEventListener("click", deleteSelected);
document.getElementById("kg-save")?.addEventListener("click", save);

document.addEventListener("keydown", (e: KeyboardEvent) => {
	if (e.key === "Delete" || e.key === "Backspace") {
		if ((document.activeElement as HTMLElement)?.tagName === "INPUT") return;
		deleteSelected();
	}
});

// --- MOUSE: CREATE ---
svg.addEventListener("mousedown", (e: MouseEvent) => {
	if ((e.target as Element)?.closest(".annotation")) return;
	const p = getPos(e);
	deselectAll();

	if (tool === "rect") {
		const id = `a${nextId++}`;
		const rect = document.createElementNS(svgNS, "rect");
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
		dragState = { type: "create-rect", id, el: rect, sx: p.x, sy: p.y };
	} else if (tool === "arrow") {
		const id = `a${nextId++}`;
		const line = document.createElementNS(svgNS, "line");
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
		dragState = { type: "create-arrow", id, el: line, sx: p.x, sy: p.y };
	} else if (tool === "label") {
		const id = `a${nextId++}`;
		const input = document.createElement("input");
		input.type = "text";
		input.value = "";
		input.placeholder = "Type label...";
		input.style.cssText =
			"position:fixed;z-index:9999999;padding:4px 8px;background:#fff;border:none;border-radius:4px;color:#FF0000;font-size:14px;font-family:-apple-system,sans-serif;outline:2px solid #6366f1;min-width:80px;box-shadow:0 2px 8px rgba(0,0,0,0.2);";
		input.style.left = `${e.clientX}px`;
		input.style.top = `${e.clientY}px`;
		document.body.appendChild(input);
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
			annotations.push({ id, type: "label", x: p.x, y: p.y, text });
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
	}
});

// --- MOUSE: DRAG ---
document.addEventListener("mousemove", (e: MouseEvent) => {
	if (!dragState) return;
	const p = getPos(e);

	if (dragState.type === "create-rect") {
		dragState.el.setAttribute("x", String(Math.min(dragState.sx ?? 0, p.x)));
		dragState.el.setAttribute("y", String(Math.min(dragState.sy ?? 0, p.y)));
		dragState.el.setAttribute(
			"width",
			String(Math.abs(p.x - (dragState.sx ?? 0))),
		);
		dragState.el.setAttribute(
			"height",
			String(Math.abs(p.y - (dragState.sy ?? 0))),
		);
	} else if (dragState.type === "create-arrow") {
		dragState.el.setAttribute("x2", String(p.x));
		dragState.el.setAttribute("y2", String(p.y));
	} else if (dragState.type === "move") {
		const a = annotations.find((ann) => ann.id === dragState?.id);
		if (!a) return;
		const dx = p.x - (dragState.lastX ?? 0);
		const dy = p.y - (dragState.lastY ?? 0);
		dragState.lastX = p.x;
		dragState.lastY = p.y;

		if (a.type === "rect") {
			a.x = (a.x ?? 0) + dx;
			a.y = (a.y ?? 0) + dy;
			dragState.el.setAttribute("x", String(a.x));
			dragState.el.setAttribute("y", String(a.y));
		} else if (a.type === "arrow") {
			a.fromX = (a.fromX ?? 0) + dx;
			a.fromY = (a.fromY ?? 0) + dy;
			a.toX = (a.toX ?? 0) + dx;
			a.toY = (a.toY ?? 0) + dy;
			dragState.el.setAttribute("x1", String(a.fromX));
			dragState.el.setAttribute("y1", String(a.fromY));
			dragState.el.setAttribute("x2", String(a.toX));
			dragState.el.setAttribute("y2", String(a.toY));
		} else if (a.type === "label") {
			a.x = (a.x ?? 0) + dx;
			a.y = (a.y ?? 0) + dy;
			const bg = dragState.el.querySelector("rect");
			const txt = dragState.el.querySelector("text");
			bg?.setAttribute("x", String(a.x));
			bg?.setAttribute("y", String(a.y));
			txt?.setAttribute("x", String(a.x + 6));
			txt?.setAttribute("y", String(a.y + 16));
		}
	}
});

// --- MOUSE: UP ---
document.addEventListener("mouseup", (e: MouseEvent) => {
	if (!dragState) return;
	const p = getPos(e);

	if (dragState.type === "create-rect") {
		const w = Math.abs(p.x - (dragState.sx ?? 0));
		const h = Math.abs(p.y - (dragState.sy ?? 0));
		if (w < 5 && h < 5) {
			dragState.el.remove();
		} else {
			const a: Annotation = {
				id: dragState.id,
				type: "rect",
				x: Math.min(dragState.sx ?? 0, p.x),
				y: Math.min(dragState.sy ?? 0, p.y),
				width: w,
				height: h,
			};
			annotations.push(a);
			selectEl(dragState.el);
			const capturedId = dragState.id;
			dragState.el.addEventListener("mousedown", (ev: MouseEvent) =>
				startMove(ev, capturedId),
			);
		}
	} else if (dragState.type === "create-arrow") {
		const dist = Math.hypot(
			p.x - (dragState.sx ?? 0),
			p.y - (dragState.sy ?? 0),
		);
		if (dist < 5) {
			dragState.el.remove();
		} else {
			const a: Annotation = {
				id: dragState.id,
				type: "arrow",
				fromX: dragState.sx,
				fromY: dragState.sy,
				toX: p.x,
				toY: p.y,
			};
			annotations.push(a);
			selectEl(dragState.el);
			const capturedId = dragState.id;
			dragState.el.addEventListener("mousedown", (ev: MouseEvent) =>
				startMove(ev, capturedId),
			);
		}
	}
	dragState = null;
});

// --- LOAD EXISTING ---
_win.__kagemusha_loadAnnotations = (decorations: Decoration[]) => {
	const dpr = _win.__kagemusha_dpr || 1;
	for (const d of decorations) {
		const id = `a${nextId++}`;
		if (d.type === "rect" && d.target) {
			const rx = d.target.x / dpr;
			const ry = d.target.y / dpr + TOOLBAR_HEIGHT;
			const rw = d.target.width / dpr;
			const rh = d.target.height / dpr;
			const rect = document.createElementNS(svgNS, "rect");
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
			annotations.push({
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
			const ay1 = d.from.y / dpr + TOOLBAR_HEIGHT;
			const ax2 = d.to.x / dpr;
			const ay2 = d.to.y / dpr + TOOLBAR_HEIGHT;
			const line = document.createElementNS(svgNS, "line");
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
			annotations.push({
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
			const ly = d.position.y / dpr + TOOLBAR_HEIGHT;
			const fontSize = (d.style?.fontSize ?? 14) / dpr;
			const g = createLabelGroup(id, lx, ly, d.text ?? "", fontSize);
			svg.appendChild(g);
			annotations.push({ id, type: "label", x: lx, y: ly, text: d.text });
			g.addEventListener("mousedown", (ev: MouseEvent) => startMove(ev, id));
		}
	}
};

// --- SAVE ---
function save() {
	const dpr = _win.__kagemusha_dpr || 1;
	const s = Math.round;
	const decorations: Decoration[] = annotations
		.map((a): Decoration | null => {
			if (a.type === "rect") {
				return {
					type: "rect",
					target: {
						x: s((a.x ?? 0) * dpr),
						y: s(((a.y ?? 0) - TOOLBAR_HEIGHT) * dpr),
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
						y: s(((a.fromY ?? 0) - TOOLBAR_HEIGHT) * dpr),
					},
					to: {
						x: s((a.toX ?? 0) * dpr),
						y: s(((a.toY ?? 0) - TOOLBAR_HEIGHT) * dpr),
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
						y: s(((a.y ?? 0) - TOOLBAR_HEIGHT) * dpr),
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

	_win.__kagemusha_save(JSON.stringify(decorations));
}
