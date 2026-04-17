export interface KagemushaConfig {
	app: {
		baseUrl: string;
	};
	auth?: {
		loginUrl: string;
		steps: CaptureAction[];
	};
	screenshot: {
		defaultViewport: Viewport;
		defaultDiffThreshold: number;
	};
	publish?: {
		destination: "intercom" | "s3";
		cdnBucket: string;
		cdnBaseUrl: string;
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
	capture: CaptureConfig;
	decorations?: Decoration[];
	hideElements?: string[];
	intercom?: {
		articleId: string;
		imageSelector?: string;
	};
}

export type CaptureAction =
	| { action: "click"; selector: string }
	| { action: "type"; selector: string; text: string }
	| { action: "select"; selector: string; value: string }
	| { action: "hover"; selector: string }
	| { action: "scroll"; selector?: string; y: number }
	| { action: "wait"; ms: number }
	| { action: "waitForSelector"; selector: string; timeout?: number }
	| { action: "waitForNavigation"; timeout?: number }
	| { action: "evaluate"; script: string };

export type CaptureConfig =
	| { mode: "fullPage" }
	| { mode: "selector"; selector: string }
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

export interface CaptureResult {
	id: string;
	rawPath: string;
	annotatedPath: string;
	timestamp: string;
}

export interface CompareResult {
	id: string;
	status: "unchanged" | "minor" | "changed";
	diffRate: number;
	beforePath?: string;
	afterPath?: string;
	diffPath?: string;
}
