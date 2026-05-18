import os from "node:os";
import chalk from "chalk";

// kagemusha は Playwright の API (= playwright-core) だけ使い、browser binary
// は bundle しない。`channel: "chrome"` で OS インストール済みの Google
// Chrome を起動する。これで `npm install` 時の ~300MB chromium download も、
// pnpm の post-install 制限もまるごと回避できる。
//
// 前提: 実行環境 (= 開発者の OS / CI runner) に Chrome がインストール済み。
// CI の場合は browser-actions/setup-chrome 等で事前 install する。

// Rosetta 2 経由で node が起動してると Playwright も Intel mode で動き、
// Apple Silicon Mac 上で Intel Chrome binary を Rosetta translation 経由で
// 起動するため Chrome の動作が 2-5x 遅くなる。Microsoft も "not planned" で
// クローズしてるので kagemusha 側で検知 + ユーザーに通知する。
// 参照: https://github.com/microsoft/playwright/issues/19602
let warnedRosetta = false;
const warnIfRosetta = (): void => {
	if (warnedRosetta) return;
	if (process.platform !== "darwin") return;
	if (process.arch !== "x64") return;
	const cpuModel = os.cpus()[0]?.model ?? "";
	if (!cpuModel.startsWith("Apple ")) return;
	warnedRosetta = true;
	console.warn(
		chalk.yellow(
			"⚠ Running under Rosetta 2 on Apple Silicon — Chrome will be 2-5x slower than native.\n" +
				"  Fix: run via arm64 shell (e.g., `arch -arm64 npx kagemusha ...`), or rebuild\n" +
				"  your terminal stack (shell / multiplexer / brew) as arm64 native binaries.\n" +
				"  See: https://github.com/microsoft/playwright/issues/19602",
		),
	);
};

export const launchOptionsFor = (): { channel: "chrome" } => {
	warnIfRosetta();
	return {
		channel: "chrome",
	};
};
