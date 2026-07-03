import { spawnSync } from "node:child_process";

export interface GitDiff {
  added: number;
  deleted: number;
}

export interface GitInfo {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  diff: GitDiff | null;
}

const GIT_TIMEOUT_MS = 1000;
const GIT_DIFF_TIMEOUT_MS = 2000;

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  red: "\x1b[31m",
} as const;

function git(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): string | null {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: timeoutMs });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout;
}

export function parseNumstat(out: string): GitDiff | null {
  let added = 0;
  let deleted = 0;
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawAdded, rawDeleted] = trimmed.split(/\s+/);
    if (rawAdded === undefined || rawDeleted === undefined) continue;
    // Binary files report "-" for both columns; Number.parseInt yields NaN → skip.
    const na = Number.parseInt(rawAdded, 10);
    const nd = Number.parseInt(rawDeleted, 10);
    if (Number.isFinite(na)) added += na;
    if (Number.isFinite(nd)) deleted += nd;
  }
  return added === 0 && deleted === 0 ? null : { added, deleted };
}

export function parseAheadBehind(out: string | null): { ahead: number; behind: number } {
  if (!out) return { ahead: 0, behind: 0 };
  const [rawBehind, rawAhead] = out.trim().split(/\s+/);
  if (rawBehind === undefined || rawAhead === undefined) return { ahead: 0, behind: 0 };
  const behind = Number.parseInt(rawBehind, 10) || 0;
  const ahead = Number.parseInt(rawAhead, 10) || 0;
  return { ahead, behind };
}

export function collectGitInfo(cwd: string): GitInfo | null {
  const branchOut = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchOut === null) return null; // not a repo, or git unavailable
  let branch = branchOut.trim();
  if (!branch) return null;
  if (branch === "HEAD") {
    const sha = git(cwd, ["rev-parse", "--short", "HEAD"]);
    branch = sha ? sha.trim() : "HEAD";
  }

  const status = git(cwd, ["--no-optional-locks", "status", "--porcelain"]);
  const dirty = status !== null && status.trim().length > 0;

  let diff: GitDiff | null = null;
  if (dirty) {
    const numstat = git(cwd, ["diff", "--numstat", "HEAD"], GIT_DIFF_TIMEOUT_MS);
    diff = numstat !== null ? parseNumstat(numstat) : null;
  }

  const { ahead, behind } = parseAheadBehind(
    git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
  );

  return { branch, dirty, ahead, behind, diff };
}

export function formatGitSegment(info: GitInfo, opts: { color?: boolean } = {}): string {
  const color = opts.color ?? true;
  const paint = (code: string, text: string): string => (color ? `${code}${text}${ANSI.reset}` : text);

  const inner: string[] = [paint(ANSI.cyan, info.branch + (info.dirty ? "*" : ""))];

  if (info.ahead > 0) inner.push(paint(ANSI.blue, `↑${info.ahead}`));
  if (info.behind > 0) inner.push(paint(ANSI.blue, `↓${info.behind}`));

  if (info.diff) {
    const diffParts: string[] = [];
    if (info.diff.added > 0) diffParts.push(paint(ANSI.green, `+${info.diff.added}`));
    if (info.diff.deleted > 0) diffParts.push(paint(ANSI.red, `-${info.diff.deleted}`));
    if (diffParts.length > 0) inner.push(`[${diffParts.join(" ")}]`);
  }

  return `${paint(ANSI.dim, "git:(")}${inner.join(" ")}${paint(ANSI.dim, ")")}`;
}

export function renderGitSegment(cwd: string | undefined, opts?: { color?: boolean }): string {
  if (process.env.CAFFEINATE_GIT_DISABLE === "1") return "";
  if (!cwd) return "";
  try {
    const info = collectGitInfo(cwd);
    if (!info) return "";
    return formatGitSegment(info, opts);
  } catch {
    return "";
  }
}
