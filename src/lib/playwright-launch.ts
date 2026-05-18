// kagemusha は Playwright の API (= playwright-core) だけ使い、browser binary
// は bundle しない。`channel: "chrome"` で OS インストール済みの Google
// Chrome を起動する。これで `npm install` 時の ~300MB chromium download も、
// pnpm の post-install 制限もまるごと回避できる。
//
// 前提: 実行環境 (= 開発者の OS / CI runner) に Chrome がインストール済み。
// CI の場合は browser-actions/setup-chrome 等で事前 install する。
export const launchOptionsFor = (): { channel: "chrome" } => ({
	channel: "chrome",
});
