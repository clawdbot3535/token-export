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
      modes: col.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
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
