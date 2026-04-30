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

# Dry-run: capture, diff vs canonical, show what would change
npx kagemusha capture

# Apply: update canonical (S3 push or local outputDir) for changed/new files
npx kagemusha capture --apply
```

That's it. **One verb does everything**: capture → diff → (optionally) publish.

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
npx kagemusha capture                  # dry-run: capture to staging, diff vs canonical
npx kagemusha capture --apply          # update canonical for changed/new only
npx kagemusha capture --ids a,b        # only those IDs
npx kagemusha capture --threshold 0.001  # 0.1% pixel diff = flagged
npx kagemusha capture --open           # open changed/new results in default viewer
```

What happens:

1. Captures fresh screenshots (with annotations) into `.kagemusha/.staging/` (internal, git-ignored)
2. **Pulls canonical** from the configured destination:
   - `s3` mode: downloads `<id>/latest.png` from S3 into your local `outputDir/` (= the working mirror)
   - `local` mode: reads `outputDir/<id>.png` directly
3. Diffs each staging file against canonical using [pixelmatch](https://github.com/mapbox/pixelmatch)
4. Writes diff visualizations to `reports/diff/<id>.diff.png` for changed files
5. **Without `--apply`**: dry-run only — canonical is untouched, exit code 1 if any pixel-diff is over threshold
6. **With `--apply`**: for changed/new files only, copies staging → outputDir and pushes to S3 (if S3 mode). Unchanged files are left alone

Output looks like:

```
🥷 Kagemusha — Capture
  canonical: https://kagemusha.example.com

📸 Capturing 3 screenshot(s) to staging...

  ✓ engagements-overview
  ~ admin-groups (2.34%) → would update
      ↳ reports/diff/admin-groups.diff.png
  + new-page (would be added)

changed: 1 / unchanged: 1 / new: 1

Run with --apply to update canonical (https://kagemusha.example.com) for changed files.
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
| `kagemusha capture` | Capture, diff vs canonical, optionally `--apply` to publish changed |
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

## CI pipeline

A typical CI flow:

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

      # Restore login session from a base64-encoded GitHub Secret
      - name: Restore login session
        if: env.KAGEMUSHA_STORAGE_STATE != ''
        run: |
          mkdir -p .kagemusha
          echo "$KAGEMUSHA_STORAGE_STATE" | base64 --decode > .kagemusha/auth-state.json
        env:
          KAGEMUSHA_STORAGE_STATE: ${{ secrets.KAGEMUSHA_STORAGE_STATE }}

      # capture --apply: pulls canonical from S3, diffs against fresh capture,
      # pushes only what changed back to S3. No screenshots/ commit needed.
      - run: npx kagemusha capture --apply
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      # Optional: keep diff visualizations as artifacts for later review
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: kagemusha-diffs
          path: reports/diff/
          if-no-files-found: ignore
```

For login-required apps:
1. Run `kagemusha login` locally
2. `base64 -i .kagemusha/auth-state.json | pbcopy`
3. Save as a GitHub Secret named `KAGEMUSHA_STORAGE_STATE`

(Plain auto-login via email/password is still on the roadmap.)

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
npx kagemusha capture --apply --open
```

## Roadmap

- [x] Screenshot capture with Playwright
- [x] Annotations (rect, arrow, label)
- [x] S3 upload with stable URLs
- [x] Auto-discover pages (SPA-aware BFS crawl)
- [x] Login via browser (`storageState`)
- [x] Visual editor for capture range (fullPage / crop)
- [x] **Visual regression — unified `capture` command (dry-run + `--apply`)**
- [ ] HTML diff report (side-by-side, hosted as CI artifact)
- [ ] Stabilization helpers (clock freezing, animation off, mask regions)
- [ ] Slack / PR notifications with affected article IDs
- [ ] Intercom / Zendesk auto-patching
- [ ] LLM-powered diff descriptions ("what changed in plain English")

## License

MIT
