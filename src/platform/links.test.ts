import { describe, expect, it } from "vitest";
import { signLink, verifyLink } from "./links";

const SECRET = "s3cret";

describe("signed links", () => {
  it("round-trips an id", () => {
    expect(verifyLink("crew", signLink("crew", "job-1", SECRET), SECRET)).toBe("job-1");
  });

  it("rejects the wrong secret", () => {
    expect(verifyLink("crew", signLink("crew", "job-1", "other"), SECRET)).toBeNull();
  });

  it("rejects a link made for a different purpose", () => {
    expect(verifyLink("quote", signLink("crew", "job-1", SECRET), SECRET)).toBeNull();
  });

  it("rejects a tampered id", () => {
    const [, signature] = signLink("crew", "job-1", SECRET).split(".");
    const body = Buffer.from(`crew.job-2.${Date.now() + 1_000_000}`).toString("base64url");
    expect(verifyLink("crew", `${body}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects an expired link", () => {
    const token = signLink("change_order", "co-1", SECRET, new Date("2026-01-01"));
    expect(verifyLink("change_order", token, SECRET, new Date("2026-06-01"))).toBeNull();
    expect(verifyLink("change_order", token, SECRET, new Date("2026-01-02"))).toBe("co-1");
  });

  it("rejects junk", () => {
    for (const token of ["", "abc", "a.b.c", "..", "a."]) {
      expect(verifyLink("crew", token, SECRET)).toBeNull();
    }
  });
});
