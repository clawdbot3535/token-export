# figma-token-export

A Figma plugin that exports **local variables** to the `*.tokens.json` files consumed by
[token-inspector](../token-inspector), without a Figma Enterprise plan. It reads variables via the
free Plugin API and reproduces Figma's REST variable-export JSON shape, then downloads a `tokens.zip`
you drop into the inspector.

## Why

The Figma Variables **REST** API (and its personal access token) requires Enterprise. The **Plugin**
API reads local variables on any plan — so this plugin produces the same JSON locally and for free.

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
- Collections that merge into `global.tokens.json` and whose variables are not self-prefixed
  (e.g. `components/sidebar`) lose their namespace and surface as ungrouped tokens in the
  inspector. Deferred — see [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).
