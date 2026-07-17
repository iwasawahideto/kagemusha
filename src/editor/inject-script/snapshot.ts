// Snapshot (image) editing mode: annotations are drawn over a headless-rendered
// screenshot of the replayed state (headless keeps hover menus open, headed drops them).

import { state } from "./state.js";
import { getSvg } from "./svg.js";

const SNAPSHOT_ID = "kagemusha-snapshot";
const SNAPSHOT_Z = 2147483645; // just below the SVG layer
const LOADING_ID = "kagemusha-snapshot-loading";

export const setSnapshotLoading = (on: boolean): void => {
	const existing = document.getElementById(LOADING_ID);
	if (!on) {
		existing?.remove();
		return;
	}
	if (existing) return;
	const el = document.createElement("div");
	el.id = LOADING_ID;
	el.setAttribute(
		"style",
		"position:fixed;inset:0;z-index:var(--kg-z-top);" +
			"background:rgba(15,15,30,0.86);display:flex;flex-direction:column;" +
			"align-items:center;justify-content:center;gap:14px;" +
			"font-family:-apple-system,sans-serif;color:#fff;",
	);
	el.innerHTML =
		'<div style="width:44px;height:44px;border:4px solid rgba(255,255,255,0.25);' +
		'border-top-color:#6366f1;border-radius:50%;animation:kg-spin 0.8s linear infinite;"></div>' +
		'<div style="font-size:15px;">Rendering snapshot…</div>' +
		'<div style="font-size:12px;color:#a0a0c0;">再生後の状態を撮影しています（数秒〜30秒）</div>' +
		"<style>@keyframes kg-spin{to{transform:rotate(360deg)}}</style>";
	document.documentElement.appendChild(el);
};

export const enterSnapshotMode = (dataUrl: string): void => {
	state.snapshotMode = true;
	document.documentElement.style.overflow = "";

	let img = document.getElementById(SNAPSHOT_ID) as HTMLImageElement | null;
	if (!img) {
		img = document.createElement("img");
		img.id = SNAPSHOT_ID;
		document.documentElement.appendChild(img);
	}
	const svg = getSvg();

	// naturalSize / DPR so image and SVG share the annotation coordinate space
	const el = img;
	el.onload = () => {
		const dpr = window.devicePixelRatio || 1;
		const w = el.naturalWidth / dpr;
		const h = el.naturalHeight / dpr;
		el.style.width = `${w}px`;
		el.style.height = `${h}px`;
		svg.setAttribute("width", String(w));
		svg.setAttribute("height", String(h));
		setSnapshotLoading(false);
	};
	el.setAttribute(
		"style",
		"position:absolute;top:0;left:0;margin:0;padding:0;border:0;" +
			`z-index:${SNAPSHOT_Z};pointer-events:none;display:block;`,
	);
	el.src = dataUrl;
};

export const exitSnapshotMode = (): void => {
	state.snapshotMode = false;
	document.getElementById(SNAPSHOT_ID)?.remove();
	setSnapshotLoading(false);
	document.documentElement.style.overflow = "hidden";
};
