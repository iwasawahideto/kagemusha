# Slack notification formatter for kagemusha.
# Called by .github/workflows/kagemusha.yml on reports/summary.json.
# Emits ONE Slack payload object per changed/new screenshot — the
# workflow loops over the lines and POSTs each as a separate message.
# Slack unfurls image URLs per-message, so prior/current previews render
# cleanly side by side even when many pages changed.
#
# Uses `.urls.history` / `.urls.previousHistory` — both are immutable
# per-run URLs under `<id>/history/<timestamp>.png`. Slack caches unfurled
# previews by URL, so a mutable URL (one whose bytes change on each
# release at the same URL) would either freeze on the cached preview or
# silently mutate under prior messages on the next push. The history URLs
# identify a specific run's screenshot for good and avoid both pitfalls.
#
# Each emitted object is a full Slack chat.postMessage body, so you can
# customize freely (add blocks, attachments, channel override, etc).
#
# Test locally:
#   jq -c -f .kagemusha/notify-slack.jq reports/summary.json

.results[]
| select(.status == "changed" or .status == "new")
| {
    text: (
      if .status == "changed" then
        "📸 *\(.id)* changed" +
        (if .diffPercentage then " (\((.diffPercentage * 100 | floor) / 100)%)"
         elif .reason == "layout-diff" then " (layout)"
         else "" end) +
        (if .urls.previousHistory then "\nBefore: \(.urls.previousHistory)" else "" end) +
        (if .urls.history then "\nAfter:  \(.urls.history)" else "" end)
      else
        "📸 *\(.id)* added" +
        (if .urls.history then "\n\(.urls.history)" else "" end)
      end
    )
  }
