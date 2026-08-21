# Example: Acme Dashboard

A simple static HTML app to try kagemusha.

## Quick Start

```bash
cd example

# 1. Install
bun install

# 2. Serve the sample app
bun run serve
# → http://localhost:3000

# 3. In another terminal, run init
bunx kagemusha init
# → Follow the prompts (use http://localhost:3000 as the base URL, no login)

# 4. Preview screenshots
bunx kagemusha preview

# 5. Capture screenshots
bunx kagemusha capture
```

## Pages

- **Dashboard** (`index.html`) — Score cards, weekly trend chart
- **Members** (`members.html`) — Member list table with search and invite
- **Settings** (`settings.html`) — General settings, notifications, danger zone
- **Card Grid** (`grid.html`) — Cards that each scroll their own list. Structurally
  identical cards with `#GRID-ITEM-<uuid>` wrappers, so it reproduces the SPA shape
  where a recorded container scroll needs a unique selector (see
  `src/lib/container-scroll.harness.ts`)
