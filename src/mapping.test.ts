import { describe, expect, it } from "vitest";
import { filenameFor } from "./mapping";

describe("filenameFor", () => {
  it("splits a multi-mode collection by mode name into light/dark", () => {
    expect(filenameFor("semantic", "light", 2)).toBe("light.tokens.json");
    expect(filenameFor("semantic", "Dark", 2)).toBe("dark.tokens.json");
  });

  it("maps single-mode primitive collections by name", () => {
    expect(filenameFor("primitives/color", "Mode 1", 1)).toBe("color.tokens.json");
    expect(filenameFor("primitives/dimension", "Mode 1", 1)).toBe("dimension.tokens.json");
    expect(filenameFor("primitives/typography", "Mode 1", 1)).toBe("typography.tokens.json");
  });

  it("maps component collections to global", () => {
    expect(filenameFor("components/global", "Mode 1", 1)).toBe("global.tokens.json");
  });

  it("falls back to a sanitized name for unknown single-mode collections", () => {
    expect(filenameFor("My Brand Set", "Mode 1", 1)).toBe("my-brand-set.tokens.json");
  });

  it("falls back to collection+mode for unknown multi-mode collections", () => {
    expect(filenameFor("Brand", "Spring", 3)).toBe("brand-spring.tokens.json");
  });
});
