export interface KagemushaConfig {
	app: {
		baseUrl: string;
	};
	screenshot: {
		defaultViewport: Viewport;
		defaultDiffThreshold: number;
	};
	auth?: {
		// Path (project-relative) to a JS module exporting `login(page)`. When
		// present, `kagemusha login` runs headless using this script — useful for
		// CI. When absent, login falls back to the interactive browser flow.
		scriptPath?: string;
	};
	publish?: {
		destination: "local" | "s3" | "intercom";
		outputDir?: string;
		cdnBucket?: string;
		cdnBaseUrl?: string;
	};
	routing?: Route[];
	notification?: {
		slack?: {
			webhookUrl: string;
		};
	};
}

export interface Route {
	pattern: string;
	screenshots: string[];
}

export interface Viewport {
	width: number;
	height: number;
	deviceScaleFactor?: number;
}

export interface ScreenshotDefinition {
	id: string;
	name: string;
	url: string;
	urlParams?: Record<string, string>;
	viewport?: Viewport;
	beforeCapture?: CaptureAction[];
	capture: CaptureSpec;
	decorations?: Decoration[];
	hideElements?: string[];
	intercom?: {
		articleId: string;
		imageSelector?: string;
	};
}

// `optional: true` makes a selector-based action silently skip when the
// target element is absent at capture time (= e.g. a welcome modal that
// only appears in a fresh session). Without it, missing elements cause
// the capture to fail. Defaults to false so existing definitions retain
// strict behavior — record auto-injects optional:true for click/type/
// select since those are inferred from the user's current page state.
export type CaptureAction =
	| { action: "click"; selector: string; optional?: boolean }
	| { action: "type"; selector: string; text: string; optional?: boolean }
	| { action: "select"; selector: string; value: string; optional?: boolean }
	| { action: "hover"; selector: string; optional?: boolean }
	| { action: "scroll"; selector?: string; y: number }
	| { action: "wait"; ms: number }
	| {
			action: "waitForSelector";
			selector: string;
			timeout?: number;
			optional?: boolean;
	  }
	| { action: "waitForNavigation"; timeout?: number }
	| { action: "evaluate"; script: string };

export type CaptureSpec =
	| { mode: "fullPage" }
	| {
			mode: "crop";
			crop: { start: { x: number; y: number }; end: { x: number; y: number } };
	  };

export type Decoration = RectDecoration | ArrowDecoration | LabelDecoration;

export interface RectDecoration {
	type: "rect";
	target:
		| { selector: string }
		| { x: number; y: number; width: number; height: number };
	style?: {
		color?: string;
		strokeWidth?: number;
		borderRadius?: number;
	};
}

export interface ArrowDecoration {
	type: "arrow";
	from: { x: number; y: number } | { selector: string; anchor?: string };
	to: { x: number; y: number } | { selector: string; anchor?: string };
	style?: {
		color?: string;
		strokeWidth?: number;
	};
}

export interface LabelDecoration {
	type: "label";
	text: string;
	position: { x: number; y: number } | { selector: string; anchor?: string };
	style?: {
		fontSize?: number;
		color?: string;
		background?: string;
	};
}
