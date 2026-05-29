# kagemusha

## コーディング規約

- `function` 宣言は使わず、`const` + アロー関数で書く
  ```ts
  // NG
  function foo(x: number): string { ... }

  // OK
  const foo = (x: number): string => { ... };
  ```

## コミット規約 (Conventional Commits)

リリースは [release-please](https://github.com/googleapis/release-please) で自動化されている。release-please は main の commit message を解析して次の release を決めるので、**PR title を Conventional Commits 形式で書く** (= squash merge で PR title が main の commit になる)。

### 許可される prefix と release-please の挙動

| Prefix | bump | 用途 |
|---|---|---|
| `feat:` | minor (= 0.X.0 → 0.X+1.0) | 新機能 |
| `fix:` | patch (= 0.X.Y → 0.X.Y+1) | バグ修正 |
| `feat!:` / `fix!:` / 本文に `BREAKING CHANGE:` | major (= 1.0+ 移行後) | 破壊的変更 |
| `chore:` / `docs:` / `style:` / `refactor:` / `perf:` / `test:` / `build:` / `ci:` / `revert:` | なし | リファクタ・ドキュメント・CI など |

scope は optional (例: `feat(editor): ...`)。kagemusha の主な scope:

- `editor` — `src/editor/inject-script/` 関連
- `capture` — `src/lib/screenshot.ts` / `src/commands/capture.ts`
- `config` / `init` — config 周り
- `ci` — `.github/workflows/`
- `docs` — README / CLAUDE.md

### 注意

- **過去の emoji prefix commit** (= `✨` / `🐛` / `♻️`) は release-please に認識されない。今後は必ず Conventional Commits を使う
- **0.x 期間中**は `feat:` (minor) に breaking change を含めても許容される (= semver 仕様)。1.0 以降は厳格に `feat!:` / `fix!:` で示す
- merge 前のチェックは [safe-squash-merge skill](.claude/skills/safe-squash-merge/SKILL.md) を `/safe-squash-merge <PR番号>` で起動すると自動化される

## 公開 API

以下は **公開 API**。ユーザーが直接依存するので、変更時は意識的に。

### 1. `reports/summary.json`

CI の jq クエリ等で parse される。

- **`SUMMARY_SCHEMA_VERSION`** (= `src/commands/capture.ts`) を bump する
  - **field 追加のみ**: そのまま (`"1"` 維持) — 既存クエリは壊れない
  - **field 削除 / rename / 型変更**: `"1"` → `"2"` に bump (= breaking)
- README「Notifications > Public API: `reports/summary.json`」セクションも同期更新

現行 fields (= schemaVersion 2):
- top level: `schemaVersion`, `timestamp`, `dryRun`, `canonical`, `counts`, `results`
- `results[]`: `id`, `status` ("unchanged" | "new" | "missing" | "changed")
- `results[].status === "changed"`: `reason` ("pixel-diff" | "layout-diff"), 各 reason 固有 fields
- `results[].urls?`: `{ history, previousHistory? }` — S3 destination + 実 push 時のみ存在
  - `history` = immutable な今回 run の URL（通知/埋め込み用、`history/<timestamp>.png`）
  - `previousHistory` = immutable な前回 run の URL（初回 push or v1→v2 migration 時は undefined）
  - `latest.png` は kagemusha 内部の diff baseline 用に S3 に存在するが、**public API には出さない**（mutable URL を埋め込んでほしくないため）

### 2. `.kagemusha/login.mjs` の引数 shape

ユーザーが書く login script は `(page: Page) => Promise<void>` を export する契約。

- 引数の型 (= Playwright `Page`) を変える、または事前に context に何を applied しておくか (`baseURL` / `storageState` / `viewport` 等) を変えるのは **breaking change**
- README「Authentication > Option 1」を同期更新
- skeleton (`generateLoginSkeleton` in `src/commands/init.ts`) も合わせて更新

### 3. `KagemushaConfig` (= `kagemusha.config.yaml`)

- field の **追加** (optional として) は OK
- field の **削除 / rename / 必須化** は breaking
- 削除する場合: 一定期間 deprecation warning を出してから消す

### 4. CLI フラグ

- `--dry-run` / `--ids` / `--threshold` / `--open` / `--headed` 等
- 追加は OK、rename / 削除は breaking

---

### 共通ルール

- breaking change を含む release は kagemusha 自体も **major bump**
  (`0.x` 期間は exception 多いが、`1.0` 以降は厳格に semver)
- README とコードの説明を**必ず同期**させる (= 食い違うと user が混乱)

このルールは README にも書いてあるが、コードを触る AI / 開発者が見落としやすいので CLAUDE.md にも明示。
