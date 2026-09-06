import { describe, it, expect } from "vitest";
import { normalizePhone, phoneProblem, passwordProblem, accountSecret, displayPhone } from "./account";

describe("normalizePhone", () => {
  // The same person types their number four different ways across two devices,
  // and every one of them has to open the SAME map.
  it("reduces every common Indian format to the same ten digits", () => {
    const forms = ["9876543210", "+91 98765 43210", "098765 43210", "+91-98765-43210", "0091 9876543210"];
    const all = new Set(forms.map(normalizePhone));
    expect(all).toEqual(new Set(["9876543210"]));
  });

  it("is idempotent", () => {
    expect(normalizePhone(normalizePhone("+91 98765 43210"))).toBe("9876543210");
  });

  it("keeps different numbers different", () => {
    expect(normalizePhone("9876543210")).not.toBe(normalizePhone("9876543211"));
  });
});

describe("phoneProblem", () => {
  it("rejects short input", () => {
    expect(phoneProblem("98765")).toBeTruthy();
    expect(phoneProblem("")).toBeTruthy();
  });

  it("accepts ten digits, with or without decoration", () => {
    expect(phoneProblem("9876543210")).toBeNull();
    expect(phoneProblem("+91 98765 43210")).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("rejects the ones that fall first", () => {
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem("password")).toBeTruthy();
    expect(passwordProblem("12345678")).toBeTruthy(); // digits only
    expect(passwordProblem("aaaaaaaa")).toBeTruthy(); // too few distinct characters
  });

  // The first thing anyone holding your number would try.
  it("rejects the phone number as the password", () => {
    expect(passwordProblem("9876543210", "9876543210")).toBeTruthy();
    expect(passwordProblem("+91 98765 43210", "9876543210")).toBeTruthy();
  });

  it("accepts an ordinary password", () => {
    expect(passwordProblem("dosaplace22", "9876543210")).toBeNull();
  });
});

describe("accountSecret", () => {
  // The prefix is what keeps accounts from ever colliding with the recovery
  // phrases that were already in use before sign-up existed.
  it("is namespaced away from bare phrases", () => {
    expect(accountSecret("9876543210", "hunter22")).toMatch(/^acct:v1:/);
  });

  it("normalises the phone but not the password", () => {
    expect(accountSecret("+91 98765 43210", "Hunter22")).toBe(accountSecret("098765 43210", "Hunter22"));
    // Case in the password is entropy the phone number cannot spare.
    expect(accountSecret("9876543210", "Hunter22")).not.toBe(accountSecret("9876543210", "hunter22"));
  });

  it("separates the two fields so they cannot be slid past each other", () => {
    expect(accountSecret("9876543210", "abc")).not.toBe(accountSecret("987654321", "0abc"));
  });
});

describe("displayPhone", () => {
  it("groups ten digits for reading back", () => {
    expect(displayPhone("+91 98765 43210")).toBe("98765 43210");
  });
});
