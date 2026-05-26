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
