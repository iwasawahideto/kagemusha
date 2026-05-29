import fs from "node:fs";
import path from "node:path";
import {
	GetObjectCommand,
	HeadObjectCommand,
	NoSuchKey,
	NotFound,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { KagemushaConfig } from "../types.js";

const DEFAULT_OUTPUT_DIR = "screenshots";

export const getOutputDir = (
	config: KagemushaConfig,
	projectRoot: string,
): string => {
	const configured = config.publish?.outputDir ?? DEFAULT_OUTPUT_DIR;
	return path.isAbsolute(configured)
		? configured
		: path.join(projectRoot, configured);
};

export const getCanonicalPath = (
	config: KagemushaConfig,
	projectRoot: string,
	id: string,
): string => path.join(getOutputDir(config, projectRoot), `${id}.png`);

export type FetchResult = "ok" | "not-found";

/**
 * URLs returned by `push()` so callers can include them in summary.json
 * for downstream notification consumers (Slack, PR comments, etc.).
 *
 * Both URLs point under `<id>/history/<timestamp>.png` — **immutable
 * per-run URLs**. Notification embeds (Slack/Intercom/etc.) cache by URL,
 * so the URL must identify a stable image for the embed to behave well
 * across releases. The mutable `latest.png` is kept internally as the
 * diff baseline pointer but is intentionally not exposed in this API.
 *
 * - `history`: this run's screenshot
 * - `previousHistory`: prior run's screenshot. Undefined on first push
 *   for an id (no prior) and on the v1→v2 migration push (prior latest
 *   carries no timestamp metadata, see `readLatestTimestamp`)
 */
export interface PushUrls {
	history: string;
	previousHistory?: string;
}

// Extract AWS region from a virtual-hosted–style S3 URL or s3.<region>.amazonaws.com endpoint.
// Returns undefined for legacy global URLs (s3.amazonaws.com) or custom CDN domains.
const extractRegionFromCdnBase = (cdnBaseUrl?: string): string | undefined => {
	if (!cdnBaseUrl) return undefined;
	const m = cdnBaseUrl.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com/i);
	return m?.[1];
};

/**
 * S3-backed canonical store.
 * Local mode has no remote — outputDir itself is the source of truth.
 */

export class S3Canonical {
	private readonly client: S3Client;

	constructor(
		private readonly bucket: string,
		private readonly cdnBaseUrl?: string,
	) {
		const region = extractRegionFromCdnBase(cdnBaseUrl);
		this.client = new S3Client(region ? { region } : {});
	}

	private latestKey(id: string): string {
		return `${id}/latest.png`;
	}

	private historyKey(id: string, timestamp: string): string {
		// Group history snapshots under a sub-prefix so the bucket list
		// shows `latest.png` cleanly without historical snapshots
		// interleaved alphabetically.
		return `${id}/history/${timestamp}.png`;
	}

	private urlFor(key: string): string {
		const base = this.cdnBaseUrl ?? `s3://${this.bucket}`;
		return `${base.replace(/\/$/, "")}/${key}`;
	}

	/** Download canonical for `id` to `localPath`. Returns "not-found" if absent. */
	async fetch(id: string, localPath: string): Promise<FetchResult> {
		try {
			const res = await this.client.send(
				new GetObjectCommand({ Bucket: this.bucket, Key: this.latestKey(id) }),
			);
			const bytes = await res.Body?.transformToByteArray();
			if (!bytes) return "not-found";
			fs.mkdirSync(path.dirname(localPath), { recursive: true });
			fs.writeFileSync(localPath, bytes);
			return "ok";
		} catch (e) {
			if (isNoSuchKey(e)) return "not-found";
			throw e;
		}
	}

