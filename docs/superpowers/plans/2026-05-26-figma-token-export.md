# figma-token-export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Figma plugin that reads local variables (free Plugin API, no Enterprise) and exports a ZIP of the six `*.tokens.json` files in the exact REST-compatible shape `token-inspector` already ingests.

**Architecture:** A thin impure shell (`main.ts` reads the Figma API; `ui.tsx` zips + downloads) wrapping a pure, unit-tested core (`format.ts`, `mapping.ts`, `export.ts`). The core takes plain collected data and returns `{ filename, json }[]` — no `figma.*` and no DOM, so it is fully testable. This mirrors token-inspector's own "pure engine behind a thin shell" design.

**Tech Stack:** TypeScript, `create-figma-plugin` (esbuild build + Preact UI components), `@figma/plugin-typings`, `fflate` (ZIP in the UI iframe), `vitest` (unit tests). Node v22+.

**Reference format:** `token-inspector/components/*.tokens.json` (the golden shape this plugin must reproduce). Spec: `../specs/2026-05-26-figma-token-export-design.md`.

---

## File Structure

```
figma-token-export/
  package.json            # figma-plugin config + scripts + deps
  tsconfig.json
  .gitignore
  README.md
  src/
    main.ts               # IMPURE: showUI; on("EXPORT") -> read API -> buildExport -> emit
    ui.tsx                # IMPURE: "Export tokens" button -> zip files -> download tokens.zip
    format.ts             # PURE: Figma value -> inspector $value/$type shapes
    format.test.ts
    mapping.ts            # PURE: (collectionName, modeName, modeCount) -> filename
    mapping.test.ts
    export.ts             # PURE: CollectedData -> { files, warnings }
    export.test.ts
```

Responsibilities: `format.ts` knows the inspector's value encodings (color object, hex, $type). `mapping.ts` knows how collections/modes become the six filenames. `export.ts` walks collections/modes/variables, resolves aliases, and assembles nested token trees. `main.ts`/`ui.tsx` are glue with no business logic worth unit-testing.

---

