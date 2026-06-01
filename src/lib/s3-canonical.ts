import fs from "node:fs";
import path from "node:path";
import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { KagemushaConfig } from "../types.js";
import { isNoSuchKey, isNotFound } from "./aws-error.js";

export type FetchResult = "ok" | "not-found";

/**
 * URLs returned alongside each push, for consumers to surface in
 * `summary.json`.
 *
 * - `history` / `previousHistory`: immutable per-run URLs under
 *   `<id>/history/<timestamp>.png`. Safe to embed as bare URLs (Slack
 *   etc. unfurl them into image previews) because the bytes never
 *   change at these URLs
 * - `latest`: mutable URL to `<id>/latest.png`. Use ONLY as a labeled
 *   link (e.g. Slack `<url|label>`), never as a bare URL in notification
 *   text — image proxies cache by URL, so a bare `latest.png` would
 *   either freeze on the cached preview or silently mutate under prior
 *   messages on the next push. The labeled-link form skips unfurl and
 *   sidesteps the cache entirely
 *
 * `previousHistory` is undefined on first push (no prior) and on the
 * v1→v2 migration push (prior latest carries no timestamp metadata).
 */
export interface PushUrls {
	latest: string;
	history: string;
	previousHistory?: string;
}

// Pulls region from virtual-hosted S3 URLs (`.s3.<region>.amazonaws.com`).
// Undefined for legacy global URLs or custom CDN domains.
const extractRegionFromCdnBase = (cdnBaseUrl?: string): string | undefined => {
	if (!cdnBaseUrl) return undefined;
	const m = cdnBaseUrl.match(/\.s3[.-]([a-z0-9-]+)\.amazonaws\.com/i);
	return m?.[1];
};

/** S3-backed canonical store. */
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

	// Sub-prefix keeps `latest.png` visible at the id root, history
	// snapshots tucked under it.
	private historyKey(id: string, timestamp: string): string {
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
	 * Writes `latest.png` (with timestamp metadata, for the next push to
	 * read) and `history/<timestamp>.png` (immutable per-run snapshot) in
	 * parallel. Returns immutable URLs only; `latest.png` is intentionally
	 * not surfaced — see `PushUrls`.
	 *
	 * Concurrency: assumes only one push() per `id` runs at a time. The
	 * generated workflow enforces this via `concurrency: { group:
	 * kagemusha, cancel-in-progress: true }`.
	 */
	async push(id: string, localPath: string): Promise<PushUrls> {
		const body = fs.readFileSync(localPath);
		const timestamp = new Date().toISOString().replaceAll(":", "-");

		const previousTimestamp = await this.readLatestTimestamp(id);
		const previousHistory = previousTimestamp
			? this.urlFor(this.historyKey(id, previousTimestamp))
			: undefined;

		await Promise.all([
			// latest — mutable pointer; `no-cache` so revalidations get the
			// new bytes. Carries timestamp metadata for the next push.
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
			// history — immutable; tells proxies/CDNs to cache forever.
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
			latest: this.urlFor(this.latestKey(id)),
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
