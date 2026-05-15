import fs from "node:fs";
import path from "node:path";
import {
	CopyObjectCommand,
	GetObjectCommand,
	NoSuchKey,
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
 * - `after`: the new `latest.png` we just uploaded
 * - `before`: the previous `latest.png`, copied to `previous.png` before
 *   being overwritten. Undefined when no prior version existed (= first push)
 */
export interface PushUrls {
	after: string;
	before?: string;
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

	private previousKey(id: string): string {
		return `${id}/previous.png`;
	}

	private historyKey(id: string, timestamp: string): string {
		// Group history snapshots under a sub-prefix so the bucket list
		// shows `latest.png` / `previous.png` cleanly without historical
		// snapshots interleaved alphabetically.
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
	 *   1. Copy existing latest.png → previous.png (no-op if missing)
	 *   2. Upload localPath → latest.png
	 *   3. Upload localPath → history/<timestamp>.png
	 *
	 * Step 1 must complete first (otherwise the soon-to-be-overwritten latest
	 * would be replaced before the snapshot is taken). Steps 2-3 target
	 * different keys and run in parallel.
	 *
	 * Returns URLs (`before` / `after`) so callers can surface them in
	 * `reports/summary.json` (= public API). Consumers compare before vs after
	 * visually; kagemusha intentionally does not publish a pre-generated diff
	 * image (= pixelmatch's red overlay is alarming and adds little vs the
	 * raw pair).
	 */
	async push(id: string, localPath: string): Promise<PushUrls> {
		const body = fs.readFileSync(localPath);

		// 1. Snapshot the soon-to-be-overwritten latest as `previous`.
		// Uses CopyObject (= S3-side copy, no local round-trip). First push for
		// this id has no latest yet — we swallow NoSuchKey and report `before:
		// undefined` to the caller.
		let beforeUrl: string | undefined;
		try {
			await this.client.send(
				new CopyObjectCommand({
					Bucket: this.bucket,
					CopySource: `${this.bucket}/${this.latestKey(id)}`,
					Key: this.previousKey(id),
					MetadataDirective: "REPLACE",
					ContentType: "image/png",
					CacheControl: "no-cache",
				}),
			);
			beforeUrl = this.urlFor(this.previousKey(id));
		} catch (e) {
			if (!isNoSuchKey(e)) throw e;
			// first push for this id — no previous yet, leave beforeUrl undefined
		}

		// 2-3. Independent uploads — run in parallel (= ~2x faster than serial).
		const timestamp = new Date().toISOString().replaceAll(":", "-");
		await Promise.all([
			// 2. latest
			this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: this.latestKey(id),
					Body: body,
					ContentType: "image/png",
					CacheControl: "no-cache",
				}),
			),
			// 3. history snapshot
			this.client.send(
				new PutObjectCommand({
					Bucket: this.bucket,
					Key: this.historyKey(id, timestamp),
					Body: body,
					ContentType: "image/png",
				}),
			),
		]);

		return {
			after: this.urlFor(this.latestKey(id)),
			before: beforeUrl,
		};
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
