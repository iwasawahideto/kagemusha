// Browser harness for container-scroll recording → replay, on the card-grid
// fixture (`example/app/grid.html`) that mimics an analytics SPA: many cards,
// one shared class structure, `#GRID-ITEM-<uuid>` as the only unique handle.
//
// Not a `bun test` file on purpose — it needs a real Chrome and a served
// fixture. Run it by hand after touching selector.ts / screenshot.ts:
//
//   bun src/lib/container-scroll.harness.ts
//
// Checks: (1) the recorded selector is unique and hits the scrolled card,
// (2) capture replays it and scrolls that card only, (3) a deliberately
// ambiguous selector still captures (first visible match, no strict violation).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import type { KagemushaConfig, ScreenshotDefinition } from "../types.js";
import { launchOptionsFor } from "./playwright-launch.js";
import { captureScreenshots, openPreparedPage } from "./screenshot.js";

const ROOT = path.resolve(import.meta.dir, "../..");
const APP_DIR = path.join(ROOT, "example/app");
const SELECTOR_SRC = path.join(ROOT, "src/editor/inject-script/selector.ts");
// 3rd card — a middle one, so a wrong pick can't accidentally look right.
const TARGET_INDEX = 2;
const SCROLL_Y = 120;
// What cssPath produced before the fix: 4 segments, no anchor.
const LEGACY_SELECTOR = "div:nth-of-type(2) > div > div > div:nth-of-type(2)";

let failures = 0;

