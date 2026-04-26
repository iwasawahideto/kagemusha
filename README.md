# kagemusha

Auto-update help center screenshots when your code changes.
The shadow warrior for your documentation.

## What it does

When you push code, Kagemusha automatically captures screenshots of your app and uploads them to S3. No more manually taking screenshots and updating help articles.

- **Auto-discover pages** — Crawls your app to find pages, select which ones to capture
- **Playwright-powered** — Supports login, click actions, element selection, and full-page capture
- **Annotations** — Add arrows, rectangles, and labels to screenshots
- **S3 upload** — Screenshots are uploaded with stable URLs for embedding in help centers
- **Local mode** — Save screenshots locally for review before uploading
- **GitHub Actions ready** — Runs on every merge to main

## Quick Start

```bash
# Install
npm install -D @wasao/kagemusha

# Interactive setup (generates config, discovers pages, creates workflow)
npx kagemusha init

# Preview screenshots locally
npx kagemusha preview

# Run full pipeline (capture → upload)
npx kagemusha run
```

## How it works

1. `npx kagemusha init` scans your app and lets you pick which pages to screenshot
2. Config and definition files are generated in your repo
3. On every merge to main, GitHub Actions runs `npx kagemusha run`
4. Screenshots are captured and uploaded to S3
5. Help center articles reference the S3 URLs — images stay up to date automatically

## Commands

| Command | Description |
|---------|-------------|
| `kagemusha init` | Interactive setup |
| `kagemusha run` | Full pipeline: capture + upload |
| `kagemusha capture` | Capture screenshots only |
| `kagemusha preview` | Preview in browser |
| `kagemusha validate` | Validate config files |
| `kagemusha compare` | VRT diff detection (coming soon) |
| `kagemusha publish` | Publish to Intercom/Zendesk (coming soon) |

## Config

`kagemusha init` generates these files:

```
kagemusha.config.yaml         # App URL, auth, save destination
.kagemusha/definitions.json   # All screenshot definitions
```

### Screenshot definition example

```json
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
}
```

## GitHub Actions

```yaml
name: Kagemusha
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  screenshots:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx kagemusha run
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

## Try it locally

```bash
cd example
bun install
bun run serve          # Start sample app
bunx kagemusha init    # Set up kagemusha
bunx kagemusha preview # See screenshots
```

## Roadmap

- [x] Screenshot capture with Playwright
- [x] Annotations (rect, arrow, label)
- [x] S3 upload
- [x] Auto-discover pages
- [ ] Visual regression testing (VRT)
- [ ] Intercom / Zendesk integration
- [ ] AI-powered text updates

## License

MIT
