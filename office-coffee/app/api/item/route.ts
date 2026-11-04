// An item's real options (sizes, milk, add-ons), for the picker sheet.

import { currentPersonId } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { findItem, getItemDetails, getMenu } from "@/lib/menu";
import { humanError } from "@/lib/swiggy";

export async function GET(req: Request) {
  if (!(await currentPersonId())) return Response.json({ error: "Sign in first" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    const s = await getSettings();
    const menu = await getMenu(s);
    const item = menu && findItem(menu, id);
    if (!item) return Response.json({ error: "That item isn't on the menu any more" }, { status: 404 });
    return Response.json(await getItemDetails(s, item));
  } catch (err) {
    return Response.json({ error: humanError(err) }, { status: 502 });
  }
}
