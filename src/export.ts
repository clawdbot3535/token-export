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
