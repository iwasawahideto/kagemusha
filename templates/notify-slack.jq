# Slack notification formatter for kagemusha. One Slack chat.postMessage
# body per line — customize freely (blocks, channel override, etc).
# Test locally:  jq -c -f .kagemusha/notify-slack.jq reports/summary.json
#
# Mutable URLs (.pageUrl, .urls.latest) are emitted as Slack <url|label>
# links so Slack does NOT unfurl them — only the immutable history URLs
# below get image previews. This keeps mutable URLs out of Slack's
# unfurl cache.

.results[]
| select(.status == "changed" or .status == "new")
| {
    text: (
      "📸 *<\(.pageUrl)|\(.id)>* " +
      (if .status == "changed" then "changed" else "added" end) +
      (if .diffPercentage then " (\((.diffPercentage * 100 | floor) / 100)%)"
       elif .reason == "layout-diff" then " (layout)"
       else "" end) +
      (if .urls.latest then "\nLatest: <\(.urls.latest)|current canonical>" else "" end) +
      (if .urls.previousHistory then "\nBefore: \(.urls.previousHistory)" else "" end) +
      (if .urls.history then "\nAfter:  \(.urls.history)" else "" end)
    )
  }
