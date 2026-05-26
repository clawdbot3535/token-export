# figma-token-export — Design

**Date:** 2026-05-26
**Status:** Approved (pending spec review)
**Repo:** `/Users/christian/Dev/figma-token-export` (standalone)
**Consumer:** [`token-inspector`](../../../../token-inspector) — Figma → Nuxt UI v4 design-token adapter/inspector

---

## Problem

`token-inspector` was built and tested against **Figma's native REST variable export** — the
JSON returned by `GET /v1/files/:key/variables/local`. That endpoint is gated behind a Figma
**Enterprise** plan (the Personal Access Token for variables requires Enterprise). Without it,
there is no first-party way to get variables out of Figma in the shape the inspector expects.

Two non-starters were evaluated and rejected:

- **Token Studio import** — Token Studio's export (both `$value`/`$type` and `value`/`type`
  key variants of the same file) uses its own type vocabulary (`fontFamilies`, `spacing`,
  `borderRadius`, `boxShadow`, …), inline math expressions (`{dimension.xs} * {dimension.scale}`,
  `roundTo({fontSizes.body}*1.25^5)`), and composite tokens (`typography`, `boxShadow`). Parsing
  it faithfully pulls a large, brittle adapter into the inspector. Rejected.
- **Third-party free export plugins** — none reproduce Figma's `com.figma.aliasData` alias shape,
  so they would still require an inspector-side adapter. Rejected.

## Key insight (the unlock)

Only the **REST** Variables API is Enterprise-gated. The **Figma Plugin API**
(`figma.variables.getLocalVariableCollectionsAsync()`, `getVariableByIdAsync()`, `VariableAlias`)
reads local variables on **every plan, for free** — confirmed against the official Plugin API
docs (no plan restriction listed; the gating appears only on the REST `variables-endpoints` page).

A custom plugin can therefore read the same data the Enterprise REST endpoint exposes and serialize
it into the **identical JSON shape** the inspector already parses. We control the producer, so the
inspector stays unchanged (its 145+ tests already validate the target format).

## Goal

A small, standalone Figma plugin that reads local variables and exports a **ZIP of the six
`*.tokens.json` files** the inspector ingests today — byte-compatible with the existing
`token-inspector/components/*.tokens.json` reference exports.

## Non-goals (v1)

- Git sync (GitHub/GitLab commit). The inspector ingests files (drag-drop / ZIP); "export → drop"
  is enough. Git sync is OAuth + commit-API work, orthogonal to the inspector. Deferred.
