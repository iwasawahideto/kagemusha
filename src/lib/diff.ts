import fs from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Dimensions {
	width: number;
	height: number;
}

/**
 * URLs of the canonical artifacts on S3. Only populated when `capture`
 * actually pushed (default mode, S3 destination). `--dry-run` and `local`
 * destination leave this undefined.
 *
 * - `history` / `previousHistory`: immutable per-run URLs. Safe to embed
 *   as bare URLs (image proxies cache by URL and the bytes never change)
 * - `latest`: mutable URL to `latest.png`. Use ONLY as a labeled link
 *   (Slack `<url|label>` etc.), never as a bare URL in notification text
 *   — proxies would cache it and break on the next release
 *
 * No `diff` URL — kagemusha doesn't publish a pre-generated diff
 * visualization. Consumers compare history vs previousHistory raw images.
 */
export interface ResultUrls {
	latest: string;
	history: string;
	previousHistory?: string;
}

// `pageUrl` is the absolute URL of the page that was screenshotted
// (`baseUrl` + the definition's `url`, with `urlParams` substituted).
// Always present regardless of destination — local vs S3 doesn't change
// the source page.
interface BaseResult {
	id: string;
	pageUrl: string;
}

export type DiffStatus =
	| (BaseResult & { status: "unchanged" })
	| (BaseResult & { status: "new"; urls?: ResultUrls })
	| (BaseResult & { status: "missing"; reason?: string })
	| (BaseResult & {
			status: "changed";
			reason: "pixel-diff";
			diffPercentage: number;
			urls?: ResultUrls;
	  })
	| (BaseResult & {
			status: "changed";
			reason: "layout-diff";
			canonical: Dimensions;
			staging: Dimensions;
			urls?: ResultUrls;
	  });

export interface DiffOptions {
	/** Color difference threshold per pixel (0-1). Lower = stricter. Default 0.1 */
	pixelThreshold?: number;
	/** Ignore anti-aliased pixels (treat them as equal). Default true */
	ignoreAntiAliasing?: boolean;
}

/**
 * Whether a pixel diff exceeds the configured "changed-vs-unchanged"
 * threshold and should be surfaced. Strictly greater so a diff exactly
 * at the threshold counts as unchanged (matches the dry-run gate's
 * existing `> threshold` semantics).
 *
 * `diffPercentage` is in percent (e.g. 2.34 = 2.34%). `threshold` is in
 * fraction (e.g. 0.005 = 0.5%) — matching `defaultDiffThreshold` in
 * `kagemusha.config.yaml`.
 */
export const isOverThreshold = (
	diffPercentage: number,
	threshold: number,
): boolean => diffPercentage / 100 > threshold;

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
