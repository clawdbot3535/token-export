// src/git/provider.test.ts
import { describe, expect, it } from "vitest";
import { CommitError } from "./provider";

describe("CommitError", () => {
  it("is an Error carrying a typed kind", () => {
    const e = new CommitError("auth", "bad token");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("auth");
    expect(e.message).toBe("bad token");
  });
});
