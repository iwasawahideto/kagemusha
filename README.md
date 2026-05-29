# kagemusha

Auto-update help center screenshots when your code changes.
The shadow warrior for your documentation.

## What it does

`kagemusha capture` walks your app with Playwright, diffs each screenshot against the canonical version on S3, and pushes only what changed. Your help articles embed a stable URL once and the image refreshes itself on every merge to main.

- **One verb (`capture`)** — capture → diff → push, all in one command
- **S3-first** — `<id>/latest.png` is the canonical, embedded directly into help articles
- **Component-level capture** — Playwright-powered, full-page / crop, pre-capture actions, element hiding
- **Visual editor** — draw rectangles, arrows, labels; pick crop range by drag (`kagemusha edit`)
- **Login once** — store `storageState` locally, or run a scripted login on every CI run
- **Slack-ready** — `reports/summary.json` ships immutable per-run URLs so notifications include image previews that don't break later

## Quick Start

```bash
npm install -D @wasao/kagemusha

# Interactive setup: config → login → discover pages → workflow
npx kagemusha init

# Capture, diff vs canonical, publish what changed
npx kagemusha capture

# Preview only — no canonical update
npx kagemusha capture --dry-run
```

## Commands

| Command | Description |
|---|---|
| `kagemusha init` | Interactive setup (config + login + discover + workflow) |
| `kagemusha login` | Refresh the saved login session (interactive or scripted) |
| `kagemusha discover` | Re-crawl the app and add newly-found pages to definitions |
| `kagemusha add <path>` | Add a single screenshot definition |
| `kagemusha list` | List all definitions |
| `kagemusha edit --id <id>` | Open the visual editor (crop range + annotations) |
| `kagemusha capture` | Capture → diff → publish (use `--dry-run` to preview) |
| `kagemusha validate` | Validate config and definition files |

## Configuration

`init` generates these files:

```
kagemusha.config.yaml         # base URL, viewport, publish destination
.kagemusha/definitions.json   # one entry per screenshot
.kagemusha/login.mjs          # optional scripted login (CI-friendly)
.github/workflows/kagemusha.yml
```

`kagemusha.config.yaml`:

```yaml
app:
  baseUrl: https://your-app.example.com
screenshot:
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 }
  defaultDiffThreshold: 0.005   # 0.5% pixel diff = flagged
publish:
  destination: s3               # or "local" for testing
  cdnBucket: your-bucket
  cdnBaseUrl: https://your-bucket.s3.ap-northeast-1.amazonaws.com
```

Definition (`.kagemusha/definitions.json`):

```json
[
  {
    "id": "dashboard",
    "url": "/dashboard",
    "capture": { "mode": "fullPage" },
    "hideElements": [".intercom-launcher"],
    "decorations": [
      { "type": "rect", "target": { "x": 32, "y": 120, "width": 310, "height": 120 } }
    ]
  }
]
```

Run `kagemusha edit --id dashboard` to set the crop range and add decorations visually.

## Avoiding loading-state screenshots

After `page.goto` kagemusha waits for `load` event + 3s of best-effort `networkidle` + 500ms hydration buffer. This handles most pages; SPAs with component-level skeletons may still capture mid-loading. Add a `beforeCapture` step per definition:

```json
{
  "id": "analytics-overview",
  "url": "/analytics/overview",
  "beforeCapture": [
    { "action": "waitForSelector", "selector": "text=Overview", "timeout": 15000 },
    { "action": "wait", "ms": 3000 }
  ]
}
```

Wait for a known page-specific element (page title, chart canvas, first table row, etc.), then a short buffer. Playwright's `text=` selector matches any rendered text.

## Authentication

If your app needs login, `init` generates a `.kagemusha/login.mjs` skeleton:

```js
/** @param {import('playwright-core').Page} page */
export const login = async (page) => {
  await page.goto("/login");
  // Pick env names that fit your project (NOT EMAIL/PASSWORD, NOT KAGEMUSHA_*).
  await page.fill('input[name="email"]', process.env.MY_APP_EMAIL ?? "");
  await page.fill('input[name="password"]', process.env.MY_APP_PASSWORD ?? "");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};
```

`kagemusha capture` auto-runs this on first invocation when no saved session exists, so CI just needs `npx kagemusha capture` — no separate login step. `baseURL` is set from your config, so relative paths work.

For SSO / MFA / OAuth where scripting is impossible: run `kagemusha login` locally to save `.kagemusha/auth-state.json`, then `base64 -i .kagemusha/auth-state.json | pbcopy` and store the result as a `KAGEMUSHA_STORAGE_STATE` GitHub Secret. The generated workflow shows the restore step (commented out).

## Deploying to GitHub Actions

`init` generates `.github/workflows/kagemusha.yml`. Required secrets:

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — IAM with `s3:GetObject` and `s3:PutObject` on your bucket, or use OIDC with `aws-actions/configure-aws-credentials@v4`
- Login credentials (named whatever your `login.mjs` reads)
- `SLACK_WEBHOOK_URL` — optional, see Notifications below

Region is auto-detected from `publish.cdnBaseUrl` (`*.s3.<region>.amazonaws.com`), so no `AWS_REGION` env needed.

