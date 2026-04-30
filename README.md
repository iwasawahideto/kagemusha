# kagemusha

Auto-update help center screenshots when your code changes.
The shadow warrior for your documentation.

## What it does

When you push code, Kagemusha automatically captures screenshots of your app, detects which screenshots changed visually, and uploads the fresh ones to S3 with stable URLs. No more "is this help article screenshot still up-to-date?".

- **Auto-discover pages** — Crawls your app (SPA routes included) and lets you pick which ones to capture
- **Login once** — Logs in via browser and reuses the session (`storageState`) for all captures
- **Playwright-powered** — Full-page / crop capture, pre-capture actions, element hiding
- **Visual regression** — Pixel diff against baselines (powered by [odiff](https://github.com/dmtrKovalenko/odiff)), flags only what visually changed
- **Visual editor** — Draw rectangles, arrows, and labels; pick crop range by drag
- **S3 upload** — Stable URLs you can embed in help articles once and never touch again
- **Local mode** — Save screenshots locally for review before uploading
- **GitHub Actions ready** — Runs on every merge to main

## Quick Start

```bash
# Install
npm install -D @wasao/kagemusha

# Interactive setup: config → login → discover pages → workflow
npx kagemusha init

# Capture screenshots locally
npx kagemusha capture

# Compare against baselines (= what changed visually?)
npx kagemusha compare

# Run full pipeline (capture + upload)
npx kagemusha run
```

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

### 4. Capture

```bash
npx kagemusha capture                 # capture everything
npx kagemusha capture --ids a,b,c     # capture specific IDs
npx kagemusha capture --ids a --open  # open the result in default viewer
```

Output goes to `screenshots/<id>.png`.

### 5. Compare against baselines (VRT) — `compare`

```bash
npx kagemusha compare                          # diff screenshots/ vs baselines/
npx kagemusha compare --ids a,b                # only those IDs
npx kagemusha compare --threshold 0.001        # 0.1% pixel diff = flagged
npx kagemusha compare --update-baseline        # adopt current as new baseline
```

What happens:

- Compares `screenshots/<id>.png` against `baselines/<id>.png` using [odiff](https://github.com/dmtrKovalenko/odiff)
- If a baseline is missing, the current screenshot is adopted as the baseline (status: `new`)
- If they differ, a diff visualization is written to `reports/diff/<id>.diff.png`
- Returns exit code 1 if any screenshot exceeds the threshold (perfect for CI fail-on-change)

Output looks like:

```
🥷 Kagemusha — Compare

  ✓ engagements-overview
  ✗ admin-groups (2.34%)
      ↳ reports/diff/admin-groups.diff.png
  + new-page (new baseline)

changed: 1 / unchanged: 1 / new: 1
```

**Recommended directory layout (in your repo)**:

```
screenshots/         # capture output (git-ignored)
baselines/           # commit these — PR review shows image diff naturally
reports/diff/        # diff visualizations (git-ignored)
```

Add to `.gitignore`:

```
screenshots/
reports/
.kagemusha/auth-state.json
.kagemusha/auth-meta.json
```

Keep `baselines/` **tracked** so PR reviewers can eyeball changes inline.

### 6. Publish

```bash
npx kagemusha run    # capture + upload to S3 (uses config.publish)
```

Once a screenshot is at a stable S3 URL, your help article can embed that URL once and never touch it again — every successful `kagemusha run` swaps the image at that URL.

## Commands

| Command | Description |
|---------|-------------|
| `kagemusha init` | Interactive setup (config + login + discover + workflow) |
| `kagemusha login` | Open browser and save login session |
| `kagemusha discover` | Re-crawl the app and add newly found pages |
| `kagemusha add <path>` | Add a single screenshot definition |
| `kagemusha list` | List all definitions, grouped by URL |
| `kagemusha edit --id <id>` | Open the visual editor (capture range + annotations) |
| `kagemusha capture` | Capture screenshots only |
| `kagemusha compare` | Diff current screenshots against baselines (VRT) |
| `kagemusha run` | Full pipeline: capture + upload |
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

## CI pipeline (capture → compare → publish)

A typical CI flow:

```yaml
name: Kagemusha
on:
  pull_request:
    types: [closed]
    branches: [main]
  workflow_dispatch:

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

      - run: npx kagemusha capture
      - run: npx kagemusha compare       # exit 1 if anything changed
        continue-on-error: true          # don't fail the job — let the next step decide
      - run: npx kagemusha run           # capture again + S3 upload (only if you want to auto-publish)
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

For login-required apps:
1. Run `kagemusha login` locally
2. `base64 -i .kagemusha/auth-state.json | pbcopy`
3. Save as a GitHub Secret named `KAGEMUSHA_STORAGE_STATE`

(Plain auto-login via email/password is still on the roadmap.)

## Try it locally

```bash
cd example
bun install
bun run serve          # Start sample app
bunx kagemusha init    # Set up kagemusha
bunx kagemusha capture --open
```

## Roadmap

- [x] Screenshot capture with Playwright
- [x] Annotations (rect, arrow, label)
- [x] S3 upload with stable URLs
- [x] Auto-discover pages (SPA-aware BFS crawl)
- [x] Login via browser (`storageState`)
- [x] Visual editor for capture range (fullPage / crop)
- [x] **Visual regression testing (VRT) — `compare` command**
- [ ] Stabilization helpers (clock freezing, animation off, mask regions)
- [ ] Slack / PR notifications with affected article IDs
- [ ] Intercom / Zendesk auto-patching
- [ ] LLM-powered diff descriptions ("what changed in plain English")

## License

MIT
