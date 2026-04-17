import fs from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { CaptureResult, KagemushaConfig } from "../types.js";

export interface UploadResult {
	id: string;
	url: string;
	bucket: string;
	key: string;
}

export async function uploadToS3(
	config: KagemushaConfig,
	results: CaptureResult[],
	_projectRoot: string,
): Promise<UploadResult[]> {
	if (!config.publish) {
		throw new Error("publish config is required for S3 upload");
	}

	const client = new S3Client({});
	const uploadResults: UploadResult[] = [];

	for (const result of results) {
		const imagePath = result.annotatedPath;
		if (!fs.existsSync(imagePath)) {
			console.warn(`Image not found, skipping: ${imagePath}`);
			continue;
		}

		const body = fs.readFileSync(imagePath);
		const key = `${result.id}/latest.png`;

		await client.send(
			new PutObjectCommand({
				Bucket: config.publish.cdnBucket,
				Key: key,
				Body: body,
				ContentType: "image/png",
				CacheControl: "no-cache",
			}),
		);

		// Also upload with timestamp for history
		const historyKey = `${result.id}/${result.timestamp}.png`;
		await client.send(
			new PutObjectCommand({
				Bucket: config.publish.cdnBucket,
				Key: historyKey,
				Body: body,
				ContentType: "image/png",
			}),
		);

		const url = `${config.publish.cdnBaseUrl}/${key}`;
		uploadResults.push({
			id: result.id,
			url,
			bucket: config.publish.cdnBucket ?? "",
			key,
		});

		console.log(`  Uploaded: ${result.id} → ${url}`);
	}

	return uploadResults;
}
