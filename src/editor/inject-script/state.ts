// Centralized editor state. Putting all mutable state in one place is the
// boundary we'll cross when porting to a hosted GUI: the React/Vue version
// will replace this with a reactive store while keeping the surface area
// (state shape + getters) identical.
//
// Don't read these fields directly from DOM modules — go through getters so
// the same module works against both this plain object and a future store.

import type {
	Annotation,
	CaptureAction,
	CropDragState,
	DragState,
	Tool,
} from "./types.js";

// --- Constants ---

export const SVG_NS = "http://www.w3.org/2000/svg";
export const HANDLE_SIZE = 10;
export const MIN_CROP = 10;

// --- Mutable state ---
// `state` is a plain object so DOM modules can mutate fields directly during
// this pass. The GUI port will swap this for a store with explicit actions,
// but the field shape stays the same.

// Picker mode is a transient state where the next click on the page targets
// element-selection (= for + Hover / + WaitForSelector buttons) instead of
// being recorded as a normal click. ESC cancels.
export type PickerKind = "hover" | "waitForSelector";

interface EditorState {
	tool: Tool;
	annotations: Annotation[];
	selectedId: string | null;
	dragState: DragState | null;
	nextId: number;

	// Capture region (= what kagemusha actually screenshots).
	// `captureCrop` is in page CSS pixels (raw page coordinates).
	captureMode: "fullPage" | "crop";
	captureCrop: { x: number; y: number; w: number; h: number } | null;
	cropDragState: CropDragState | null;

	// Pre-capture step recording. `recordedSteps` is seeded from definition's
	// existing `beforeCapture` on load and overwritten when the user enters
	// record mode + saves. `null` for picker means "not picking right now".
	recordedSteps: CaptureAction[];
	recording: boolean;
	pickerKind: PickerKind | null;

	// Drawing over a frozen snapshot instead of the live DOM (see snapshot.ts).
	snapshotMode: boolean;
}

export const state: EditorState = {
	tool: "rect",
	annotations: [],
	selectedId: null,
	dragState: null,
	nextId: 1,
	captureMode: "fullPage",
	captureCrop: null,
	cropDragState: null,
	recordedSteps: [],
	recording: false,
	pickerKind: null,
	snapshotMode: false,
};

export const allocateAnnotationId = (): string => `a${state.nextId++}`;
