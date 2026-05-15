// Shared types for the inject editor. Kept in one file because the page-scoped
// editor is small enough to avoid one-type-per-file overhead — and the GUI
// rewrite will likely consume these as a single import.

// CaptureAction is shared with the Node-side runtime — same shape on both
// sides so what the editor records is exactly what `screenshot.ts` replays.
export type {
	CaptureAction,
	ScreenshotDefinition,
} from "../../types.js";

export interface Decoration {
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

export type CaptureSpec =
	| { mode: "fullPage" }
	| {
			mode: "crop";
			crop: { start: { x: number; y: number }; end: { x: number; y: number } };
	  };

export interface Annotation {
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

export interface DragState {
	type: "create-rect" | "create-arrow" | "move";
	id: string;
	el: SVGElement;
	sx?: number;
	sy?: number;
	lastX?: number;
	lastY?: number;
}

export type CropHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export type CropDragState =
	| { kind: "create"; sx: number; sy: number }
	| {
			kind: "move";
			sx: number;
			sy: number;
			orig: { x: number; y: number; w: number; h: number };
	  }
	| {
			kind: "resize";
			handle: CropHandle;
			sx: number;
			sy: number;
			orig: { x: number; y: number; w: number; h: number };
	  };

// Tool determines which mouse interactions are active.
// `crop` is the capture-region tool, `rect|arrow|label` are annotation tools.
export type Tool = "rect" | "arrow" | "label" | "crop";

// Bridge surface — Node side calls these via `page.evaluate` / `exposeFunction`.
// Listed here so future GUI ports keep the same contract.
import type { CaptureAction } from "../../types.js";

export interface EditorBridge {
	__kagemusha_save: (payloadJson: string) => void;
	__kagemusha_loadAnnotations: (decorations: Decoration[]) => void;
	__kagemusha_loadCapture: (capture: CaptureSpec) => void;
	__kagemusha_loadSteps: (steps: CaptureAction[]) => void;
}