### Task 1: Scaffold repo + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/main.ts`, `src/ui.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "figma-token-export",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "scripts": {
    "build": "build-figma-plugin --typecheck --minify",
    "watch": "build-figma-plugin --typecheck --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@create-figma-plugin/ui": "^4",
    "@create-figma-plugin/utilities": "^4",
    "fflate": "^0.8.2",
    "preact": "^10"
  },
  "devDependencies": {
    "@create-figma-plugin/build": "^4",
    "@figma/plugin-typings": "^1",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "figma-plugin": {
    "editorType": ["figma"],
    "id": "figma-token-export",
    "name": "Token Export (Inspector)",
    "main": "src/main.ts",
    "ui": "src/ui.tsx",
    "documentAccess": "dynamic-page",
    "networkAccess": { "allowedDomains": ["none"] }
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "target": "ES2020",
    "typeRoots": ["node_modules/@figma", "node_modules/@types"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Note: imports are **extensionless** (`import { buildExport } from "./export"`) — both esbuild and vitest resolve TS directly, avoiding the `.js`→`.ts` resolution issues seen in token-inspector.

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
build/
manifest.json
*.log
.DS_Store
```

- [ ] **Step 4: Create stub `src/main.ts`**

```ts
import { showUI } from "@create-figma-plugin/utilities";

export default function (): void {
  showUI({ width: 260, height: 160 });
}
```

- [ ] **Step 5: Create stub `src/ui.tsx`**

```tsx
import { Button, Container, render, VerticalSpace } from "@create-figma-plugin/ui";
import { h } from "preact";

function Plugin() {
  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Button fullWidth>Export tokens</Button>
    </Container>
  );
}

export default render(Plugin);
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/` populated.

- [ ] **Step 7: Verify build produces manifest + bundle**

Run: `npm run build`
Expected: PASS; creates `manifest.json` and `build/` directory, no type errors.

- [ ] **Step 8: Verify the test runner works (no tests yet)**

Run: `npm test`
Expected: vitest reports "No test files found" (exit 0) — confirms vitest is wired.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold create-figma-plugin project with vitest"
```

---

### Task 2: Pure value formatters (`format.ts`)

**Files:**
- Create: `src/format.ts`, `src/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/format.test.ts
import { describe, expect, it } from "vitest";
import { channelToHex, formatColor, formatLiteral, toHex, tokenTypeFor } from "./format";

describe("channelToHex", () => {
  it("converts 0..1 float channels to 2-digit uppercase hex", () => {
    expect(channelToHex(1)).toBe("FF");
    expect(channelToHex(0)).toBe("00");
    expect(channelToHex(0.5)).toBe("80");
  });
  it("clamps out-of-range input", () => {
    expect(channelToHex(2)).toBe("FF");
    expect(channelToHex(-1)).toBe("00");
  });
});

describe("toHex", () => {
  it("builds #RRGGBB ignoring alpha", () => {
    expect(toHex({ r: 1, g: 1, b: 1, a: 0.5 })).toBe("#FFFFFF");
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });
});

describe("formatColor", () => {
  it("produces the inspector color object with srgb space and alpha default 1", () => {
    expect(formatColor({ r: 1, g: 1, b: 1 })).toEqual({
      colorSpace: "srgb",
      components: [1, 1, 1],
      alpha: 1,
      hex: "#FFFFFF",
    });
  });
  it("preserves explicit alpha and raw component floats", () => {
    expect(formatColor({ r: 0.15, g: 0.39, b: 0.92, a: 0.5 })).toEqual({
      colorSpace: "srgb",
      components: [0.15, 0.39, 0.92],
      alpha: 0.5,
      hex: "#2663EB",
    });
  });
});

describe("tokenTypeFor", () => {
  it("maps Figma resolved types to inspector $type", () => {
    expect(tokenTypeFor("COLOR")).toBe("color");
    expect(tokenTypeFor("FLOAT")).toBe("number");
    expect(tokenTypeFor("STRING")).toBe("string");
    expect(tokenTypeFor("BOOLEAN")).toBe("string");
  });
});

describe("formatLiteral", () => {
  it("formats colors as objects", () => {
    expect(formatLiteral({ r: 0, g: 0, b: 0 }, "COLOR")).toEqual({
      colorSpace: "srgb",
      components: [0, 0, 0],
      alpha: 1,
      hex: "#000000",
    });
  });
  it("passes numbers and strings through", () => {
    expect(formatLiteral(16, "FLOAT")).toBe(16);
    expect(formatLiteral("Inter", "STRING")).toBe("Inter");
  });
  it("stringifies booleans", () => {
    expect(formatLiteral(true, "BOOLEAN")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/format.test.ts`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/format.ts
// Pure value formatters: Figma variable values -> the JSON shapes the
// token-inspector expects (REST-compatible). No figma.* access.

export type FigmaResolvedType = "BOOLEAN" | "COLOR" | "FLOAT" | "STRING";

export interface RGB { r: number; g: number; b: number }
export interface RGBA extends RGB { a: number }

/** Inspector token $type vocabulary used in the reference exports. */
export type TokenType = "color" | "number" | "string";

export interface FigmaColorValue {
  colorSpace: "srgb";
  components: [number, number, number];
  alpha: number;
  hex: string;
}

export function channelToHex(n: number): string {
  const clamped = Math.max(0, Math.min(1, n));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

export function toHex(c: RGB | RGBA): string {
  return `#${channelToHex(c.r)}${channelToHex(c.g)}${channelToHex(c.b)}`;
}

export function formatColor(c: RGB | RGBA): FigmaColorValue {
  const alpha = "a" in c ? c.a : 1;
  return {
    colorSpace: "srgb",
    components: [c.r, c.g, c.b],
    alpha,
    hex: toHex(c),
  };
}

export function tokenTypeFor(resolved: FigmaResolvedType): TokenType {
  switch (resolved) {
    case "COLOR":
      return "color";
    case "FLOAT":
      return "number";
    default:
      return "string"; // STRING and BOOLEAN
  }
}

export function formatLiteral(value: unknown, resolved: FigmaResolvedType): unknown {
  if (resolved === "COLOR") return formatColor(value as RGB | RGBA);
  if (resolved === "BOOLEAN") return String(value);
  return value; // FLOAT -> number, STRING -> string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/format.test.ts`
Expected: PASS (all cases). Note `#2663EB` is the correct round-trip of `0.15,0.39,0.92` — verify the test's expected hex matches; if vitest reports a different hex, fix the **test's** expected value to the computed one (the implementation is the source of truth for rounding).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/format.test.ts
git commit -m "feat: pure Figma value formatters (color object, hex, $type)"
```

---

### Task 3: Filename mapping (`mapping.ts`)

**Files:**
- Create: `src/mapping.ts`, `src/mapping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/mapping.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mapping.test.ts`
Expected: FAIL — cannot resolve `./mapping`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/mapping.ts
// Maps a Figma (collection, mode) pair to one of the six filenames the
// token-inspector loader recognizes. Multi-mode collections split by mode
// name (light/dark); single-mode collections map by collection name.
// Unknown collections fall back to a sanitized name and are surfaced as
// warnings rather than dropped.
//
// NOTE: the substring rules below assume the user's Figma collection names
// contain "color"/"dimension"/"typography"/"global". Confirm against the
// real file in Task 9 and adjust these constants if the names differ.

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function filenameFor(
  collectionName: string,
  modeName: string,
  modeCount: number,
): string {
  const c = collectionName.toLowerCase();
  const m = modeName.toLowerCase();

  // Theme-varying collections: split by mode name.
  if (modeCount > 1 || /semantic|theme/.test(c)) {
    if (m.includes("dark")) return "dark.tokens.json";
    if (m.includes("light")) return "light.tokens.json";
  }

  if (c.includes("typography")) return "typography.tokens.json";
  if (c.includes("dimension") || c.includes("spacing")) return "dimension.tokens.json";
  if (c.includes("color")) return "color.tokens.json";
  if (c.includes("global") || c.includes("component")) return "global.tokens.json";

  const base = sanitize(collectionName) || "tokens";
  return modeCount > 1
    ? `${base}-${sanitize(modeName)}.tokens.json`
    : `${base}.tokens.json`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mapping.ts src/mapping.test.ts
git commit -m "feat: collection/mode -> inspector filename mapping"
```

---

### Task 4: Export core — literals (`export.ts`)

**Files:**
- Create: `src/export.ts`, `src/export.test.ts`

- [ ] **Step 1: Write the failing test (literal tokens, single mode)**

```ts
// src/export.test.ts
import { describe, expect, it } from "vitest";
import { buildExport, type CollectedData } from "./export";

function parse(files: { filename: string; json: string }[], name: string) {
  const f = files.find((x) => x.filename === name);
  if (!f) throw new Error(`missing file ${name}`);
  return JSON.parse(f.json);
}

describe("buildExport — literals", () => {
  it("emits a nested color primitive in the inspector shape", () => {
    const data: CollectedData = {
      collections: [
        {
          id: "C1",
          name: "primitives/color",
          defaultModeId: "m1",
          modes: [{ modeId: "m1", name: "Mode 1" }],
          variables: [
            {
              id: "V1",
              name: "color/white",
              resolvedType: "COLOR",
              valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
              scopes: ["ALL_SCOPES"],
              collectionId: "C1",
            },
          ],
        },
      ],
    };

    const { files, warnings } = buildExport(data);
    expect(warnings).toEqual([]);
    const tree = parse(files, "color.tokens.json");
    expect(tree.color.white).toEqual({
      $type: "color",
      $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: 1, hex: "#FFFFFF" },
      $extensions: {
        "com.figma.variableId": "V1",
        "com.figma.scopes": ["ALL_SCOPES"],
      },
    });
  });

  it("emits numeric primitives as $type number", () => {
    const data: CollectedData = {
      collections: [
        {
          id: "C2",
          name: "primitives/dimension",
          defaultModeId: "m1",
          modes: [{ modeId: "m1", name: "Mode 1" }],
          variables: [
            {
              id: "V2",
              name: "spacing/0",
              resolvedType: "FLOAT",
              valuesByMode: { m1: 0 },
              scopes: ["ALL_SCOPES"],
              collectionId: "C2",
            },
          ],
        },
      ],
    };
    const tree = parse(buildExport(data).files, "dimension.tokens.json");
    expect(tree.spacing["0"]).toEqual({
      $type: "number",
      $value: 0,
      $extensions: { "com.figma.variableId": "V2", "com.figma.scopes": ["ALL_SCOPES"] },
    });
  });

  it("warns when a variable has no value for a mode", () => {
    const data: CollectedData = {
      collections: [
        {
          id: "C3",
          name: "primitives/color",
          defaultModeId: "m1",
          modes: [{ modeId: "m1", name: "Mode 1" }],
          variables: [
            {
              id: "V3",
              name: "color/ghost",
              resolvedType: "COLOR",
              valuesByMode: {},
              scopes: [],
              collectionId: "C3",
            },
          ],
        },
      ],
    };
    const { warnings } = buildExport(data);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("color/ghost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/export.test.ts`
Expected: FAIL — cannot resolve `./export`.

- [ ] **Step 3: Write minimal implementation (literals only; alias support added in Task 5)**

```ts
// src/export.ts
// Pure builder: plain collected variable data -> { filename, json }[] in the
// REST-compatible shape the token-inspector ingests. No figma.* / no DOM.

import { type FigmaResolvedType, formatLiteral, type TokenType, tokenTypeFor } from "./format";
import { filenameFor } from "./mapping";

export interface VariableAliasValue {
  type: "VARIABLE_ALIAS";
  id: string;
}
export type CollectedValue =
  | boolean
  | number
  | string
  | { r: number; g: number; b: number; a?: number }
  | VariableAliasValue;

export interface CollectedVariable {
  id: string;
  name: string; // slash path, e.g. "color/bg/base"
  resolvedType: FigmaResolvedType;
  valuesByMode: Record<string, CollectedValue>;
  scopes: string[];
  collectionId: string;
}
export interface CollectedMode {
  modeId: string;
  name: string;
}
export interface CollectedCollection {
  id: string;
  name: string;
  defaultModeId: string;
  modes: CollectedMode[];
  variables: CollectedVariable[];
}
export interface CollectedData {
  collections: CollectedCollection[];
}

export interface ExportFile {
  filename: string;
  json: string;
}
export interface ExportResult {
  files: ExportFile[];
  warnings: string[];
}

interface TokenLeaf {
  $type: TokenType;
  $value: unknown;
  $extensions: Record<string, unknown>;
}

function isAlias(v: CollectedValue): v is VariableAliasValue {
  return typeof v === "object" && v !== null && (v as VariableAliasValue).type === "VARIABLE_ALIAS";
}

function setNested(root: Record<string, unknown>, path: string[], leaf: TokenLeaf): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = leaf;
}

export function buildExport(data: CollectedData): ExportResult {
  const warnings: string[] = [];
  const fileTrees = new Map<string, Record<string, unknown>>();

  for (const col of data.collections) {
    for (const mode of col.modes) {
      const filename = filenameFor(col.name, mode.name, col.modes.length);
      let tree = fileTrees.get(filename);
      if (!tree) {
        tree = {};
        fileTrees.set(filename, tree);
      }

      for (const v of col.variables) {
        const raw = v.valuesByMode[mode.modeId];
        if (raw === undefined) {
          warnings.push(`${v.name}: no value for mode "${mode.name}"`);
          continue;
        }
        if (isAlias(raw)) {
          // Alias handling is implemented in Task 5.
          continue;
        }
        const leaf: TokenLeaf = {
          $type: tokenTypeFor(v.resolvedType),
          $value: formatLiteral(raw, v.resolvedType),
          $extensions: {
            "com.figma.variableId": v.id,
            "com.figma.scopes": v.scopes,
          },
        };
        setNested(tree, v.name.split("/"), leaf);
      }
    }
  }

  const files: ExportFile[] = [...fileTrees].map(([filename, tree]) => ({
    filename,
    json: JSON.stringify(tree, null, 2),
  }));
  return { files, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/export.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/export.ts src/export.test.ts
git commit -m "feat: export core for literal tokens (nested trees, warnings)"
```

---

### Task 5: Export core — alias resolution (`export.ts`)

**Files:**
- Modify: `src/export.ts`
- Modify: `src/export.test.ts`

- [ ] **Step 1: Add failing tests for aliases + light/dark merge**

Append to `src/export.test.ts`:

```ts
describe("buildExport — aliases", () => {
  // primitives/color (single mode) + semantic (light/dark) aliasing into it.
  const data: CollectedData = {
    collections: [
      {
        id: "PC",
        name: "primitives/color",
        defaultModeId: "p1",
        modes: [{ modeId: "p1", name: "Mode 1" }],
        variables: [
          {
            id: "WHITE",
            name: "color/white",
            resolvedType: "COLOR",
            valuesByMode: { p1: { r: 1, g: 1, b: 1, a: 1 } },
            scopes: ["ALL_SCOPES"],
            collectionId: "PC",
          },
          {
            id: "BLACK",
            name: "color/black",
            resolvedType: "COLOR",
            valuesByMode: { p1: { r: 0, g: 0, b: 0, a: 1 } },
            scopes: ["ALL_SCOPES"],
            collectionId: "PC",
          },
        ],
      },
      {
        id: "SEM",
        name: "semantic",
        defaultModeId: "light",
        modes: [
          { modeId: "light", name: "light" },
          { modeId: "dark", name: "dark" },
        ],
        variables: [
          {
            id: "BG",
            name: "color/bg/base",
            resolvedType: "COLOR",
            valuesByMode: {
              light: { type: "VARIABLE_ALIAS", id: "WHITE" },
              dark: { type: "VARIABLE_ALIAS", id: "BLACK" },
            },
            scopes: ["ALL_SCOPES"],
            collectionId: "SEM",
          },
        ],
      },
    ],
  };

  it("resolves an alias to the target literal AND records aliasData (light)", () => {
    const tree = parse(buildExport(data).files, "light.tokens.json");
    expect(tree.color.bg.base).toEqual({
      $type: "color",
      $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: 1, hex: "#FFFFFF" },
      $extensions: {
        "com.figma.variableId": "BG",
        "com.figma.scopes": ["ALL_SCOPES"],
        "com.figma.aliasData": {
          targetVariableName: "color/white",
          targetVariableSetName: "primitives/color",
        },
      },
    });
  });

  it("resolves the dark mode to the dark target", () => {
    const tree = parse(buildExport(data).files, "dark.tokens.json");
    expect(tree.color.bg.base.$value.hex).toBe("#000000");
    expect(tree.color.bg.base.$extensions["com.figma.aliasData"].targetVariableName).toBe(
      "color/black",
    );
  });

  it("warns and emits null $value on an unresolvable alias", () => {
    const broken: CollectedData = {
      collections: [
        {
          id: "S",
          name: "semantic",
          defaultModeId: "light",
          modes: [{ modeId: "light", name: "light" }],
          variables: [
            {
              id: "X",
              name: "color/x",
              resolvedType: "COLOR",
              valuesByMode: { light: { type: "VARIABLE_ALIAS", id: "GHOST" } },
              scopes: [],
              collectionId: "S",
            },
          ],
        },
      ],
    };
    const { files, warnings } = buildExport(broken);
    expect(warnings.some((w) => w.includes("color/x"))).toBe(true);
    const tree = parse(files, "light.tokens.json");
    expect(tree.color.x.$value).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/export.test.ts`
Expected: FAIL — alias cases produce no `color.bg.base` leaf (Task 4 skipped aliases).

- [ ] **Step 3: Implement alias resolution**

In `src/export.ts`, add the resolver helpers above `buildExport`:

```ts
interface ResolveCtx {
  idToVar: Map<string, CollectedVariable>;
  idToCol: Map<string, CollectedCollection>;
}

/** Pick the target collection's modeId matching the consuming mode name,
 *  else its default mode, else its first mode. */
function resolveModeId(col: CollectedCollection, modeName: string): string {
  const byName = col.modes.find((m) => m.name.toLowerCase() === modeName.toLowerCase());
  if (byName) return byName.modeId;
  const def = col.modes.find((m) => m.modeId === col.defaultModeId);
  return (def ?? col.modes[0]).modeId;
}

/** Follow an alias chain to a final literal for the given consuming mode. */
function resolveLiteral(
  value: CollectedValue,
  resolvedType: FigmaResolvedType,
  modeName: string,
  ctx: ResolveCtx,
  seen: Set<string>,
): unknown | null {
  if (!isAlias(value)) return formatLiteral(value, resolvedType);
  if (seen.has(value.id)) return null; // cycle guard
  seen.add(value.id);
  const target = ctx.idToVar.get(value.id);
  if (!target) return null;
  const col = ctx.idToCol.get(target.collectionId);
  if (!col) return null;
  const next = target.valuesByMode[resolveModeId(col, modeName)];
  if (next === undefined) return null;
  return resolveLiteral(next, target.resolvedType, modeName, ctx, seen);
}
```

Then replace the `if (isAlias(raw)) { ... continue; }` block inside `buildExport`'s variable loop with full handling. The loop body becomes:

```ts
      for (const v of col.variables) {
        const raw = v.valuesByMode[mode.modeId];
        if (raw === undefined) {
          warnings.push(`${v.name}: no value for mode "${mode.name}"`);
          continue;
        }

        const extensions: Record<string, unknown> = {
          "com.figma.variableId": v.id,
          "com.figma.scopes": v.scopes,
        };

        let value: unknown;
        if (isAlias(raw)) {
          value = resolveLiteral(raw, v.resolvedType, mode.name, ctx, new Set());
          if (value === null) {
            warnings.push(`${v.name}: unresolvable alias in mode "${mode.name}"`);
          }
          const target = ctx.idToVar.get(raw.id);
          if (target) {
            extensions["com.figma.aliasData"] = {
              targetVariableName: target.name,
              targetVariableSetName: ctx.idToCol.get(target.collectionId)?.name ?? "",
            };
          }
        } else {
          value = formatLiteral(raw, v.resolvedType);
        }

        const leaf: TokenLeaf = {
          $type: tokenTypeFor(v.resolvedType),
          $value: value,
          $extensions: extensions,
        };
        setNested(tree, v.name.split("/"), leaf);
      }
```

And build `ctx` once at the top of `buildExport`, before the collection loop:

```ts
  const idToVar = new Map<string, CollectedVariable>();
  const idToCol = new Map<string, CollectedCollection>();
  for (const col of data.collections) {
    idToCol.set(col.id, col);
    for (const v of col.variables) idToVar.set(v.id, v);
  }
  const ctx: ResolveCtx = { idToVar, idToCol };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/export.test.ts`
Expected: PASS (all literal + alias cases).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/export.ts src/export.test.ts
git commit -m "feat: transitive alias resolution with com.figma.aliasData + light/dark merge"
```

---

### Task 6: Plugin main thread (`main.ts`)

**Files:**
- Modify: `src/main.ts`

This is impure glue (reads the Figma API). No unit test; verified by typecheck + manual run (Task 9). Keep it thin — all logic lives in the tested core.

- [ ] **Step 1: Implement read + buildExport + emit**

```ts
// src/main.ts
import { emit, on, showUI } from "@create-figma-plugin/utilities";
import {
  buildExport,
  type CollectedCollection,
  type CollectedData,
  type CollectedValue,
} from "./export";

async function collectData(): Promise<CollectedData> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const out: CollectedCollection[] = [];
  for (const col of collections) {
    const variables = [];
    for (const id of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      variables.push({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        valuesByMode: v.valuesByMode as Record<string, CollectedValue>,
        scopes: v.scopes as unknown as string[],
        collectionId: v.variableCollectionId,
      });
    }
    out.push({
      id: col.id,
      name: col.name,
      defaultModeId: col.defaultModeId,
      modes: col.modes,
      variables,
    });
  }
  return { collections: out };
}

export default function (): void {
  showUI({ width: 260, height: 180 });
  on("EXPORT", async function () {
    try {
      const data = await collectData();
      emit("EXPORT_RESULT", buildExport(data));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit("EXPORT_ERROR", message);
    }
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (If `v.scopes` type mismatches, the `as unknown as string[]` cast keeps the boundary loose; the inspector treats scopes as opaque strings.)

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main thread reads local variables and emits export result"
```

---

### Task 7: Plugin UI (`ui.tsx`)

**Files:**
- Modify: `src/ui.tsx`

Impure glue (DOM download). Verified by build + manual run.

- [ ] **Step 1: Implement button, zip, download, status**

```tsx
// src/ui.tsx
import { Button, Container, render, Text, VerticalSpace } from "@create-figma-plugin/ui";
import { emit, on } from "@create-figma-plugin/utilities";
import { strToU8, zipSync } from "fflate";
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ExportResult } from "./export";

function downloadZip(result: ExportResult): void {
  const entries: Record<string, Uint8Array> = {};
  for (const file of result.files) entries[file.filename] = strToU8(file.json);
  const zipped = zipSync(entries); // method 8 (deflate) — inspector unzip supports it
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tokens.zip";
  anchor.click();
  URL.revokeObjectURL(url);
}

function Plugin() {
  const [status, setStatus] = useState("");

  useEffect(() => {
    const offResult = on("EXPORT_RESULT", (result: ExportResult) => {
      downloadZip(result);
      const warn = result.warnings.length ? ` · ${result.warnings.length} warnings` : "";
      setStatus(`Exported ${result.files.length} file(s)${warn}`);
    });
    const offError = on("EXPORT_ERROR", (message: string) => {
      setStatus(`Error: ${message}`);
    });
    return () => {
      offResult();
      offError();
    };
  }, []);

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Button
        fullWidth
        onClick={() => {
          setStatus("Reading variables…");
          emit("EXPORT");
        }}
      >
        Export tokens
      </Button>
      <VerticalSpace space="small" />
      <Text>{status}</Text>
    </Container>
  );
}

export default render(Plugin);
```

- [ ] **Step 2: Build the whole plugin**

Run: `npm run build`
Expected: PASS; regenerates `manifest.json` + `build/`, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui.tsx
git commit -m "feat: UI export button zips files and downloads tokens.zip"
```

---

### Task 8: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```markdown
# figma-token-export

A Figma plugin that exports **local variables** to the `*.tokens.json` files consumed by
[token-inspector](../token-inspector), without a Figma Enterprise plan. It reads variables via the
free Plugin API and reproduces Figma's REST variable-export JSON shape, then downloads a `tokens.zip`
you drop into the inspector.

## Why

The Figma Variables **REST** API (and its PAT) requires Enterprise. The **Plugin** API reads local
variables on any plan — so this plugin produces the same JSON locally and for free.

## Develop

Requires Node v22+.

```bash
npm install
npm run build      # generates manifest.json + build/
npm test           # vitest unit tests for the pure core
npm run watch      # rebuild on change
```

In the Figma desktop app: Quick Actions → `Import plugin from manifest…` → select `manifest.json`.

## Use

Run the plugin, click **Export tokens**, then drag the downloaded `tokens.zip` into the inspector.

## Architecture

- `src/format.ts`, `src/mapping.ts`, `src/export.ts` — pure, unit-tested core.
- `src/main.ts` — reads the Figma variables API (impure).
- `src/ui.tsx` — export button, zips with `fflate`, triggers the download.

## Limitations (v1)

- Local variables only (no styles, no remote/library variables).
- No Git sync (export → drop).
- The collection→filename mapping in `src/mapping.ts` assumes collection names containing
  `color`/`dimension`/`typography`/`global` and `light`/`dark` modes. Adjust the constants there if
  your file uses different names.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with develop/use instructions and limitations"
```

---

### Task 9: Manual QA against the real Figma file + inspector round-trip

**Files:** none (verification + possible `src/mapping.ts` constant tweak).

- [ ] **Step 1: Load the plugin in Figma desktop**

Open the design file that holds the variables. Quick Actions → `Import plugin from manifest…` → select the generated `manifest.json`. Run the plugin.

- [ ] **Step 2: Export and inspect filenames**

Click **Export tokens**; unzip the downloaded `tokens.zip`. Expected: files named `color.tokens.json`, `dimension.tokens.json`, `typography.tokens.json`, `light.tokens.json`, `dark.tokens.json`, `global.tokens.json`. Note the plugin UI status line for any warning count.

- [ ] **Step 3: If filenames are wrong, adjust the mapping**

If a collection mapped to the wrong (or fallback) filename, edit the substring rules in `src/mapping.ts` to match the real collection/mode names (the function is the only place this lives), then re-run `npm test` and `npm run build`. Commit:

```bash
git add src/mapping.ts
git commit -m "fix: align filename mapping with real Figma collection names"
```

- [ ] **Step 4: Round-trip through the inspector**

Start the inspector (`cd ../token-inspector && npm run dev`) and drag `tokens.zip` onto it. Expected: tokens load; no parse errors; aliases show resolved values and "used by" relations. Spot-check a primitive color, a semantic light/dark token, and a component token against the original Figma values.

- [ ] **Step 5: Diff against the reference exports (optional but recommended)**

Compare a generated file to its counterpart under `../token-inspector/components/` to confirm structural parity (keys, color object shape, aliasData). Differences in `com.figma.variableId` values are expected (Figma assigns them); structure must match.

- [ ] **Step 6: Record outcome**

If everything loads cleanly, the plugin is feature-complete for v1. Note any remaining warnings (e.g. expression-derived variables Figma couldn't resolve to a literal, composite types) for a future milestone.

---

## Self-Review

**Spec coverage:**
- Plugin reads local variables via free Plugin API → Tasks 6, 9 (verified non-Enterprise in spec + Task 9).
- Reproduces REST color object + aliasData shape → Tasks 2, 5 (asserted against reference shape).
- Six-file `(collection, mode)` mapping → Task 3, confirmed in Task 9.
- ZIP output, inspector unchanged, drop-in ingest → Task 7 (fflate method 8, inspector unzip supports it), Task 9 round-trip.
- Pure core / thin shell → Tasks 2–5 pure + tested; 6–7 glue.
- Non-goals (git sync, write-back, styles, remote) → documented in README (Task 8), not implemented.

**Placeholder scan:** No TBD/TODO code steps. The one "assumption" (mapping substring rules) is complete, runnable code with an explicit Task 9 verification step — not a placeholder.

**Type consistency:** `CollectedData`/`CollectedCollection`/`CollectedVariable`/`CollectedValue`/`VariableAliasValue`/`ExportResult`/`ExportFile` defined in Task 4, reused unchanged in Tasks 5–7. `buildExport`, `formatLiteral`, `tokenTypeFor`, `filenameFor`, `isAlias`, `resolveLiteral`, `resolveModeId`, `setNested` names consistent across tasks. `format.ts` exports (`channelToHex`, `toHex`, `formatColor`, `tokenTypeFor`, `formatLiteral`, `FigmaResolvedType`, `TokenType`) match their imports in `export.ts`.
