import { emit, on, showUI } from "@create-figma-plugin/utilities";
import {
  buildExport,
  type CollectedCollection,
  type CollectedData,
  type CollectedValue,
  type CollectedVariable,
} from "./export";
import { createGitHubProvider } from "./git/github";
import { CommitError, type GitFile } from "./git/provider";
import { normalizePath, type Settings, validateSettings } from "./settings";

const SETTINGS_KEY = "tokenexport.settings";
const TOKEN_KEY = "tokenexport.token";

async function collectData(): Promise<CollectedData> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const out: CollectedCollection[] = [];
  for (const col of collections) {
    const variables: CollectedVariable[] = [];
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

async function loadSettings(): Promise<{ settings: Settings | null; tokenSet: boolean }> {
  const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) as Settings | undefined;
  const token = (await figma.clientStorage.getAsync(TOKEN_KEY)) as string | undefined;
  return { settings: settings ?? null, tokenSet: Boolean(token) };
}

export default function (): void {
  showUI({ width: 320, height: 480 });

  loadSettings().then((s) => emit("SETTINGS_LOADED", s));

  on("SAVE_SETTINGS", async function (payload: { settings: Settings; token?: string }) {
    const errors = validateSettings(payload.settings);
    if (errors.length > 0) {
      emit("SETTINGS_ERROR", errors.join("; "));
      return;
    }
    const normalized: Settings = { ...payload.settings, path: normalizePath(payload.settings.path) };
    await figma.clientStorage.setAsync(SETTINGS_KEY, normalized);
    if (payload.token && payload.token.trim()) {
      await figma.clientStorage.setAsync(TOKEN_KEY, payload.token.trim());
    }
    emit("SETTINGS_LOADED", await loadSettings());
  });

  on("EXPORT_ZIP", async function () {
    try {
      emit("ZIP_FILES", buildExport(await collectData()));
    } catch (err) {
      emit("COMMIT_ERROR", { kind: "unexpected", message: err instanceof Error ? err.message : String(err) });
    }
  });

  on("COMMIT", async function (payload: { message?: string }) {
    const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) as Settings | undefined;
    const token = (await figma.clientStorage.getAsync(TOKEN_KEY)) as string | undefined;
    if (!settings || !token) {
      emit("COMMIT_ERROR", { kind: "auth", message: "Configure repo settings and a token first" });
      return;
    }
    try {
      const { files } = buildExport(await collectData());
      const path = normalizePath(settings.path);
      const gitFiles: GitFile[] = files.map((f) => ({
        path: path ? `${path}/${f.filename}` : f.filename,
        content: f.json,
      }));
      const message =
        payload.message && payload.message.trim()
          ? payload.message.trim()
          : `Update design tokens (${files.length} files) — ${new Date().toISOString()}`;
      const result = await createGitHubProvider().commit({
        owner: settings.owner,
        repo: settings.repo,
        branch: settings.branch,
        message,
        files: gitFiles,
        token,
      });
      emit("COMMIT_RESULT", { commitUrl: result.commitUrl });
    } catch (err) {
      if (err instanceof CommitError) {
        emit("COMMIT_ERROR", { kind: err.kind, message: err.message });
      } else {
        emit("COMMIT_ERROR", { kind: "unexpected", message: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
