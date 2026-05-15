// Centralized editor state. Putting all mutable state in one place is the
// boundary we'll cross when porting to a hosted GUI: the React/Vue version
// will replace this with a reactive store while keeping the surface area
// (state shape + getters) identical.
//
// Don't read these fields directly from DOM modules — go through getters so
// the same module works against both this plain object and a future store.

import type { Annotation, CropDragState, DragState, Tool } from "./types.js";

// --- Constants ---

export const TOOLBAR_HEIGHT_FALLBACK = 48;
export const SVG_NS = "http://www.w3.org/2000/svg";
export const HANDLE_SIZE = 10;
export const MIN_CROP = 10;

// --- Mutable state ---
// `state` is a plain object so DOM modules can mutate fields directly during
// this pass. The GUI port will swap this for a store with explicit actions,
// but the field shape stays the same.

interface EditorState {
	tool: Tool;
	toolbarHeight: number;
	annotations: Annotation[];
	selectedId: string | null;
	dragState: DragState | null;
	nextId: number;

	// Capture region (= what kagemusha actually screenshots).
	// `captureCrop` is in page CSS pixels (toolbarHeight-shifted for display).
	captureMode: "fullPage" | "crop";
	captureCrop: { x: number; y: number; w: number; h: number } | null;
	cropDragState: CropDragState | null;
}

export const state: EditorState = {
	tool: "rect",
	toolbarHeight: TOOLBAR_HEIGHT_FALLBACK,
	annotations: [],
	selectedId: null,
	dragState: null,
	nextId: 1,
	captureMode: "fullPage",
	captureCrop: null,
	cropDragState: null,
};

export const allocateAnnotationId = (): string => `a${state.nextId++}`;
