# Slack notification formatter for kagemusha.
# Called by .github/workflows/kagemusha.yml on reports/summary.json.
# Emits ONE Slack payload object per changed/new screenshot — the
# workflow loops over the lines and POSTs each as a separate message.
# Slack unfurls image URLs per-message, so before/after previews render
# cleanly even when many pages changed.
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
        (if .urls.before then "\nBefore: \(.urls.before)" else "" end) +
        (if .urls.after  then "\nAfter:  \(.urls.after)"  else "" end)
      else
        "📸 *\(.id)* added" +
        (if .urls.after then "\n\(.urls.after)" else "" end)
      end
    )
  }
