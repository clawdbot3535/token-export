# git-export — Design

**Date:** 2026-05-26
**Status:** Approved (pending spec review)
**Repo:** `/Users/christian/Dev/figma-token-export`, branch `feat/git-export` (off `main` after PR #1 merged v1)
**Builds on:** the v1 plugin (`format.ts`, `mapping.ts`, `export.ts`, `main.ts`, `ui.tsx`).

---

## Problem

v1 exports a `tokens.zip` the user downloads and drags into `token-inspector`. The user's
priority is **versioned tokens** (git history with meaningful diffs), with losing the manual drag
as a secondary benefit. Versioning is best solved at the source: the plugin commits the token
files directly into a git repo.

## Goal

Add two export targets to the plugin:

1. **Commit to GitHub** — write the six `*.tokens.json` files as **one atomic commit** to a
   configured public GitHub repo/branch/path. Real, reviewable git diffs → versioning solved at the
   source.
2. **Download .zip (timestamped)** — the existing zip download, now named
   `tokens-YYYYMMDD-HHMMSS.zip`, as an offline/fallback snapshot.

## Non-goals (this milestone)

- OAuth (PAT only for v1; OAuth needs a hosted broker — later polish).
- Providers other than GitHub (a `GitProvider` interface is defined so GitLab/etc. can be added
  without rework, but only GitHub is implemented).
- Two-way sync / pulling tokens back into Figma.
- The inspector-side "load from URL" (the read side / full drag removal) — a separate next step in
  `token-inspector`, deferred until this write side is in place.

## Authentication (PAT, main-thread)

- The user creates a **fine-grained GitHub PAT** scoped to the single target repo with
  **Contents: read & write**, and pastes it into the plugin once.
- Settings (`owner`, `repo`, `branch`, `path`, `token`) are stored in **`figma.clientStorage`**
  (main thread, persists across plugin runs).
- **The commit runs in the main thread** (Figma supports `fetch` in `code.js`, gated by
  `networkAccess`). Therefore the PAT never crosses the postMessage bridge to the UI iframe — it
  stays in the sandbox/clientStorage. The UI's PAT input sends the value to main once on save; the
  field is a password input and is not echoed back to the UI after saving (UI shows only
  "token set / not set").
- `manifest.json` (`package.json` → `figma-plugin.networkAccess`): `allowedDomains: ["api.github.com"]`.

## Architecture

The pure v1 core (`format/mapping/export`) is unchanged. New work is the **transport layer**.

```
src/
  git/
    provider.ts     # GitProvider interface + CommitRequest/CommitResult/CommitError types (pure)
    github.ts       # GitHubProvider: Git Data API commit; fetch injected → testable
    github.test.ts
  settings.ts       # Settings type + pure validation; clientStorage load/save helpers
  settings.test.ts  # validation only (pure)
  timestamp.ts      # pure: timestampedZipName(date) -> "tokens-YYYYMMDD-HHMMSS.zip"
  timestamp.test.ts
  main.ts           # + settings load/save, COMMIT (buildExport -> github.commit), EXPORT_ZIP (-> files to UI)
  ui.tsx            # settings form + "Commit to GitHub" + "Download .zip" + status
  export.ts, format.ts, mapping.ts   # unchanged
```

### Types (`git/provider.ts`)

```ts
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
  sha: string;       // new commit sha
  commitUrl: string; // html_url of the commit
}
export type CommitErrorKind =
  | "auth"            // 401/403
  | "not-found"       // 404 repo/branch
  | "empty-repo"      // 409 branch has no commits yet
  | "network"
  | "unexpected";
export class CommitError extends Error {
  constructor(public kind: CommitErrorKind, message: string) { super(message); }
}
export interface GitProvider {
  commit(req: CommitRequest): Promise<CommitResult>;
}
```

### GitHub commit sequence (`git/github.ts`)

`createGitHubProvider(fetchFn = fetch): GitProvider`. `commit(req)` runs the **Git Data API** so all
files land in one commit (not six Contents-API PUTs):

1. `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` → base commit sha. **404 → `not-found`.
   409 ("Git Repository is empty") → no ref yet; take the empty-repo path below.**
2. (existing branch only) `GET /repos/{owner}/{repo}/git/commits/{baseSha}` → base tree sha.
3. For each file: `POST /repos/{owner}/{repo}/git/blobs` `{ content, encoding: "utf-8" }` → blob sha.
4. `POST /repos/{owner}/{repo}/git/trees` `{ base_tree?, tree: [{ path, mode: "100644", type: "blob", sha }] }` → new tree sha. (`base_tree` omitted on the empty-repo path.)
5. `POST /repos/{owner}/{repo}/git/commits` `{ message, tree, parents }` → new commit sha + html_url. (`parents: [baseSha]` for an existing branch; `parents: []` for the empty-repo orphan commit.)
6. **Existing branch:** `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` `{ sha }`. **Empty repo:** `POST /repos/{owner}/{repo}/git/refs` `{ ref: "refs/heads/{branch}", sha }` → creates the branch.

All requests send `Authorization: Bearer {token}`, `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2022-11-28`. The ref write (step 6) is the single atomic switch — if any
earlier step fails, the branch is untouched. A brand-new empty repository is initialized
automatically (orphan first commit), so no manual seeding is required. Non-2xx responses map to
`CommitError` by status.

### Data flow

- **Commit:** UI `COMMIT` → main loads settings+token from clientStorage → `buildExport(collectData())`
  → maps each `ExportFile` to a `GitFile` at `{path}/{filename}` → `gitHubProvider.commit(...)` (fetch
  in main) → emits `COMMIT_RESULT { commitUrl }` or `COMMIT_ERROR { kind, message }` to UI.
- **Zip:** UI `EXPORT_ZIP` → main `buildExport` → sends files to UI → UI zips with fflate, downloads
  `timestampedZipName(new Date())`. (Download must be UI-side.)
- **Settings:** UI `SAVE_SETTINGS { settings }` → main validates + writes clientStorage. On launch,
  main reads clientStorage and sends `SETTINGS_LOADED { settings, tokenSet: boolean }` (token value
  itself is not sent back).

### Settings (`settings.ts`)

```ts
export interface Settings { owner: string; repo: string; branch: string; path: string }
```

Pure `validateSettings(s): string[]` — non-empty owner/repo/branch; `path` may be empty (repo root)
or a slash path without leading/trailing slashes (normalized). clientStorage keys:
`tokenexport.settings` (the `Settings`) and `tokenexport.token` (the PAT, stored separately).

### Commit message

Default `Update design tokens (N files) — <ISO timestamp>`; the UI may let the user override it
(optional, small). Keep default if blank.

## Error handling

Each `CommitErrorKind` maps to a clear UI message: `auth` → "GitHub token invalid or missing
Contents write permission"; `not-found` → "Repo or branch not found — check owner/repo/branch";
`network` → "Network error reaching api.github.com"; `unexpected` → the raw status/message.
(`empty-repo` is no longer surfaced for the normal flow — an empty repo is initialized
automatically; the kind remains as a defensive mapping.) The zip path keeps
v1's behavior (empty-files guard, error status).

## Testing

- `git/github.test.ts`: inject a mock `fetchFn` returning scripted responses; assert (a) the request
  sequence + URLs + payloads (blobs/tree/commit/ref) for a happy path, (b) one commit references all
  six blobs, (c) each `CommitErrorKind` is produced from the matching status (401, 404, 409, network
  throw). No real network.
- `timestamp.test.ts`: `timestampedZipName(new Date("2026-05-26T12:07:03"))` → `tokens-20260526-120703.zip`;
  zero-padding verified.
- `settings.test.ts`: `validateSettings` accepts valid input, rejects empties, normalizes `path`.
- `buildExport` and the v1 suite stay green (22 tests).
- Manual QA (user, needs Figma): paste settings+PAT, click Commit, verify one commit with six files
  appears on GitHub with readable diffs; click Download .zip, verify timestamped filename.

## Manifest / config changes

`package.json` → `figma-plugin`: add
`"networkAccess": { "allowedDomains": ["api.github.com"], "reasoning": "Commit exported design tokens to the configured GitHub repository." }`
(replacing the v1 `["none"]`). Resize the UI window for the settings form.

## Process

Built on `feat/git-export` (off merged `main`). Subagent-driven execution like v1: pure modules
(`provider`/`github`/`settings`/`timestamp`) TDD-first, then the `main.ts`/`ui.tsx` glue, then a
final review, then PR. The PAT-commit and the timestamped zip ship together.
