// Slack button taps. Slack wants a 200 within 3 seconds, so the work runs in
// after() and the message is updated in place when it's done.

import { after } from "next/server";
import { cancelDay, placeDay, recentOrdersText, reviewDay, trackText } from "@/lib/run";
import { approvers, mention, respondEphemeral, verifySlack } from "@/lib/slack";

export const maxDuration = 120;

interface Payload {
  type: string;
  user: { id: string };
  response_url: string;
  container?: { channel_id?: string; message_ts?: string };
  channel?: { id: string };
  message?: { ts: string };
  actions?: { action_id: string; value?: string }[];
}

// `orders` reads Keerthan's personal Swiggy order history: approvers only.
const GATED = new Set(["review", "rebuild_unknown", "place", "cancel", "orders"]);

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlack(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}") as Payload;
  const action = payload.actions?.[0];
  if (payload.type !== "block_actions" || !action) return new Response("");

  const user = payload.user.id;
  const channel = payload.container?.channel_id ?? payload.channel?.id ?? "";
  const ts = payload.container?.message_ts ?? payload.message?.ts ?? "";
  const value = action.value ?? "";

  if (GATED.has(action.action_id) && !approvers().includes(user)) {
    after(() =>
      respondEphemeral(
        payload.response_url,
        approvers().length
          ? `Only ${mention(approvers())} can do that. Change your own order on the site.`
          : "No approver is set up yet (SLACK_APPROVER_IDS)."
      )
    );
    return new Response("");
  }

  after(async () => {
    try {
      switch (action.action_id) {
        case "review":
        case "rebuild_unknown": {
          const why = await reviewDay(value, channel, ts, null, { afterUnknown: action.action_id === "rebuild_unknown" });
          if (why) await respondEphemeral(payload.response_url, why);
          return;
        }
        case "place": {
          const why = await placeDay(value, user, channel, ts);
          if (why) await respondEphemeral(payload.response_url, why);
          return;
        }
        case "cancel":
          if (!(await cancelDay(value, user, { channel, ts }))) {
            await respondEphemeral(payload.response_url, "Can't cancel here: it's an old run, or the order is being placed / already went in. To cancel a placed order: Swiggy care 080-67466729.");
          }
          return;
        case "track":
          return await respondEphemeral(payload.response_url, await trackText(value));
        case "orders":
          return await respondEphemeral(payload.response_url, await recentOrdersText());
        default:
          return; // open_site and other link buttons
      }
    } catch (err) {
      console.error("[slack/interact]", action.action_id, err);
      await respondEphemeral(payload.response_url, `Something broke: ${(err as Error).message}`).catch(() => undefined);
    }
  });
  return new Response("");
}
