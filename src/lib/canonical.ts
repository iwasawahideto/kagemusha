import fs from "node:fs";
import path from "node:path";
import {
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
 * S3-backed canonical store.
 * Local mode has no remote — outputDir itself is the source of truth.
 */
export class S3Canonical {
	private readonly client: S3Client;

	constructor(
		private readonly bucket: string,
		private readonly cdnBaseUrl?: string,
	) {
		this.client = new S3Client({});
	}

	private keyOf(id: string): string {
		return `${id}/latest.png`;
	}

	/** Download canonical for `id` to `localPath`. Returns "not-found" if absent. */
	async fetch(id: string, localPath: string): Promise<FetchResult> {
		try {
			const res = await this.client.send(
				new GetObjectCommand({ Bucket: this.bucket, Key: this.keyOf(id) }),
			);
			const bytes = await res.Body?.transformToByteArray();
			if (!bytes) return "not-found";
			fs.mkdirSync(path.dirname(localPath), { recursive: true });
			fs.writeFileSync(localPath, bytes);
			return "ok";
		} catch (e) {
			if (e instanceof NoSuchKey) return "not-found";
			if ((e as { name?: string })?.name === "NoSuchKey") return "not-found";
			if ((e as { Code?: string })?.Code === "NoSuchKey") return "not-found";
			throw e;
		}
	}

	/** Upload `localPath` as the canonical for `id`. */
	async push(id: string, localPath: string): Promise<void> {
		const body = fs.readFileSync(localPath);
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: this.keyOf(id),
				Body: body,
				ContentType: "image/png",
				CacheControl: "no-cache",
			}),
		);
		// History snapshot for debug / rollback
		const historyKey = `${id}/${new Date().toISOString()}.png`;
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: historyKey,
				Body: body,
				ContentType: "image/png",
			}),
		);
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
