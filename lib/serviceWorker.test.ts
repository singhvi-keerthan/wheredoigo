import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { GET } from "../app/sw.js/route";
import { deploymentRevision, serviceWorkerScript } from "./serviceWorker";

describe("service worker deployment revision", () => {
  it("changes the worker and cache name for every Vercel deployment", () => {
    const first = serviceWorkerScript("dpl_first");
    const second = serviceWorkerScript("dpl_second");

    expect(first).not.toBe(second);
    expect(first).toContain('const REVISION = "dpl_first";');
    expect(first).toContain('const CACHE = "wheredoigokeerthan-" + REVISION;');
    expect(second).toContain('const REVISION = "dpl_second";');
    expect(() => new Script(first)).not.toThrow();
  });

  it("prefers the deployment id and falls back safely away from Vercel", () => {
    expect(
      deploymentRevision({ VERCEL_DEPLOYMENT_ID: "dpl_123", VERCEL_GIT_COMMIT_SHA: "abc123" })
    ).toBe("dpl_123");
    expect(deploymentRevision({ VERCEL_GIT_COMMIT_SHA: "abc123" })).toBe("abc123");
    expect(deploymentRevision({})).toBe("development");
  });

  it("quotes the revision as JavaScript rather than interpolating executable text", () => {
    const script = serviceWorkerScript('bad"; self.pwned = true; //');

    expect(script).toContain('const REVISION = "bad\\\"; self.pwned = true; //";');
    expect(script).not.toContain('const REVISION = bad";');
  });

  it("serves the worker as uncached JavaScript with root scope", () => {
    const response = GET();

    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0, must-revalidate");
    expect(response.headers.get("service-worker-allowed")).toBe("/");
  });
});
