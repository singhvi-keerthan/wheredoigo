"use client";

import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { findOnSwiggy, swiggyRestaurantUrl } from "@/lib/swiggyClient";
import { updatePlace } from "@/lib/store";
import { useIsSiteOwner } from "@/lib/sync/client";
import type { Place } from "@/lib/types";
import { PoweredBySwiggy } from "./PoweredBySwiggy";

// "Open in Swiggy" for a saved place, on the map's place screen.
//
// A place that knows its Swiggy id (a swipe save, or one found here before) is
// a plain link — anyone can follow a link to swiggy.com. One that doesn't is
// looked up by name, once, on a tap: that is a Dineout MCP search, so it is
// owner-only like every Swiggy route, and the id it finds is banked on the
// place so the next tap is a link. Two taps the first time, not one, on
// purpose: iOS blocks a page opening a window after an await, so the lookup
// turns the button into the link rather than navigating on its own.
export default function OpenInSwiggy({ place }: { place: Place }) {
  const owner = useIsSiteOwner();
  const [state, setState] = useState<"idle" | "looking" | "none" | "failed">("idle");

  const rowClass =
    "press flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold no-underline";
  const rowStyle = {
    borderRadius: "var(--radius-chip)",
    border: "1px solid var(--border-strong)",
    color: "var(--text-primary)",
  } as const;

  if (place.swiggyId) {
    return (
      <div className="mt-2">
        <a
          href={swiggyRestaurantUrl(place.swiggyId, place.name, place.area)}
          target="_blank"
          rel="noreferrer"
          className={rowClass}
          style={rowStyle}
        >
          <ExternalLink size={15} strokeWidth={2.25} /> Open in Swiggy
        </a>
        <PoweredBySwiggy className="mt-1.5 text-center" />
      </div>
    );
  }

  // Finding it needs the MCP, which answers only to the owner's device.
  if (!owner) return null;

  const find = async () => {
    setState("looking");
    const { restaurant, error } = await findOnSwiggy(place);
    if (error) return setState("failed");
    if (!restaurant) return setState("none");
    updatePlace(place.id, { swiggyId: restaurant.id });
    setState("idle");
  };

  const label =
    state === "looking"
      ? "Looking on Swiggy…"
      : state === "none"
        ? "Not on Swiggy Dineout under this name"
        : state === "failed"
          ? "Couldn’t reach Swiggy — try again"
          : "Find on Swiggy";

  return (
    <div className="mt-2">
      <button
        onClick={find}
        disabled={state === "looking" || state === "none"}
        className={`${rowClass} disabled:opacity-60`}
        style={rowStyle}
      >
        <Search size={15} strokeWidth={2.25} /> {label}
      </button>
      <PoweredBySwiggy className="mt-1.5 text-center" />
    </div>
  );
}
