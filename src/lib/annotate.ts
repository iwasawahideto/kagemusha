import fs from "node:fs";
import sharp from "sharp";
import type {
	CaptureResult,
	CaptureSpec,
	Decoration,
	KagemushaConfig,
	ScreenshotDefinition,
} from "../types.js";

export async function annotateScreenshots(
	definitions: ScreenshotDefinition[],
	results: CaptureResult[],
	config: KagemushaConfig,
): Promise<CaptureResult[]> {
	const dpr = config.screenshot.defaultViewport.deviceScaleFactor ?? 2;
	const annotatedResults: CaptureResult[] = [];

	for (const result of results) {
		const def = definitions.find((d) => d.id === result.id);

		if (!def?.decorations?.length) {
			// No decorations — copy raw as annotated
			const annotatedPath = result.rawPath.replace(".raw.png", ".png");
			fs.copyFileSync(result.rawPath, annotatedPath);
			annotatedResults.push({ ...result, annotatedPath });
			continue;
		}

		const annotatedPath = result.rawPath.replace(".raw.png", ".png");
		await drawAnnotations(
			result.rawPath,
			annotatedPath,
			def.decorations,
			def.capture,
			dpr,
		);
		annotatedResults.push({ ...result, annotatedPath });
	}

	return annotatedResults;
}

// Decorations are saved in page-relative device-pixel coords. When the
// captured image is a crop, we subtract the crop's top-left so the SVG overlay
// lines up with what's actually in the PNG.
const captureOffset = (
	capture: CaptureSpec,
	dpr: number,
): { x: number; y: number } => {
	if (capture.mode === "crop") {
		return { x: capture.crop.start.x * dpr, y: capture.crop.start.y * dpr };
	}
	return { x: 0, y: 0 };
};

async function drawAnnotations(
	inputPath: string,
	outputPath: string,
	decorations: Decoration[],
	capture: CaptureSpec,
	dpr: number,
): Promise<void> {
	const offset = captureOffset(capture, dpr);
	const image = sharp(inputPath);
	const metadata = await image.metadata();
	const width = metadata.width ?? 1280;
	const height = metadata.height ?? 720;

	const svgParts: string[] = [];

	for (const dec of decorations) {
		switch (dec.type) {
			case "rect":
				svgParts.push(renderRect(dec, offset));
				break;
			case "arrow":
				svgParts.push(renderArrow(dec, offset));
				break;
			case "label":
				svgParts.push(renderLabel(dec, offset));
				break;
		}
	}

	const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7"
                refX="10" refY="3.5" orient="auto" fill="red">
          <polygon points="0 0, 10 3.5, 0 7" />
        </marker>
      </defs>
      ${svgParts.join("\n")}
    </svg>
  `;

	await image
		.composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
		.toFile(outputPath);
}

type Offset = { x: number; y: number };

function renderRect(
	dec: Extract<Decoration, { type: "rect" }>,
	offset: Offset,
): string {
	const color = dec.style?.color ?? "#FF0000";
	const strokeWidth = dec.style?.strokeWidth ?? 2;
	const borderRadius = dec.style?.borderRadius ?? 0;

	if ("selector" in dec.target) {
		// Selector-based rects need runtime resolution — use placeholder
		// In real usage, the bounding box is resolved during capture
		return `<!-- rect: selector "${dec.target.selector}" needs runtime resolution -->`;
	}

	const { x, y, width, height } = dec.target;
	return `<rect x="${x - offset.x}" y="${y - offset.y}" width="${width}" height="${height}"
    rx="${borderRadius}" ry="${borderRadius}"
    fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`;
}

function renderArrow(
	dec: Extract<Decoration, { type: "arrow" }>,
	offset: Offset,
): string {
	const color = dec.style?.color ?? "#FF0000";
	const strokeWidth = dec.style?.strokeWidth ?? 2;

	const from = "x" in dec.from ? dec.from : { x: 0, y: 0 };
	const to = "x" in dec.to ? dec.to : { x: 100, y: 100 };

	return `<line x1="${from.x - offset.x}" y1="${from.y - offset.y}" x2="${to.x - offset.x}" y2="${to.y - offset.y}"
    stroke="${color}" stroke-width="${strokeWidth}"
    marker-end="url(#arrowhead)" />`;
}

function renderLabel(
	dec: Extract<Decoration, { type: "label" }>,
	offset: Offset,
): string {
	const fontSize = dec.style?.fontSize ?? 14;
	const color = dec.style?.color ?? "#FF0000";
	const bg = dec.style?.background ?? "#FFFFFF";
	const pos = "x" in dec.position ? dec.position : { x: 0, y: 0 };
	const px = pos.x - offset.x;
	const py = pos.y - offset.y;

	const paddingX = 6;
	const paddingY = 4;
	const textWidth = dec.text.length * fontSize * 0.6;
	const textHeight = fontSize;

	return `
    <rect x="${px - paddingX}" y="${py - textHeight - paddingY}"
      width="${textWidth + paddingX * 2}" height="${textHeight + paddingY * 2}"
      rx="4" ry="4" fill="${bg}" />
    <text x="${px}" y="${py}" font-size="${fontSize}"
      fill="${color}" font-family="sans-serif">${escapeXml(dec.text)}</text>
  `;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
