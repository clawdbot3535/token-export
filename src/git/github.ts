// GitHub GitProvider using the Git Data API so all files land in ONE commit.
// fetch is injected for testability (defaults to the global Fetch API, which
// Figma exposes in the plugin main thread). When the target branch has no
// commits yet (empty repo), an orphan first commit is created and the ref is
// established with POST /git/refs.

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

function mapHttpError(status: number, text: string): CommitError {
  if (status === 401 || status === 403) {
    return new CommitError("auth", "GitHub token invalid or missing Contents write permission");
  }
  if (status === 404) {
    return new CommitError("not-found", "Repo or branch not found — check owner/repo/branch");
  }
  if (status === 409) {
    return new CommitError("empty-repo", "Target branch has no commits yet");
  }
  return new CommitError("unexpected", `GitHub API ${status}: ${text.slice(0, 200)}`);
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
      throw mapHttpError(res.status, text);
    }
    return res.json();
  }

  /** Base commit sha for the branch, or null when the repo/branch has no commits yet. */
  async function getBaseSha(base: string, branch: string, token: string): Promise<string | null> {
    let res: Response;
    try {
      res = await fetchFn(`${base}/git/ref/heads/${branch}`, { method: "GET", headers: headers(token) });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new CommitError("network", `Network error reaching api.github.com: ${msg}`);
    }
    if (res.status === 409) return null; // empty repository — no commits yet
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw mapHttpError(res.status, text);
    }
    const body = await res.json();
    return body.object.sha as string;
  }

  return {
    async commit(req: CommitRequest): Promise<CommitResult> {
      const base = `${API}/repos/${req.owner}/${req.repo}`;

      const baseSha = await getBaseSha(base, req.branch, req.token);

      let baseTree: string | undefined;
      if (baseSha) {
        const baseCommit = await call("GET", `${base}/git/commits/${baseSha}`, req.token);
        baseTree = baseCommit.tree.sha;
      }

      const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      for (const f of req.files) {
        const blob = await call("POST", `${base}/git/blobs`, req.token, {
          content: f.content,
          encoding: "utf-8",
        });
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      }

      const newTree = await call(
        "POST",
        `${base}/git/trees`,
        req.token,
        baseTree ? { base_tree: baseTree, tree } : { tree },
      );

      const commit = await call("POST", `${base}/git/commits`, req.token, {
        message: req.message,
        tree: newTree.sha,
        parents: baseSha ? [baseSha] : [],
      });

      if (baseSha) {
        await call("PATCH", `${base}/git/refs/heads/${req.branch}`, req.token, { sha: commit.sha });
      } else {
        await call("POST", `${base}/git/refs`, req.token, {
          ref: `refs/heads/${req.branch}`,
          sha: commit.sha,
        });
      }

      return { sha: commit.sha, commitUrl: commit.html_url };
    },
  };
}
