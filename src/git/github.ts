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
