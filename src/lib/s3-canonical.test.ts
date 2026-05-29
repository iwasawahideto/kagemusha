import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	HeadObjectCommand,
	NotFound,
	PutObjectCommand,
	S3Client,
	S3ServiceException,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3Canonical } from "./s3-canonical.js";

// aws-sdk-client-mock intercepts every S3Client instance created in this
// process. canonical.ts constructs its own client internally, so we mock
// the class itself rather than passing a client in.
const s3Mock = mockClient(S3Client);

const BUCKET = "test-bucket";
const CDN_BASE = "https://cdn.example.com";
const ID = "home";

// Minimal PNG-ish bytes — content doesn't matter for these tests since we
// only assert that S3 received *some* body. Using a real PNG header keeps
// the fixture self-documenting.
const PNG_HEADER = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

let tmpDir: string;
let localPath: string;

beforeEach(() => {
	s3Mock.reset();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kagemusha-canonical-test-"));
	localPath = path.join(tmpDir, "screenshot.png");
	fs.writeFileSync(localPath, PNG_HEADER);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// readLatestTimestamp is `private` in TS but the test is the contract for
// the metadata round-trip, so cast through `any` to reach it. Using
// `unknown` then narrowing keeps the cast localized.
const readLatestTimestamp = (
	c: S3Canonical,
	id: string,
): Promise<string | undefined> =>
	(
		c as unknown as {
			readLatestTimestamp: (id: string) => Promise<string | undefined>;
		}
	).readLatestTimestamp(id);

describe("S3Canonical.readLatestTimestamp", () => {
	it("returns undefined when latest.png does not exist (first push)", async () => {
		s3Mock
			.on(HeadObjectCommand)
			.rejects(new NotFound({ message: "", $metadata: {} }));

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const ts = await readLatestTimestamp(canonical, ID);

		expect(ts).toBeUndefined();
	});

	it("returns undefined on v1 migration (HEAD ok, Metadata is empty)", async () => {
		// Pre-v2 kagemusha wrote latest.png without timestamp metadata.
		// HEAD succeeds but Metadata is `{}` (SDK normalizes missing metadata).
		s3Mock.on(HeadObjectCommand).resolves({ Metadata: {} });

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const ts = await readLatestTimestamp(canonical, ID);

		expect(ts).toBeUndefined();
	});

	it("returns undefined when Metadata field itself is absent", async () => {
		s3Mock.on(HeadObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const ts = await readLatestTimestamp(canonical, ID);

		expect(ts).toBeUndefined();
	});

	it("returns the timestamp string when present in Metadata (v2)", async () => {
		s3Mock
			.on(HeadObjectCommand)
			.resolves({ Metadata: { timestamp: "2026-05-15T12-34-56.789Z" } });

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const ts = await readLatestTimestamp(canonical, ID);

		expect(ts).toBe("2026-05-15T12-34-56.789Z");
	});

	it("rethrows non-NotFound errors (e.g. 403 / 5xx) — must not swallow", async () => {
		const forbidden = new S3ServiceException({
			name: "AccessDenied",
			$fault: "client",
			$metadata: { httpStatusCode: 403 },
			message: "Access Denied",
		});
		s3Mock.on(HeadObjectCommand).rejects(forbidden);

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		await expect(readLatestTimestamp(canonical, ID)).rejects.toThrow(
			"Access Denied",
		);
	});
});

describe("S3Canonical.push", () => {
	it("first push (HEAD NotFound): previousHistory undefined, two PUTs issued", async () => {
		s3Mock
			.on(HeadObjectCommand)
			.rejects(new NotFound({ message: "", $metadata: {} }));
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const urls = await canonical.push(ID, localPath);

		expect(urls.previousHistory).toBeUndefined();
		expect(urls.history).toMatch(
			new RegExp(`^${CDN_BASE}/${ID}/history/.+\\.png$`),
		);
		expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
	});

	it("v1 migration push (HEAD ok, no metadata): previousHistory undefined, history set", async () => {
		s3Mock.on(HeadObjectCommand).resolves({ Metadata: {} });
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const urls = await canonical.push(ID, localPath);

		expect(urls.previousHistory).toBeUndefined();
		expect(urls.history).toMatch(
			new RegExp(`^${CDN_BASE}/${ID}/history/.+\\.png$`),
		);
	});

	it("normal v2 push: previousHistory points to <base>/<id>/history/OLD-TS.png", async () => {
		const OLD_TS = "2026-05-15T12-34-56.789Z";
		s3Mock.on(HeadObjectCommand).resolves({ Metadata: { timestamp: OLD_TS } });
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		const urls = await canonical.push(ID, localPath);

		expect(urls.previousHistory).toBe(
			`${CDN_BASE}/${ID}/history/${OLD_TS}.png`,
		);
		// history must be a *different* (this-run) timestamp, not the prior one.
		expect(urls.history).not.toBe(urls.previousHistory);
		expect(urls.history.startsWith(`${CDN_BASE}/${ID}/history/`)).toBe(true);
	});

	it("PUT latest.png: Key/CacheControl/Metadata/ContentType", async () => {
		s3Mock
			.on(HeadObjectCommand)
			.rejects(new NotFound({ message: "", $metadata: {} }));
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		await canonical.push(ID, localPath);

		const puts = s3Mock.commandCalls(PutObjectCommand);
		const latestPut = puts.find(
			(c) => c.args[0].input.Key === `${ID}/latest.png`,
		);
		expect(latestPut).toBeDefined();
		const input = latestPut?.args[0].input;
		expect(input?.Bucket).toBe(BUCKET);
		expect(input?.CacheControl).toBe("no-cache");
		expect(input?.ContentType).toBe("image/png");
		expect(input?.Metadata?.timestamp).toBeDefined();
		expect(typeof input?.Metadata?.timestamp).toBe("string");
		expect((input?.Metadata?.timestamp ?? "").length).toBeGreaterThan(0);
	});

	it("PUT history/<ts>.png: Key/CacheControl/ContentType, no Metadata", async () => {
		s3Mock
			.on(HeadObjectCommand)
			.rejects(new NotFound({ message: "", $metadata: {} }));
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		await canonical.push(ID, localPath);

		const puts = s3Mock.commandCalls(PutObjectCommand);
		const historyPut = puts.find((c) =>
			c.args[0].input.Key?.startsWith(`${ID}/history/`),
		);
		expect(historyPut).toBeDefined();
		const input = historyPut?.args[0].input;
		expect(input?.Bucket).toBe(BUCKET);
		expect(input?.Key).toMatch(new RegExp(`^${ID}/history/.+\\.png$`));
		expect(input?.CacheControl).toBe("public, max-age=31536000, immutable");
		expect(input?.ContentType).toBe("image/png");
		// latest is the only object that carries timestamp metadata — history
		// stays metadata-free so the bytes are pure content.
		expect(input?.Metadata).toBeUndefined();
	});

	it("latest.png Metadata.timestamp matches the history key timestamp (round-trip parity)", async () => {
		s3Mock
			.on(HeadObjectCommand)
			.rejects(new NotFound({ message: "", $metadata: {} }));
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);
		await canonical.push(ID, localPath);

		const puts = s3Mock.commandCalls(PutObjectCommand);
		const latestPut = puts.find(
			(c) => c.args[0].input.Key === `${ID}/latest.png`,
		);
		const historyPut = puts.find((c) =>
			c.args[0].input.Key?.startsWith(`${ID}/history/`),
		);
		const tsInMeta = latestPut?.args[0].input.Metadata?.timestamp;
		const historyKey = historyPut?.args[0].input.Key ?? "";
		expect(tsInMeta).toBeDefined();
		expect(historyKey).toBe(`${ID}/history/${tsInMeta}.png`);
	});

	// intentional: empty timestamp is treated as no prior
	// readLatestTimestamp returns "" verbatim, but push()'s truthy check
	// causes previousHistory to remain undefined. This locks in current
	// behavior so a future refactor doesn't silently start emitting a
	// `.../history/.png` link (which would 404).
	it("empty-string Metadata.timestamp: read returns '', push omits previousHistory", async () => {
		s3Mock.on(HeadObjectCommand).resolves({ Metadata: { timestamp: "" } });
		s3Mock.on(PutObjectCommand).resolves({});

		const canonical = new S3Canonical(BUCKET, CDN_BASE);

		const raw = await readLatestTimestamp(canonical, ID);
		expect(raw).toBe("");

		const urls = await canonical.push(ID, localPath);
		expect(urls.previousHistory).toBeUndefined();
	});
});
