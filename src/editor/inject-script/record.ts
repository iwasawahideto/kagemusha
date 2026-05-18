// Pre-capture step recording — record clicks / inputs / selects during a
// "Record" mode, plus explicit buttons for + Wait / + WaitForSelector /
// + Hover (= things you can't infer from passive observation).
//
// Design notes:
// - Record ON wipes existing recordedSteps after a confirmation. OFF just
//   stops collecting; the panel keeps showing what was captured.
// - While recording, the SVG overlay is set to `pointer-events: none` so
//   clicks reach the host page. Annotation / crop buttons are disabled.
// - Toolbar self-clicks and the steps panel itself are excluded from
//   recording (= we don't record interactions with kagemusha's own UI).
// - The eventual hosted GUI will replace the click/input listeners with
//   message-bus events but keep the same step shape.

import { computeSelector } from "./selector.js";
import { state } from "./state.js";
import type { CaptureAction } from "./types.js";

// Excluded selectors — any event whose target is inside one of these is
// not recorded (= kagemusha's own UI).
const KAGEMUSHA_UI_SELECTORS = [
	"#kagemusha-toolbar",
	"#kagemusha-svg-layer",
	".kagemusha-hint",
	".kagemusha-steps-panel",
	".kagemusha-prompt",
];

const isOwnUi = (el: EventTarget | null): boolean => {
	if (!(el instanceof Element)) return false;
	return KAGEMUSHA_UI_SELECTORS.some((s) => el.closest(s) !== null);
};

let svgRef: SVGElement | null = null;
let panelEl: HTMLDivElement | null = null;
let pickerOutlineEl: HTMLDivElement | null = null;
let panelOpen = false;

// --- Steps panel (read-only list) ---

const ensurePanel = (): HTMLDivElement => {
	if (panelEl) return panelEl;
	const div = document.createElement("div");
	div.className = "kagemusha-steps-panel";
	div.setAttribute(
		"style",
		// Anchored just below the toolbar (top: 60px) so it's visible without
		// scrolling. Fills available vertical space minus a small bottom margin.
		"position:fixed;top:60px;right:16px;width:340px;max-height:calc(100vh - 80px);" +
			"overflow-y:auto;background:#1a1a2e;color:#fff;padding:12px 16px;" +
			"border-radius:8px;font-family:-apple-system,sans-serif;font-size:12px;" +
			"line-height:1.5;z-index:var(--kg-z-top);box-shadow:0 4px 16px rgba(0,0,0,0.4);" +
			"display:none;",
	);
	document.documentElement.appendChild(div);
	panelEl = div;
	return div;
};

const renderPanel = (): void => {
	const panel = ensurePanel();
	updateToggleButton();
	if (!panelOpen) {
		panel.style.display = "none";
		return;
	}
	panel.style.display = "block";

	const header = state.recording
		? `<div style="color:#ef4444;font-weight:600;margin-bottom:6px;">📹 Recording... (${state.recordedSteps.length} steps)</div>`
		: `<div style="color:#7a89b0;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Steps (${state.recordedSteps.length})</div>`;

	const rows = state.recordedSteps
		.map((s, i) => `<div>${i + 1}. ${renderStepLine(s)}</div>`)
		.join("");

	panel.innerHTML = `${header}${rows || '<div style="color:#888;">(no steps)</div>'}`;
};

const updateToggleButton = (): void => {
	const btn = document.getElementById("kg-steps-toggle");
	if (!btn) return;
	const n = state.recordedSteps.length;
	const recording = state.recording;
	btn.textContent = recording
		? `📹 Steps (${n})`
		: n > 0
			? `📋 Steps (${n})`
			: "📋 Steps (0)";
	btn.classList.toggle("has-steps", n > 0 && !panelOpen);
	btn.classList.toggle("open", panelOpen);
};

const openPanel = (): void => {
	panelOpen = true;
	renderPanel();
};

const closePanel = (): void => {
	panelOpen = false;
	renderPanel();
};

const togglePanel = (): void => {
	if (panelOpen) closePanel();
	else openPanel();
};

const escapeHtml = (v: string): string =>
	v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const optBadge = (s: CaptureAction & { optional?: boolean }): string =>
	s.optional
		? ' <span style="color:#7a89b0;font-size:10px;background:#2a2a4e;padding:1px 5px;border-radius:3px;margin-left:4px;">optional</span>'
		: "";

const renderStepLine = (s: CaptureAction): string => {
	switch (s.action) {
		case "click":
			return `<b>click</b> ${escapeHtml(s.selector)}${optBadge(s)}`;
		case "type":
			return `<b>type</b> ${escapeHtml(s.selector)} → "${escapeHtml(s.text)}"${optBadge(s)}`;
		case "select":
			return `<b>select</b> ${escapeHtml(s.selector)} → "${escapeHtml(s.value)}"${optBadge(s)}`;
		case "hover":
			return `<b>hover</b> ${escapeHtml(s.selector)}${optBadge(s)}`;
		case "wait":
			return `<b>wait</b> ${s.ms}ms`;
		case "waitForSelector":
			return `<b>waitForSelector</b> ${escapeHtml(s.selector)}${s.timeout ? ` (${s.timeout}ms)` : ""}${optBadge(s)}`;
		default:
			return `<b>${(s as { action: string }).action}</b>`;
	}
};

