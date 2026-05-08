# kagemusha

## コーディング規約

- `function` 宣言は使わず、`const` + アロー関数で書く
  ```ts
  // NG
  function foo(x: number): string { ... }

  // OK
  const foo = (x: number): string => { ... };
  ```

## 公開 API のバージョニング

`reports/summary.json` は kagemusha の **公開 API**。consumer (= ユーザーの CI / jq クエリ) が依存しているので、schema を変更する時は必ず以下を守る:

- **`SUMMARY_SCHEMA_VERSION`** (= `src/commands/capture.ts`) を bump する
  - **field 追加のみ**: そのまま (`"1"` 維持) — consumer の既存クエリは壊れない
  - **field 削除 / rename / 型変更**: `"1"` → `"2"` に bump (= breaking)
- README の「Notifications > Public API: `reports/summary.json`」セクションも同期して更新
- breaking change 時は kagemusha 自体も major bump (`0.x → 1.0` 後は `1.x → 2.0`) を検討

このルールは README に書いてあるが、コードを触る AI / 開発者が見落としやすいので CLAUDE.md にも明示。