const check = (label: string, ok: boolean, detail = ""): void => {
	if (!ok) failures++;
	console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const bundleSelectorModule = async (): Promise<string> => {
	const out = await build({
		entryPoints: [SELECTOR_SRC],
		bundle: true,
		write: false,
		format: "iife",
		globalName: "KG",
		platform: "browser",
		target: "es2022",
	});
	const text = out.outputFiles[0]?.text;
	if (!text) throw new Error("failed to bundle selector.ts");
	return text;
};

const mkConfig = (baseUrl: string): KagemushaConfig => ({
	app: { baseUrl },
	screenshot: {
		defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
		defaultDiffThreshold: 0.5,
	},
});

const scrollTops = async (
	page: Awaited<ReturnType<typeof openPreparedPage>>,
): Promise<{ id: string; top: number }[]> =>
	await page.evaluate(() =>
		Array.from(document.querySelectorAll(".grid-item")).map((item) => ({
			id: item.id,
			top: item.querySelector(".ov-y_auto")?.scrollTop ?? -1,
		})),
	);

const main = async (): Promise<void> => {
	const server = Bun.serve({
		port: 0,
		fetch: async (req) => {
			const p = new URL(req.url).pathname;
			const file = Bun.file(path.join(APP_DIR, p === "/" ? "index.html" : p));
			if (!(await file.exists()))
				return new Response("not found", { status: 404 });
			return new Response(file);
		},
	});
	const baseUrl = `http://localhost:${server.port}`;
	const config = mkConfig(baseUrl);
	const projectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "kagemusha-harness-"),
	);
	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({
		headless: true,
		...launchOptionsFor(),
	});

	try {
		// --- 1. Record side: what computeContainerSelector produces live ---
		const context = await browser.newContext({
			baseURL: baseUrl,
			viewport: { width: 1280, height: 800 },
		});
		const page = await context.newPage();
		await page.goto(`${baseUrl}/grid.html`, { waitUntil: "load" });
		await page.addScriptTag({ content: await bundleSelectorModule() });
		const recorded = await page.evaluate(
			({ index, legacy }) => {
				const kg = (
					window as unknown as {
						KG: {
							computeContainerSelector: (el: Element) => {
								selector: string;
								quality: string;
							};
						};
					}
				).KG;
				const card = document.querySelectorAll(".grid-item")[index];
				const target = card?.querySelector(".ov-y_auto");
				if (!card || !target) throw new Error("fixture card not found");
				const result = kg.computeContainerSelector(target);
				return {
					...result,
					cardId: card.id,
					matches: document.querySelectorAll(result.selector).length,
					hitsTarget: document.querySelector(result.selector) === target,
					legacyMatches: document.querySelectorAll(legacy).length,
					classMatches: document.querySelectorAll(".ov-y_auto").length,
				};
			},
			{ index: TARGET_INDEX, legacy: LEGACY_SELECTOR },
		);
		await context.close();

		console.log(
			`recorded selector: ${recorded.selector} (${recorded.quality})`,
		);
		console.log(
			`legacy 4-segment path matched ${recorded.legacyMatches} elements (the bug)`,
		);
		check(
			"recorded selector is unique",
			recorded.matches === 1,
			`${recorded.matches} match(es)`,
		);
		check(
			"recorded selector resolves to the scrolled container",
			recorded.hitsTarget,
		);
		check(
			"recorded selector is anchored on the card id",
			recorded.selector.startsWith(`#${recorded.cardId}`),
		);
		check(
			"quality is good (anchored)",
			recorded.quality === "good",
			recorded.quality,
		);
		check("the fixture is genuinely ambiguous", recorded.legacyMatches > 1);

		// --- 2. Replay side: capture with that step ---
		const def: ScreenshotDefinition = {
			id: "grid",
			name: "Card Grid",
			url: "/grid.html",
			capture: { mode: "fullPage" },
			beforeCapture: [
				{ action: "scroll", selector: recorded.selector, y: SCROLL_Y },
			],
		};
		const outputDir = path.join(projectRoot, "screenshots");
		const capFailures = await captureScreenshots(config, [def], projectRoot, {
			outputDir,
		});
		check(
			"capture succeeds with the recorded step",
			capFailures.length === 0,
			capFailures.map((f) => f.reason).join(" | "),
		);
		check(
			"screenshot written",
			fs.existsSync(path.join(outputDir, "grid.png")),
		);

		const verifyContext = await browser.newContext({
			baseURL: baseUrl,
			viewport: { width: 1280, height: 800 },
		});
		const replayed = await openPreparedPage(
			verifyContext,
			config,
			def,
			def.beforeCapture,
		);
		const tops = await scrollTops(replayed);
		const scrolled = tops.filter((t) => t.top > 0);
		check(
			"exactly one container scrolled",
			scrolled.length === 1,
			JSON.stringify(tops),
		);
		check(
			"the scrolled container is the recorded card",
			scrolled[0]?.id === recorded.cardId,
			`${scrolled[0]?.id} vs ${recorded.cardId}`,
		);
		check(
			"scrollTop matches the recorded y",
			scrolled[0]?.top === SCROLL_Y,
			String(scrolled[0]?.top),
		);
		await replayed.close();

		// --- 3. Ambiguous selector: tolerated, never a strict violation ---
		const ambiguousDef: ScreenshotDefinition = {
			...def,
			id: "grid-ambiguous",
			beforeCapture: [
				{ action: "scroll", selector: ".ov-y_auto", y: SCROLL_Y },
			],
		};
		const ambiguousFailures = await captureScreenshots(
			config,
			[ambiguousDef],
			projectRoot,
			{ outputDir },
		);
		check(
			`capture survives a selector matching ${recorded.classMatches} elements`,
			ambiguousFailures.length === 0,
			ambiguousFailures.map((f) => f.reason).join(" | "),
		);
		const ambiguousPage = await openPreparedPage(
			verifyContext,
			config,
			ambiguousDef,
			ambiguousDef.beforeCapture,
		);
		const ambiguousTops = await scrollTops(ambiguousPage);
		const ambiguousScrolled = ambiguousTops.filter((t) => t.top > 0);
		check(
			"the first visible match scrolled",
			ambiguousScrolled.length === 1 &&
				ambiguousScrolled[0]?.id === ambiguousTops[0]?.id,
			JSON.stringify(ambiguousTops),
		);
		await ambiguousPage.close();
		await verifyContext.close();
	} finally {
		await browser.close();
		server.stop(true);
		fs.rmSync(projectRoot, { recursive: true, force: true });
	}

	console.log(
		failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`,
	);
	process.exit(failures === 0 ? 0 : 1);
};

await main();
