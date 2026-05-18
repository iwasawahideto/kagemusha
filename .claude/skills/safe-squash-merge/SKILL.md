---
name: safe-squash-merge
version: 1.0.0
description: "release-please 環境で PR を squash merge する前に PR title / body をチェックし、必要なら修正してから merge する。誤った Conventional Commits prefix で main commit を汚すのを防ぐ。"
---

kagemusha は **squash merge 一択 + commit title = PR title** に設定されている (= repo settings)。
release-please は main 上の commit message を解析して次の release を決めるので、PR title が
誤った Conventional Commits prefix だと release が起きない / 意図しない bump になる。

この skill は merge 前に PR title / body を検証し、必要に応じて修正して **squash merge** する。

## 手順

### 1. PR 特定

引数で PR 番号 / URL を受け取る。指定なしなら現在ブランチから推定:

```bash
gh pr view <num-or-url-or-branch> --json number,title,body,headRefName,baseRefName,mergeStateStatus,state
```

PR が見つからなければ user に「branch から PR を作って」と促す。

### 2. PR title の Conventional Commits 検証

正規表現でチェック:

```bash
TITLE="<PR title>"
if echo "$TITLE" | grep -qE '^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.+\))?!?: .+'; then
  echo "OK"
else
  echo "NG"
fi
```

許可される prefix:

| Prefix | release-please の挙動 | 用途 |
|---|---|---|
| `feat:` | minor bump | 新機能追加 |
| `fix:` | patch bump | bug fix |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` (body) | major bump (1.0+) | 破壊的変更 |
| `chore:` / `docs:` / `style:` / `refactor:` / `perf:` / `test:` / `build:` / `ci:` / `revert:` | bump なし | 機能変更なし |

`(scope)` は optional (例: `feat(editor): ...`)。

NG なら user に「正しい prefix は?」と提案。kagemusha 領域別の scope サジェスト:

- editor 関連 → `feat(editor):` / `fix(editor):`
- capture 関連 → `feat(capture):` / `fix(capture):`
- workflow / CI 関連 → `ci:` / `chore(ci):`
- README / docs → `docs:`

### 3. PR body の検証

squash merge で **PR body が commit message 本文 + CHANGELOG body に展開される** (= repo settings で `PR_BODY` 指定)。release notes として読める内容かチェック:

- 空 (= `null` または 空文字) → NG、最低限の Summary を書くよう促す
- `🤖 Generated with [Claude Code]` フッターだけ → NG、本文を書くよう促す
- 長すぎる (= 数千行の internal note 等) → 警告、release notes として読めるか確認

理想的な構成 (= user に提案する template):

```markdown
## Summary

<1-2 文で「何を変えたか / なぜ」>

## 変更

- <変更点 1>
- <変更点 2>

## Test plan (optional)

- [ ] ...

## Migration (optional, breaking change の時)

- ...
```

### 4. 修正

検証で NG が出た時、user に確認してから `gh pr edit` で update:

```bash
gh pr edit <pr-number> --title "feat: 新しいタイトル"
gh pr edit <pr-number> --body-file /tmp/new-body.md
```

修正後は再度 step 2-3 を実行して OK を確認。

### 5. マージ前の最終確認

```bash
gh pr view <pr-number> --json mergeStateStatus,statusCheckRollup,mergeable
```

- `mergeStateStatus`: `CLEAN` / `BLOCKED` / `BEHIND` 等
- `statusCheckRollup`: CI status
- `mergeable`: `MERGEABLE`

`CLEAN` + `MERGEABLE` + 全 CI green でなければ user に修正を促す。

### 6. squash merge 実行

```bash
gh pr merge <pr-number> --squash
```

`--auto` は付けない (= 即時 merge する想定)。

repo settings で squash 一択 + title=PR_TITLE + message=PR_BODY が設定済みなので、
merge 後の main commit は **「PR title (#番号)」+ PR body** になる。

### 7. release-please の起動確認

merge 後、release.yml workflow が main で trigger される:

```bash
sleep 5
gh run list --workflow=release.yml --limit 1 --json databaseId,status,conclusion,event
```

`jobs.release-please` が走って Release PR が auto-create されるかを user に通知:

```bash
sleep 30  # release-please-action の処理待ち
gh pr list --label "autorelease: pending" --json number,title
```

Release PR が出現してれば「release-please が動作した」シグナル。user に「Release PR をマージすれば v0.X.Y が npm に公開される」を案内。

`feat:` / `fix:` / breaking 系でない PR (= `chore:` 等) の場合は Release PR は作られない (= 正常)。

## 失敗時の対応

| 症状 | 原因 | 対応 |
|---|---|---|
| `gh pr merge` で "not mergeable" | CI fail / conflict / branch protection 未満足 | `gh pr view` で詳細確認 → 修正 |
| squash merge ボタンが押せない | repo settings で許可されてない | `gh api -X PATCH repos/$OWNER/$REPO -F allow_squash_merge=true` |
| merge 後に Release PR が出ない | commit title が Conventional Commits prefix を満たしてない | `gh api repos/$OWNER/$REPO/commits/main` で commit message 確認、Conventional Commits 違反なら手で main に Conventional Commits commit を 1 つ足す (= 修正 PR を作る) |
| Release PR は出たが bump level が想定と違う | commit prefix の解釈ミス (= `feat:` と思ったら `chore:` だった) | 該当 commit を理解、必要なら追加 commit で正しい prefix の Conventional Commits を main に push |

## 注意事項

- **kagemusha の repo settings は squash 一択 + PR_TITLE/PR_BODY 固定**: settings 変更は `gh api -X PATCH repos/$OWNER/$REPO -F squash_merge_commit_title=PR_TITLE -F squash_merge_commit_message=PR_BODY`
- **過去の emoji prefix commit は release-please に無視される**: `✨` / `🐛` / `♻️` で始まる commit は Conventional Commits 形式ではないので release-please の解析対象外
- **breaking change を含む場合**: `!` suffix (例 `feat!:`) を付けるか、PR body に `BREAKING CHANGE: ...` の paragraph を書く。1.0 未満は minor で許容される (= `feat:` のみで OK)、1.0 以降は厳格に
- **dry-run したい**: `gh pr edit` 前に title / body を `/tmp/preview.md` 等に書いて確認、OK なら apply
