import { describe, expect, it } from "vitest";
import { photoBlobPutOptions } from "./photoBlob";

describe("photoBlobPutOptions", () => {
  it("makes deterministic photo uploads safe to retry", () => {
    expect(photoBlobPutOptions("token", "image/jpeg")).toEqual({
      access: "private",
      token: "token",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  });
});