// --- Recording lifecycle ---

const updateToolbarLockState = (): void => {
	// Annotation + capture-mode + delete buttons are disabled while recording
	// so user can't draw rectangles into "the page they're recording on".
	const lock = state.recording;
	for (const id of [
		"kg-tool-rect",
		"kg-tool-arrow",
		"kg-tool-label",
		"kg-cap-full",
		"kg-cap-crop",
		"kg-delete",
	]) {
		const btn = document.getElementById(id) as HTMLButtonElement | null;
		if (btn) btn.disabled = lock;
	}
	// Step builder buttons are entirely hidden when not recording (= clearer
	// than disabled-but-greyed-out; the buttons appear/disappear with Record).
	const group = document.getElementById("kg-rec-group");
	if (group) group.classList.toggle("visible", lock);
	// Record toggle reflects current state.
	const recBtn = document.getElementById("kg-record");
	if (recBtn) {
		recBtn.textContent = state.recording ? "⏹ Stop" : "🔴 Record";
		recBtn.classList.toggle("active", state.recording);
	}
	if (svgRef) {
		// Block svg clicks while recording so the host page receives them.
		svgRef.style.pointerEvents = state.recording ? "none" : "";
	}
};

const setRecording = (on: boolean): void => {
	if (on) {
		if (state.recordedSteps.length > 0) {
			const ok = window.confirm(
				`Recording will replace the existing ${state.recordedSteps.length} step(s). Continue?`,
			);
			if (!ok) return;
		}
		state.recordedSteps = [];
		state.recording = true;
	} else {
		state.recording = false;
		cancelPicker();
	}
	updateToolbarLockState();
	renderPanel();
};

// --- Picker mode (single-shot element selection for + Hover / + WaitForSelector) ---

const pickerButtonId = (kind: "hover" | "waitForSelector"): string =>
	kind === "hover" ? "kg-rec-hover" : "kg-rec-wfs";

const startPicker = (kind: "hover" | "waitForSelector"): void => {
	if (!state.recording) return;
	state.pickerKind = kind;
	// Highlight the button that initiated picking so user can see they're in
	// picker mode (and which kind).
	document.getElementById(pickerButtonId(kind))?.classList.add("picking");
	if (svgRef) svgRef.style.cursor = "crosshair";
	showPrompt(
		kind === "hover"
			? "Hover an element, click to confirm. ESC to cancel."
			: "Hover an element, click to confirm. ESC to cancel.",
	);
};

const cancelPicker = (): void => {
	if (state.pickerKind) {
		document
			.getElementById(pickerButtonId(state.pickerKind))
			?.classList.remove("picking");
	}
	state.pickerKind = null;
	if (svgRef) svgRef.style.cursor = "";
	hidePrompt();
	hidePickerOutline();
};

const ensurePickerOutline = (): HTMLDivElement => {
	if (pickerOutlineEl) return pickerOutlineEl;
	const div = document.createElement("div");
	div.className = "kagemusha-picker-outline";
	div.style.display = "none";
	document.documentElement.appendChild(div);
	pickerOutlineEl = div;
	return div;
};

const showPickerOutline = (rect: DOMRect): void => {
	const el = ensurePickerOutline();
	el.style.display = "block";
	el.style.left = `${rect.left}px`;
	el.style.top = `${rect.top}px`;
	el.style.width = `${rect.width}px`;
	el.style.height = `${rect.height}px`;
};

const hidePickerOutline = (): void => {
	if (pickerOutlineEl) pickerOutlineEl.style.display = "none";
};

let promptEl: HTMLDivElement | null = null;
const showPrompt = (message: string): void => {
	if (!promptEl) {
		const div = document.createElement("div");
		div.className = "kagemusha-prompt";
		div.setAttribute(
			"style",
			"position:fixed;top:60px;left:50%;transform:translateX(-50%);" +
				"background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:8px;" +
				"font-family:-apple-system,sans-serif;font-size:13px;" +
				"z-index:var(--kg-z-top);box-shadow:0 4px 12px rgba(0,0,0,0.3);",
		);
		document.documentElement.appendChild(div);
		promptEl = div;
	}
	promptEl.textContent = message;
	promptEl.style.display = "block";
};
const hidePrompt = (): void => {
	if (promptEl) promptEl.style.display = "none";
};

// --- Event listeners ---

