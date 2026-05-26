# git-export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Commit to GitHub" export (one atomic commit of the six `*.tokens.json` files via a fine-grained PAT) plus a timestamped `.zip` download, to the existing token-export Figma plugin.

**Architecture:** The pure v1 core (`format`/`mapping`/`export`) is untouched. New work is a transport layer: a `GitProvider` interface with a GitHub implementation (Git Data API, injectable `fetch` → unit-testable), pure `settings`/`timestamp` helpers, and glue in `main.ts` (reads variables → `buildExport` → commits in the main thread, where the PAT lives in `clientStorage` and never crosses to the UI) and `ui.tsx` (settings form + two buttons).

**Tech Stack:** TypeScript, create-figma-plugin (esbuild + Preact UI), `@figma/plugin-typings`, `fflate` (zip), vitest. GitHub REST Git Data API.

**Spec:** `../specs/2026-05-26-git-export-design.md`. Branch: `feat/git-export` (off merged `main`, v1 present).

---

## File Structure

```
src/
  timestamp.ts        # PURE: timestampedZipName(date) -> "tokens-YYYYMMDD-HHMMSS.zip"
  timestamp.test.ts
  settings.ts         # PURE: Settings type, validateSettings, normalizePath
  settings.test.ts
  git/
    provider.ts       # PURE: GitFile/CommitRequest/CommitResult types, CommitError, GitProvider iface
    github.ts         # createGitHubProvider(fetchFn): Git Data API commit (testable via injected fetch)
    github.test.ts
  main.ts             # MODIFY: settings load/save (clientStorage), COMMIT + EXPORT_ZIP handlers
  ui.tsx              # MODIFY: settings form + Commit button + timestamped zip + status
  export.ts, format.ts, mapping.ts   # unchanged
package.json          # MODIFY: figma-plugin.networkAccess -> api.github.com
README.md             # MODIFY: document the GitHub commit workflow
```

---

### Task 1: Timestamped zip filename (`timestamp.ts`)

**Files:**
- Create: `src/timestamp.ts`, `src/timestamp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/timestamp.test.ts
import { describe, expect, it } from "vitest";
import { timestampedZipName } from "./timestamp";

describe("timestampedZipName", () => {
  it("formats local date-time as tokens-YYYYMMDD-HHMMSS.zip with zero-padding", () => {
    const d = new Date(2026, 4, 6, 9, 7, 3); // 2026-05-06 09:07:03 local
    expect(timestampedZipName(d)).toBe("tokens-20260506-090703.zip");
  });

  it("handles double-digit components", () => {
    const d = new Date(2026, 10, 26, 12, 30, 45); // 2026-11-26 12:30:45 local
    expect(timestampedZipName(d)).toBe("tokens-20261126-123045.zip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/timestamp.test.ts`
Expected: FAIL — cannot resolve `./timestamp`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/timestamp.ts
// Pure helper: a sortable, human-readable filename for snapshot zips.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function timestampedZipName(date: Date): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `tokens-${y}${mo}${d}-${h}${mi}${s}.zip`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/timestamp.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add src/timestamp.ts src/timestamp.test.ts
git commit -m "feat: timestamped zip filename helper"
```

---

### Task 2: Settings type + validation (`settings.ts`)

**Files:**
- Create: `src/settings.ts`, `src/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/settings.test.ts`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/settings.ts
// GitHub target settings + pure validation. clientStorage I/O lives in main.ts
// (this module stays pure and testable).

export interface Settings {
  owner: string;
  repo: string;
  branch: string;
  /** Repo-relative folder for the token files; "" = repo root. */
  path: string;
}

export function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

export function validateSettings(s: Settings): string[] {
  const errors: string[] = [];
  if (!s.owner.trim()) errors.push("owner is required");
  if (!s.repo.trim()) errors.push("repo is required");
  if (!s.branch.trim()) errors.push("branch is required");
  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/settings.test.ts
git commit -m "feat: git target settings type + validation"
```

---

### Task 3: Git provider contract (`git/provider.ts`)

**Files:**
- Create: `src/git/provider.ts`, `src/git/provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/git/provider.test.ts`
Expected: FAIL — cannot resolve `./provider`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/git/provider.ts
// Provider-agnostic git commit contract. Only GitHub is implemented in v1,
// but the interface lets GitLab/etc. be added without touching callers.

