import fs from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Dimensions {
	width: number;
	height: number;
}

/**
 * URLs of the canonical artifacts on the remote (= S3). Only populated when
 * `capture` actually pushed (= default mode, S3 destination). `--dry-run` and
 * `local` destination leave this undefined.
 *
 * Both URLs point under `history/<timestamp>.png` — **immutable per-run
 * URLs**. Image proxies (Slack, Intercom) cache by URL, so the URL must
 * identify a stable image for the embed to behave well across releases.
 *
 * - `history`: this run's screenshot
 * - `previousHistory`: prior run's screenshot. Undefined on first push for
 *   this id (no prior run existed) and on the v1→v2 migration push (prior
 *   latest.png carries no timestamp metadata)
 *
 * No `diff` URL — kagemusha intentionally does not publish a pre-generated
 * diff visualization. Consumers compare history vs previousHistory raw
 * images instead.
 */
export interface ResultUrls {
	history: string;
	previousHistory?: string;
}

export type DiffStatus =
	| { id: string; status: "unchanged" }
	| { id: string; status: "new"; urls?: ResultUrls }
	| { id: string; status: "missing"; reason?: string }
	| {
			id: string;
			status: "changed";
			reason: "pixel-diff";
			diffPercentage: number;
			urls?: ResultUrls;
	  }
	| {
			id: string;
			status: "changed";
			reason: "layout-diff";
			canonical: Dimensions;
			staging: Dimensions;
			urls?: ResultUrls;
	  };

export interface DiffOptions {
	/** Color difference threshold per pixel (0-1). Lower = stricter. Default 0.1 */
	pixelThreshold?: number;
	/** Ignore anti-aliased pixels (treat them as equal). Default true */
	ignoreAntiAliasing?: boolean;
}

export type DiffResult =
	| { match: true }
	| {
			match: false;
			reason: "layout-diff";
			canonical: Dimensions;
			staging: Dimensions;
	  }
	| {
			match: false;
			reason: "pixel-diff";
			diffCount: number;
			diffPercentage: number;
	  };

const readPng = (filePath: string): PNG =>
	PNG.sync.read(fs.readFileSync(filePath));

/**
 * Compare two PNG files using pixelmatch. Returns a structured result with
 * the diff percentage; we deliberately don't write a diff PNG anywhere
 * (= the red overlay is alarming + adds little value over the raw pair).
 */
export const diffImages = async (
	baseline: string,
	current: string,
	options: DiffOptions = {},
): Promise<DiffResult> => {
	const a = readPng(baseline);
	const b = readPng(current);

	if (a.width !== b.width || a.height !== b.height) {
		return {
			match: false,
			reason: "layout-diff",
			canonical: { width: a.width, height: a.height },
			staging: { width: b.width, height: b.height },
		};
	}

	const { width, height } = a;
	// pixelmatch requires an output buffer even though we discard it.
	const diff = new PNG({ width, height });

	const diffCount = pixelmatch(a.data, b.data, diff.data, width, height, {
		threshold: options.pixelThreshold ?? 0.1,
		// pixelmatch's `includeAA: true` means "check AA pixels" (= flag them).
		// Our `ignoreAntiAliasing` defaults true (= skip AA), so we invert.
		includeAA: options.ignoreAntiAliasing === false,
	});

	if (diffCount === 0) {
		return { match: true };
	}

	return {
		match: false,
		reason: "pixel-diff",
		diffCount,
		diffPercentage: (diffCount / (width * height)) * 100,
	};
};
