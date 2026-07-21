# Changelog

## [0.5.0](https://github.com/iwasawahideto/kagemusha/compare/v0.4.0...v0.5.0) (2026-07-21)


### Features

* **editor:** 再生後の状態のスナップショット上に注釈できるようにする ([#40](https://github.com/iwasawahideto/kagemusha/issues/40)) ([fb7f644](https://github.com/iwasawahideto/kagemusha/commit/fb7f6442d96f4de40159cb162f5208cd675ed486))
* **preview:** ローカルで撮影して開く preview コマンドを追加 ([#42](https://github.com/iwasawahideto/kagemusha/issues/42)) ([fe9e29f](https://github.com/iwasawahideto/kagemusha/commit/fe9e29ffcee8bf996359fb42b3242e462310c434))


### Bug Fixes

* **capture:** 曖昧な text= セレクタで可視要素を優先する（capture/preview） ([#43](https://github.com/iwasawahideto/kagemusha/issues/43)) ([370d9ed](https://github.com/iwasawahideto/kagemusha/commit/370d9edae9b8eb40ed5f057f89529fa0304fa324))

## [0.4.0](https://github.com/iwasawahideto/kagemusha/compare/v0.3.6...v0.4.0) (2026-06-01)


### ⚠ BREAKING CHANGES

* `summary.json` schemaVersion bumped 1 → 2. `urls.before` and `urls.after` removed; use `urls.previousHistory` and `urls.history` instead. Existing `.kagemusha/notify-slack.jq` files must be updated from `templates/notify-slack.jq` to keep Slack image previews working.

### Features

* include pageUrl and latest URL in summary.json + notifications ([#36](https://github.com/iwasawahideto/kagemusha/issues/36)) ([f28c25a](https://github.com/iwasawahideto/kagemusha/commit/f28c25a3aba6333b21ff9da9855020712387d69a))
* switch summary.json urls to immutable per-run history URLs ([#34](https://github.com/iwasawahideto/kagemusha/issues/34)) ([7dc28e6](https://github.com/iwasawahideto/kagemusha/commit/7dc28e65673238b849e54f29a25d2000eb2cdb76))


### Bug Fixes

* apply defaultDiffThreshold to changed-vs-unchanged classification ([#37](https://github.com/iwasawahideto/kagemusha/issues/37)) ([e9a6eb7](https://github.com/iwasawahideto/kagemusha/commit/e9a6eb782c0610a4f41cf5f8136db2e494856084))
* install Japanese fonts and color emoji in generated workflow template ([#32](https://github.com/iwasawahideto/kagemusha/issues/32)) ([b223368](https://github.com/iwasawahideto/kagemusha/commit/b22336820c907fb6727c4555a374786aab3ed2cf))

## [0.3.6](https://github.com/iwasawahideto/kagemusha/compare/v0.3.5...v0.3.6) (2026-05-18)


### Bug Fixes

* Apple Silicon Rosetta 2 warn + remove stale playwright install chromium step ([#30](https://github.com/iwasawahideto/kagemusha/issues/30)) ([78280aa](https://github.com/iwasawahideto/kagemusha/commit/78280aabbc6ace617c056cae9db979355fc31168))

## [0.3.5](https://github.com/iwasawahideto/kagemusha/compare/v0.3.4...v0.3.5) (2026-05-18)


### Bug Fixes

* handle null diffPercentage in Slack notify jq template ([#28](https://github.com/iwasawahideto/kagemusha/issues/28)) ([93fb254](https://github.com/iwasawahideto/kagemusha/commit/93fb2541edcd87841fea2ad2ec1ae6ee6f2d7428))

## [0.3.4](https://github.com/iwasawahideto/kagemusha/compare/v0.3.3...v0.3.4) (2026-05-18)


### Bug Fixes

* upgrade npm to latest for Trusted Publishing support ([#23](https://github.com/iwasawahideto/kagemusha/issues/23)) ([f6eb9af](https://github.com/iwasawahideto/kagemusha/commit/f6eb9afa8357c79858dc84a67b09598626052fac))

## [0.3.3](https://github.com/iwasawahideto/kagemusha/compare/v0.3.2...v0.3.3) (2026-05-18)


### Bug Fixes

* use npm CLI for publish so OIDC Trusted Publishing works ([#21](https://github.com/iwasawahideto/kagemusha/issues/21)) ([48ad54f](https://github.com/iwasawahideto/kagemusha/commit/48ad54fb8ee2db7c488900c5c67e77a846d9f65c))

## [0.3.2](https://github.com/iwasawahideto/kagemusha/compare/v0.3.1...v0.3.2) (2026-05-18)


### Bug Fixes

* use npm Trusted Publishing (OIDC) instead of NPM_TOKEN ([#19](https://github.com/iwasawahideto/kagemusha/issues/19)) ([b7653eb](https://github.com/iwasawahideto/kagemusha/commit/b7653eb7142671368bb5ac755d0859fbf97a4f67))

## [0.3.1](https://github.com/iwasawahideto/kagemusha/compare/v0.3.0...v0.3.1) (2026-05-18)


### Bug Fixes

* use pnpm in prepublishOnly + document commit conventions ([#17](https://github.com/iwasawahideto/kagemusha/issues/17)) ([7c28995](https://github.com/iwasawahideto/kagemusha/commit/7c28995efdf5b09beffc845df5366bd7e1abdb3e))

## [0.3.0](https://github.com/iwasawahideto/kagemusha/compare/v0.2.0...v0.3.0) (2026-05-18)


### Features

* add example app (static HTML) ([dc2d2d9](https://github.com/iwasawahideto/kagemusha/commit/dc2d2d9ba4c4a3198b550d72d482661035428ebd))
* add type definitions ([9b9b7e1](https://github.com/iwasawahideto/kagemusha/commit/9b9b7e14020f1f0e8c34ac19b3d6933565e9f4bc))
* annotation drawing (rect, arrow, label) ([16b7d22](https://github.com/iwasawahideto/kagemusha/commit/16b7d22d26d3caf5fd0d884ac1bf587831e1dc32))
* auto-discover pages by crawling same-origin links ([785bedf](https://github.com/iwasawahideto/kagemusha/commit/785bedf836bf5221b2799fa843f6056c6f904ffb))
* CLI commands (init, run, capture, preview, validate) ([3a88273](https://github.com/iwasawahideto/kagemusha/commit/3a882734cca101c38483dffa571a9d22b00ce968))
* config and definition file loader ([7d173b0](https://github.com/iwasawahideto/kagemusha/commit/7d173b0e08fba9ebb1c2ec611be2049288ea5d1e))
* improve init command ([7645357](https://github.com/iwasawahideto/kagemusha/commit/764535719b3ee45c0b1982805c2b1115329625a6))
* introduce release-please for automated releases ([#13](https://github.com/iwasawahideto/kagemusha/issues/13)) ([475712a](https://github.com/iwasawahideto/kagemusha/commit/475712af3adb423832dda72c943a0e618bb2abe9))
* merge preview into capture --open, fix init prompts ([fe9c96c](https://github.com/iwasawahideto/kagemusha/commit/fe9c96cbe3a31a8bc5f4423b7ca7b01947eff954))
* Playwright screenshot capture engine ([a14d1d1](https://github.com/iwasawahideto/kagemusha/commit/a14d1d197118d392b1181feca21fa902c58d7841))
* S3 upload ([fe50451](https://github.com/iwasawahideto/kagemusha/commit/fe50451af0d24402e83c09b3f54594396c587192))
* switch to playwright-chromium, add local save mode ([dee02c5](https://github.com/iwasawahideto/kagemusha/commit/dee02c526d8be72067dda3be40505d3c52abc84b))
