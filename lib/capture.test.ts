import { describe, it, expect } from "vitest";
import { parseLocation, isUrl } from "./capture";

describe("parseLocation", () => {
  it("parses @lat,lng from a full Maps URL", () => {
    expect(
      parseLocation("https://www.google.com/maps/place/Toit/@12.9784,77.6408,17z")
    ).toEqual({ lat: 12.9784, lng: 77.6408 });
  });

  it("parses q= / ll= query params", () => {
    expect(parseLocation("https://maps.google.com/?q=12.9716,77.6411")).toEqual({
      lat: 12.9716,
      lng: 77.6411,
    });
  });

  it("parses bare coordinates", () => {
    expect(parseLocation("12.9716, 77.6411")).toEqual({ lat: 12.9716, lng: 77.6411 });
  });

  it("returns null for text without coordinates", () => {
    expect(parseLocation("https://maps.app.goo.gl/AbCdEf")).toBeNull();
    expect(parseLocation("toit indiranagar")).toBeNull();
  });
});

describe("isUrl", () => {
  it("detects http(s) URLs only", () => {
    expect(isUrl("https://maps.app.goo.gl/x")).toBe(true);
    expect(isUrl("12.97, 77.64")).toBe(false);
  });
});
