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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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
    if (method === "PUT" && url.includes("/contents/"))
      return json({ commit: { sha: "INITSHA", tree: { sha: "INITTREE" }, html_url: "https://github.com/me/tokens/commit/INITSHA" } }, 201);
    if (method === "POST" && url.includes("/git/blobs")) return json({ sha: `BLOB${++blob}` });
    if (method === "POST" && url.includes("/git/trees")) return json({ sha: "NEWTREE" });
    if (method === "POST" && url.includes("/git/commits"))
      return json({ sha: "NEWCOMMIT", html_url: "https://github.com/me/tokens/commit/NEWCOMMIT" });
    if (method === "PATCH" && url.includes("/git/refs/heads/")) return json({ object: { sha: "NEWCOMMIT" } });
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("createGitHubProvider.commit — non-empty repo (existing branch)", () => {
  it("creates one commit on top of the base and returns the commit url", async () => {
    const { fn, calls } = mockFetch();
    const result = await createGitHubProvider(fn).commit(req(2));

    expect(result).toEqual({
      sha: "NEWCOMMIT",
      commitUrl: "https://github.com/me/tokens/commit/NEWCOMMIT",
    });

    // no Contents bootstrap on a non-empty repo
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

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

describe("createGitHubProvider.commit — empty repo (no ref yet)", () => {
  it("bootstraps an initial commit via the Contents API, then commits tokens on top", async () => {
    const { fn, calls } = mockFetch({ "/git/ref/heads/": { status: 409 } });
    const result = await createGitHubProvider(fn).commit(req(2));

    expect(result).toEqual({
      sha: "NEWCOMMIT",
      commitUrl: "https://github.com/me/tokens/commit/NEWCOMMIT",
    });

    // bootstrap: PUT a README via the Contents API to create the first commit + branch
    const initPut = calls.find((c) => c.method === "PUT" && c.url.includes("/contents/README.md"))!;
    expect(initPut.body).toEqual({
      message: "Initialize repository",
      content: "IyBEZXNpZ24gdG9rZW5zCg==",
      branch: "main",
    });

    // base comes from the bootstrap response — no base-commit GET on an empty repo
    expect(calls.some((c) => c.method === "GET" && c.url.includes("/git/commits/"))).toBe(false);

    const treePost = calls.find((c) => c.url.includes("/git/trees"))!;
    expect(treePost.body.base_tree).toBe("INITTREE");

    const commitPost = calls.find((c) => c.url.endsWith("/git/commits"))!;
    expect(commitPost.body.parents).toEqual(["INITSHA"]);

    // branch exists after bootstrap → PATCH (not POST /git/refs)
    const refPatch = calls.find((c) => c.method === "PATCH")!;
    expect(refPatch.body).toEqual({ sha: "NEWCOMMIT" });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/git/refs"))).toBe(false);
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
  it("maps a thrown fetch to network", async () => {
    const { fn } = mockFetch({ "/git/ref/heads/": { status: -1 } });
    await expect(createGitHubProvider(fn).commit(req())).rejects.toMatchObject({ kind: "network" });
  });
});
