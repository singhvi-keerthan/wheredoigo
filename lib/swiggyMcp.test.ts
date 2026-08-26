import { describe, it, expect } from "vitest";
import { unwrapReply } from "./swiggyMcp";

const reply = (over: Record<string, unknown>) => ({
  content: [{ type: "text", text: "" }],
  ...over,
});

describe("unwrapReply — which envelope Swiggy actually filled", () => {
  // THE regression. search_restaurants_dineout answers with an EMPTY
  // structuredContent and the real list as prose. Reading `!== undefined` took
  // the empty object and returned it, so every search produced zero results
  // with no error anywhere. This is the test that would have caught it.
  it("treats an empty structuredContent as absent and keeps the prose", () => {
    const text = "1. Downtown Diner —  | 4.3★ |  | Residency Road (ID: 737829)";
    const out = unwrapReply(reply({ structuredContent: {}, content: [{ type: "text", text }] }));
    expect(out).toEqual({ data: null, text });
  });

  it("takes a structuredContent that actually carries something", () => {
    const sc = { restaurants: [{ id: "1" }] };
    expect(unwrapReply(reply({ structuredContent: sc })).data).toEqual(sc);
  });

  it("throws Swiggy's own words on a tool error", () => {
    expect(() =>
      unwrapReply(
        reply({
          isError: true,
          structuredContent: {},
          content: [{ type: "text", text: "Date is required (YYYY-MM-DD format or epoch timestamp)" }],
        })
      )
    ).toThrow(/Date is required/);
  });

  it("parses JSON hidden in the text block", () => {
    const out = unwrapReply(reply({ content: [{ type: "text", text: '{"slots":[1,2]}' }] }));
    expect(out.data).toEqual({ slots: [1, 2] });
  });

  it("falls back to prose when a brace-leading text isn't JSON after all", () => {
    const text = "{not json at all";
    expect(unwrapReply(reply({ content: [{ type: "text", text }] }))).toEqual({ data: null, text });
  });

  it("reports an empty answer as empty rather than throwing", () => {
    // A slotless day answers with prose and no structured payload; that is an
    // empty list to the caller, not a failure.
    const text = "No bookable slots for 2026-08-26. Do not retry this tool for the same date.";
    expect(unwrapReply(reply({ structuredContent: {}, content: [{ type: "text", text }] }))).toEqual({
      data: null,
      text,
    });
  });
});
