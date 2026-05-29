# Slack notification formatter for kagemusha. One Slack chat.postMessage
# body per line — customize freely (blocks, channel override, etc).
# Test locally:  jq -c -f .kagemusha/notify-slack.jq reports/summary.json

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
