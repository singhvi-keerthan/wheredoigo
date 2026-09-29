#!/bin/bash
# The "every 5 days" half of Swiggy token renewal: a launchd nudge, not a cron
# that renews — renewal needs Keerthan's phone + OTP, so no scheduler can do it
# alone. What CAN be scheduled is noticing: this asks prod when the token dies
# (/api/swiggy/token-status) and, under THRESHOLD_H hours, pops a dialog whose
# [Renew now] opens the app's #renew-swiggy deep link — which walks straight
# into Swiggy's consent. One OTP later the callback route has already finished
# the rest server-side.
#
# Runs at 11:00 and 19:00 IST (launchd: ~/Library/LaunchAgents/
# com.keerthan.swiggy-renew-nudge.plist — missed runs fire on wake). Twice a
# day with a 36 h threshold means 2–3 daytime chances before a token dies.
# Free on purpose: no LLM, no metered API — one curl against our own route.

set -u
APP="https://wheredoigokeerthan.vercel.app"
THRESHOLD_H=36
LOG="$HOME/Library/Logs/swiggy-renew-nudge.log"

note() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG"; }

BODY=$(curl -s --max-time 15 "$APP/api/swiggy/token-status") || {
  note "skip: token-status unreachable (network/deploy problem, not a token verdict)"
  exit 0
}

# hoursLeft: number (negative = already dead), "null" = no token configured.
HOURS=$(printf '%s' "$BODY" | python3 -c '
import json, sys
try:
    v = json.load(sys.stdin).get("hoursLeft", "parse_error")
except Exception:
    v = "parse_error"
print(v)')

case "$HOURS" in
  parse_error)
    note "skip: token-status answered non-JSON (${BODY:0:80})"
    exit 0 ;;
  None)
    MSG="Swiggy has no token configured at all." ;;
  *)
    if python3 -c "import sys; sys.exit(0 if float('$HOURS') < $THRESHOLD_H else 1)"; then
      if python3 -c "import sys; sys.exit(0 if float('$HOURS') < 0 else 1)"; then
        MSG="The Swiggy token is DEAD (expired $(python3 -c "print(round(-float('$HOURS')))") h ago) — the deck is on mock data."
      else
        MSG="The Swiggy token dies in $(python3 -c "print(round(float('$HOURS')))") h."
      fi
    else
      note "ok: ${HOURS}h left — no nudge"
      exit 0
    fi ;;
esac

note "nudge: $MSG"

# Also email the reminder (asked 2026-09-30: "along with the push notification,
# also send me an email"). Gmail SMTP app password, reused from the LinkedIn
# listener setup, read from this repo's .env.local. Email first, dialog second:
# the dialog can sit unanswered for 300s and the mail must not wait on that.
ENVF="/Users/keerthan.singhvi/going-out-app/.env.local"
export SMTP_USER=$(grep '^SMTP_USER=' "$ENVF" | cut -d= -f2-)
export SMTP_PASS=$(grep '^SMTP_PASS=' "$ENVF" | cut -d= -f2-)
if [ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ]; then
  if MSG="$MSG" python3 - <<'PY' 2>>"$LOG"
import os, smtplib
from email.message import EmailMessage

m = EmailMessage()
m["From"] = os.environ["SMTP_USER"]
m["To"] = "singhvikeerthan@gmail.com"
m["Subject"] = "Swiggy token — renew (laptop, ~5 min)"
m.set_content(
    os.environ["MSG"]
    + "\n\nOn the laptop: click [Renew now] on the dialog, or run"
    + "\n  cd ~/going-out-app && npm run swiggy:renew"
    + "\nthen finish the phone + OTP in the tab it opens."
    + "\n\nMobile renewal stays blocked until Swiggy whitelists the domain"
    + "\n(github.com/Swiggy/swiggy-mcp-server-manifest/issues/128)."
)
with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as s:
    s.starttls()
    s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
    s.send_message(m)
PY
  then note "email sent to singhvikeerthan@gmail.com"
  else note "email FAILED (smtp error above) — dialog still shown"
  fi
else
  note "email skipped: SMTP_USER/SMTP_PASS missing in .env.local"
fi

# giving up after 300: an unattended machine must not hold the script forever.
CHOICE=$(osascript -e "display dialog \"$MSG\n\nRenew now? It's one Swiggy OTP — everything else finishes itself.\" buttons {\"Later\", \"Renew now\"} default button \"Renew now\" with title \"Swiggy token\" giving up after 300" 2>/dev/null)

if printf '%s' "$CHOICE" | grep -q "Renew now"; then
  # The in-app #renew-swiggy path is walled off until Swiggy whitelists the
  # domain ("Oops, Vercel isn't whitelisted yet", 2026-09-30) — localhost is
  # whitelisted, so run the local chain instead: consent tab + OTP here, and
  # swiggy-renew-finish.ts stores the result where prod reads it.
  note "launching npm run swiggy:renew in Terminal"
  osascript -e 'tell application "Terminal"
    activate
    do script "cd /Users/keerthan.singhvi/going-out-app && npm run swiggy:renew"
  end tell'
else
  note "dismissed (or timed out)"
fi
