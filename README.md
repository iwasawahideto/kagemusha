# kagemusha

Auto-update help center screenshots when your code changes.
The shadow warrior for your documentation.

## What it does

When you push code, Kagemusha automatically captures screenshots of your app and uploads them to S3. No more manually taking screenshots and updating help articles.

- **Auto-discover pages** — Crawls your app (SPA routes included) and lets you pick which ones to capture
- **Login once** — Logs in via browser and reuses the session (`storageState`) for all captures
- **Playwright-powered** — Full-page / element / crop capture, pre-capture actions, element hiding
- **Visual editor** — Draw rectangles, arrows, and labels; also pick capture range by hovering / dragging
- **S3 upload** — Screenshots are uploaded with stable URLs for embedding in help centers
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

# Run full pipeline (capture → upload)
npx kagemusha run
```

## Workflow

### 1. First-time setup — `init`

```bash
npx kagemusha init
```

Walks you through:

1. **Config** — target base URL and save destination (local / S3)
2. **Login** — if the app requires auth, opens a browser so you can sign in manually. The session is saved to `.kagemusha/auth/storageState.json` and reused afterwards.
3. **Discover** — crawls the app (clicks nav links + BFS on `<a>`) and shows a checklist of found pages
4. **Workflow** — optionally generates `.github/workflows/kagemusha.yml`

Produces:

```
kagemusha.config.yaml         # base URL, viewport, publish destination
.kagemusha/definitions.json   # one entry per screenshot
.kagemusha/auth/              # saved login state (git-ignored)
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
- **🎯 Element** — hover to outline elements, click to pick one; the generated selector is shown in an editable text field
- **✂️ Crop** — drag a rectangle on the page; re-drag to replace

**Annotate** — decorations drawn on top of the captured image
- **▭ Rect / → Arrow / T Label** — drag or click to place; drag existing ones to move; Delete to remove

Hit **💾 Save** — both capture and decorations are written back to `.kagemusha/definitions.json`. The same editor restores everything on next open, so adjusting is iterative.

### 4. Capture & publish

```bash
npx kagemusha capture                 # capture everything
npx kagemusha capture --ids a,b,c     # capture specific IDs
npx kagemusha capture --ids a --open  # open the result locally after capture
npx kagemusha run                     # capture + upload (uses config.publish)
```

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
| `kagemusha run` | Full pipeline: capture + upload |
| `kagemusha validate` | Validate config and definition files |
| `kagemusha compare` | VRT diff detection (coming soon) |
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
    "id": "dashboard-card",
    "url": "/dashboard",
    "capture": { "mode": "selector", "selector": "[data-testid=summary-card]" },
    "decorations": []
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

## GitHub Actions

`init` generates a workflow like this:

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
      - run: npx kagemusha run
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

For apps that need login in CI, run `kagemusha login` locally, base64-encode the resulting `.kagemusha/auth/storageState.json`, store it as a GitHub Secret (e.g. `KAGEMUSHA_STORAGE_STATE`), and decode it back into place in the workflow before `kagemusha run`. Do **not** commit the file. (Plain auto-login via email/password is still on the roadmap.)

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
- [x] S3 upload
- [x] Auto-discover pages (SPA-aware BFS crawl)
- [x] Login via browser (`storageState`)
- [x] Visual editor for capture range (fullPage / selector / crop)
- [ ] Visual regression testing (VRT)
- [ ] Intercom / Zendesk integration
- [ ] AI-powered text updates

## License

MIT
