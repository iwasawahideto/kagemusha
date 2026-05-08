# kagemusha

## コーディング規約

- `function` 宣言は使わず、`const` + アロー関数で書く
  ```ts
  // NG
  function foo(x: number): string { ... }

  // OK
  const foo = (x: number): string => { ... };
  ```

## 公開 API

以下は **公開 API**。ユーザーが直接依存するので、変更時は意識的に。

### 1. `reports/summary.json`

CI の jq クエリ等で parse される。

- **`SUMMARY_SCHEMA_VERSION`** (= `src/commands/capture.ts`) を bump する
  - **field 追加のみ**: そのまま (`"1"` 維持) — 既存クエリは壊れない
  - **field 削除 / rename / 型変更**: `"1"` → `"2"` に bump (= breaking)
- README「Notifications > Public API: `reports/summary.json`」セクションも同期更新

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