- Writing variables **back** into Figma.
- Non-variable styles (text/effect/grid styles).
- Remote/library files (only the current file's **local** variables).
- Any change to `token-inspector`.

## Target format (reference, confirmed)

From `token-inspector/components/color.tokens.json` and `light.tokens.json`:

```jsonc
// primitive color (color.tokens.json) — nested by "/" in the variable name
{
  "color": {
    "white": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [1, 1, 1], "alpha": 1, "hex": "#FFFFFF" },
      "$extensions": {
        "com.figma.variableId": "VariableID:2:55",
        "com.figma.scopes": ["ALL_SCOPES"]
      }
    }
  }
}
```

```jsonc
// aliased semantic token (light.tokens.json) — literal value + aliasData pointer
{
  "color": {
    "bg": {
      "base": {
        "$type": "color",
        "$value": { "colorSpace": "srgb", "components": [1, 1, 1], "alpha": 1, "hex": "#FFFFFF" },
        "$extensions": {
          "com.figma.variableId": "VariableID:2:337",
          "com.figma.scopes": ["ALL_SCOPES"],
          "com.figma.aliasData": {
            "targetVariableName": "color/white",
            "targetVariableSetName": "primitives/color"
          }
        }
      }
    }
  }
}
```

Non-color primitives use `$type: "number"` with a plain numeric `$value` (e.g.
`dimension.tokens.json` → `spacing/0` = `{ "$type": "number", "$value": 0 }`); the inspector
infers CSS units from the token path. Strings use `$type: "string"`.

The six files correspond to `(collection, mode)` pairs:

| File | Source |
|---|---|
| `color.tokens.json` | primitives color collection (single mode) |
| `dimension.tokens.json` | primitives dimension collection (single mode) |
| `typography.tokens.json` | primitives typography collection (single mode) |
| `light.tokens.json` | semantic collection, **light** mode |
| `dark.tokens.json` | semantic collection, **dark** mode |
| `global.tokens.json` | components collection (single mode) |

## Architecture

`create-figma-plugin` scaffold (TypeScript, `@figma/plugin-typings`, built-in build/watch/typecheck
and minimal Preact UI). Three small parts:

```
src/
  main.ts      // sandbox: reads variables, builds files, posts to UI
  ui.tsx       // iframe: "Export tokens" button → triggers ZIP download
  export.ts    // PURE: raw collections/variables in → { filename: jsonObject } out (no figma.*)
  export.test.ts
```

**Why pure `export.ts`:** the Figma sandbox global (`figma.*`) is not testable. `main.ts` does the
thin I/O (read API → plain data structures), then hands plain data to `export.ts`, which is unit-
tested against a mock of the API surface and golden fixtures. This mirrors the inspector's own
"pure engine behind a thin shell" philosophy.

### Data flow

1. `main.ts`: `getLocalVariableCollectionsAsync()` → for each collection, for each mode, for each
   `variableId` → `getVariableByIdAsync(id)`. Collect into plain records
   `{ collections: [{ name, modes, variables: [{ name, resolvedType, valuesByMode, scopes, id, description }] }] }`.
2. `export.ts`:
   - Build a name→id map across all variables (to resolve alias targets to `targetVariableName`).
   - For each `(collection, mode)`: walk its variables, split each `name` on `/` into nested groups,
     and emit a token leaf:
     - **literal** → `$type` + `$value` (see type mapping); for color convert Figma `{r,g,b,a}`
       (0–1 floats) → `{ colorSpace:"srgb", components:[r,g,b], alpha:a, hex }`.
     - **`VariableAlias`** → resolve `value.id` to the target variable; emit the target's **resolved
       literal** for the same mode as `$value`, plus `$extensions["com.figma.aliasData"]`
       (`targetVariableName`, `targetVariableSetName` = target's collection name).
     - always attach `$extensions` (`com.figma.variableId` = `id`, `com.figma.scopes` = `scopes`).
   - Map each `(collection, mode)` to one of the six filenames (see mapping below).
3. `ui.tsx`: receives `{ filename: jsonString }[]`, zips them client-side, triggers a download of
   `tokens.zip`.

### Type mapping

| Figma `resolvedType` | `$type` | `$value` |
|---|---|---|
| `COLOR` | `"color"` | `{ colorSpace:"srgb", components:[r,g,b], alpha, hex }` |
| `FLOAT` | `"number"` | the number |
| `STRING` | `"string"` | the string |
| `BOOLEAN` | `"string"` | stringified (`"true"`/`"false"`) — rare; flagged, not expected in token files |

### Collection/mode → filename mapping

The inspector's loader recognizes exactly six base filenames. A small, readable map in `export.ts`
translates the user's Figma collection names + mode names to those filenames. Default heuristic:

- collection with a single mode → filename by collection role (`color` / `dimension` /
  `typography` / `global`);
- collection with `light` / `dark` modes → one file per mode (`light.tokens.json`,
  `dark.tokens.json`).

**Open item (resolve during implementation):** the *exact* collection names in the user's Figma
file are not yet known (the original six files were produced by an earlier REST split). Confirm by
running the plugin in dev mode (or via the Figma MCP) against the real file and lock the mapping.
Unmapped collections are exported under a sanitized fallback filename and surfaced in the UI rather
than dropped.

### Output delivery

Downloads can only be triggered from the UI iframe, so `ui.tsx` owns the ZIP + download. A single
"Export tokens" button → `tokens.zip` containing the recognized `*.tokens.json` files. The user
drops the ZIP into the inspector (existing ZIP ingest path in `load-sources.ts` → `unzip.ts`).

## Testing

- `export.test.ts`: feed a hand-built mock of the collected API data (covering a primitive color, an
  aliased semantic color across light+dark modes, a numeric primitive, and a string) into
  `export.ts`; assert the emitted objects match the shape of copied golden fixtures derived from
  `token-inspector/components/*.tokens.json`.
- Round-trip confidence: a sample export ZIP loads cleanly in the inspector (manual QA step in the
  plan), proving format compatibility end-to-end.

## Risks & mitigations

- **Plugin API shape drift** — pinned `@figma/plugin-typings`; async (`*Async`) APIs +
  `documentAccess: "dynamic-page"` per current docs.
- **Alias resolves to another alias** — resolve transitively to the final literal for `$value`
  while keeping the *direct* target in `aliasData` (matches REST behavior: REST stores the immediate
  alias target name and the resolved value).
- **Unknown collection names** — fallback filename + UI warning (see open item), never a silent drop.
- **Wrong assumption that Plugin API is free** — already verified against official docs; first plan
  step re-confirms by listing collections in the real file.

## Out-of-scope follow-ups (later milestones)

- Git sync (commit ZIP contents to a repo).
- Configurable mapping UI (instead of code-level map).
- Publish as a private/org Figma plugin (v1 runs in dev mode).
