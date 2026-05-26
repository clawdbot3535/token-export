// src/timestamp.test.ts
import { describe, expect, it } from "vitest";
import { timestampedZipName } from "./timestamp";

describe("timestampedZipName", () => {
  it("formats local date-time as tokens-YYYYMMDD-HHMMSS.zip with zero-padding", () => {
    const d = new Date(2026, 4, 6, 9, 7, 3);
    expect(timestampedZipName(d)).toBe("tokens-20260506-090703.zip");
  });
  it("handles double-digit components", () => {
    const d = new Date(2026, 10, 26, 12, 30, 45);
    expect(timestampedZipName(d)).toBe("tokens-20261126-123045.zip");
  });
});
