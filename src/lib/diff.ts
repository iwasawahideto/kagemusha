import fs from "node:fs";
import path from "node:path";
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
 * - `after`: the new `latest.png` URL
 * - `before`: the previous `latest.png` URL (= `previous.png`). Undefined on
 *   the first push for this id (no prior version existed).
 * - `diff`: pixel-diff visualization URL. Undefined for `new` or `layout-diff`.
 */
export interface ResultUrls {
	after: string;
	before?: string;
	diff?: string;
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
			diffPath: string;
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
 * Compare two PNG files using pixelmatch and write the diff visualization.
 * If dimensions differ, returns layout-diff without writing a diff image.
 */
export const diffImages = async (
	baseline: string,
	current: string,
	diffPath: string,
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

	fs.mkdirSync(path.dirname(diffPath), { recursive: true });
	fs.writeFileSync(diffPath, PNG.sync.write(diff));

	return {
		match: false,
		reason: "pixel-diff",
		diffCount,
		diffPercentage: (diffCount / (width * height)) * 100,
	};
};