	/**
	 * Upload `localPath` as the canonical for `id`.
	 *
	 * Side effects on S3 for a single push:
	 *   1. HEAD latest.png to read the prior run's timestamp (from object
	 *      metadata). Used to build `previousHistory` — the immutable URL
	 *      to the screenshot from the run before this one
	 *   2. Upload localPath → latest.png (with timestamp metadata)
	 *   3. Upload localPath → history/<timestamp>.png
	 *
	 * Steps 2-3 target different keys and run in parallel. Step 1 only
	 * reads, so it's also parallel-safe — but kept serial because we need
	 * the prior timestamp before constructing the return value.
	 *
	 * Returns immutable per-run URLs (`history` / `previousHistory`) so
	 * callers can surface them in `reports/summary.json`. `latest.png` is
	 * written but intentionally not returned — see `PushUrls` doc for why
	 * mutable URLs are kept out of the public API.
	 *
	 * Concurrency: assumes only one push() per `id` runs at a time. The
	 * generated workflow guarantees this via `concurrency: { group:
	 * kagemusha, cancel-in-progress: true }`. Removing that opens a race
	 * where two pushes read the same prior timestamp and lose history
	 * links.
	 */
	async push(id: string, localPath: string): Promise<PushUrls> {
		const body = fs.readFileSync(localPath);
		const timestamp = new Date().toISOString().replaceAll(":", "-");

		// 1. Read prior run's timestamp from latest's object metadata to
		// construct an immutable URL to the screenshot from the previous run.
		// Missing latest (= first push for this id) or missing metadata (=
		// latest was written by a pre-v2 kagemusha) both leave previousHistory
		// undefined.
		const previousTimestamp = await this.readLatestTimestamp(id);
		const previousHistory = previousTimestamp
			? this.urlFor(this.historyKey(id, previousTimestamp))
			: undefined;

		// 2-3. Independent uploads — run in parallel (= ~2x faster than serial).
		await Promise.all([
			// 2. latest — kagemusha-internal stable pointer. Used by `fetch()`
			// as the diff baseline (one GET per id, no list needed), and its
			// `timestamp` metadata is read on the next push to construct
			// `previousHistory`. NOT exposed in the public summary.json — see
			// PushUrls doc.
			this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: this.latestKey(id),
					Body: body,
					ContentType: "image/png",
					CacheControl: "no-cache",
					Metadata: { timestamp },
				}),
			),
			// 3. history snapshot — immutable per-run URL for embeds/archival.
			// `immutable` advertises to image proxies (Slack, Intercom) and
			// CDNs that this URL's bytes will never change, so they can cache
			// freely and skip revalidation. 1-year max-age + immutable is the
			// canonical "permanent" Cache-Control recipe.
			this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: this.historyKey(id, timestamp),
					Body: body,
					ContentType: "image/png",
					CacheControl: "public, max-age=31536000, immutable",
				}),
			),
		]);

		return {
			history: this.urlFor(this.historyKey(id, timestamp)),
			previousHistory,
		};
	}

	/**
	 * Read the `timestamp` metadata from latest.png. Returns undefined when
	 * latest is absent (first push) or has no metadata (pre-v2 kagemusha).
	 */
	private async readLatestTimestamp(id: string): Promise<string | undefined> {
		try {
			const res = await this.client.send(
				new HeadObjectCommand({
					Bucket: this.bucket,
					Key: this.latestKey(id),
				}),
			);
			return res.Metadata?.timestamp;
		} catch (e) {
			if (isNotFound(e)) return undefined;
			throw e;
		}
	}

	label(): string {
		return this.cdnBaseUrl ?? `s3://${this.bucket}`;
	}
}

const isNoSuchKey = (e: unknown): boolean => {
	if (e instanceof NoSuchKey) return true;
	const name = (e as { name?: string })?.name;
	const code = (e as { Code?: string })?.Code;
	return name === "NoSuchKey" || code === "NoSuchKey";
};

// HeadObject returns NotFound (not NoSuchKey) for absent keys. The AWS SDK
// surfaces this as either a typed `NotFound` instance or an error with
// `name`/`Code` of "NotFound" — match both.
const isNotFound = (e: unknown): boolean => {
	if (e instanceof NotFound) return true;
	const name = (e as { name?: string })?.name;
	const code = (e as { Code?: string })?.Code;
	const statusCode = (e as { $metadata?: { httpStatusCode?: number } })
		?.$metadata?.httpStatusCode;
	return name === "NotFound" || code === "NotFound" || statusCode === 404;
};

export const createS3Canonical = (
	config: KagemushaConfig,
): S3Canonical | null => {
	const publish = config.publish;
	if (publish?.destination !== "s3") return null;
	if (!publish.cdnBucket) {
		throw new Error("publish.cdnBucket is required for s3 destination");
	}
	return new S3Canonical(publish.cdnBucket, publish.cdnBaseUrl);
};