The workflow triggers on `push: main` and runs `kagemusha capture` automatically.

## Notifications

`kagemusha capture` writes `reports/summary.json` with image URLs (when destination is S3 and a real push happened):

```json
{
  "schemaVersion": "2",
  "timestamp": "2026-05-15T12:34:56.789Z",
  "dryRun": false,
  "canonical": "https://your-bucket.s3.ap-northeast-1.amazonaws.com",
  "counts": { "changed": 1, "unchanged": 5, "new": 2, "missing": 0 },
  "results": [
    {
      "id": "engagements-overview",
      "status": "changed",
      "reason": "pixel-diff",
      "diffPercentage": 2.34,
      "urls": {
        "history": "https://.../engagements-overview/history/2026-05-15T12-34-56.789Z.png",
        "previousHistory": "https://.../engagements-overview/history/2026-05-08T09-12-03.456Z.png"
      }
    },
    {
      "id": "new-page",
      "status": "new",
      "urls": {
        "history": "https://.../new-page/history/2026-05-15T12-34-56.789Z.png"
      }
    },
    { "id": "dashboard", "status": "unchanged" }
  ]
}
```

### About the URLs

Both `urls.history` and `urls.previousHistory` are **immutable per-run URLs** under `<id>/history/<timestamp>.png`. Use them anywhere the link will be viewed later — Slack/Intercom/email notifications, help-article embeds, PR comments. Image proxies (Slack `slack-imgs.com`, Intercom, etc.) cache by URL, so the URL must identify a stable image; that's why kagemusha publishes only immutable URLs in `summary.json`.

The history objects ship with `Cache-Control: public, max-age=31536000, immutable` so proxies and CDNs cache them aggressively — old Slack messages load their preview instantly without revalidating against S3.

`previousHistory` is undefined on the first push for an id (no prior run exists). It's also undefined on the v1→v2 migration push for an id that already had v1 history (the prior `latest.png` carries no timestamp metadata) — the next push reverts to normal.

The schema is **part of kagemusha's public API** — additive changes stay on the current `schemaVersion`, removals/renames bump it. kagemusha intentionally does not publish a pre-rendered diff image; consumers compare history vs previousHistory raw images (= Slack auto-unfurls both side by side).

> **Migration from v1 → v2**: `urls.before` and `urls.after` were removed (they pointed at mutable URLs with proxy-cache pitfalls). Use `urls.previousHistory` / `urls.history` instead, and **update `.kagemusha/notify-slack.jq`** from [`templates/notify-slack.jq`](templates/notify-slack.jq) — otherwise Slack messages will lose image previews. Existing `<id>/previous.png` objects in your bucket are no longer maintained and can be safely deleted.

Slack notification (the generated workflow includes this; just set `SLACK_WEBHOOK_URL`):

```yaml
- name: Slack notify
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  run: |
    [ -n "$SLACK_WEBHOOK_URL" ] || exit 0
    jq -c -f .kagemusha/notify-slack.jq reports/summary.json | while IFS= read -r payload; do
      [ -z "$payload" ] && continue
      curl -sS -X POST "$SLACK_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        --data "$payload"
    done
```

One message per changed/new screenshot — Slack unfurls the history URLs per-message, so each post shows its own image previews instead of a single message that just lists URLs as plain text.

The message format is defined in `.kagemusha/notify-slack.jq` (generated by `kagemusha init`). Each line of jq output becomes one Slack `chat.postMessage` body, so you can customize freely (add `blocks`, override `channel`, etc). Test locally:

```bash
jq -c -f .kagemusha/notify-slack.jq reports/summary.json
```

The same `summary.json` works for Discord (swap `text` → `content`) or PR comments via `actions/github-script` — copy the jq file and tweak.

## Positioning

**kagemusha is NOT a PR-gating VRT tool.** For per-commit baselines and PR diff review with hosted HTML reports, use [reg-suit](https://github.com/reg-viz/reg-suit), [Chromatic](https://www.chromatic.com/), or [Percy](https://percy.io/).

kagemusha is for **post-merge auto-update of help center screenshots**, where stable embeddable URLs matter more than per-commit baseline correctness.

## Releasing

Automated via [release-please](https://github.com/googleapis/release-please).

1. **Write PRs with [Conventional Commits](https://www.conventionalcommits.org/) titles**:
   - `feat: ...` → minor bump (= 0.2.0 → 0.3.0)
   - `fix: ...` → patch bump (= 0.2.0 → 0.2.1)
   - `feat!: ...` or `BREAKING CHANGE:` in body → major (= 1.0.0+)
   - `chore: ...` / `docs: ...` → no version bump
   - Squash merge propagates the PR title as the commit on `main`.
2. **release-please opens a "Release PR" automatically** whenever there's anything to release. It bumps `package.json`, updates `.release-please-manifest.json`, and regenerates `CHANGELOG.md`.
3. **Merge the Release PR** → release-please tags `v0.X.Y` and publishes a GitHub Release.
4. **`release.yml` triggers on `release: published`** → builds and runs `pnpm publish --provenance` to npm. Requires the `NPM_TOKEN` secret.

The `kagemusha` CLI reads its version from `package.json` at runtime, so release-please only needs to touch one file.

## License

MIT
