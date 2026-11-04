// Slack Web API + request signing. Bot scopes needed: chat:write (see
// slack-manifest.yml). The bot must be invited to the channel.

import { createHmac, timingSafeEqual } from "node:crypto";

type Json = Record<string, unknown>;

export async function slack<T extends Json = Json>(method: string, body: Json): Promise<T & { ok: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`slack ${method}: ${data.error ?? res.status}`);
  return data;
}

// https://api.slack.com/authentication/verifying-requests-from-slack
export function verifySlack(rawBody: string, timestamp: string | null, signature: string | null, now = Date.now()): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function approvers(): string[] {
  return (process.env.SLACK_APPROVER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const mention = (ids: string[]) => ids.map((id) => `<@${id}>`).join(" ");

// Schedule anything still in the future; post now only if the moment has
// passed, or Slack refuses it as already past. Posting early would announce
// "orders are locked" while the site still takes orders.
export async function postAt(channel: string, postAtSec: number, text: string, blocks?: Json[]): Promise<{ scheduledId: string | null; ts: string | null }> {
  const postNow = async () => {
    const r = await slack<{ ts: string }>("chat.postMessage", { channel, text, blocks });
    return { scheduledId: null, ts: r.ts };
  };
  if (postAtSec <= Math.floor(Date.now() / 1000) + 2) return postNow();
  try {
    const r = await slack<{ scheduled_message_id: string }>("chat.scheduleMessage", { channel, post_at: postAtSec, text, blocks });
    return { scheduledId: r.scheduled_message_id, ts: null };
  } catch (err) {
    if (/time_in_past|time_too_close/.test(String((err as Error).message))) {
      // Slack's own clock says it's due: wait it out rather than post early.
      const wait = postAtSec * 1000 - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, Math.min(wait, 30_000)));
      return postNow();
    }
    throw err;
  }
}

export async function respondEphemeral(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  });
}

export const section = (text: string): Json => ({ type: "section", text: { type: "mrkdwn", text } });
export const context = (text: string): Json => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
export const button = (text: string, actionId: string, value: string, style?: "primary" | "danger", url?: string): Json => ({
  type: "button",
  text: { type: "plain_text", text, emoji: true },
  action_id: actionId,
  value,
  ...(style ? { style } : {}),
  ...(url ? { url } : {}),
});
export const actions = (...elements: Json[]): Json => ({ type: "actions", elements });

// Slack mrkdwn: & < > must be escaped in user-supplied text.
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