export interface GitFile {
  /** Repo-relative path, e.g. "tokens/color.tokens.json". */
  path: string;
  /** UTF-8 file content. */
  content: string;
}

export interface CommitRequest {
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: GitFile[];
  token: string;
}

export interface CommitResult {
  /** New commit sha. */
  sha: string;
  /** html_url of the new commit. */
  commitUrl: string;
}

export type CommitErrorKind =
  | "auth"
  | "not-found"
  | "empty-repo"
  | "network"
  | "unexpected";

export class CommitError extends Error {
  constructor(public readonly kind: CommitErrorKind, message: string) {
    super(message);
    this.name = "CommitError";
  }
}

export interface GitProvider {
  commit(req: CommitRequest): Promise<CommitResult>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/git/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git/provider.ts src/git/provider.test.ts
git commit -m "feat: GitProvider contract + typed CommitError"
```

---

### Task 4: GitHub commit via Git Data API (`git/github.ts`)

**Files:**
- Create: `src/git/github.ts`, `src/git/github.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/git/github.test.ts
import { describe, expect, it } from "vitest";
import { createGitHubProvider } from "./github";
import type { CommitRequest } from "./provider";

function req(files = 2): CommitRequest {
  return {
    owner: "me",
    repo: "tokens",
    branch: "main",
    message: "msg",
    token: "TKN",
    files: Array.from({ length: files }, (_, i) => ({
      path: `tokens/f${i}.json`,
      content: `{"i":${i}}`,
    })),
  };
}

/** Routes by method + URL substring; blob POSTs get incrementing shas. */
function mockFetch(overrides: Record<string, { status: number; body?: unknown }> = {}) {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  let blob = 0;
  const fn = async (url: string, init?: any): Promise<Response> => {
    const method = (init?.method ?? "GET") as string;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const key = Object.keys(overrides).find((k) => url.includes(k));
    if (key) {
      const o = overrides[key];
      if (o.status === -1) throw new Error("network down");
      return new Response(o.body === undefined ? "" : JSON.stringify(o.body), { status: o.status });
    }
    if (method === "GET" && url.includes("/git/ref/heads/")) return json({ object: { sha: "BASE" } });
    if (method === "GET" && url.includes("/git/commits/")) return json({ tree: { sha: "BASETREE" } });
    if (method === "POST" && url.includes("/git/blobs")) return json({ sha: `BLOB${++blob}` });
    if (method === "POST" && url.includes("/git/trees")) return json({ sha: "NEWTREE" });
    if (method === "POST" && url.includes("/git/commits"))
      return json({ sha: "NEWCOMMIT", html_url: "https://github.com/me/tokens/commit/NEWCOMMIT" });
    if (method === "PATCH" && url.includes("/git/refs/heads/")) return json({ object: { sha: "NEWCOMMIT" } });
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fn: fn as unknown as typeof fetch, calls };
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("createGitHubProvider.commit — happy path", () => {
  it("creates one commit referencing all blobs and returns the commit url", async () => {
    const { fn, calls } = mockFetch();
    const result = await createGitHubProvider(fn).commit(req(2));

    expect(result).toEqual({
      sha: "NEWCOMMIT",
      commitUrl: "https://github.com/me/tokens/commit/NEWCOMMIT",
    });

    const blobPosts = calls.filter((c) => c.method === "POST" && c.url.includes("/git/blobs"));
    expect(blobPosts.length).toBe(2);
    expect(blobPosts[0].body).toEqual({ content: '{"i":0}', encoding: "utf-8" });

    const treePost = calls.find((c) => c.url.includes("/git/trees"))!;
    expect(treePost.body.base_tree).toBe("BASETREE");
    expect(treePost.body.tree).toEqual([
      { path: "tokens/f0.json", mode: "100644", type: "blob", sha: "BLOB1" },
      { path: "tokens/f1.json", mode: "100644", type: "blob", sha: "BLOB2" },
    ]);

    const commitPost = calls.find((c) => c.url.endsWith("/git/commits"))!;
    expect(commitPost.body).toEqual({ message: "msg", tree: "NEWTREE", parents: ["BASE"] });

    const refPatch = calls.find((c) => c.method === "PATCH")!;
    expect(refPatch.body).toEqual({ sha: "NEWCOMMIT" });
  });
});

describe("createGitHubProvider.commit — errors", () => {
  it("maps 401 to auth", async () => {
    const { fn } = mockFetch({ "/git/ref/heads/": { status: 401 } });
    await expect(createGitHubProvider(fn).commit(req())).rejects.toMatchObject({ kind: "auth" });
  });
  it("maps 404 to not-found", async () => {
    const { fn } = mockFetch({ "/git/ref/heads/": { status: 404 } });
    await expect(createGitHubProvider(fn).commit(req())).rejects.toMatchObject({ kind: "not-found" });
  });
  it("maps 409 to empty-repo", async () => {
    const { fn } = mockFetch({ "/git/ref/heads/": { status: 409 } });
    await expect(createGitHubProvider(fn).commit(req())).rejects.toMatchObject({ kind: "empty-repo" });
  });
  it("maps a thrown fetch to network", async () => {
    const { fn } = mockFetch({ "/git/ref/heads/": { status: -1 } });
    await expect(createGitHubProvider(fn).commit(req())).rejects.toMatchObject({ kind: "network" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/git/github.test.ts`
Expected: FAIL — cannot resolve `./github`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/git/github.ts
// GitHub GitProvider using the Git Data API so all files land in ONE commit.
// fetch is injected for testability (defaults to the global Fetch API, which
// Figma exposes in the plugin main thread).

import {
  CommitError,
  type CommitRequest,
  type CommitResult,
  type GitProvider,
} from "./provider";

const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export function createGitHubProvider(fetchFn: typeof fetch = fetch): GitProvider {
  async function call(method: string, url: string, token: string, body?: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method,
        headers: headers(token),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new CommitError("network", `Network error reaching api.github.com: ${msg}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new CommitError("auth", "GitHub token invalid or missing Contents write permission");
      }
      if (res.status === 404) {
        throw new CommitError("not-found", "Repo or branch not found — check owner/repo/branch");
      }
      if (res.status === 409) {
        throw new CommitError("empty-repo", "Target branch has no commits yet — create an initial commit first");
      }
      throw new CommitError("unexpected", `GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  return {
    async commit(req: CommitRequest): Promise<CommitResult> {
      const base = `${API}/repos/${req.owner}/${req.repo}`;

      const ref = await call("GET", `${base}/git/ref/heads/${req.branch}`, req.token);
      const baseSha: string = ref.object.sha;

      const baseCommit = await call("GET", `${base}/git/commits/${baseSha}`, req.token);
      const baseTree: string = baseCommit.tree.sha;

      const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      for (const f of req.files) {
        const blob = await call("POST", `${base}/git/blobs`, req.token, {
          content: f.content,
          encoding: "utf-8",
        });
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      }

      const newTree = await call("POST", `${base}/git/trees`, req.token, {
        base_tree: baseTree,
        tree,
      });

      const commit = await call("POST", `${base}/git/commits`, req.token, {
        message: req.message,
        tree: newTree.sha,
        parents: [baseSha],
      });

      await call("PATCH", `${base}/git/refs/heads/${req.branch}`, req.token, { sha: commit.sha });

      return { sha: commit.sha, commitUrl: commit.html_url };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/git/github.test.ts`
Expected: PASS (happy path + 4 error cases).

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass (v1's 22 + the new tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/git/github.ts src/git/github.test.ts
git commit -m "feat: GitHub Git Data API atomic commit with error mapping"
```

---

### Task 5: Main thread — settings + commit/zip handlers (`main.ts`)

**Files:**
- Modify: `src/main.ts` (replace contents)

Impure glue (Figma API + clientStorage + network). No unit test; verified by typecheck/build + manual QA. The PAT is read from `clientStorage` in the main thread and passed only to `createGitHubProvider().commit(...)` — it is never emitted to the UI.

- [ ] **Step 1: Replace `src/main.ts`**

```ts
import { emit, on, showUI } from "@create-figma-plugin/utilities";
import {
  buildExport,
  type CollectedCollection,
  type CollectedData,
  type CollectedValue,
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
    const variables: CollectedCollection["variables"] = [];
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (If `CollectedCollection["variables"]` indexing errors, replace the annotation with `const variables: import("./export").CollectedVariable[] = []` and add `type CollectedVariable` to the import — the v1 type exists.)

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main thread settings storage + GitHub commit / zip handlers"
```

---

### Task 6: UI — settings form + commit/zip buttons (`ui.tsx`)

**Files:**
- Modify: `src/ui.tsx` (replace contents)

Impure glue (DOM + events). Verified by build + manual QA. The token field sends its value to main on Save and is never populated from main (main reports only `tokenSet`).

- [ ] **Step 1: Replace `src/ui.tsx`**

```tsx
import { Button, Container, render, Text, Textbox, VerticalSpace } from "@create-figma-plugin/ui";
import { emit, on } from "@create-figma-plugin/utilities";
import { strToU8, zipSync } from "fflate";
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ExportResult } from "./export";
import type { Settings } from "./settings";
import { timestampedZipName } from "./timestamp";

const EMPTY: Settings = { owner: "", repo: "", branch: "main", path: "tokens" };

function download(files: ExportResult["files"]): void {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.filename] = strToU8(f.json);
  const blob = new Blob([zipSync(entries)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = timestampedZipName(new Date());
  a.click();
  URL.revokeObjectURL(url);
}

function Plugin() {
  const [s, setS] = useState<Settings>(EMPTY);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const offLoaded = on("SETTINGS_LOADED", (p: { settings: Settings | null; tokenSet: boolean }) => {
      if (p.settings) setS(p.settings);
      setTokenSet(p.tokenSet);
    });
    const offSettingsErr = on("SETTINGS_ERROR", (m: string) => setStatus(`Settings: ${m}`));
    const offCommit = on("COMMIT_RESULT", (p: { commitUrl: string }) => setStatus(`Committed: ${p.commitUrl}`));
    const offCommitErr = on("COMMIT_ERROR", (p: { kind: string; message: string }) =>
      setStatus(`Error (${p.kind}): ${p.message}`),
    );
    const offZip = on("ZIP_FILES", (r: ExportResult) => {
      if (r.files.length === 0) {
        setStatus("No variable collections found.");
        return;
      }
      download(r.files);
      const warn = r.warnings.length ? ` · ${r.warnings.length} warnings` : "";
      setStatus(`Downloaded ${r.files.length} file(s)${warn}`);
    });
    return () => {
      offLoaded();
      offSettingsErr();
      offCommit();
      offCommitErr();
      offZip();
    };
  }, []);

  const set = (k: keyof Settings) => (value: string) => setS({ ...s, [k]: value });

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Text>GitHub target</Text>
      <VerticalSpace space="small" />
      <Textbox onValueInput={set("owner")} value={s.owner} placeholder="owner" />
      <VerticalSpace space="small" />
      <Textbox onValueInput={set("repo")} value={s.repo} placeholder="repo" />
      <VerticalSpace space="small" />
      <Textbox onValueInput={set("branch")} value={s.branch} placeholder="branch" />
      <VerticalSpace space="small" />
      <Textbox onValueInput={set("path")} value={s.path} placeholder="path (folder, blank = root)" />
      <VerticalSpace space="small" />
      <input
        type="password"
        value={tokenInput}
        placeholder={tokenSet ? "token set — paste to replace" : "fine-grained PAT (Contents: write)"}
        onInput={(e) => setTokenInput((e.target as HTMLInputElement).value)}
        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px" }}
      />
      <VerticalSpace space="small" />
      <Button
        secondary
        fullWidth
        onClick={() => {
          emit("SAVE_SETTINGS", { settings: s, token: tokenInput || undefined });
          setTokenInput("");
          setStatus("Settings saved");
        }}
      >
        Save settings
      </Button>
      <VerticalSpace space="medium" />
      <Button
        fullWidth
        onClick={() => {
          setStatus("Committing…");
          emit("COMMIT", {});
        }}
      >
        Commit to GitHub
      </Button>
      <VerticalSpace space="small" />
      <Button
        secondary
        fullWidth
        onClick={() => {
          setStatus("Reading variables…");
          emit("EXPORT_ZIP");
        }}
      >
        Download .zip
      </Button>
      <VerticalSpace space="small" />
      <Text>{status}</Text>
    </Container>
  );
}

export default render(Plugin);
```

- [ ] **Step 2: Build the plugin**

Run: `npm run build`
Expected: PASS; regenerates `manifest.json` + `build/`, no type errors. (If `Textbox`'s prop is named differently in the installed `@create-figma-plugin/ui` version, the build's typecheck will say so — use the prop it reports; `onValueInput` + `value` is the v4 API.)

- [ ] **Step 3: Commit**

```bash
git add src/ui.tsx
git commit -m "feat: UI settings form, Commit to GitHub, timestamped zip download"
```

---

### Task 7: Manifest network access + README

**Files:**
- Modify: `package.json` (the `figma-plugin` block), `README.md`

- [ ] **Step 1: Update `networkAccess` in `package.json`**

Replace the `figma-plugin.networkAccess` value (currently `{ "allowedDomains": ["none"] }`) with:

```json
    "networkAccess": {
      "allowedDomains": ["https://api.github.com"],
      "reasoning": "Commit exported design tokens to the configured GitHub repository."
    }
```

- [ ] **Step 2: Rebuild to confirm the manifest is valid**

Run: `npm run build`
Expected: PASS; `manifest.json` regenerated with the new `networkAccess`.

- [ ] **Step 3: Add a "Commit to GitHub" section to `README.md`**

Insert after the `## Use` section:

```markdown
## Commit to GitHub

1. Create a **fine-grained Personal Access Token** scoped to your tokens repo with
   **Contents: read and write**.
2. In the plugin, fill in **owner / repo / branch / path**, paste the **PAT**, and click
   **Save settings** (stored in Figma `clientStorage`; the token stays in the plugin's main
   thread and is never sent to the UI).
3. Click **Commit to GitHub** — the six `*.tokens.json` files are written as one atomic commit;
   the commit URL appears in the status line.

**Download .zip** still works as an offline snapshot (filename `tokens-YYYYMMDD-HHMMSS.zip`).
```

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: allow api.github.com network access; document commit workflow"
```

---

### Task 8: Manual QA (user — needs Figma + GitHub)

**Files:** none.

- [ ] **Step 1: Build + import**

Run `npm install && npm run build` if needed; in Figma desktop, re-import the plugin from `manifest.json` (the network-access change requires a re-import).

- [ ] **Step 2: Configure + commit**

Enter owner/repo/branch/path, paste a fine-grained PAT, **Save settings**. Click **Commit to GitHub**. Expected: status shows a commit URL; the repo shows **one** commit adding/updating the six `*.tokens.json` files under the configured path, with readable per-file diffs.

- [ ] **Step 3: Error paths**

Try a wrong branch (expect "Repo or branch not found"), and an invalid token (expect "GitHub token invalid…"). Confirm the messages are clear.

- [ ] **Step 4: Zip fallback**

Click **Download .zip**; confirm the filename is `tokens-YYYYMMDD-HHMMSS.zip` and it loads in the inspector.

---

## Self-Review

**Spec coverage:**
- Commit to GitHub as one atomic commit → Task 4 (Git Data API) + Task 5 (wiring).
- Timestamped zip → Task 1 + Task 6.
- PAT auth, main-thread, never to UI → Task 5 (clientStorage read in main; only `tokenSet` emitted) + Task 6 (token input never populated from main).
- `GitProvider` interface, GitHub-only → Task 3 + Task 4.
- Settings + clientStorage → Task 2 (pure) + Task 5 (I/O).
- networkAccess api.github.com → Task 7.
- Error kinds (auth/not-found/empty-repo/network/unexpected) → Task 4 (mapping + tests) surfaced in Task 6.
- Non-goals (OAuth, other providers, two-way, inspector URL-fetch) → not implemented.

**Placeholder scan:** No TBD/TODO code steps; every code step shows complete code. The Task 5/Task 6 fallback notes (type-index, Textbox prop) are concrete contingencies tied to the build's own error output, not placeholders.

**Type consistency:** `Settings` (owner/repo/branch/path) consistent across Tasks 2/5/6. `GitFile`/`CommitRequest`/`CommitResult`/`CommitError`/`CommitErrorKind`/`GitProvider` defined in Task 3, used unchanged in Tasks 4/5. `createGitHubProvider(fetchFn?)`, `validateSettings`, `normalizePath`, `timestampedZipName`, `buildExport`/`ExportResult` names match across tasks. Event names (`SETTINGS_LOADED`, `SAVE_SETTINGS`, `SETTINGS_ERROR`, `COMMIT`, `COMMIT_RESULT`, `COMMIT_ERROR`, `EXPORT_ZIP`, `ZIP_FILES`) are paired identically between Task 5 (main) and Task 6 (ui).
