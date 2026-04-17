# Example: Acme Dashboard

A simple static HTML app to try kagemusha locally.

## Quick Start

```bash
# 1. Build kagemusha (from repo root)
cd ~/projects/kagemusha
bun run build

# 2. Install dependencies in example
cd example
bun install

# 3. Serve the sample app
bun run serve
# → http://localhost:3000

# 4. In another terminal, run init
cd example
bunx kagemusha init
# → Follow the prompts (use http://localhost:3000 as the base URL, no login)

# 5. Preview screenshots
bunx kagemusha preview

# 6. Capture screenshots
bunx kagemusha capture
```

## Pages

- **Dashboard** (`index.html`) — Score cards, weekly trend chart
- **Members** (`members.html`) — Member list table with search and invite
- **Settings** (`settings.html`) — General settings, notifications, danger zone