const onClickCapture = (e: MouseEvent): void => {
	if (!state.recording) return;
	if (isOwnUi(e.target)) return;
	const el = e.target as Element | null;
	if (!el) return;

	// Picker mode: one-shot element selection
	if (state.pickerKind) {
		e.preventDefault();
		e.stopPropagation();
		const kind = state.pickerKind;
		const sel = computeSelector(el);
		if (kind === "hover") {
			state.recordedSteps.push({ action: "hover", selector: sel.selector });
		} else {
			state.recordedSteps.push({
				action: "waitForSelector",
				selector: sel.selector,
			});
		}
		cancelPicker();
		renderPanel();
		return;
	}

	// Normal record: append a click step. The page still receives the click
	// because we don't preventDefault — we only observe.
	//
	// `optional: true` so capture doesn't fail when the recorded element is
	// absent on a re-run (= session-dependent modals, AB-test variants, etc).
	// User can flip to false in definitions.json if the step must succeed.
	const sel = computeSelector(el);
	state.recordedSteps.push({
		action: "click",
		selector: sel.selector,
		optional: true,
	});
	renderPanel();
};

const onChangeCapture = (e: Event): void => {
	if (!state.recording) return;
	if (isOwnUi(e.target)) return;
	const target = e.target as HTMLElement | null;
	if (!target) return;

	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
		const input = target as HTMLInputElement | HTMLTextAreaElement;
		// Skip checkbox/radio — those are click semantics, not "type a value".
		const type = (input as HTMLInputElement).type;
		if (type === "checkbox" || type === "radio") return;
		const sel = computeSelector(input);
		// optional:true — same reasoning as click. See onClickCapture.
		state.recordedSteps.push({
			action: "type",
			selector: sel.selector,
			text: input.value,
			optional: true,
		});
		renderPanel();
		return;
	}
	if (target.tagName === "SELECT") {
		const select = target as HTMLSelectElement;
		const sel = computeSelector(select);
		state.recordedSteps.push({
			action: "select",
			selector: sel.selector,
			value: select.value,
			optional: true,
		});
		renderPanel();
	}
};

const onKeyDownCapture = (e: KeyboardEvent): void => {
	if (state.pickerKind && e.key === "Escape") {
		cancelPicker();
	}
};

const onMouseMoveCapture = (e: MouseEvent): void => {
	if (!state.pickerKind) return;
	if (isOwnUi(e.target)) {
		hidePickerOutline();
		return;
	}
	const el = e.target as Element | null;
	if (!el) return;
	showPickerOutline(el.getBoundingClientRect());
};

// Close the steps popover when clicking outside it (or the toggle button).
// We listen in the bubble phase so the toggle's own stopPropagation can
// preempt this, and we bail if the click landed inside the panel.
const onOutsideClick = (e: MouseEvent): void => {
	if (!panelOpen) return;
	const target = e.target as Element | null;
	if (!target) return;
	if (target.closest(".kagemusha-steps-panel")) return;
	if (target.closest("#kg-steps-toggle")) return;
	closePanel();
};

// --- Step builder buttons ---

const promptForWaitMs = (): void => {
	const raw = window.prompt("Wait for how many milliseconds?", "3000");
	if (raw === null) return;
	const ms = Number.parseInt(raw, 10);
	if (Number.isNaN(ms) || ms <= 0) return;
	state.recordedSteps.push({ action: "wait", ms });
	renderPanel();
};

// --- Init ---

export const initRecord = (svg: SVGElement): void => {
	svgRef = svg;
	ensurePanel();

	document
		.getElementById("kg-record")
		?.addEventListener("click", () => setRecording(!state.recording));
	document
		.getElementById("kg-rec-wait")
		?.addEventListener("click", () => promptForWaitMs());
	document
		.getElementById("kg-rec-wfs")
		?.addEventListener("click", () => startPicker("waitForSelector"));
	document
		.getElementById("kg-rec-hover")
		?.addEventListener("click", () => startPicker("hover"));
	document.getElementById("kg-steps-toggle")?.addEventListener("click", (e) => {
		e.stopPropagation();
		togglePanel();
	});

	// Capture-phase listeners on document — we want first dibs so we can
	// observe events on elements that stopPropagation later.
	document.addEventListener("click", onClickCapture, true);
	document.addEventListener("change", onChangeCapture, true);
	document.addEventListener("keydown", onKeyDownCapture, true);
	document.addEventListener("mousemove", onMouseMoveCapture, true);

	// Outside click closes the panel. Use bubble phase so that clicks on the
	// toggle / inside the panel can suppress this via stopPropagation /
	// closest checks before it reaches here.
	document.addEventListener("click", onOutsideClick);

	updateToolbarLockState();
	renderPanel();
};

// Called by bridge on load to seed from existing definition.beforeCapture.
export const loadSteps = (steps: CaptureAction[]): void => {
	state.recordedSteps = [...steps];
	renderPanel();
};

// Called by bridge on save.
export const serializeSteps = (): CaptureAction[] => [...state.recordedSteps];
