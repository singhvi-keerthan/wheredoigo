import { describe, it, expect } from "vitest";
import { hasShare, sharedLink, withoutShare } from "./share";

const p = (o: Record<string, string>) => new URLSearchParams(o);

describe("a share from Android's share sheet", () => {
  it("finds the reel inside the text Instagram sends, minus its tracking", () => {
    const text = "Check out this reel https://www.instagram.com/reel/DAbc123xyz/?igsh=MTV4ZnQ5 by @foodie";
    expect(sharedLink(p({ shared_text: text }))).toBe("https://www.instagram.com/reel/DAbc123xyz/");
  });

  it("prefers an Instagram link over any other one in the share", () => {
    const s = p({ shared_url: "https://l.example.com/x", shared_text: "see https://instagram.com/p/XYZ/" });
    expect(sharedLink(s)).toBe("https://instagram.com/p/XYZ/");
  });

  it("takes any other link as-is, and nothing when there is none", () => {
    expect(sharedLink(p({ shared_url: "https://youtu.be/abc?t=4" }))).toBe("https://youtu.be/abc?t=4");
    expect(sharedLink(p({ shared_text: "no link here" }))).toBeNull();
    expect(sharedLink(p({}))).toBeNull();
  });

  it("drops a trailing full stop from a link at the end of a sentence", () => {
    expect(sharedLink(p({ shared_text: "Go here: https://instagram.com/reel/A1."}))).toBe("https://instagram.com/reel/A1");
  });

  it("strips only its own parameters from the address", () => {
    expect(withoutShare("https://x.app/app?shared_text=hi&shared_url=u")).toBe("/app");
    expect(withoutShare("https://x.app/app?keep=1&shared_title=t")).toBe("/app?keep=1");
    expect(hasShare(p({ shared_text: "" }))).toBe(true);
    expect(hasShare(p({ q: "x" }))).toBe(false);
  });
});
