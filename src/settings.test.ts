// src/settings.test.ts
import { describe, expect, it } from "vitest";
import { normalizePath, validateSettings, type Settings } from "./settings";

const ok: Settings = { owner: "me", repo: "tokens", branch: "main", path: "tokens" };

describe("validateSettings", () => {
  it("accepts valid settings", () => {
    expect(validateSettings(ok)).toEqual([]);
  });
  it("rejects empty owner/repo/branch with field-named errors", () => {
    const errs = validateSettings({ owner: " ", repo: "", branch: "", path: "" });
    expect(errs.some((e) => /owner/i.test(e))).toBe(true);
    expect(errs.some((e) => /repo/i.test(e))).toBe(true);
    expect(errs.some((e) => /branch/i.test(e))).toBe(true);
  });
  it("allows an empty path (repo root)", () => {
    expect(validateSettings({ ...ok, path: "" })).toEqual([]);
  });
});

describe("normalizePath", () => {
  it("strips leading and trailing slashes", () => {
    expect(normalizePath("/tokens/")).toBe("tokens");
    expect(normalizePath("a/b/")).toBe("a/b");
  });
  it("returns empty string unchanged", () => {
    expect(normalizePath("")).toBe("");
    expect(normalizePath("   ")).toBe("");
  });
});
