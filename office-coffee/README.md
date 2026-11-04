# Coffee run

The office's daily coffee order on Swiggy. People set a regular from the café's
real menu and change it for a given day on the website. Slack posts a reminder
before the order time, then a review card with the cart. Nothing is ordered
until an approver taps **Yes**.

Separate Next.js app and separate Vercel project (root directory
`office-coffee`). It shares nothing with the wheredoigo app except the Neon DB,
where it reads the Swiggy token that app keeps renewed.

## A day

| IST | What happens |
|---|---|
| ~09:00–09:59 | Vercel cron `/api/cron/morning` (Hobby crons fire anywhere in their hour). It asks Slack to post the next two messages at exact times, warns if the Swiggy token dies before the order, and warms the menu cache. |
| 11:20 | Slack: "☕ Coffee run in 10 min" with a link to the site. |
| until 11:30 | People change today's drink or skip on the site. After 11:30, edits go to the next run. |
| 11:30 | Slack: "⏰ orders are locked" with **Review cart** / **No coffee today**. |
| tap Review | Builds the Swiggy cart from everyone's picks and shows who/what/total with **Yes, order ₹X** / Rebuild / No. |
| tap Yes | Re-checks the picks and the live total haven't changed, then pays with Swiggy Money (or cash) and posts the order + Track. |

Order time, reminder lead, days, payment, address and café are set at `/admin`.

## Things to know

- **It uses Keerthan's own Swiggy account and cart.** Building the office cart
  replaces whatever is in his Swiggy cart; the review card lists what it
  replaced.
- **Swiggy Money must cover the order.** If it doesn't, Yes fails cleanly and
  nothing is ordered. Top up in the Swiggy app.
- **If Swiggy doesn't confirm** a placed order, the card says so and offers
  "Check Swiggy orders". It never retries an order on its own.
- **Cancel after ordering:** Swiggy care 080-67466729 (the MCP has no cancel).
- **Token:** 5-day Swiggy token renewed by the wheredoigo app's Reconnect flow.
  `/admin` shows hours left; the morning cron warns in Slack if it will expire
  before the order.
- Rate limit: all Swiggy calls go through one meter capped at 30/min (Swiggy
  publishes 70 reads / 30 writes per minute).

## Setup

1. Vercel project, root directory `office-coffee`, env vars from `.env.example`.
2. Slack app from `slack-manifest.yml` (set the request URL to the deployed
   domain), install, invite the bot to the channel, set `SLACK_BOT_TOKEN`,
   `SLACK_SIGNING_SECRET`, `SLACK_APPROVER_IDS`, `SLACK_CHANNEL_ID`.
3. `/admin` → check Health is all green → **Set up today now** to try it.

`npm test` covers the cart builder, option validation, IST time rules, menu
parsing and the cart-vs-picks check.
