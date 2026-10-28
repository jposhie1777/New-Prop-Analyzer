import { describe, expect, it } from "vitest";
import { constantTimeEqual, safeNextPath, sessionToken } from "@/lib/auth/siteSession";

describe("site session", () => {
  it("hashes the password into a stable token", async () => {
    const token = await sessionToken("hunter2");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(await sessionToken("hunter2"));
    expect(token).not.toBe(await sessionToken("hunter3"));
    expect(token).not.toContain("hunter2");
  });
  it("compares tokens and only allows same-site next paths", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(safeNextPath("/lines")).toBe("/lines");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
  });
});
