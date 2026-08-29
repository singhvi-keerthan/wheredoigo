import { describe, expect, it } from "vitest";
import { keywordForNewSearch } from "./lens";

describe("keywordForNewSearch", () => {
  it("does not send the selected area back as a generic Swiggy keyword", () => {
    expect(keywordForNewSearch(["jayanagar"], "Jayanagar")).toBe("");
    expect(keywordForNewSearch(["layout"], "HSR Layout")).toBe("");
  });

  it("keeps non-area keywords", () => {
    expect(keywordForNewSearch(["rooftop", "jayanagar"], "Jayanagar")).toBe("rooftop");
  });
});
