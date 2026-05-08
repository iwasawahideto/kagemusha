# kagemusha

Auto-update help center screenshots when your code changes.
The shadow warrior for your documentation.

## What it does

When you push code, Kagemusha automatically captures screenshots of your app, detects which screenshots changed visually, and uploads the fresh ones to S3 with stable URLs. No more "is this help article screenshot still up-to-date?".

- **Auto-discover pages** — Crawls your app (SPA routes included) and lets you pick which ones to capture
- **Login once** — Logs in via browser and reuses the session (`storageState`) for all captures
- **Playwright-powered** — Full-page / crop capture, pre-capture actions, element hiding
- **Visual regression** — One command captures, diffs against canonical (S3 or local), and publishes only what changed via [pixelmatch](https://github.com/mapbox/pixelmatch)
- **Visual editor** — Draw rectangles, arrows, and labels; pick crop range by drag
- **S3-first** — Stable URLs you can embed in help articles once and never touch again. S3 IS the canonical truth — git stays clean
- **Local mode** — Optional output dir for testing; never committed to git
- **GitHub Actions ready** — Runs on every merge to main

## Quick Start

```bash
# Install
npm install -D @wasao/kagemusha

# Interactive setup: config → login → discover pages → workflow
npx kagemusha init

# Capture, diff vs canonical, publish what changed (the everyday command)
npx kagemusha capture

# Preview only — no canonical update, no S3 push
npx kagemusha capture --dry-run
```

That's it. **One verb does everything**: capture → diff → publish (skip with `--dry-run`).

## Workflow

### 1. First-time setup — `init`

```bash
npx kagemusha init
```

Walks you through:

1. **Config** — target base URL and save destination (local / S3)
2. **Login** — if the app requires auth, opens a browser so you can sign in manually. The session is saved to `.kagemusha/auth-state.json` and reused afterwards.
3. **Discover** — crawls the app (clicks nav links + BFS on `<a>`) and shows a checklist of found pages
4. **Workflow** — optionally generates `.github/workflows/kagemusha.yml`
5. **Gitignore** — adds `outputDir/`, `.kagemusha/.staging/`, `reports/`, auth files to `.gitignore`

Produces:

```
kagemusha.config.yaml         # base URL, viewport, publish destination
.kagemusha/definitions.json   # one entry per screenshot
.kagemusha/auth-state.json    # saved login state (git-ignored)
.github/workflows/kagemusha.yml
```

### 2. Adding pages later

| Command | Use when |
|---------|----------|
| `npx kagemusha discover` | Re-crawl and pick up newly added routes |
| `npx kagemusha add <path>` | Add a single page manually, e.g. `npx kagemusha add /settings` |
| `npx kagemusha add <path> --id custom-id` | Add a second variant of the same page with a custom ID |
| `npx kagemusha login` | Refresh the login session (run if you get redirected to the login page during capture) |
| `npx kagemusha list` | Inspect the current definitions, grouped by URL |

One page can have multiple screenshots — use `add` with `--id` to stack states (e.g. `dashboard-empty`, `dashboard-with-data`).

### 3. Editing capture range + annotations — `edit`

```bash
npx kagemusha edit --id dashboard
```

Opens the real page in a Playwright browser with a toolbar overlay. Two groups of tools:

**Capture** — what area to screenshot
- **📷 Full** — capture the whole page (default)
- **✂️ Crop** — drag a rectangle on the page; re-drag to replace

**Annotate** — decorations drawn on top of the captured image
- **▭ Rect / → Arrow / T Label** — drag or click to place; drag existing ones to move; Delete to remove

Hit **💾 Save** — both capture range and decorations are written back to `.kagemusha/definitions.json`. The same editor restores everything on next open, so adjusting is iterative.

### 4. Capture — the only verb you need

```bash
npx kagemusha capture                    # capture, diff, push changed/new to canonical
npx kagemusha capture --dry-run          # preview only, no canonical update
npx kagemusha capture --ids a,b          # only those IDs
npx kagemusha capture --threshold 0.001  # 0.1% pixel diff = flagged
npx kagemusha capture --open             # open changed/new results in default viewer
```

What happens:

1. Captures fresh screenshots (with annotations) into `.kagemusha/.staging/` (internal, git-ignored)
2. **Pulls canonical** from the configured destination:
   - `s3` mode: downloads `<id>/latest.png` from S3 into your local `outputDir/` (= the working mirror)
   - `local` mode: reads `outputDir/<id>.png` directly
3. Diffs each staging file against canonical using [pixelmatch](https://github.com/mapbox/pixelmatch)
4. Writes diff visualizations to `reports/diff/<id>.diff.png` for changed files
5. **Default**: for changed/new files only, pushes staging → S3 (or copies into local `outputDir/`). Unchanged files are left alone (history snapshots `<id>/<timestamp>.png` keep prior versions for rollback)
6. **With `--dry-run`**: nothing is published — exit code 1 if any pixel-diff is over threshold (CI gate use case)

Output (default — push happened):

```
🥷 Kagemusha — Capture
  canonical: https://kagemusha.example.com

📸 Capturing 3 screenshot(s) to staging...

  ✓ engagements-overview
  ~ admin-groups (2.34%) → updated
      ↳ reports/diff/admin-groups.diff.png
  + new-page (added to canonical)

changed: 1 / unchanged: 1 / new: 1
```

Output (`--dry-run`):

```
🥷 Kagemusha — Capture (dry-run)
  canonical: https://kagemusha.example.com

  ✓ engagements-overview
  ~ admin-groups (2.34%) → would update
  + new-page (would be added)

changed: 1 / unchanged: 1 / new: 1

Drop --dry-run to update canonical (https://kagemusha.example.com).
```

**Single canonical, kept out of git:**

- For `s3` destination: S3 IS the truth. Local `outputDir/` is just a download mirror, git-ignored
- For `local` destination: `outputDir/` is the truth, also git-ignored — use it for local testing only
- No `baselines/` directory; the canonical store (S3 or outputDir) IS the baseline. S3 history snapshots are kept as `<id>/<timestamp>.png` for rollback

```
<outputDir>/                 # local working mirror (git-ignored)
.kagemusha/.staging/         # internal capture staging (git-ignored)
reports/diff/                # diff visualizations (git-ignored)
```

`init` adds these to `.gitignore` automatically.

## Commands

| Command | Description |
|---------|-------------|
| `kagemusha init` | Interactive setup (config + login + discover + workflow) |
| `kagemusha login` | Open browser and save login session |
| `kagemusha discover` | Re-crawl the app and add newly found pages |
| `kagemusha add <path>` | Add a single screenshot definition |
| `kagemusha list` | List all definitions, grouped by URL |
| `kagemusha edit --id <id>` | Open the visual editor (capture range + annotations) |
| `kagemusha capture` | Capture, diff vs canonical, push changed/new (use `--dry-run` to preview) |
| `kagemusha validate` | Validate config and definition files |
| `kagemusha publish` | Publish to Intercom / Zendesk (coming soon) |

## Definition example

`.kagemusha/definitions.json` is an array of definitions:

```json
[
  {
    "id": "dashboard",
    "name": "dashboard",
    "url": "/dashboard",
    "capture": { "mode": "fullPage" },
    "hideElements": [".intercom-launcher"],
    "decorations": [
      {
        "type": "rect",
        "target": { "x": 32, "y": 120, "width": 310, "height": 120 },
        "style": { "color": "#FF0000", "strokeWidth": 2 }
      }
    ]
  },
  {
    "id": "dashboard-hero",
    "url": "/dashboard",
    "capture": {
      "mode": "crop",
      "crop": { "start": { "x": 0, "y": 0 }, "end": { "x": 1280, "y": 400 } }
    },
    "decorations": []
  }
]
```

You normally won't edit this by hand — `discover` / `add` / `edit` write it for you.

## Deploying to GitHub Actions

To run kagemusha in CI, you need to set up secrets and verify your workflow file.

### 1. Workflow file

`kagemusha init` generates `.github/workflows/kagemusha.yml`. If you've already initialized, verify it exists. For monorepos where kagemusha config lives in a subdirectory, add `defaults.run.working-directory: <subdir>` to the job.

### 2. AWS credentials (for S3 publish)

The IAM identity (user or role) needs `s3:GetObject` / `s3:PutObject` on your bucket. Pick one auth strategy:

**A. Long-lived access keys** (simpler)

\`\`\`bash
gh secret set AWS_ACCESS_KEY_ID --body "AKIA..."
gh secret set AWS_SECRET_ACCESS_KEY --body "..."
\`\`\`

**B. OIDC** (recommended for orgs with established trust policies)

If your org already has a GitHub OIDC provider + IAM Role configured, replace the AWS env vars in the workflow with:

\`\`\`yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::<account-id>:role/<role-name>
      aws-region: ap-northeast-1
\`\`\`

No keys in secrets.

### 3. Login credentials (if your app needs auth)

If you wrote a `.kagemusha/login.mjs` that reads `process.env.EMAIL` / `PASSWORD`:

\`\`\`bash
gh secret set EMAIL --body "ci-bot@example.com"
gh secret set PASSWORD --body "..."
\`\`\`

Pass them to the workflow step (already templated in `kagemusha init`):

\`\`\`yaml
- run: npx kagemusha capture
  env:
    EMAIL: \${{ secrets.EMAIL }}
    PASSWORD: \${{ secrets.PASSWORD }}
\`\`\`

For SSO / MFA cases where login can't be scripted, fall back to `KAGEMUSHA_STORAGE_STATE` (see Authentication section below).

### 4. AWS region

Auto-detected from `publish.cdnBaseUrl` (e.g. `https://bucket.s3.ap-northeast-1.amazonaws.com` → `ap-northeast-1`). No explicit `AWS_REGION` env needed.

### 5. First-time test

Run the workflow manually before relying on the auto trigger:

\`\`\`bash
gh workflow run "Kagemusha - Screenshot Update"
gh run watch
\`\`\`

If it fails, check:
- `gh run view --log-failed` — see step-level errors
- AWS auth: workflow logs should show `Configure AWS credentials` succeeding
- Login: friendly errors from `aws-error.ts` (`✗ AWS authentication failed`)
- Login script: errors from `.kagemusha/login.mjs` will surface in the capture step

## Authentication for login-required apps

There are two ways to handle login:

### Local dev: passing env vars

kagemusha doesn't auto-load `.env`. Pick whichever fits your project:

```bash
# Direct shell export
export EMAIL=demo@example.com
export PASSWORD=local-dev-password
npx kagemusha capture

# Or wrap with dotenv-cli (works with your existing .env)
npx dotenv -e .env -- kagemusha capture

# Or Node 20.6+ built-in
node --env-file=.env $(which kagemusha) capture
```

CI uses GitHub Secrets — same env names, just passed via the workflow's `env:` block (no .env needed).

### Option 1 (recommended): scripted auto-login

Best for **CI** and apps with simple form-based login. `kagemusha init` offers to generate a skeleton at `.kagemusha/login.mjs`:

```js
/** @param {import('playwright-chromium').Page} page */
export const login = async (page) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};
```

Edit the selectors / wait condition for your app. `kagemusha capture` auto-runs this on first invocation when no saved session exists, so CI just needs `kagemusha capture` (no separate login step). `baseURL` is set from `kagemusha.config.yaml`, so relative paths work.

More variations:

```js
// HTTP Basic Auth — no script needed, set in kagemusha.config.yaml:
// auth:
//   httpCredentials: { username: ..., password: ... }
// (coming soon)

// Token-based:
export const login = async (page) => {
  await page.context().setExtraHTTPHeaders({
    Authorization: \`Bearer \${process.env.TOKEN}\`,
  });
};

// Multi-step (e.g. email → check inbox → magic link):
export const login = async (page) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', process.env.EMAIL);
  await page.click('button[type="submit"]');
  // ...fetch the link from a test mailbox API, then navigate to it...
};
```

### Option 2: manual login + storageState (fallback for SSO / MFA)

When scripting login is impossible (SSO, OAuth provider, MFA):

1. Run `kagemusha login` locally — opens a browser, you sign in manually
2. Session is saved to `.kagemusha/auth-state.json`
3. For CI: `base64 -i .kagemusha/auth-state.json | pbcopy` and save as `KAGEMUSHA_STORAGE_STATE` secret
4. CI workflow restores it before capture (commented snippet in the generated `kagemusha.yml`)

## CI pipeline

A typical CI flow (uses scripted login from Option 1):

```yaml
name: Kagemusha
on:
  pull_request:
    types: [closed]
    branches: [main]
  workflow_dispatch:

# Serialize runs so two merges can't race the S3 canonical
concurrency:
  group: kagemusha
  cancel-in-progress: false

jobs:
  update-screenshots:
    if: github.event.pull_request.merged == true || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install chromium

      # capture auto-runs .kagemusha/login.mjs (if present) on first invocation,
      # then pulls canonical from S3, diffs, pushes only what changed.
      - run: npx kagemusha capture
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          EMAIL: ${{ secrets.EMAIL }}
          PASSWORD: ${{ secrets.PASSWORD }}

      # Optional: keep diff visualizations as artifacts for later review
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: kagemusha-diffs
          path: reports/diff/
          if-no-files-found: ignore
```

## Notifications

`kagemusha capture` writes a structured `reports/summary.json` after every run. CI (or any tool) reads it and decides what to notify. There's intentionally no built-in Slack/Discord adapter — `jq` + a webhook is enough, and you keep full control of the message.

### Public API: `reports/summary.json`

Schema versioned and **part of kagemusha's public API** — additive changes go in minor releases, removals/renames in majors.

```json
{
  "schemaVersion": "1",
  "timestamp": "2026-05-08T12:34:56.789Z",
  "dryRun": false,
  "canonical": "https://wevox-help-pages.s3.ap-northeast-1.amazonaws.com",
  "counts": { "changed": 1, "unchanged": 5, "new": 2, "missing": 0 },
  "results": [
    { "id": "engagements-overview", "status": "changed", "reason": "pixel-diff", "diffPercentage": 2.34, "diffPath": "reports/diff/engagements-overview.diff.png" },
    { "id": "admin-groups", "status": "changed", "reason": "layout-diff", "canonical": { "width": 1280, "height": 720 }, "staging": { "width": 1280, "height": 880 } },
    { "id": "new-page", "status": "new" },
    { "id": "dashboard", "status": "unchanged" }
  ]
}
```

### Example: Slack (changed/new only)

In your `.github/workflows/kagemusha.yml`:

```yaml
- run: npx kagemusha capture

- name: Slack notify
  if: always()
  run: |
    [ -f reports/summary.json ] || exit 0
    BODY=$(jq -r '
      [.results[] | select(.status == "changed" or .status == "new")] as $items
      | if ($items | length) == 0 then empty
        else
          "📸 *kagemusha*: \($items | length) screenshot(s)\n" +
          ($items | map(
            if .status == "changed" then
              "~ \(.id) (\(.diffPercentage // .reason))"
            else
              "+ \(.id) (new)"
            end
          ) | join("\n"))
        end
    ' reports/summary.json)
    [ -n "$BODY" ] || exit 0
    curl -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "$(jq -n --arg t "$BODY" '{text: $t}')"
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

`[ -n "$BODY" ] || exit 0` makes the step a no-op when nothing changed. The generated workflow template includes this commented out — uncomment + set the secret to enable.

### Example: Discord (same payload, different key)

```yaml
- name: Discord notify
  if: always()
  run: |
    [ -f reports/summary.json ] || exit 0
    BODY=$(jq -r '...' reports/summary.json)  # same as Slack
    [ -n "$BODY" ] || exit 0
    curl -X POST "$DISCORD_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "$(jq -n --arg c "$BODY" '{content: $c}')"
  env:
    DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

### Example: GitHub PR comment

```yaml
- name: PR comment
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      if (!fs.existsSync('reports/summary.json')) return;
      const r = JSON.parse(fs.readFileSync('reports/summary.json', 'utf8'));
      const items = r.results.filter(x => x.status === 'changed' || x.status === 'new');
      if (items.length === 0) return;
      const body = `## 📸 kagemusha\n\n` + items.map(x =>
        x.status === 'changed' ? `- ~ \`${x.id}\` (${x.diffPercentage?.toFixed(2) ?? x.reason}%)` : `- + \`${x.id}\` (new)`
      ).join('\n');
      await github.rest.issues.createComment({
        ...context.repo,
        issue_number: context.issue.number,
        body,
      });
```

### Local debugging

`reports/summary.json` is written every run, including local. Inspect with:

```bash
cat reports/summary.json | jq '.counts'
cat reports/summary.json | jq '.results[] | select(.status == "changed")'
```

## Positioning

**kagemusha is NOT a PR-gating VRT tool.** For per-commit baselines and PR diff review with hosted HTML reports, use [reg-suit](https://github.com/reg-viz/reg-suit), [Chromatic](https://www.chromatic.com/), or [Percy](https://percy.io/).

kagemusha is for **post-merge auto-update of help center screenshots**, where:
- Stable embeddable URLs matter more than per-commit baseline correctness
- One config + one command should cover capture, diff, and publish
- The canonical IS the served asset — no separate baseline-vs-published split

## Try it locally

```bash
cd example
pnpm install            # or `npm install`, or `bun install`
pnpm run serve          # Start sample app
npx kagemusha init      # Set up kagemusha
npx kagemusha capture --open
```

## Roadmap

- [x] Screenshot capture with Playwright
- [x] Annotations (rect, arrow, label)
- [x] S3 upload with stable URLs
- [x] Auto-discover pages (SPA-aware BFS crawl)
- [x] Login via browser (`storageState`) + scripted CI auto-login (`.kagemusha/login.mjs`)
- [x] Visual editor for capture range (fullPage / crop)
- [x] **Visual regression — unified `capture` command (publish by default, `--dry-run` to preview)**
- [ ] HTML diff report (side-by-side, hosted as CI artifact)
- [ ] Stabilization helpers (clock freezing, animation off, mask regions)
- [ ] Slack / PR notifications with affected article IDs
- [ ] Intercom / Zendesk auto-patching
- [ ] LLM-powered diff descriptions ("what changed in plain English")

## License

MIT
